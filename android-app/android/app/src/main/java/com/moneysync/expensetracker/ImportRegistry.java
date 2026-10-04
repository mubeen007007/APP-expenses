package com.moneysync.expensetracker;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local hashed alert identities, shared by SMS and every notification source. */
final class ImportRegistry {
  private ImportRegistry() {}

  static synchronized boolean save(Context context, String sourceKey, String description,
      String body, double amount, String currency, String type, long timestamp, String notificationSlot) {
    return save(context, sourceKey, description, body, amount, currency, type, timestamp, notificationSlot, description + " " + body);
  }

  static synchronized boolean save(Context context, String sourceKey, String description,
      String body, double amount, String currency, String type, long timestamp, String notificationSlot,
      String categorySource) {
    return save(context, sourceKey, description, body, amount, currency, type, timestamp,
      notificationSlot, categorySource, "", "", "", "");
  }

  static synchronized boolean save(Context context, String sourceKey, String description,
      String body, double amount, String currency, String type, long timestamp, String notificationSlot,
      String categorySource, String sender, String counterparty, String account, String reference) {
    try {
      SharedPreferences prefs = context.getSharedPreferences("moneysync_import_identity_v1", Context.MODE_PRIVATE);
      JSONArray stored = new JSONArray(prefs.getString("alerts", "[]"));
      ImportIdentity incoming = ImportIdentity.from(sourceKey, body, currency, type, amount, timestamp, notificationSlot);
      // Preserve legacy source IDs when this delivery predates the upgrade.
      String canonical = (sourceKey.startsWith("notification|") ? "notif-" : "sms-")
        + incoming.delivery.substring(0, 24);
      String duplicateOf = "";
      boolean matched = false;
      for (int i = stored.length() - 1; i >= 0; i--) {
        JSONObject row = stored.getJSONObject(i);
        if (incoming.sameTransaction(read(row))) {
          canonical = row.getString("id");
          duplicateOf = row.optString("duplicateOf", "");
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (int i = stored.length() - 1; i >= 0; i--) {
          JSONObject row = stored.getJSONObject(i);
          if (incoming.needsReview(read(row))) {
            duplicateOf = row.optString("duplicateOf", "");
            if (duplicateOf.isEmpty()) duplicateOf = row.getString("id");
            break;
          }
        }
      }
      JSONArray next = new JSONArray();
      long cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000;
      for (int i = Math.max(0, stored.length() - 2047); i < stored.length(); i++) {
        JSONObject row = stored.getJSONObject(i);
        if (row.optLong("seen") >= cutoff && !incoming.delivery.equals(row.optString("delivery"))) next.put(row);
      }
      JSONObject row = new JSONObject();
      row.put("id", canonical); row.put("delivery", incoming.delivery);
      row.put("duplicateOf", duplicateOf);
      row.put("channel", incoming.channel); row.put("content", incoming.content);
      row.put("reference", incoming.reference); row.put("account", incoming.account);
      row.put("slot", incoming.slot);
      row.put("currency", incoming.currency); row.put("type", incoming.type); row.put("cents", incoming.cents);
      row.put("timestamp", incoming.timestamp); row.put("seen", System.currentTimeMillis());
      next.put(row);
      // Commit the identity first. If queue writing fails or the process dies,
      // redelivery resolves to the same ID and retries the write (never lost).
      if (!prefs.edit().putString("alerts", next.toString()).commit()) return false;
      // Repeated deliveries may enqueue the same ID: SQLite INSERT OR IGNORE
      // and the widget's counted-ID set both make that write idempotent.
      return ExpenseStore.add(context, canonical, description, amount, currency, type,
        incoming.timestamp, categorySource, duplicateOf, incoming.channel,
        body, sender, counterparty, account, reference);
    } catch (Exception error) {
      android.util.Log.e("MoneySyncImport", "Could not persist alert identity", error);
      return false;
    }
  }

  private static ImportIdentity read(JSONObject row) throws org.json.JSONException {
    return new ImportIdentity(row.getString("delivery"), row.getString("channel"),
      row.getString("content"), row.getString("reference"), row.getString("account"),
      row.optString("slot", ""), row.optString("currency", "PKR"), row.getString("type"), row.getLong("cents"), row.getLong("timestamp"));
  }
}
