package com.kharcha.expensetracker;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

final class ExpenseStore {
  private ExpenseStore() {}

  static File databaseFile(Context context) {
    return new File(new File(context.getFilesDir(), "SQLite"), "kharcha.db");
  }

  static void migrateLegacy(Context context) {
    if (context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
      .getBoolean("legacy_database_migrated", false)) return;
    File target = databaseFile(context);
    File parent = target.getParentFile();
    if (parent != null && !parent.exists()) parent.mkdirs();
    File legacy = context.getDatabasePath("kharcha.db");
    if (!legacy.exists() || legacy.equals(target)) {
      context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
        .edit().putBoolean("legacy_database_migrated", true).apply();
      return;
    }

    SQLiteDatabase db = null;
    try {
      db = SQLiteDatabase.openOrCreateDatabase(target, null);
      ensureSchema(db);
      db.execSQL("ATTACH DATABASE ? AS legacy_kharcha", new Object[]{legacy.getAbsolutePath()});
      db.execSQL(
        "INSERT OR IGNORE INTO expenses (id, description, amount, type, category, created_at) " +
          "SELECT id, description, amount, type, category, created_at FROM legacy_kharcha.expenses"
      );
      db.execSQL("DETACH DATABASE legacy_kharcha");
      context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
        .edit().putBoolean("legacy_database_migrated", true).apply();
    } catch (Exception ignored) {
      // The legacy copy stays untouched, so migration can be retried safely.
    } finally {
      if (db != null) db.close();
    }
  }

  static boolean add(Context context, String id, String description, double amount, String type, long timeMillis) {
    return add(context, id, description, amount, type, timeMillis, description);
  }

  static boolean add(Context context, String id, String description, double amount, String type, long timeMillis, String categorySource) {
    if (description == null || description.trim().isEmpty() || amount <= 0) return false;
    migrateLegacy(context);
    File file = databaseFile(context);
    File parent = file.getParentFile();
    if (parent != null && !parent.exists()) parent.mkdirs();
    String chosenId = id == null ? UUID.randomUUID().toString() : id;
    String cleanDescription = description.trim().substring(0, Math.min(120, description.trim().length()));
    String cleanType = "credit".equals(type) ? "credit" : "debit";
    String category = categorize(categorySource, cleanType);
    String createdAt = isoDate(timeMillis);

    SQLiteDatabase db = null;
    try {
      db = SQLiteDatabase.openOrCreateDatabase(file, null);
      ensureSchema(db);
      if (id != null && isDuplicateImport(db, amount, type, timeMillis)) return false;
      ContentValues values = new ContentValues();
      values.put("id", chosenId);
      values.put("description", cleanDescription);
      values.put("amount", amount);
      values.put("type", cleanType);
      values.put("category", category);
      values.put("created_at", createdAt);
      long result = db.insertWithOnConflict("expenses", null, values, SQLiteDatabase.CONFLICT_IGNORE);
      if (result != -1) {
        appendPending(context, chosenId, cleanDescription, amount, cleanType, category, createdAt);
        KharchaWidget.refreshAll(context);
      }
      return result != -1;
    } catch (Exception ignored) {
      return appendPending(context, chosenId, cleanDescription, amount, cleanType, category, createdAt);
    } finally {
      if (db != null) db.close();
    }
  }

  static void seedPendingBridge(Context context) {
    if (context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
      .getBoolean("pending_bridge_seed_v1", false)) return;
    migrateLegacy(context);
    File file = databaseFile(context);
    if (!file.exists()) return;

    SQLiteDatabase db = null;
    Cursor cursor = null;
    try {
      db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
      cursor = db.rawQuery(
        "SELECT id, description, amount, type, category, created_at FROM expenses ORDER BY created_at ASC",
        null
      );
      while (cursor.moveToNext()) {
        appendPending(
          context,
          cursor.getString(0),
          cursor.getString(1),
          cursor.getDouble(2),
          cursor.getString(3),
          cursor.getString(4),
          cursor.getString(5)
        );
      }
      context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
        .edit().putBoolean("pending_bridge_seed_v1", true).apply();
    } catch (Exception ignored) {
      // Retry on the next app launch if the database was temporarily busy.
    } finally {
      if (cursor != null) cursor.close();
      if (db != null) db.close();
    }
  }

