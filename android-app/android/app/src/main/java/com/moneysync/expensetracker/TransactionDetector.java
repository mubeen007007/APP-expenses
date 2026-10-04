package com.moneysync.expensetracker;

import java.util.Currency;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Conservative, local-only parser for completed bank and wallet transactions. */
final class TransactionDetector {
  private static final String CURRENCY_TOKEN =
    "(?:(?i:Rs\\.?|Rupees?)|(?i:[A-Z]{3,4})|US\\$|C\\$|A\\$|S\\$|HK\\$|NZ\\$|\\$|€|£|₹)";
  private static final Pattern CURRENCY_FIRST = Pattern.compile(
    "(" + CURRENCY_TOKEN + ")" +
      "\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,4})?)"
  );
  private static final Pattern CURRENCY_LAST = Pattern.compile(
    "([0-9][0-9,]*(?:\\.[0-9]{1,4})?)\\s*(" + CURRENCY_TOKEN + ")(?![a-zA-Z0-9-])"
  );
  private static final Pattern INCOMING_ACCOUNT_POSTING = Pattern.compile(
    "(?i)\\b(?:received(?:\\s+from)?|deposited|credited)\\b.{0,180}" +
      "\\b(?:in|into|to)\\s+(?:your\\s+)?(?:[a-z0-9*.-]+\\s+){0,8}(?:a\\s*/?\\s*c|acct|account)\\b|" +
      "\\btransferred\\s+to\\s+your\\s+(?:a\\s*/?\\s*c|acct|account)\\b"
  );
  private static final Pattern EXPLICIT_INCOMING = Pattern.compile(
    "(?i)\\b(?:received\\s+from|(?:you(?:['’]ve)?|your\\s+(?:a\\s*/?\\s*c|account|wallet))\\s+(?:have\\s+)?received|" +
      "credited\\s+(?:in|into|to|with)\\s+(?:your\\s+)?|(?:a\\s*/?\\s*c|account)\\s+(?:has\\s+been\\s+)?credited|" +
      "(?:funds|money|transfer|payment)\\s+(?:was\\s+|has\\s+been\\s+)?received)\\b"
  );
  // Stripe dashboard notices are directionally safe only when they explicitly say
  // funds reached the merchant's Stripe balance/account or a completed bank payout.
  private static final Pattern STRIPE_INCOMING_POSTING = Pattern.compile(
    "(?i)\\b(?:payment|charge)\\b.{0,120}\\b(?:successfully\\s+made|received|succeeded|successful|paid)\\b.{0,100}\\b(?:to\\s+your\\s+stripe\\s+(?:account|balance)|in\\s+your\\s+stripe\\s+balance)\\b"
  );
  private static final Pattern STRIPE_COMPLETED_PAYOUT = Pattern.compile(
    "(?i)\\bpayout\\b.{0,100}\\b(?:was\\s+)?(?:paid|completed|credited)\\b.{0,100}\\b(?:bank|account)\\b"
  );
  private static final Pattern REVERSAL_CREDIT = Pattern.compile("(?i)\\b(?:reversed|reversal)\\b.{0,80}\\bcredited\\b");
  private static final Pattern DIRECT_COUNTERPARTY = Pattern.compile(
    "(?i)\\b(?:received\\s+from|sent\\s+to|transferred\\s+to|paid\\s+to|paid\\s+at|" +
      "spent\\s+at|purchase\\s+at|paid\\s+for)\\s+(.+)"
  );
  private static final Pattern LATE_INCOMING_FROM = Pattern.compile(
    "(?i)\\breceived\\b.{0,180}?\\bfrom\\s+(.+)"
  );
  private static final Pattern CARD_MERCHANT = Pattern.compile(
    "(?i)\\bcard\\s+[*x0-9-]{2,}\\s+transaction\\s+(?:was\\s+)?successful\\s+" +
      "(.+?)\\s+[0-9][0-9,]*(?:\\.[0-9]{1,4})?\\s*" + CURRENCY_TOKEN + "\\b"
  );
  private static final Pattern COMPLETED_CARD_TRANSACTION = Pattern.compile(
    "(?i)\\bcard\\s+[*x0-9-]{2,}\\s+(?:transaction|payment)\\s+(?:was\\s+)?(?:successful|completed)\\b"
  );
  private static final Pattern COMPLETED_DEPOSIT = Pattern.compile(
    "(?i)\\b(?:deposit|deposited)\\s+(?:was\\s+)?(?:successful|successfully|completed|complete|confirmed)\\b|" +
      "\\b(?:successfully\\s+)?deposited\\b"
  );
  private static final String POS_EVENT = "(?:pos|point[ -]of[ -]sale)\\s+(?:transaction|txn|purchase|payment)";
  private static final Pattern COMPLETED_POS_TRANSACTION = Pattern.compile(
    "(?i)\\b(?:you\\s+(?:have\\s+)?|your\\s+card\\s+has\\s+)?" +
      "(?:performed|made|completed|conducted)\\s+(?:a\\s+)?" + POS_EVENT + "\\b|" +
      "\\b" + POS_EVENT + "\\b.{0,100}?\\b(?:successful|completed|approved|processed)\\b|" +
      "\\b(?:successful|completed|approved)\\s+" + POS_EVENT + "\\b"
  );
  private static final Pattern POS_ACCOUNT_POSTING = Pattern.compile(
    "(?i)\\b" + POS_EVENT + "\\b.{0,120}?\\b(?:from|on)\\s+(?:your\\s+)?" +
      "(?:account|a\\s*/?\\s*c|card)\\b"
  );
  private static final Pattern POS_MERCHANT = Pattern.compile(
    "(?i)\\b" + POS_EVENT + "\\b.{0,120}?\\b(?:at|on)\\s+" +
      "(?!account\\b|a\\s*/?\\s*c\\b|card\\b)(.+?)" +
      "(?=,?\\s+at\\s+\\d{1,2}:|\\s+dated\\b|\\s+from\\s+(?:your\\s+)?(?:account|a\\s*/?\\s*c|card)\\b|$)"
  );
  private static final String[] CRYPTO_CURRENCIES = {
    "USDT", "USDC", "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "LTC",
    "TRX", "TON", "DOT", "AVAX", "LINK", "XLM", "BCH", "SHIB", "DAI", "TUSD", "FDUSD"
  };
  private static final Pattern COUNTERPARTY_END = Pattern.compile(
    "(?i)\\s+(?:raast\\s+id\\b|(?:a\\s*/?\\s*c|acct|account)\\b|" +
      "(?:from|in|into|on|via|through|using|with|by)\\s+|" +
      "for\\s+(?=\\+?[0-9]{7,})|(?:tx(?:n)?|trx|ref(?:erence)?)\\s*(?:id|#))"
  );
  private static final Pattern MASKED_REFERENCE = Pattern.compile(
    "(?i)\\s+(?:[a-z]{2,4}[*x]{2,}[a-z0-9*x-]*|[*x]{2,}[a-z0-9*x-]*).*$"
  );
  private static final Pattern ACCOUNT_HINT = Pattern.compile(
    "(?i)\\b(?:a\\s*/?\\s*c|acct|account)(?:\\s*(?:no\\.?|#|ending))?\\s*[:#*xX ]*(?:\\d[*xX-]*){2,}\\d"
  );
  private static final Pattern TRANSACTION_REFERENCE = Pattern.compile(
    "(?i)\\b(?:trx|txn|transaction)\\s*(?:id|no\\.?|number|#)\\s*[:#-]?\\s*[a-z0-9-]{5,}\\b"
  );
  private static final Pattern REFERENCED_COMPLETED_DEBIT = Pattern.compile(
    "(?i)\\b(?:paid\\s+(?:for|to|via|through)|(?:payment|bill|recharge|top[ -]?up)\\b.{0,70}\\b(?:successful|completed|paid)|successfully\\s+paid)\\b"
  );
  private static final Pattern REFERENCED_COMPLETED_CREDIT = Pattern.compile(
    "(?i)\\b(?:received\\s+(?:from|in|into)|(?:money|funds|deposit|transfer|payment|cashback)\\s+(?:was\\s+)?(?:received|credited)|(?:money|funds)\\s+added|incoming\\s+transfer)\\b"
  );

