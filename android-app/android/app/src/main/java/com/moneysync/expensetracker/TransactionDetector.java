package com.moneysync.expensetracker;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Conservative, local-only parser for completed bank and wallet transactions. */
final class TransactionDetector {
  private static final Pattern CURRENCY_FIRST = Pattern.compile(
    "(?i)(?:PKR|Rs\\.?|Rupees?)\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)"
  );
  private static final Pattern CURRENCY_LAST = Pattern.compile(
    "(?i)([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:PKR|Rs\\.?|Rupees?)"
  );
  private static final Pattern INCOMING_ACCOUNT_POSTING = Pattern.compile(
    "(?i)\\b(?:received(?:\\s+from)?|transferred|deposited|credited)\\b.{0,180}" +
      "\\b(?:in|into|to)\\s+(?:your\\s+)?(?:[a-z0-9*.-]+\\s+){0,6}(?:a/c|acct|account)\\b"
  );

  private static final String[] FINANCIAL_IDENTIFIERS = {
    "bank", "banking", "hbl", "ubl", "mcb", "meezan", "alfalah", "al habib", "bahl",
    "faysal", "askari", "standard chartered", "scb", "nbp", "easypaisa", "jazzcash",
    "sadapay", "nayapay", "finja", "upaisa", "a/c", "acct", "account no", "account ending",
    "card ending", "card no", "debit card", "available balance", "avail bal", "avl bal",
    "current balance", "txn id", "transaction id", "raast", "ibft", "iban"
  };

  private static final String[] HARD_REJECTIONS = {
    "otp", "one time password", "one-time password", "verification code", "security code",
    "login code", "payment reminder", "payment due",
    "amount due", "minimum due", "bill due", "request money", "requested money"
  };

  private static final String[] COMMERCE_ONLY_SIGNALS = {
    "order confirmed", "order confirmation", "order placed", "order shipped", "out for delivery",
    "track your order", "tracking number", "delivery update", "shopping cart", "your cart",
    "wishlist", "coupon", "promo code", "flash sale", "discount", "cash on delivery",
    "payment method", "invoice attached", "refund requested", "refund initiated"
  };

  private static final String[] DEBIT_SIGNALS = {
    "debited", "debit of", "a/c dr", "account dr", "charged to your", "deducted from",
    "withdrawn", "withdrawal of", "spent at", "spent on your", "purchase of", "paid from",
    "card was charged", "charged on your", "sent to",
    "transferred to", "transfer of", "you sent"
  };

  private static final String[] CREDIT_SIGNALS = {
    "credited", "credit of", "a/c cr", "account cr", "deposited into", "deposit of",
    "received in your", "received into your", "salary credited", "cash deposit", "funds added"
  };

  static final class Result {
    final String type;
    final double amount;

    Result(String type, double amount) {
      this.type = type;
      this.amount = amount;
    }
  }

  private TransactionDetector() {}

  static Result detect(String sender, String body) {
    String safeSender = sender == null ? "" : sender;
    String safeBody = body == null ? "" : body;
    String combined = (safeSender + " " + safeBody).toLowerCase(Locale.US);

    if (safeBody.trim().isEmpty() || containsAny(combined, HARD_REJECTIONS)) return null;
    if (!containsAny(combined, FINANCIAL_IDENTIFIERS)) return null;

    String type = null;
    // Treat an incoming posting to the user's account as authoritative regardless of the bank,
    // sender name or whether the institution calls it received, transferred, deposited or credited.
    if (INCOMING_ACCOUNT_POSTING.matcher(combined).find()) type = "credit";
    else if (containsAny(combined, DEBIT_SIGNALS)) type = "debit";
    else if (containsAny(combined, CREDIT_SIGNALS)) type = "credit";
    if (type == null) return null;

    // Commerce notifications often contain money and words such as "payment" or "received".
    // Only accept one when it also contains an unmistakable account/card transaction marker.
    if (containsAny(combined, COMMERCE_ONLY_SIGNALS) && !hasAccountPostingEvidence(combined)) return null;

    Double amount = firstAmount(safeBody);
    if (amount == null || amount <= 0 || !Double.isFinite(amount)) return null;
    return new Result(type, amount);
  }

  private static boolean hasAccountPostingEvidence(String text) {
    return containsAny(text,
      "debited", "credited", "a/c dr", "a/c cr", "account dr", "account cr",
      "received from", "available balance", "avail bal", "avl bal", "current balance"
    );
  }

  private static Double firstAmount(String text) {
    Matcher matcher = CURRENCY_FIRST.matcher(text);
    if (!matcher.find()) {
      matcher = CURRENCY_LAST.matcher(text);
      if (!matcher.find()) return null;
    }
    try {
      return Double.parseDouble(matcher.group(1).replace(",", ""));
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  private static boolean containsAny(String text, String... terms) {
    for (String term : terms) if (text.contains(term)) return true;
    return false;
  }
}
