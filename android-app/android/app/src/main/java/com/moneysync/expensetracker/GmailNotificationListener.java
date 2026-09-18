package com.moneysync.expensetracker;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

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
    String packageName = notification.getPackageName();
    if (getPackageName().equals(packageName) || "com.android.systemui".equals(packageName) || "android".equals(packageName)) return;
    Notification value = notification.getNotification();
    if (value == null || (value.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

    Bundle extras = value.extras;
    if (extras == null) return;
    String sender = stringValue(extras.get(Notification.EXTRA_TITLE));
    StringBuilder content = new StringBuilder();
    append(content, extras.get(Notification.EXTRA_TEXT));
    append(content, extras.get(Notification.EXTRA_BIG_TEXT));
    append(content, extras.get(Notification.EXTRA_SUB_TEXT));
    CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
    if (lines != null) for (CharSequence line : lines) append(content, line);

    String body = content.toString().trim();
    if (body.isEmpty()) return;
    if (TransactionDetector.detect(sender, body) == null) return;

    long postedAt = notification.getPostTime();
    String day = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(postedAt));
    String sourceKey = "notification|" + day + "|" + packageName + "|" + sender + "|" + body;
    BankSmsReceiver.parseAndSave(
      getApplicationContext(),
      sender.isEmpty() ? "Money alert" : sender,
      sender + " · " + body,
      postedAt,
      sourceKey
    );
  }

  private static void append(StringBuilder target, Object value) {
    String text = stringValue(value);
    if (text.isEmpty() || target.indexOf(text) >= 0) return;
    if (target.length() > 0) target.append(" · ");
    target.append(text);
  }

  private static String stringValue(Object value) {
    return value == null ? "" : String.valueOf(value).trim();
  }

}