  private static final String[] FINANCIAL_SENDER_IDENTIFIERS = {
    "bank", "wallet", "paisa", "cash", "finance", "money", "wise", "revolut", "redot",
    "paypal", "payoneer", "paytm", "stripe", "venmo", "cashapp", "cash app", "square", "skrill",
    "neteller", "zelle", "remitly", "worldremit", "monzo", "n26", "airwallex", "paysera",
    "exchange", "coinbase", "binance", "kraken", "crypto"
  };

  private static final String[] FINANCIAL_IDENTIFIERS = {
    "bank", "banking", "hbl", "ubl", "mcb", "meezan", "alfalah", "al habib", "bahl",
    "faysal", "askari", "standard chartered", "scb", "nbp", "easypaisa", "jazzcash",
    "sadapay", "nayapay", "finja", "upaisa", "paypal", "payoneer", "paytm", "wise", "stripe",
    "revolut", "venmo", "cashapp", "cash app", "square", "skrill", "neteller", "zelle", "remitly",
    "worldremit", "monzo", "n26", "airwallex", "paysera", "coinbase", "binance", "kraken",
    "a/c", "acct", "account no", "account ending",
    "card ending", "card no", "debit card", "available balance", "avail bal", "avl bal",
    "current balance", "txn id", "transaction id", "raast", "ibft", "iban"
  };