  static synchronized void writeRecoverySnapshot(Context context) {
    migrateLegacy(context);
    File database = databaseFile(context);
    if (!database.exists()) return;
    File target = new File(context.getFilesDir(), "kharcha_recovery.jsonl");
    File temporary = new File(context.getFilesDir(), "kharcha_recovery.jsonl.tmp");
    if (temporary.exists()) temporary.delete();

    SQLiteDatabase db = null;
    Cursor cursor = null;
    try (
      BufferedWriter writer = new BufferedWriter(
        new OutputStreamWriter(new FileOutputStream(temporary, false), StandardCharsets.UTF_8)
      )
    ) {
      db = SQLiteDatabase.openDatabase(database.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
      cursor = db.rawQuery(
        "SELECT id, description, amount, type, category, created_at FROM expenses ORDER BY created_at ASC",
        null
      );
      while (cursor.moveToNext()) {
        JSONObject item = new JSONObject();
        item.put("id", cursor.getString(0));
        item.put("description", cursor.getString(1));
        item.put("amount", cursor.getDouble(2));
        item.put("type", cursor.getString(3));
        item.put("category", cursor.getString(4));
        item.put("createdAt", cursor.getString(5));
        writer.write(item.toString());
        writer.newLine();
      }
      writer.flush();
      if (target.exists() && !target.delete()) return;
      temporary.renameTo(target);
    } catch (Exception ignored) {
      // Keep the previous complete snapshot, if any, and retry on next resume.
    } finally {
      if (cursor != null) cursor.close();
      if (db != null) db.close();
      if (temporary.exists()) temporary.delete();
    }
  }

  private static synchronized boolean appendPending(
    Context context,
    String id,
    String description,
    double amount,
    String type,
    String category,
    String createdAt
  ) {
    File pending = new File(context.getFilesDir(), "kharcha_pending.jsonl");
    try (
      BufferedWriter writer = new BufferedWriter(
        new OutputStreamWriter(new FileOutputStream(pending, true), StandardCharsets.UTF_8)
      )
    ) {
      JSONObject item = new JSONObject();
      item.put("id", id);
      item.put("description", description);
      item.put("amount", amount);
      item.put("type", type);
      item.put("category", category);
      item.put("createdAt", createdAt);
      writer.write(item.toString());
      writer.newLine();
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  private static void ensureSchema(SQLiteDatabase db) {
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS expenses (" +
        "id TEXT PRIMARY KEY NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, " +
        "type TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL)"
    );
  }

  private static boolean isDuplicateImport(SQLiteDatabase db, double amount, String type, long timeMillis) {
    Cursor cursor = null;
    try {
      cursor = db.rawQuery(
        "SELECT created_at FROM expenses WHERE (id LIKE 'sms-%' OR id LIKE 'import-%') " +
          "AND type = ? AND ABS(amount - ?) < 0.01 ORDER BY created_at DESC LIMIT 12",
        new String[]{type, String.valueOf(amount)}
      );
      SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
      iso.setTimeZone(TimeZone.getTimeZone("UTC"));
      while (cursor.moveToNext()) {
        Date date = iso.parse(cursor.getString(0));
        if (date != null && Math.abs(date.getTime() - timeMillis) <= 10 * 60 * 1000L) return true;
      }
    } catch (Exception ignored) {
      return false;
    } finally {
      if (cursor != null) cursor.close();
    }
    return false;
  }

  private static String isoDate(long millis) {
    SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    iso.setTimeZone(TimeZone.getTimeZone("UTC"));
    return iso.format(new Date(millis));
  }

  private static String categorize(String description, String type) {
    if ("credit".equals(type)) return "Income";
    String text = description.toLowerCase(Locale.US);
    if (contains(text, "lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee", "food", "pizza", "burger", "kfc", "mcdonald", "hardees", "domino", "cheezious")) return "Food";
    if (contains(text, "grocery", "groceries", "mart", "supermarket", "milk", "imtiaz", "carrefour", "naheed", "alfatah", "al-fatah")) return "Groceries";
    if (contains(text, "careem", "uber", "indrive", "bykea", "fuel", "petrol", "taxi", "ride", "shell", "pso", "total parco")) return "Transport";
    if (contains(text, "shirt", "dress", "clothes", "shoes", "shopping", "daraz", "mall", "outfitters", "limelight", "khaadi")) return "Shopping";
    if (contains(text, "bill", "electricity", "internet", "mobile", "gas", "water", "subscription", "ptcl", "lesco", "wapda", "jazz", "zong", "telenor", "ufone", "netflix", "spotify")) return "Bills";
    if (contains(text, "rent", "repair", "furniture", "cleaning")) return "Home";
    if (contains(text, "doctor", "medicine", "pharmacy", "hospital", "clinic")) return "Health";
    if (contains(text, "atm", "cash withdrawal", "withdrawal", "cash out")) return "Cash";
    if (contains(text, "transfer", "ibft", "raast", "sent to", "send to", "advance", "loan", "lent", "borrowed")) return "Transfers";
    if (contains(text, "office", "client", "work", "business", "freelance", "salary advance")) return "Work";
    if (contains(text, "school", "college", "university", "tuition", "course", "textbook", "books", "stationery", "exam fee")) return "Education";
    if (contains(text, "cinema", "movie", "game", "gaming", "concert", "spotify", "youtube premium")) return "Entertainment";
    if (contains(text, "salon", "barber", "spa", "gift", "skincare", "cosmetic", "makeup")) return "Personal";
    if (contains(text, "hotel", "flight", "airline", "booking", "visa", "trip", "airbnb")) return "Travel";
    String trimmed = description.trim();
    if (trimmed.matches("[A-Z][a-z]{2,}(\\s+[A-Z][a-z]{2,}){0,2}")) return "Transfers";
    return "Other";
  }

  private static boolean contains(String text, String... terms) {
    for (String term : terms) if (text.contains(term)) return true;
    return false;
  }
}
