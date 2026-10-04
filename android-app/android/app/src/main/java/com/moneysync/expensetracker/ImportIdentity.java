package com.moneysync.expensetracker;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.text.ParsePosition;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bank-independent identity signals. Never treat amount/time alone as identity. */
final class ImportIdentity {
  private static final Pattern REFERENCE = Pattern.compile(
    "(?i)\\b(?:(?:tx(?:n)?|transaction)\\s*(?:id|number|no\\.?|#)|(?:reference|ref|rrn|utr)\\s*(?:id|number|no\\.?)?)\\s*[:#=-]?\\s*([a-z0-9][a-z0-9-]{7,63})\\b");
  private static final Pattern ACCOUNT = Pattern.compile(
    "(?i)(?:\\*{1,}|[xX]{2,})\\s*(\\d{3,6})\\b");
  final String delivery, channel, content, reference, account, slot, currency, type;
  final long cents, timestamp;

  ImportIdentity(String delivery, String channel, String content, String reference,
      String account, String slot, String currency, String type, long cents, long timestamp) {
    this.delivery = delivery; this.channel = channel; this.content = content;
    this.reference = reference; this.account = account; this.slot = slot;
    this.currency = currency; this.type = type;
    this.cents = cents; this.timestamp = timestamp;
  }

  static ImportIdentity from(String sourceKey, String body, String currency, String type, double amount, long timestamp) {
    return from(sourceKey, body, currency, type, amount, timestamp, "");
  }

  static ImportIdentity from(String sourceKey, String body, String currency, String type, double amount, long timestamp,
      String notificationSlot) {
    String normalized = Normalizer.normalize(body, Normalizer.Form.NFKC)
      .toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    String reference = "";
    Matcher refs = REFERENCE.matcher(normalized);
    while (refs.find()) {
      String token = refs.group(1);
      // Exclude prose such as 'transaction completed' and plain dates.
      if (token.matches(".*\\d.*") && !token.matches("\\d{4}-\\d{2}-\\d{2}")) {
        reference = hash(token); break;
      }
    }
    Matcher accounts = ACCOUNT.matcher(normalized);
    String account = accounts.find() ? hash(accounts.group(1)) : "";
    String channel = "sms";
    if (sourceKey.startsWith("notification|")) {
      String[] parts = sourceKey.split("\\|", 4);
      channel = parts.length >= 3 ? "notification:" + parts[2] : "notification";
    }
    String slot = notificationSlot != null && notificationSlot.matches("[0-9a-f]{64}") ? notificationSlot : "";
    return new ImportIdentity(hash(sourceKey), channel, hash(normalized), reference,
      account, slot, currency, type, Math.round(amount * 100), transactionTime(body, timestamp));
  }

  // Only explicit, unambiguous date/time forms. Unknown formats use arrival
  // time; never guess the order of e.g. 03/04 or a foreign time zone.
  static long transactionTime(String body, long fallback) {
    String[] patterns = {"yyyy-MM-dd HH:mm:ss", "dd-MM-yyyy HH:mm:ss", "dd/MM/yyyy HH:mm:ss", "dd-MMM-yyyy HH:mm:ss"};
    Matcher dates = Pattern.compile("(?i)\\b(\\d{4}-\\d{2}-\\d{2}|\\d{2}[-/]\\d{2}[-/]\\d{4}|\\d{2}-[a-z]{3}-\\d{4})[ T]+(\\d{2}:\\d{2}:\\d{2})\\b").matcher(body);
    if (!dates.find()) return fallback;
    String date = dates.group(1);
    if (date.matches("\\d{2}[-/]\\d{2}[-/]\\d{4}") && Integer.parseInt(date.substring(0, 2)) <= 12) return fallback;
    String suffix = body.substring(dates.end()).trim();
    if (suffix.matches("(?i)^(?:Z\\b|[+-]\\d{2}:?\\d{2}|UTC\\b|GMT\\b|AM\\b|PM\\b).*")) return fallback;
    String value = date + " " + dates.group(2);
    for (String pattern : patterns) {
      SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.ENGLISH);
      format.setLenient(false);
      ParsePosition position = new ParsePosition(0);
      Date parsed = format.parse(value, position);
      if (parsed != null && position.getIndex() == value.length()
          && parsed.getTime() <= fallback + 5 * 60 * 1000L
          && parsed.getTime() >= fallback - 30L * 24 * 60 * 60 * 1000) return parsed.getTime();
    }
    return fallback;
  }

  boolean sameTransaction(ImportIdentity other) {
    if (delivery.equals(other.delivery)) return true;
    if (cents != other.cents || !currency.equals(other.currency) || !type.equals(other.type)) return false;
    if (!account.isEmpty() && !other.account.isEmpty() && !account.equals(other.account)) return false;
    if (!reference.isEmpty() && !other.reference.isEmpty()) {
      return reference.equals(other.reference)
        && Math.abs(timestamp - other.timestamp) <= 30L * 24 * 60 * 60 * 1000;
    }
    // Different delivery channels repeating the exact payment body are safe
    // to coalesce. Same-channel alerts can be genuine repeat payments, so
    // those go to review unless an explicit reference matches.
    return !channel.equals(other.channel) && content.equals(other.content)
      && Math.abs(timestamp - other.timestamp) <= 10L * 60 * 1000;
  }

  boolean needsReview(ImportIdentity other) {
    if (cents != other.cents || !currency.equals(other.currency) || !type.equals(other.type)) return false;
    if (!account.isEmpty() && !other.account.isEmpty() && !account.equals(other.account)) return false;
    // Conflicting explicit references mean two different payments.
    if (!reference.isEmpty() && !other.reference.isEmpty() && !reference.equals(other.reference)) return false;
    // Different-looking alerts from the same provider can still represent a
    // single payment (e.g. an SMS and a second preview, or a notification
    // update). Do not silently merge on amount/time alone: keep the second
    // alert out of totals and offer it for review. A narrow same-channel
    // window limits disruption to genuine repeat payments.
    long elapsed = Math.abs(timestamp - other.timestamp);
    if (!slot.isEmpty() && slot.equals(other.slot) && elapsed <= 6L * 60 * 60 * 1000) return true;
    return elapsed <= (channel.equals(other.channel) ? 2L : 10L) * 60 * 1000;
  }

  static String hash(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder();
      for (byte part : digest) result.append(String.format(Locale.ROOT, "%02x", part));
      return result.toString();
    } catch (Exception error) {
      throw new IllegalStateException("SHA-256 unavailable", error);
    }
  }
}
