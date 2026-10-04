package com.moneysync.expensetracker

import android.content.ComponentName
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

class PermissionStatusPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(PermissionStatusModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class PermissionStatusModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MoneySyncPermissions"

  @ReactMethod
  fun refreshWidgets() {
    KharchaWidget.refreshAll(reactApplicationContext)
  }

  @ReactMethod
  fun hasNotificationAccess(promise: Promise) {
    try {
      val expected = ComponentName(reactApplicationContext, GmailNotificationListener::class.java)
      val enabled = Settings.Secure.getString(reactApplicationContext.contentResolver, "enabled_notification_listeners") ?: ""
      promise.resolve(enabled.split(':').any { ComponentName.unflattenFromString(it) == expected })
    } catch (error: Exception) {
      promise.reject("PERMISSION_STATUS", "Could not read notification access", error)
    }
  }
}