  private static final String[] HARD_REJECTIONS = {
    "otp", "one time password", "one-time password", "verification code", "security code",
    "login code", "payment reminder", "payment due",
    "amount due", "minimum due", "bill due", "request money", "requested money",
    "transaction declined", "was declined", "transaction failed", "payment failed", "charge failed", "payout failed", "deposit failed", "unsuccessful", "could not process",
    "payment pending", "transaction pending", "authorization required", "approval required",
    "payment reversed", "transaction reversed", "payment cancelled", "transaction cancelled",
    "order cancelled", "order canceled", "order was cancelled", "order was canceled",
    "spending summary", "monthly summary", "weekly summary", "monthly insights",
    "this month", "this week"
  };

  private static final String[] COMMERCE_ONLY_SIGNALS = {
    "order confirmed", "order confirmation", "order placed", "order shipped", "out for delivery",
    "track your order", "tracking number", "delivery update", "shopping cart", "your cart",
    "wishlist", "coupon", "promo code", "flash sale", "discount", "cash on delivery",
    "payment method", "invoice attached", "refund requested", "refund initiated"
  };

  private static final String[] DELIVERY_SENDERS = {
    "foodpanda", "uber eats", "ubereats", "deliveroo", "doordash", "talabat",
    "grubhub", "just eat", "justeat", "zomato", "swiggy"
  };
  private static final Pattern COMPLETED_DELIVERY_ORDER = Pattern.compile(
    "(?i)\\b(?:order\\s+(?:has\\s+been\\s+)?(?:delivered|completed)|delivered\\s+your\\s+order|" +
      "payment\\s+(?:was\\s+)?(?:successful|completed)|paid\\s+for\\s+your\\s+order)\\b"
  );
  private static final Pattern DELIVERY_ORDER_TOTAL = Pattern.compile(
    "(?i)\\b(?:order\\s+total|grand\\s+total|total\\s+(?:paid|amount|price|bill|payable)|" +
      "amount\\s+paid|you\\s+paid)\\b"
  );
  private static final String[] DELIVERY_ORDER_CONTEXT = {
    "order", "foodpanda", "uber eats", "ubereats", "deliveroo", "doordash", "talabat"
  };

  private static final String[] DEBIT_SIGNALS = {
    "debited", "debit of", "a/c dr", "account dr", "charged to your", "deducted from",
    "withdrawn", "withdrawal of", "spent at", "spent on your", "purchase of", "paid from", "you paid",
    "paid to", "payment made to",
    "card was charged", "charged on your", "sent to",
    "transferred to", "transfer of", "you sent", "you made a pos transaction",
    "you've sent", "payment sent", "card payment", "paid with your card", "you spent",
    "cash withdrawal", "you made a payment", "payment made",
    "you have made a pos transaction", "purchase transaction of",
    "paid for", "amount paid", "top-up successful", "top up successful", "topup successful", "recharge successful"
  };

  private static final String[] CREDIT_SIGNALS = {
    "credited", "credit of", "a/c cr", "account cr", "deposited into", "deposit of",
    "received in your", "received into your", "you received", "money received", "transfer received",
    "you've received", "you’ve received", "payment received", "salary credited", "cash deposit", "funds added", "refund of", "refunded",
    "deposit successful", "deposit successfully", "deposit completed", "deposit confirmed",
    "deposited successfully", "deposited"
  };

  private static final String[] STRONG_TRANSACTION_SIGNALS = {
    "you spent", "paid with your card", "card was charged", "card payment",
    "cash withdrawal", "you sent", "you've sent", "you paid", "money sent", "transfer sent",
    "you received", "money received", "transfer received", "refund of", "refunded",
    "top-up successful", "top up successful", "topup successful", "recharge successful"
  };

