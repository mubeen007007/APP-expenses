package com.moneysync.expensetracker;

import android.app.Notification;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.provider.Telephony;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.LinkedHashSet;

public class GmailNotificationListener extends NotificationListenerService {
  @Override
  public void onNotificationPosted(StatusBarNotification notification) {
    processNotification(notification);
  }

  @Override
  public void onListenerConnected() {
    super.onListenerConnected();
    StatusBarNotification[] active = getActiveNotifications();
    if (active == null) return;
    for (StatusBarNotification notification : active) processNotification(notification);
  }

  private void processNotification(StatusBarNotification notification) {
    if (notification == null) return;
    if (isPreMigrationAlert(notification.getPostTime())) return;
    String packageName = notification.getPackageName();
    if (getPackageName().equals(packageName) || "com.android.systemui".equals(packageName) || "android".equals(packageName)) return;
    // The SMS broadcast is the authoritative route when enabled. Messaging
    // notifications can add previews, SIM labels or several messages, so they
    // must not become a second expense. Bank/Gmail notifications remain enabled.
    if (ImportSourcePolicy.skipSmsNotification(packageName, Telephony.Sms.getDefaultSmsPackage(this),
        checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED)) {
      android.util.Log.d("MoneySyncImport", "Messaging notification skipped: direct SMS route enabled");
      return;
    }
    Notification value = notification.getNotification();
    if (value == null || (value.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

    Bundle extras = value.extras;
    if (extras == null) return;
    String title = stringValue(extras.get(Notification.EXTRA_TITLE));
    String appLabel = applicationLabel(packageName);
    String sender = title.isEmpty() ? appLabel : title;
    LinkedHashSet<String> parts = new LinkedHashSet<>();
    append(parts, extras.get(Notification.EXTRA_TEXT));
    append(parts, extras.get(Notification.EXTRA_BIG_TEXT));
    append(parts, extras.get(Notification.EXTRA_SUB_TEXT));
    append(parts, extras.get(Notification.EXTRA_INFO_TEXT));
    append(parts, extras.get(Notification.EXTRA_SUMMARY_TEXT));
    append(parts, value.tickerText);
    CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
    if (lines != null) for (CharSequence line : lines) append(parts, line);
    android.os.Parcelable[] messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
    if (messages != null) for (android.os.Parcelable message : messages) {
      if (message instanceof Bundle) append(parts, ((Bundle) message).get("text"));
    }

    String body = join(parts);
    if (body.isEmpty()) return;
    if (TransactionDetector.detect(appLabel + " " + sender, body) == null) return;

    long postedAt = notification.getPostTime();
    String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(postedAt));
    String sourceKey = "notification|" + day + "|" + packageName + "|" + sender + "|" + body;
    boolean emailNotification = packageName.toLowerCase(Locale.US).contains("gmail");
    String source = emailNotification || appLabel.isEmpty() ? sender : appLabel;
    BankSmsReceiver.parseAndSave(
      getApplicationContext(),
      source.isEmpty() ? "Money alert" : source,
      body,
      postedAt,
      sourceKey,
      ImportIdentity.hash(notification.getKey()),
      appLabel + " " + sender + " " + body
    );
  }

  private boolean isPreMigrationAlert(long postedAt) {
    SharedPreferences prefs = getSharedPreferences("moneysync_import_identity_v1", Context.MODE_PRIVATE);
    if (!prefs.contains("legacy_notification_cutoff")) {
      long cutoff = 0;
      java.io.File snapshot = new java.io.File(getFilesDir(), "kharcha_recovery.jsonl");
      if (snapshot.exists() && snapshot.length() > 0) {
        try {
          cutoff = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
        } catch (Exception ignored) {
          // On migration, prefer leaving old active notifications alone over
          // re-importing alerts previously suppressed by the legacy importer.
          cutoff = System.currentTimeMillis();
        }
      }
      if (!prefs.edit().putLong("legacy_notification_cutoff", cutoff).commit()) return true;
    }
    // Only the one-time upgrade boundary, not a rolling startup-time filter.
    // Fresh installs can still import active alerts; later reconnects process
    // all post-migration alerts through the persistent identity registry.
    return postedAt < prefs.getLong("legacy_notification_cutoff", 0);
  }

  private static void append(LinkedHashSet<String> target, Object value) {
    String text = stringValue(value);
    if (!text.isEmpty()) target.add(text);
  }

  private static String join(LinkedHashSet<String> parts) {
    StringBuilder result = new StringBuilder();
    for (String part : parts) {
      boolean containedByLongerPart = false;
      for (String other : parts) if (!part.equals(other) && other.contains(part)) {
        containedByLongerPart = true;
        break;
      }
      if (containedByLongerPart) continue;
      if (result.length() > 0) result.append(" · ");
      result.append(part);
    }
    return result.toString();
  }

  private static String stringValue(Object value) {
    return value == null ? "" : String.valueOf(value)
      .replace('\u00a0', ' ').replaceAll("[\\u200B-\\u200D\\uFEFF]", "")
      .replaceAll("\\s+", " ").trim();
  }

  private String applicationLabel(String packageName) {
    try {
      ApplicationInfo info = getPackageManager().getApplicationInfo(packageName, 0);
      return stringValue(getPackageManager().getApplicationLabel(info));
    } catch (Exception ignored) {
      return "";
    }
  }

}
