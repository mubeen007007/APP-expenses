package com.moneysync.expensetracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;

import org.junit.Test;

public class TransactionDetectorTest {
  @Test public void acceptsPostedBankDebit() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "AL Habib Mobile",
      "Fund Transfer-Debit via Raast PKR 1,670.00 sent to MUHAMMAD from your BAHL A/C *0701. Txn ID 123"
    );
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(1670.0, result.amount, 0.001);
  }

  @Test public void acceptsPostedBankCredit() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Meezan Bank",
      "Your A/C has been credited with PKR 25,000.00. Available balance PKR 31,200.00"
    );
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(25000.0, result.amount, 0.001);
  }

  @Test public void acceptsIncomingTransferWithSenderAsCredit() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "AL Habib Mobile",
      "PKR 356250.00 received from UZAIR COMMISSION AGENT Meezan in your BAHL A/C **0701 on 18/09/2026 11:50:57 via RAAST Tx ID AMEZNPKKA98310111097188260918115057"
    );
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(356250.0, result.amount, 0.001);
  }

  @Test public void acceptsGenericTransferToYourAccountAsCredit() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Banking Alert",
      "PKR 12,500.00 transferred to your account ending 4321. Transaction ID ABC123"
    );
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(12500.0, result.amount, 0.001);
  }

  @Test public void acceptsGenericDepositIntoAccountAsCredit() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Account Alert",
      "Rs 8,750 deposited into your A/C. Available balance Rs 21,000."
    );
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(8750.0, result.amount, 0.001);
  }

  @Test public void rejectsAliExpressOrderEmail() {
    assertNull(TransactionDetector.detect(
      "AliExpress",
      "Order confirmed. We received your payment of PKR 4,299. Track your order in the app."
    ));
  }

  @Test public void rejectsMarketplacePaymentPromotionEvenWithCardWord() {
    assertNull(TransactionDetector.detect(
      "Online Store",
      "Save 20% with your credit card. Payment method offer on orders above Rs 5,000."
    ));
  }

  @Test public void rejectsPaymentDueReminder() {
    assertNull(TransactionDetector.detect(
      "HBL",
      "Credit card payment due: PKR 12,500. Minimum due Rs 1,250."
    ));
  }

  @Test public void rejectsOtp() {
    assertNull(TransactionDetector.detect(
      "Bank Alfalah",
      "OTP 123456 for transaction of PKR 8,000. Do not share this code."
    ));
  }

  @Test public void rejectsGenericPaymentNotification() {
    assertNull(TransactionDetector.detect(
      "Courier App",
      "Payment received: Rs 2,000 for your delivery order."
    ));
  }
}