  // When wallet notifications include both the transaction and a running
  // balance, fee, or exchange equivalent, prefer the amount nearest an actual
  // posting verb instead of blindly taking the first currency-looking number.
  private static final String[] DEBIT_AMOUNT_CONTEXT = {
    "debited", "debit of", "withdrawn", "withdrawal", "spent", "paid", "purchase",
    "charged", "sent", "transfer", "payment", "deducted", "pos transaction",
    "pos txn", "pos purchase", "pos payment", "point of sale",
    "purchase transaction", "order total", "grand total", "total paid", "total amount",
    "total price", "total bill", "total payable", "amount paid", "top-up", "top up", "topup", "successful"
  };
  private static final String[] CREDIT_AMOUNT_CONTEXT = {
    "credited", "credit of", "received", "deposited", "deposit successful", "deposit completed", "deposit", "funds added",
    "transfer received", "transferred", "cashback", "refund", "payout", "stripe account", "stripe balance", "top-up", "top up", "topup", "successful", "succeeded"
  };

  static final class Result {
    final String type;
    final double amount;
    final String currency;
    final String counterparty;
    final String account;
    final String reference;

    Result(String type, double amount, String currency, String counterparty, String account, String reference) {
      this.type = type;
      this.amount = amount;
      this.currency = currency;
      this.counterparty = counterparty;
      this.account = account;
      this.reference = reference;
    }
  }

  private TransactionDetector() {}

  static Result detect(String sender, String body) {
    String safeSender = sender == null ? "" : sender;
    String safeBody = body == null ? "" : body;
    String combined = (safeSender + " " + safeBody).toLowerCase(Locale.US);
    boolean completedCard = isFinancialSender(safeSender)
      && COMPLETED_CARD_TRANSACTION.matcher(safeBody).find();
    boolean completedDeposit = isFinancialSender(safeSender)
      && COMPLETED_DEPOSIT.matcher(safeBody).find();
    boolean completedPosTransaction = COMPLETED_POS_TRANSACTION.matcher(safeBody).find()
      || POS_ACCOUNT_POSTING.matcher(safeBody).find();
    boolean stripeIncoming = containsAny(safeSender.toLowerCase(Locale.US), "stripe")
      && STRIPE_INCOMING_POSTING.matcher(safeBody).find();
    boolean stripePayout = containsAny(safeSender.toLowerCase(Locale.US), "stripe")
      && STRIPE_COMPLETED_PAYOUT.matcher(safeBody).find();
    boolean deliveryReceipt = containsAny(combined, DELIVERY_SENDERS)
      && COMPLETED_DELIVERY_ORDER.matcher(combined).find()
      && DELIVERY_ORDER_TOTAL.matcher(combined).find();

    if (safeBody.trim().isEmpty()) return null;
    boolean postedReversal = REVERSAL_CREDIT.matcher(safeBody).find();
    for (String rejection : HARD_REJECTIONS) {
      if (containsTerm(combined, rejection)
          && !(postedReversal && (rejection.equals("payment reversed") || rejection.equals("transaction reversed")))) return null;
    }
    if (!containsAny(combined, FINANCIAL_IDENTIFIERS)
        && !containsAny(combined, STRONG_TRANSACTION_SIGNALS)
        && !hasReferencedFinancialSender(safeSender, safeBody) && !completedCard
        && !completedDeposit && !completedPosTransaction && !stripeIncoming && !stripePayout && !deliveryReceipt) return null;

    String type = null;
    // Treat an incoming posting to the user's account as authoritative regardless of the bank,
    // sender name or whether the institution calls it received, transferred, deposited or credited.
    if (postedReversal
        || INCOMING_ACCOUNT_POSTING.matcher(safeBody).find()
        || EXPLICIT_INCOMING.matcher(safeBody).find()
        || stripeIncoming || stripePayout) type = "credit";
    else if (completedDeposit) type = "credit";
    else if (completedPosTransaction) type = "debit";
    else if (containsAny(combined, DEBIT_SIGNALS)) type = "debit";
    else if (completedCard) type = "debit";
    else if (isReferencedFinancialPosting(safeSender, safeBody, REFERENCED_COMPLETED_DEBIT)) type = "debit";
    else if (containsAny(combined, CREDIT_SIGNALS)) type = "credit";
    else if (combined.contains("payment received") && isFinancialSender(safeSender)) type = "credit";
    // Delivery app receipts are not bank notifications. Accept only completed/delivered
    // orders with a clearly labelled total and a known delivery service sender/body.
    if (deliveryReceipt) type = "debit";
    if (type == null) return null;

    if (containsAny(combined, DELIVERY_ORDER_CONTEXT) && !deliveryReceipt
        && !hasAccountPostingEvidence(combined)) return null;

    // Commerce notifications often contain money and words such as "payment" or "received".
    // Only accept one when it also contains an unmistakable account/card transaction marker.
    if (containsAny(combined, COMMERCE_ONLY_SIGNALS) && !hasAccountPostingEvidence(combined)
        && !deliveryReceipt) return null;

    Money amount = firstAmount(safeBody, type);
    if (amount == null || amount.amount <= 0 || !Double.isFinite(amount.amount)) return null;
    return new Result(type, amount.amount, amount.currency,
      extractCounterparty(safeBody, type), extract(ACCOUNT_HINT, safeBody), extractReference(safeBody));
  }

