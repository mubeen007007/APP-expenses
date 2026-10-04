package com.moneysync.expensetracker;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TransactionCategorizerTest {
  @Test public void deliveryAppNamesAreClassifiedAsFood() {
    assertEquals("Food", TransactionCategorizer.categorize("Bank debit · Foodpanda order", "debit"));
    assertEquals("Food", TransactionCategorizer.categorize("Uber Eats", "debit"));
  }

  @Test public void exactWordRulesAvoidSubstringFalseMatches() {
    assertEquals("Other", TransactionCategorizer.categorize("Smart phone case", "debit"));
    assertEquals("Groceries", TransactionCategorizer.categorize("Imtiaz Supermarket", "debit"));
  }

  @Test public void incomingMoneyAlwaysUsesIncomeCategory() {
    assertEquals("Income", TransactionCategorizer.categorize("Foodpanda refund", "credit"));
  }
}
