package com.moneysync.expensetracker;

import org.junit.Test;
import static org.junit.Assert.*;

public class ImportIdentityTest {
  @Test public void uncertainCrossChannelMatchNeedsReviewNotDeletion() {
    ImportIdentity sms = alert("sms-one", "Paid merchant **1234", 0);
    ImportIdentity email = alert("notification|day|gmail|two", "Purchase **1234", 600000);
    assertTrue(sms.needsReview(email));
    assertFalse(sms.sameTransaction(email));
    assertFalse(sms.needsReview(alert("notification|day|gmail|three", "Purchase **1234", 600001)));
    assertTrue(sms.needsReview(alert("sms-two", "Purchase **1234", 0)));
    assertFalse(sms.needsReview(alert("notification|day|gmail|four", "Purchase **5678", 0)));
  }
  @Test public void conflictingPaymentDetailsNeverEnterReview() {
    ImportIdentity sms = alert("sms-one", "Tx ID ABC12345678", 0);
    assertFalse(sms.needsReview(alert("notification|day|gmail|two", "Tx ID XYZ12345678", 0)));
    assertFalse(sms.needsReview(ImportIdentity.from("notification|day|gmail|three", "Paid", "PKR", "credit", 10000, 0)));
    assertFalse(sms.needsReview(ImportIdentity.from("notification|day|gmail|four", "Paid", "PKR", "debit", 10001, 0)));
  }
  @Test public void delayedEmailUsesExplicitTransactionTime() throws Exception {
    long time = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").parse("2026-09-27 11:16:00").getTime();
    ImportIdentity sms = alert("sms-one", "Paid on 27-09-2026 11:16:00", time);
    ImportIdentity email = alert("notification|day|gmail|two", "Purchase on 2026-09-27 11:16:00", time + 3600000);
    assertTrue(sms.needsReview(email));
    assertEquals(time, email.timestamp);
    assertEquals(time, ImportIdentity.transactionTime("Unknown date 03/04/2026 11:16:00", time));
    assertEquals(time, ImportIdentity.transactionTime("Invalid 2026-02-31 11:16:00", time));
  }
  private ImportIdentity alert(String source, String body, long time) {
    return ImportIdentity.from(source, body, "PKR", "debit", 10000, time);
  }
  @Test public void matchesReferenceAcrossDifferentBanksWordingAndChannels() {
    assertTrue(alert("sms-message", "PKR 10,000 debited. Tx ID ABC12345678", 0)
      .sameTransaction(alert("notification|day|gmail|message", "Payment sent: Reference number ABC12345678", 3600000)));
  }
  @Test public void matchesTwoNotificationApps() {
    assertTrue(alert("notification|day|bank.app|one", "Txn ID ABC12345678", 0)
      .sameTransaction(alert("notification|day|gmail|two", "UTR: ABC12345678", 600000)));
  }
  @Test public void preservesDifferentReferencesWithSameAmountAndTime() {
    assertFalse(alert("sms-one", "Tx ID ABC12345678", 0)
      .sameTransaction(alert("notification|day|bank|two", "Tx ID XYZ12345678", 0)));
    assertFalse(alert("sms-one", "Tx ID ABC12345678", 0)
      .needsReview(alert("sms-two", "Tx ID XYZ12345678", 0)));
  }
  @Test public void neverMatchesAmountAndTimeAlone() {
    assertFalse(alert("sms-one", "Money sent to Alice", 0)
      .sameTransaction(alert("notification|day|bank|two", "Money sent to Bob", 0)));
  }
  @Test public void matchesNormalizedPayloadAcrossChannels() {
    assertTrue(alert("sms-one", "PKR 10,000 debited from account **1234", 0)
      .sameTransaction(alert("notification|day|messages|two", "PKR 10,000   DEBITED from account **1234", 120000)));
  }
  @Test public void preservesRepeatedSameChannelPaymentsWithoutReference() {
    assertFalse(alert("sms-one", "PKR 10,000 debited", 0)
      .sameTransaction(alert("sms-two", "PKR 10,000 debited", 1000)));
    assertTrue(alert("sms-one", "PKR 10,000 debited", 0)
      .needsReview(alert("sms-two", "PKR 10,000 debited", 1000)));
  }
  @Test public void changedNotificationPreviewIsHeldForReview() {
    ImportIdentity first = ImportIdentity.from("notification|day|bank.app|8810|first",
      "PKR 100,000 received in your account", "PKR", "credit", 100000, 0);
    ImportIdentity updated = ImportIdentity.from("notification|day|bank.app|info|second",
      "PKR 100,000 credited to your account", "PKR", "credit", 100000, 45000);
    assertFalse(first.sameTransaction(updated));
    assertTrue(first.needsReview(updated));
    assertFalse(first.needsReview(ImportIdentity.from("notification|day|bank.app|later",
      "PKR 100,000 credited to your account", "PKR", "credit", 100000, 180000)));
  }
  @Test public void sameAndroidNotificationUpdateIsReviewedEvenWhenDelayed() {
    String slot = ImportIdentity.hash("bank.app|notification-id-42");
    ImportIdentity first = ImportIdentity.from("notification|day|bank.app|8810|first",
      "PKR 100,000 received in your account", "PKR", "credit", 100000, 0, slot);
    ImportIdentity updated = ImportIdentity.from("notification|day|bank.app|info|second",
      "PKR 100,000 credited to your account", "PKR", "credit", 100000, 3600000, slot);
    assertFalse(first.sameTransaction(updated));
    assertTrue(first.needsReview(updated));
    assertFalse(first.needsReview(ImportIdentity.from("notification|day|bank.app|later",
      "PKR 100,000 credited to your account", "PKR", "credit", 100000, 7L * 3600000, slot)));
  }
  @Test public void preservesDifferentAccounts() {
    assertFalse(alert("sms-one", "Tx ID ABC12345678 account **1234", 0)
      .sameTransaction(alert("notification|day|bank|two", "Tx ID ABC12345678 account **5678", 0)));
  }
  @Test public void preservesCreditAndDebitForSameTransfer() {
    assertFalse(alert("sms-one", "Tx ID ABC12345678", 0)
      .sameTransaction(ImportIdentity.from("sms-two", "Tx ID ABC12345678", "PKR", "credit", 10000, 0)));
  }
  @Test public void preservesDifferentAmounts() {
    assertFalse(alert("sms-one", "Tx ID ABC12345678", 0)
      .sameTransaction(ImportIdentity.from("sms-two", "Tx ID ABC12345678", "PKR", "debit", 10001, 0)));
  }
  @Test public void preservesSameNumberInDifferentCurrencies() {
    assertFalse(alert("sms-one", "PKR 10,000 debited", 0)
      .sameTransaction(ImportIdentity.from("notification|day|wallet|two", "USD 10,000 debited", "USD", "debit", 10000, 0)));
  }
  @Test public void exactDeliveryIsIdempotent() {
    assertTrue(alert("same-key", "PKR 10,000 debited", 0)
      .sameTransaction(alert("same-key", "PKR 10,000 debited", 900000)));
  }
  @Test public void avoidsTreatingProseAsReference() {
    assertEquals("", alert("sms", "Transaction completed successfully", 0).reference);
    assertEquals("", alert("sms", "Transaction 10000000 PKR completed", 0).reference);
  }
  @Test public void delayedUnidentifiedMessagesAreNotMerged() {
    assertFalse(alert("sms-one", "PKR 10,000 debited", 0)
      .sameTransaction(alert("notification|day|bank|two", "PKR 10,000 debited", 86400000)));
  }
}