  private static String extractCounterparty(String body, String type) {
    Matcher posMerchant = POS_MERCHANT.matcher(body);
    if (posMerchant.find()) return cleanCounterparty(posMerchant.group(1));
    Matcher direct = DIRECT_COUNTERPARTY.matcher(body);
    if (direct.find()) return cleanCounterparty(direct.group(1));
    if ("credit".equals(type)) {
      Matcher lateFrom = LATE_INCOMING_FROM.matcher(body);
      if (lateFrom.find()) return cleanCounterparty(lateFrom.group(1));
    } else {
      Matcher cardMerchant = CARD_MERCHANT.matcher(body);
      if (cardMerchant.find()) return cleanCounterparty(cardMerchant.group(1));
    }
    return "";
  }

  private static String cleanCounterparty(String candidate) {
    String value = candidate.replaceAll("\\s+", " ").trim();
    Matcher end = COUNTERPARTY_END.matcher(value);
    if (end.find()) value = value.substring(0, end.start()).trim();
    value = MASKED_REFERENCE.matcher(value).replaceFirst("");
    value = value.replaceAll("[\\s.,;:-]+$", "").trim();
    return value.length() > 80 ? value.substring(0, 80).trim() : value;
  }

  private static String extract(Pattern pattern, String body) {
    Matcher match = pattern.matcher(body);
    if (!match.find()) return "";
    String value = match.group(match.groupCount() == 0 ? 0 : 1).replaceAll("\\s+", " ").trim();
    return value.length() > 80 ? value.substring(0, 80).trim() : value;
  }

  private static String extractReference(String body) {
    Matcher match = Pattern.compile("(?i)\\b(?:(?:tx(?:n)?|trx|transaction)\\s*(?:id|no\\.?|number|#)|(?:ref(?:erence)?|rrn|utr)\\s*(?:id|no\\.?|number|#)?)\\s*[:#-]?\\s*([a-z0-9-]{6,64})\\b").matcher(body);
    return match.find() ? match.group(1) : "";
  }

  private static boolean hasAccountPostingEvidence(String text) {
    return containsAny(text,
      "debited", "credited", "a/c dr", "a/c cr", "account dr", "account cr",
      "received from", "available balance", "avail bal", "avl bal", "current balance"
    );
  }

  private static boolean isReferencedFinancialPosting(String sender, String body, Pattern posting) {
    return posting.matcher(body).find()
      && hasReferencedFinancialSender(sender, body);
  }

  private static boolean hasReferencedFinancialSender(String sender, String body) {
    return TRANSACTION_REFERENCE.matcher(body).find()
      && isFinancialSender(sender);
  }

  private static boolean isFinancialSender(String sender) {
    return containsAny(sender.toLowerCase(Locale.US), FINANCIAL_SENDER_IDENTIFIERS);
  }

  private static final class Money {
    final double amount;
    final String currency;
    Money(double amount, String currency) { this.amount = amount; this.currency = currency; }
  }

  private static final class AmountCandidate {
    final Money money;
    final int start;
    final int end;
    AmountCandidate(Money money, int start, int end) {
      this.money = money;
      this.start = start;
      this.end = end;
    }
  }

