package com.moneysync.expensetracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertNotNull;

import org.junit.Test;

public class TransactionDetectorTest {
  @Test public void separatesOutgoingAndIncomingTransferEvents() {
    TransactionDetector.Result outgoing = TransactionDetector.detect("Bank alert",
      "PKR 1,070.00 sent to MUHAMMAD AMIR EasyPaisa from your A/C *7015 on 02-10-2026 09:29 PM via Raast Tx ID BAHL2610022129104991662011220");
    TransactionDetector.Result incoming = TransactionDetector.detect("Bank alert",
      "PKR 38000.00 received from MUHAMMAD MUBEEN KHALID AKBL in your A/C **0701 on 02/10/2026 17:37:41 via RAAST Tx ID ASCM2610021737400473591996495");
    assertNotNull(outgoing);
    assertNotNull(incoming);
    assertEquals("debit", outgoing.type);
    assertEquals("credit", incoming.type);
    assertEquals(38000.0, incoming.amount, 0.001);
    assertEquals("MUHAMMAD MUBEEN KHALID AKBL", incoming.counterparty);
  }

  @Test public void receivesIbftIntoNamedAccount() {
    TransactionDetector.Result result = TransactionDetector.detect("Account alert",
      "IBFT of PKR. 57,670.26 received from Feyre Ltd A C * in MUHAMMAD MUBEEN KHAL AKBL A C *3249 on 01 10 26 13 18 Ref# 011099225065");
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(57670.26, result.amount, 0.001);
    assertEquals("Feyre Ltd", result.counterparty);
    assertEquals("011099225065", result.reference);
  }

  @Test public void transferToAnotherPersonAccountRemainsDebit() {
    TransactionDetector.Result result = TransactionDetector.detect("Digital wallet",
      "USD 52.00 transferred to Alex account 1234 from your wallet. Txn ID ABC12345");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(52.0, result.amount, 0.001);
  }

  @Test public void countsCompletedReversalCreditedBackToAccount() {
    TransactionDetector.Result result = TransactionDetector.detect("Account alert",
      "Raast transaction of PKR. 700.00 has been reversed and credited in your A C# 021***3249");
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(700.0, result.amount, 0.001);
    assertNull(TransactionDetector.detect("Account alert", "Raast transaction of PKR 700 was reversed, refund pending."));
  }

  @Test public void acceptsCompletedPosPurchase() {
    TransactionDetector.Result result = TransactionDetector.detect("Bank alert",
      "You made a POS transaction of PKR 4,000.00 at BISMILLAH MUTTON BEAF CHI from BAHL A/C **7015 through your Visa Platinum Debit Card on 26-09-2026 11:16:00");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(4000.0, result.amount, 0.001);
    assertEquals("PKR", result.currency);
  }

  @Test public void detectsInternationalCurrencyBeforeOrAfterAmount() {
    TransactionDetector.Result usd = TransactionDetector.detect("Wallet", "You spent USD 12.50 with your card");
    TransactionDetector.Result eur = TransactionDetector.detect("Wallet", "You received 45.75 EUR from a contact");
    assertNotNull(usd);
    assertEquals("USD", usd.currency);
    assertEquals(12.5, usd.amount, 0.001);
    assertNotNull(eur);
    assertEquals("EUR", eur.currency);
    assertEquals(45.75, eur.amount, 0.001);
  }

