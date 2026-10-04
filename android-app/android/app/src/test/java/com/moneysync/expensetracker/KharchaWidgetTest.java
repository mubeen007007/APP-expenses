package com.moneysync.expensetracker;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class KharchaWidgetTest {
  @Test public void formatsWidgetBalanceWithoutShorteningOrDroppingDecimals() {
    assertEquals("Rs 1,234.50", KharchaWidget.formatMoney(1234.5, "PKR"));
    assertEquals("Rs 1,234", KharchaWidget.formatMoney(1234, "PKR"));
    assertEquals("USD 1,234.57", KharchaWidget.formatMoney(1234.567, "USD"));
    assertEquals("Rs -1,234.50", KharchaWidget.formatMoney(-1234.5, "PKR"));
  }

  @Test public void respectsCurrencyFractionDigits() {
    assertEquals("JPY 1,235", KharchaWidget.formatMoney(1234.5, "JPY"));
    assertEquals("KWD 1,234.568", KharchaWidget.formatMoney(1234.5678, "KWD"));
  }
}
