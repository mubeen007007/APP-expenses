package com.kharcha.expensetracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class BankSmsReceiver extends BroadcastReceiver {
  private static final Pattern CURRENCY_FIRST = Pattern.compile(
    "(?i)(?:PKR|Rs\\.?|Rupees?)\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"
  );
  private static final Pattern CURRENCY_LAST = Pattern.compile(
    "(?i)([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:PKR|Rs\\.?|Rupees?)"
  );

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
    String lower = body.toLowerCase(Locale.US);
    if (lower.contains("otp") || lower.contains("one time password") || lower.contains("verification code")) return false;

    String type;
    if (contains(lower, "debited", "debit", "debit of", "a/c dr", "account dr")) {
      type = "debit";
    } else if (
      contains(lower, "credited", "credit of", "received", "deposited", "deposit of", "salary", "cash deposit", "funds added", "a/c cr", "account cr") ||
      (lower.contains("credit") && !lower.contains("credit card"))
    ) {
      type = "credit";
    } else if (contains(lower, "spent", "charged", "withdrawn", "withdrawal", "purchase", "payment", "paid", "deducted", "transferred", "transfer of", "transaction of", "txn of", "you sent", "sent to", "sent pkr", "sent rs")) {
      type = "debit";
    } else {
      return false;
    }

    Matcher matcher = CURRENCY_FIRST.matcher(body);
    if (!matcher.find()) {
      matcher = CURRENCY_LAST.matcher(body);
      if (!matcher.find()) return false;
    }

    double amount;
    try {
      amount = Double.parseDouble(matcher.group(1).replace(",", ""));
    } catch (Exception ignored) {
      return false;
    }
    if (amount <= 0) return false;

    String safeSender = sender.replaceAll("[^A-Za-z0-9+_-]", "");
    if (safeSender.length() > 24) safeSender = safeSender.substring(0, 24);
    String description = "Bank " + type + (safeSender.isEmpty() ? "" : " · " + safeSender);
    return ExpenseStore.add(context, stableId(sourceKey), description, amount, type, timestamp, body);
  }

  private static boolean contains(String text, String... terms) {
    for (String term : terms) if (text.contains(term)) return true;
    return false;
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
