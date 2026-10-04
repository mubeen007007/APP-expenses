package com.moneysync.expensetracker;

/** Choose one transport for the default SMS app, independent of bank wording. */
final class ImportSourcePolicy {
  static boolean skipSmsNotification(String sourcePackage, String defaultSmsPackage, boolean smsGranted) {
    return smsGranted && defaultSmsPackage != null && !defaultSmsPackage.isEmpty()
      && defaultSmsPackage.equals(sourcePackage);
  }
}
