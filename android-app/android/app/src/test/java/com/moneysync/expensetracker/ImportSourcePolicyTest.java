package com.moneysync.expensetracker;

import org.junit.Test;
import static org.junit.Assert.*;

public class ImportSourcePolicyTest {
  @Test public void ignoresDefaultSmsNotificationWhenDirectSmsEnabled() {
    assertTrue(ImportSourcePolicy.skipSmsNotification("any.messages", "any.messages", true));
  }
  @Test public void notificationFallbackWorksWithoutSmsPermission() {
    assertFalse(ImportSourcePolicy.skipSmsNotification("any.messages", "any.messages", false));
  }
  @Test public void bankAndEmailNotificationsRemainEnabled() {
    assertFalse(ImportSourcePolicy.skipSmsNotification("any.bank", "any.messages", true));
    assertFalse(ImportSourcePolicy.skipSmsNotification("any.mail", "any.messages", true));
  }
  @Test public void unknownSmsAppDoesNotDisableNotifications() {
    assertFalse(ImportSourcePolicy.skipSmsNotification("any.messages", null, true));
    assertFalse(ImportSourcePolicy.skipSmsNotification("any.messages", "", true));
  }
  @Test public void followsChangedDefaultSmsApp() {
    assertFalse(ImportSourcePolicy.skipSmsNotification("old.messages", "new.messages", true));
    assertTrue(ImportSourcePolicy.skipSmsNotification("new.messages", "new.messages", true));
  }
}
