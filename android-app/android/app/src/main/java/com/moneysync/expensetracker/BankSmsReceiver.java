package com.moneysync.expensetracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

public class BankSmsReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
    SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
    if (messages == null || messages.length == 0) return;

    StringBuilder body = new StringBuilder();
    String sender = messages[0].getDisplayOriginatingAddress();
    long timestamp = messages[0].getTimestampMillis();
    for (SmsMessage message : messages) body.append(message.getMessageBody());
    parseAndSave(context, sender == null ? "Bank" : sender, body.toString(), timestamp);
  }

  static boolean parseAndSave(Context context, String sender, String body, long timestamp) {
    return parseAndSave(context, sender, body, timestamp, sender + "|" + body + "|" + timestamp);
  }

  static boolean parseAndSave(Context context, String sender, String body, long timestamp, String sourceKey) {
    TransactionDetector.Result transaction = TransactionDetector.detect(sender, body);
    if (transaction == null) return false;

    String safeSender = sender.replaceAll("[^A-Za-z0-9+_-]", "");
    if (safeSender.length() > 24) safeSender = safeSender.substring(0, 24);
    String description = "Bank " + transaction.type + (safeSender.isEmpty() ? "" : " · " + safeSender);
    return ExpenseStore.add(context, stableId(sourceKey), description, transaction.amount, transaction.type, timestamp, body);
  }

  private static String stableId(String input) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder("sms-");
      for (int i = 0; i < 12; i++) result.append(String.format(Locale.US, "%02x", digest[i]));
      return result.toString();
    } catch (Exception ignored) {
      return "sms-" + Integer.toHexString(input.hashCode());
    }
  }
}
