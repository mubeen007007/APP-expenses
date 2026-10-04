package com.moneysync.expensetracker;

import java.util.Locale;

/** Local, deterministic category suggestions; users can still edit any suggestion. */
final class TransactionCategorizer {
  private TransactionCategorizer() {}

  static String categorize(String description, String type) {
    if ("credit".equals(type)) return "Income";
    String text = description == null ? "" : description.toLowerCase(Locale.US);
    if (has(text, "foodpanda", "uber eats", "ubereats", "deliveroo", "doordash", "talabat", "grubhub", "just eat", "justeat", "zomato", "swiggy",
        "lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee", "tea", "food", "pizza", "burger", "kfc", "mcdonald", "hardees", "domino", "cheezious", "biryani")) return "Food";
    if (has(text, "grocery", "groceries", "supermarket", "milk", "vegetable", "fruit", "imtiaz", "carrefour", "naheed", "alfatah", "al-fatah") || has(text, "mart")) return "Groceries";
    if (has(text, "careem", "uber", "indrive", "bykea", "fuel", "petrol", "taxi", "ride", "shell", "pso", "total parco", "bus", "metro", "parking")) return "Transport";
    if (has(text, "shirt", "dress", "clothes", "clothing", "shoes", "shopping", "daraz", "mall", "outfitters", "limelight", "khaadi")) return "Shopping";
    if (has(text, "atm", "cash withdrawal", "withdrawal", "cash out")) return "Cash";
    if (has(text, "transfer", "ibft", "raast", "sent to", "send to", "advance", "loan", "lent", "borrowed")) return "Transfers";
    if (has(text, "doctor", "medicine", "pharmacy", "hospital", "clinic")) return "Health";
    if (has(text, "electricity", "internet", "mobile bill", "gas bill", "water bill", "subscription", "ptcl", "lesco", "wapda", "jazz", "zong", "telenor", "ufone", "netflix", "spotify", "bill")) return "Bills";
    if (has(text, "rent", "repair", "furniture", "cleaning")) return "Home";
    if (has(text, "office", "client", "work", "business", "freelance", "salary advance")) return "Work";
    if (has(text, "school", "college", "university", "tuition", "course", "textbook", "books", "stationery", "exam fee")) return "Education";
    if (has(text, "cinema", "movie", "game", "gaming", "concert", "youtube premium")) return "Entertainment";
    if (has(text, "salon", "barber", "spa", "gift", "skincare", "cosmetic", "makeup")) return "Personal";
    if (has(text, "hotel", "flight", "airline", "booking", "visa", "trip", "airbnb")) return "Travel";
    String trimmed = description == null ? "" : description.trim();
    if (trimmed.matches("[A-Z][a-z]{2,}(\\s+[A-Z][a-z]{2,}){0,2}")) return "Transfers";
    return "Other";
  }

  private static boolean has(String text, String... terms) {
    for (String term : terms) {
      int from = 0;
      while ((from = text.indexOf(term, from)) >= 0) {
        int end = from + term.length();
        boolean leftBoundary = from == 0 || !Character.isLetterOrDigit(text.charAt(from - 1));
        boolean rightBoundary = end == text.length() || !Character.isLetterOrDigit(text.charAt(end));
        if (leftBoundary && rightBoundary) return true;
        from++;
      }
    }
    return false;
  }
}