  @Test public void acceptsReferencedWalletServicePayment() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "easypaisa",
      "Trx ID 56606342847. Rs. 2000.0 paid for Monthly Supreme for 03356117248 on 2026-09-30. Fee: Rs 0.0 incl. FED."
    );
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(2000.0, result.amount, 0.001);
    assertEquals("PKR", result.currency);
  }

  @Test public void acceptsReferencedPaymentFromGenericWallet() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Digital wallet", "Transaction ID ABC12345. USD 12.50 paid for a mobile plan. Fee: USD 0.00"
    );
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(12.5, result.amount, 0.001);
    assertEquals("USD", result.currency);
  }

  @Test public void rejectsMerchantReceiptWithTransactionReference() {
    assertNull(TransactionDetector.detect(
      "Online Store", "Transaction ID ABC12345. Rs 2,000 paid for your order."
    ));
  }

  @Test public void acceptsOtherReferencedCompletedWalletWording() {
    TransactionDetector.Result payment = TransactionDetector.detect(
      "Mobile wallet", "Txn ID 987654. Payment of GBP 8.20 completed for your plan."
    );
    TransactionDetector.Result topUp = TransactionDetector.detect(
      "Payment app", "Transaction ID TOPUP123. INR 500 top-up successful."
    );
    assertNotNull(payment);
    assertEquals("debit", payment.type);
    assertEquals("GBP", payment.currency);
    assertNotNull(topUp);
    assertEquals("debit", topUp.type);
    assertEquals("INR", topUp.currency);
  }

  @Test public void acceptsReferencedCompletedWalletCreditWording() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Digital wallet", "Trx ID 12345678. USD 42.75 funds received in your wallet."
    );
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(42.75, result.amount, 0.001);
    assertEquals("USD", result.currency);
  }

  @Test public void rejectsMerchantAndPendingPaymentWording() {
    assertNull(TransactionDetector.detect(
      "Online Store", "Txn ID 987654. Payment of GBP 8.20 completed for your order."
    ));
    assertNull(TransactionDetector.detect(
      "Mobile wallet", "Txn ID 987654. Payment of GBP 8.20 pending for your plan."
    ));
    assertNull(TransactionDetector.detect(
      "Online Store", "Transaction ID ABC12345. Payment received: Rs 2,000 for your order."
    ));
  }

  @Test public void rejectsDeclinedPosPurchase() {
    assertNull(TransactionDetector.detect("Bank alert",
      "POS purchase of PKR 4,000.00 on your debit card was declined."));
  }

  @Test public void rejectsPosOffer() {
    assertNull(TransactionDetector.detect("Bank alert",
      "Enjoy a discount on a POS transaction of PKR 4,000 with your debit card."));
  }

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

  @Test public void acceptsCompletedCardSpendFromGenericFinancialApp() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Digital wallet", "You spent PKR 1,250.00 with your card at Corner Shop");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(1250.0, result.amount, 0.001);
  }

  @Test public void acceptsReceivedMoneyFromGenericFinancialApp() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Wallet", "You received Rs 9,500.00 from a contact");
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(9500.0, result.amount, 0.001);
  }

  @Test public void selectsGoogleWalletTransactionAmountInsteadOfBalance() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Google Pay", "You sent USD 15.00 to Alex. Your Google Pay balance is USD 85.00.");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(15.0, result.amount, 0.001);
    assertEquals("USD", result.currency);
  }

  @Test public void selectsGoogleWalletCreditInsteadOfNewBalance() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Google Wallet", "You received EUR 20.00 from Alex. New balance EUR 40.00.");
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(20.0, result.amount, 0.001);
    assertEquals("EUR", result.currency);
  }

  @Test public void acceptsExplicitGooglePlayPaymentButRejectsInformationalMoney() {
    TransactionDetector.Result paid = TransactionDetector.detect(
      "Google Play Store", "You paid USD 5.49 for an app purchase.");
    assertNotNull(paid);
    assertEquals("debit", paid.type);
    assertEquals(5.49, paid.amount, 0.001);
    assertEquals("USD", paid.currency);

    assertNull(TransactionDetector.detect(
      "Google", "Your Google Play balance is USD 20.00. You might also like these apps."));
  }

  @Test public void skipsAmbiguousMoneyValuesWithoutNearbyPostingContext() {
    assertNull(TransactionDetector.detect(
      "Google Pay", "Payment update: USD 15.00 · balance USD 85.00"));
  }

  @Test public void readsCompletedFoodDeliveryTotalButIgnoresUnconfirmedOrder() {
    TransactionDetector.Result delivered = TransactionDetector.detect(
      "Foodpanda", "Your order has been delivered. Order total: PKR 1,245.50. Thank you!");
    assertNotNull(delivered);
    assertEquals("debit", delivered.type);
    assertEquals(1245.50, delivered.amount, 0.001);
    assertEquals("PKR", delivered.currency);

    assertNull(TransactionDetector.detect(
      "Foodpanda", "Order confirmed. Your order total is PKR 1,245.50."));
    assertNull(TransactionDetector.detect(
      "Foodpanda", "Your order was canceled. Order total PKR 1,245.50."));
  }

  @Test public void choosesExplicitPaidTotalInsteadOfDeliveryFee() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Foodpanda", "Payment successful for your order. Total paid PKR 1,245.50. Delivery fee PKR 100.00.");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(1245.50, result.amount, 0.001);
  }

  @Test public void doesNotTreatALoneBalanceAsPostedAmount() {
    assertNull(TransactionDetector.detect(
      "Wallet", "Your available balance is USD 85.00 after a payment update."));
  }

  @Test public void readsLowercaseIsoCurrencyTokens() {
    TransactionDetector.Result result = TransactionDetector.detect(
      "Wallet", "You paid gbp 8.25 for your purchase.");
    assertNotNull(result);
    assertEquals("GBP", result.currency);
    assertEquals(8.25, result.amount, 0.001);
  }

  @Test public void financialAppStillRejectsPendingAndNonTransactionAlerts() {
    assertNull(TransactionDetector.detect(
      "Wallet", "Card payment pending: PKR 3,200 at a merchant"));
    assertNull(TransactionDetector.detect(
      "Wallet", "Your monthly insights are ready. You spent PKR 20,000 this month."));
  }

  @Test public void namesPaidForServiceWithoutPhoneNumberOrFee() {
    TransactionDetector.Result result = TransactionDetector.detect("easypaisa",
      "Trx ID 56771265071. Rs. 10.0 paid for ZONG Emergency Pack for 03356117248 on 2026-10-03. Fee: Rs 0.0 incl. FED.");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(10.0, result.amount, 0.001);
    assertEquals("ZONG Emergency Pack", result.counterparty);
    assertEquals("Paid for ZONG Emergency Pack", BankSmsReceiver.describe(result,
      "Trx ID 56771265071. Rs. 10.0 paid for ZONG Emergency Pack for 03356117248 on 2026-10-03. Fee: Rs 0.0 incl. FED."));
  }

  @Test public void stripsRaastIdentifierFromTransferRecipient() {
    TransactionDetector.Result result = TransactionDetector.detect("Askari",
      "PKR 100 sent to MUHAMMAD MUBEEN KHALID RAAST ID ********************7611 from your Askari A/C **********3249 on 03-Oct-2026 01:01:15 AM via RAAST Tx ID 276619039359");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals("MUHAMMAD MUBEEN KHALID", result.counterparty);
    assertEquals("Sent to MUHAMMAD MUBEEN KHALID", BankSmsReceiver.describe(result,
      "PKR 100 sent to MUHAMMAD MUBEEN KHALID RAAST ID ********************7611 from your A/C ****3249"));
  }

  @Test public void extractsSenderAfterDestinationAccountInCredit() {
    TransactionDetector.Result result = TransactionDetector.detect("easypaisa",
      "Dear MUHAMMAD MUBEEN KHALID, You have received Rs.100 in your Easypaisa account ***********7248 from MUHAMMAD MUBEEN KHALID PK**ASCMPKKA****3249 via Raast Payment on 03-10-2026 at 01:01:16. Trx ID: 56771228767");
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(100.0, result.amount, 0.001);
    assertEquals("MUHAMMAD MUBEEN KHALID", result.counterparty);
    assertEquals("Received from MUHAMMAD MUBEEN KHALID", BankSmsReceiver.describe(result,
      "You have received Rs.100 in your wallet account ****7248 from MUHAMMAD MUBEEN KHALID via Raast"));
  }

  @Test public void acceptsCompletedCardMerchantAlertWithSuffixCurrency() {
    TransactionDetector.Result result = TransactionDetector.detect("RedotPay",
      "Card 0735 transaction successful FOOD PANDA 770.59PKR");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(770.59, result.amount, 0.001);
    assertEquals("PKR", result.currency);
    assertEquals("FOOD PANDA", result.counterparty);
    assertEquals("Paid at FOOD PANDA", BankSmsReceiver.describe(result,
      "Card 0735 transaction successful FOOD PANDA 770.59PKR"));
    TransactionDetector.Result withTitle = TransactionDetector.detect("RedotPay Transaction successful",
      "Transaction successful · Card 0735 transaction successful FOOD PANDA 770.59PKR");
    assertNotNull(withTitle);
    assertEquals("FOOD PANDA", withTitle.counterparty);
    assertNull(TransactionDetector.detect("Online Store", "Card 0735 transaction successful FOOD PANDA 770.59PKR"));
    assertNull(TransactionDetector.detect("RedotPay", "Card 0735 transaction declined FOOD PANDA 770.59PKR"));
  }

  @Test public void acceptsRedotPayCryptoDepositInOriginalAssetCurrency() {
    TransactionDetector.Result result = TransactionDetector.detect("RedotPay",
      "Deposit Successful +70.08USDT");
    assertNotNull(result);
    assertEquals("credit", result.type);
    assertEquals(70.08, result.amount, 0.001);
    assertEquals("USDT", result.currency);
  }

  @Test public void acceptsPayPalReceivedAndSentAlertsWithDirection() {
    TransactionDetector.Result received = TransactionDetector.detect("PayPal",
      "You've received a payment of USD 42.75 from Alex Smith. Transaction ID PP12345678");
    TransactionDetector.Result sent = TransactionDetector.detect("PayPal",
      "You sent $18.25 USD to Alex Smith. Transaction ID PP87654321");
    assertNotNull(received);
    assertEquals("credit", received.type);
    assertEquals(42.75, received.amount, 0.001);
    assertEquals("USD", received.currency);
    assertNotNull(sent);
    assertEquals("debit", sent.type);
    assertEquals(18.25, sent.amount, 0.001);
  }

  @Test public void acceptsPayoneerAndWiseIncomingPayments() {
    TransactionDetector.Result payoneer = TransactionDetector.detect("Payoneer",
      "Payment of EUR 820.50 received from ACME LTD. Reference ID PO12345678");
    TransactionDetector.Result wise = TransactionDetector.detect("Wise",
      "You received GBP 100.25 from Alice Smith. Transfer ID WS12345678");
    assertNotNull(payoneer);
    assertEquals("credit", payoneer.type);
    assertEquals(820.50, payoneer.amount, 0.001);
    assertEquals("EUR", payoneer.currency);
    assertNotNull(wise);
    assertEquals("credit", wise.type);
    assertEquals(100.25, wise.amount, 0.001);
    assertEquals("GBP", wise.currency);
  }

  @Test public void acceptsOnlyExplicitCompletedStripeCreditsAndPayouts() {
    TransactionDetector.Result payment = TransactionDetector.detect("Stripe",
      "A payment of USD 124.50 was successfully made to your Stripe account. Payment ID pi_12345678");
    TransactionDetector.Result payout = TransactionDetector.detect("Stripe",
      "Payout of USD 1,200.00 was paid to your bank account. Payout ID po_12345678");
    TransactionDetector.Result cardSpend = TransactionDetector.detect("Stripe",
      "You paid $24.99 USD to Example Service. Receipt ID ch_12345678");
    assertNotNull(payment);
    assertEquals("credit", payment.type);
    assertEquals(124.50, payment.amount, 0.001);
    assertNotNull(payout);
    assertEquals("credit", payout.type);
    assertEquals(1200.00, payout.amount, 0.001);
    assertNotNull(cardSpend);
    assertEquals("debit", cardSpend.type);
    assertEquals(24.99, cardSpend.amount, 0.001);
    assertNull(TransactionDetector.detect("Stripe", "Payment processing USD 124.50"));
    assertNull(TransactionDetector.detect("Stripe", "Payout pending USD 1,200.00"));
  }

  @Test public void rejectsPendingOrFailedProviderAlerts() {
    assertNull(TransactionDetector.detect("PayPal", "Payment pending USD 42.75"));
    assertNull(TransactionDetector.detect("Payoneer", "Payment failed EUR 820.50"));
    assertNull(TransactionDetector.detect("Stripe", "Payout failed USD 1,200.00"));
  }

  @Test public void recognizesCompletedPosDebitFromNumericSmsSender() {
    TransactionDetector.Result result = TransactionDetector.detect("8870",
      "Dear Customer, you have performed a POS transaction of PKR. 700.00 from Account: 002101*****249 on ZINNIA THE SCHOOL SYST, at 19:12:21 Dated: 04-OCT-26");
    assertNotNull(result);
    assertEquals("debit", result.type);
    assertEquals(700.00, result.amount, 0.001);
    assertEquals("PKR", result.currency);
    assertEquals("ZINNIA THE SCHOOL SYST", result.counterparty);
  }

  @Test public void doesNotTreatPendingPosAlertAsCompletedDebit() {
    assertNull(TransactionDetector.detect("8870",
      "Your POS transaction is pending for PKR 700.00. We will notify you when complete."));
  }

  @Test public void recognizesCompletedPosWordingAcrossSendersAndCurrencies() {
    TransactionDetector.Result approved = TransactionDetector.detect("41925",
      "POS payment approved for EUR 24.50 at CITY MARKET using your card ending 1234.");
    assertNotNull(approved);
    assertEquals("debit", approved.type);
    assertEquals(24.50, approved.amount, 0.001);
    assertEquals("EUR", approved.currency);
    assertEquals("CITY MARKET", approved.counterparty);

    TransactionDetector.Result posted = TransactionDetector.detect("Account notice",
      "POS txn of GBP 16.75 from your account ending 4321 at STATION CAFE.");
    assertNotNull(posted);
    assertEquals("debit", posted.type);
    assertEquals(16.75, posted.amount, 0.001);
    assertEquals("GBP", posted.currency);
    assertEquals("STATION CAFE", posted.counterparty);
  }

  @Test public void ignoresPosMentionsWithoutCompletedPosting() {
    assertNull(TransactionDetector.detect("41925", "POS payment of EUR 24.50 at CITY MARKET is awaiting approval."));
    assertNull(TransactionDetector.detect("41925", "Save on your next POS purchase over EUR 24.50."));
    assertNull(TransactionDetector.detect("Bank alert", "Save on your next POS purchase over EUR 24.50 using your card."));
    assertNull(TransactionDetector.detect("41925", "POS payment of EUR 24.50 at CITY MARKET was declined."));
  }
}