  private static Money firstAmount(String text, String type) {
    java.util.ArrayList<AmountCandidate> candidates = new java.util.ArrayList<>();
    collectAmounts(text, CURRENCY_FIRST, true, candidates);
    collectAmounts(text, CURRENCY_LAST, false, candidates);
    if (candidates.isEmpty()) return null;
    if (candidates.size() == 1) {
      AmountCandidate only = candidates.get(0);
      String[] singleContexts = "credit".equals(type) ? CREDIT_AMOUNT_CONTEXT : DEBIT_AMOUNT_CONTEXT;
      int singleDistance = nearestContextDistance(text.toLowerCase(Locale.US), only, singleContexts);
      return singleDistance <= 72
        ? only.money : null;
    }

    String normalized = text.toLowerCase(Locale.US);
    String[] contexts = "credit".equals(type) ? CREDIT_AMOUNT_CONTEXT : DEBIT_AMOUNT_CONTEXT;
    AmountCandidate best = null;
    int bestDistance = Integer.MAX_VALUE;
    int secondBestDistance = Integer.MAX_VALUE;
    for (AmountCandidate candidate : candidates) {
      int distance = nearestContextDistance(normalized, candidate, contexts);
      if (distance < bestDistance) {
        secondBestDistance = bestDistance;
        bestDistance = distance;
        best = candidate;
      } else if (distance < secondBestDistance) {
        secondBestDistance = distance;
      }
    }

    // Without a nearby posting verb, or when two values are equally plausible,
    // skip the alert rather than logging a balance/fee as the transaction.
    if (bestDistance > 48 || secondBestDistance - bestDistance < 4) return null;
    return best.money;
  }

  private static void collectAmounts(String text, Pattern pattern, boolean currencyFirst,
      java.util.List<AmountCandidate> candidates) {
    Matcher matcher = pattern.matcher(text);
    while (matcher.find()) {
      Money amount = currencyFirst
        ? parseAmount(matcher.group(1), matcher.group(2))
        : parseAmount(matcher.group(2), matcher.group(1));
      if (amount == null) continue;
      boolean duplicate = false;
      for (AmountCandidate candidate : candidates) {
        boolean overlaps = matcher.start() < candidate.end && matcher.end() > candidate.start;
        boolean sameMoney = candidate.money.currency.equals(amount.currency)
          && Math.abs(candidate.money.amount - amount.amount) < 0.00000001;
        if ((candidate.start == matcher.start() && candidate.end == matcher.end())
            || (overlaps && sameMoney)) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) candidates.add(new AmountCandidate(amount, matcher.start(), matcher.end()));
    }
  }

  private static int nearestContextDistance(String text, AmountCandidate amount, String[] contexts) {
    int nearest = Integer.MAX_VALUE;
    for (String context : contexts) {
      int from = 0;
      while (from < text.length()) {
        int index = text.indexOf(context, from);
        if (index < 0) break;
        int end = index + context.length();
        int distance = end <= amount.start ? amount.start - end
          : index >= amount.end ? index - amount.end : 0;
        nearest = Math.min(nearest, distance);
        from = index + 1;
      }
    }
    return nearest;
  }

  private static Money parseAmount(String token, String digits) {
    try {
      String currency = normalizeCurrency(token);
      try {
        Currency.getInstance(currency);
      } catch (IllegalArgumentException notFiat) {
        if (!isCryptoCurrency(currency)) return null;
      }
      double amount = Double.parseDouble(digits.replace(",", ""));
      return new Money(amount, currency);
    } catch (IllegalArgumentException ignored) {
      return null;
    }
  }

  private static boolean isCryptoCurrency(String currency) {
    for (String crypto : CRYPTO_CURRENCIES) if (crypto.equals(currency)) return true;
    return false;
  }

  private static String normalizeCurrency(String token) {
    String value = token.toUpperCase(Locale.US).replace(".", "");
    if (value.equals("RS") || value.startsWith("RUPEE")) return "PKR";
    if (value.equals("$") || value.equals("US$")) return "USD";
    if (value.equals("€")) return "EUR";
    if (value.equals("£")) return "GBP";
    if (value.equals("₹")) return "INR";
    if (value.equals("C$")) return "CAD";
    if (value.equals("A$")) return "AUD";
    if (value.equals("S$")) return "SGD";
    if (value.equals("HK$")) return "HKD";
    if (value.equals("NZ$")) return "NZD";
    return value;
  }

  private static boolean containsAny(String text, String... terms) {
    for (String term : terms) if (text.contains(term)) return true;
    return false;
  }

  private static boolean containsTerm(String text, String term) {
    int from = 0;
    while ((from = text.indexOf(term, from)) >= 0) {
      int end = from + term.length();
      if ((from == 0 || !Character.isLetterOrDigit(text.charAt(from - 1)))
          && (end == text.length() || !Character.isLetterOrDigit(text.charAt(end)))) return true;
      from++;
    }
    return false;
  }
}
