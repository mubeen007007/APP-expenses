package com.moneysync.expensetracker;

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
import java.util.Currency;
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
    File legacy = context.getDatabasePath("kharcha.db");
    if (!legacy.exists() || legacy.equals(databaseFile(context))) {
      context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
        .edit().putBoolean("legacy_database_migrated", true).apply();
      return;
    }

    SQLiteDatabase db = null;
    Cursor cursor = null;
    try {
      // Never open the Expo database with Android's SQLite implementation.
      // Copy the old database into the durable import queue instead.
      db = SQLiteDatabase.openDatabase(legacy.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
      cursor = db.rawQuery("SELECT id, description, amount, type, category, created_at FROM expenses", null);
      while (cursor.moveToNext()) {
        if (!appendPending(context, cursor.getString(0), cursor.getString(1), cursor.getDouble(2),
          cursor.getString(3), cursor.getString(4), cursor.getString(5))) return;
      }
      context.getSharedPreferences("kharcha_native", Context.MODE_PRIVATE)
        .edit().putBoolean("legacy_database_migrated", true).apply();
    } catch (Exception ignored) {
      // The legacy copy stays untouched, so migration can be retried safely.
    } finally {
      if (cursor != null) cursor.close();
      if (db != null) db.close();
    }
  }

  static boolean add(Context context, String id, String description, double amount, String type, long timeMillis) {
    return add(context, id, description, amount, type, timeMillis, description);
  }

  static boolean add(Context context, String id, String description, double amount, String type, long timeMillis, String categorySource) {
    return add(context, id, description, amount, type, timeMillis, categorySource, "", "");
  }

  static boolean add(Context context, String id, String description, double amount, String type, long timeMillis,
      String categorySource, String duplicateOf, String source) {
    return add(context, id, description, amount, readBaseCurrency(context), type, timeMillis,
      categorySource, duplicateOf, source);
  }

  static boolean add(Context context, String id, String description, double amount, String currency, String type,
      long timeMillis, String categorySource, String duplicateOf, String source) {
    return add(context, id, description, amount, currency, type, timeMillis, categorySource,
      duplicateOf, source, "", "", "", "", "");
  }

  static boolean add(Context context, String id, String description, double amount, String currency, String type,
      long timeMillis, String categorySource, String duplicateOf, String source,
      String sourceText, String sourceSender, String counterparty, String account, String reference) {
    if (description == null || description.trim().isEmpty() || amount <= 0) return false;
    migrateLegacy(context);
    String chosenId = id == null ? UUID.randomUUID().toString() : id;
    String cleanDescription = description.trim().substring(0, Math.min(120, description.trim().length()));
    String cleanType = "credit".equals(type) ? "credit" : "debit";
    String category = TransactionCategorizer.categorize(categorySource, cleanType);
    String createdAt = isoDate(timeMillis);

    boolean saved = appendPending(context, chosenId, cleanDescription, amount, cleanType, category,
      createdAt, duplicateOf, source, cleanCurrency(currency), sourceText, sourceSender,
      counterparty, account, reference);
    if (saved) KharchaWidget.refreshAll(context);
    return saved;
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
      cursor = db.rawQuery("SELECT * FROM expenses ORDER BY created_at ASC", null);
      while (cursor.moveToNext()) {
        JSONObject item = new JSONObject();
        item.put("id", cursor.getString(0));
        item.put("description", cursor.getString(1));
        item.put("amount", cursor.getDouble(2));
        item.put("type", cursor.getString(3));
        item.put("category", cursor.getString(4));
        item.put("createdAt", cursor.getString(5));
        for (String[] field : new String[][] {
          {"currency", "currency"}, {"source_text", "sourceText"},
          {"source_sender", "sourceSender"}, {"source_channel", "sourceChannel"},
          {"counterparty", "counterparty"}, {"account", "account"}, {"reference", "reference"}
        }) {
          int column = cursor.getColumnIndex(field[0]);
          if (column >= 0 && !cursor.isNull(column)) item.put(field[1], cursor.getString(column));
        }
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
    return appendPending(context, id, description, amount, type, category, createdAt, "", "", "PKR");
  }

  private static synchronized boolean appendPending(Context context, String id, String description,
      double amount, String type, String category, String createdAt, String duplicateOf, String source) {
    return appendPending(context, id, description, amount, type, category, createdAt,
      duplicateOf, source, readBaseCurrency(context));
  }

  private static synchronized boolean appendPending(Context context, String id, String description,
      double amount, String type, String category, String createdAt, String duplicateOf, String source,
      String currency) {
    return appendPending(context, id, description, amount, type, category, createdAt,
      duplicateOf, source, currency, "", "", "", "", "");
  }

  private static synchronized boolean appendPending(Context context, String id, String description,
      double amount, String type, String category, String createdAt, String duplicateOf, String source,
      String currency, String sourceText, String sourceSender, String counterparty,
      String account, String reference) {
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
      item.put("currency", cleanCurrency(currency));
      if (!sourceText.isEmpty()) item.put("sourceText", sourceText);
      if (!sourceSender.isEmpty()) item.put("sourceSender", sourceSender);
      if (!counterparty.isEmpty()) item.put("counterparty", counterparty);
      if (!account.isEmpty()) item.put("account", account);
      if (!reference.isEmpty()) item.put("reference", reference);
      if (!duplicateOf.isEmpty()) item.put("duplicateOf", duplicateOf);
      if (!source.isEmpty()) item.put("source", source);
      writer.write(item.toString());
      writer.newLine();
      return true;
    } catch (Exception ignored) {
      return false;
    }
  }

  static String readBaseCurrency(Context context) {
    File file = new File(context.getFilesDir(), "moneysync_currency.txt");
    if (!file.exists()) return "PKR";
    try (java.io.BufferedReader reader = new java.io.BufferedReader(
      new java.io.InputStreamReader(new java.io.FileInputStream(file), StandardCharsets.UTF_8))) {
      return cleanCurrency(reader.readLine());
    } catch (Exception ignored) {
      return "PKR";
    }
  }

  private static String cleanCurrency(String currency) {
    String value = currency == null ? "" : currency.trim().toUpperCase(Locale.US);
    if (!value.matches("[A-Z]{3}")) return "PKR";
    try {
      Currency.getInstance(value);
      return value;
    } catch (IllegalArgumentException ignored) {
      return "PKR";
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

}
