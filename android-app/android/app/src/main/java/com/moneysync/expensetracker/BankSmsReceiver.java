package com.moneysync.expensetracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;


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
    return parseAndSave(context, sender, body, timestamp, sourceKey, "");
  }

  static boolean parseAndSave(Context context, String sender, String body, long timestamp, String sourceKey,
      String notificationSlot) {
    return parseAndSave(context, sender, body, timestamp, sourceKey, notificationSlot, sender + " " + body);
  }

  static boolean parseAndSave(Context context, String sender, String body, long timestamp, String sourceKey,
      String notificationSlot, String categorySource) {
    TransactionDetector.Result transaction = TransactionDetector.detect(sender, body);
    if (transaction == null) return false;

    String description = describe(transaction, body);
    return ImportRegistry.save(context, sourceKey, description, body, transaction.amount,
      transaction.currency, transaction.type, timestamp, notificationSlot, categorySource,
      sender, transaction.counterparty, transaction.account, transaction.reference);
  }

  static String describe(TransactionDetector.Result transaction, String body) {
    String lower = body.toLowerCase(java.util.Locale.US);
    boolean refund = "credit".equals(transaction.type)
      && (lower.contains("reversed") || lower.contains("refund"));
    boolean purchase = "debit".equals(transaction.type)
      && (lower.contains(" paid ") || lower.contains(" pos ") || lower.contains("purchase") || lower.contains(" spent "));
    return transaction.counterparty.isEmpty()
      ? (refund ? "Refund credited" : "credit".equals(transaction.type) ? "Money received" : purchase ? "Payment made" : "Money sent")
      : ("credit".equals(transaction.type) ? "Received from "
        : lower.contains("paid for ") ? "Paid for "
        : lower.contains("paid to ") ? "Paid to "
        : lower.contains("sent to ") || lower.contains("transferred to ") ? "Sent to "
        : purchase || lower.contains("transaction successful") ? "Paid at " : "Sent to ") + transaction.counterparty;
  }

}
