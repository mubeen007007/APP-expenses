package com.moneysync.expensetracker

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

class PlayUpdatePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(PlayUpdateModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class PlayUpdateModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private lateinit var manager: AppUpdateManager

  private val installListener = InstallStateUpdatedListener { state ->
    val payload = Arguments.createMap()
    payload.putString("installStatus", installStatusName(state.installStatus()))
    payload.putLong("bytesDownloaded", state.bytesDownloaded())
    payload.putLong("totalBytesToDownload", state.totalBytesToDownload())
    val errorCode = state.installErrorCode()
    if (errorCode != 0) payload.putInt("errorCode", errorCode)
    emitStatus(payload)
  }

  override fun getName() = "MoneySyncUpdates"

  override fun initialize() {
    super.initialize()
    manager = AppUpdateManagerFactory.create(reactApplicationContext)
    manager.registerListener(installListener)
  }

  override fun invalidate() {
    if (this::manager.isInitialized) manager.unregisterListener(installListener)
    super.invalidate()
  }

  @ReactMethod
  fun checkForUpdate(promise: Promise) {
    manager.appUpdateInfo
      .addOnSuccessListener { info -> promise.resolve(updateInfoMap(info)) }
      .addOnFailureListener { error ->
        promise.reject("PLAY_UPDATE_CHECK_FAILED", "Could not check Google Play for an update", error)
      }
  }

  @ReactMethod
  fun startUpdate(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null || activity.isFinishing || activity.isDestroyed) {
      promise.reject("PLAY_UPDATE_NO_ACTIVITY", "MoneySync is not ready to start the update", null)
      return
    }

    manager.appUpdateInfo
      .addOnSuccessListener { info ->
        val updateType = when {
          info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE) -> AppUpdateType.FLEXIBLE
          info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) -> AppUpdateType.IMMEDIATE
          else -> null
        }
        if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE || updateType == null) {
          promise.resolve(false)
          return@addOnSuccessListener
        }

        try {
          val started = manager.startUpdateFlowForResult(
            info,
            activity,
            AppUpdateOptions.newBuilder(updateType).build(),
            UPDATE_REQUEST_CODE,
          )
          promise.resolve(started)
        } catch (error: Exception) {
          promise.reject("PLAY_UPDATE_START_FAILED", "Google Play could not start the update", error)
        }
      }
      .addOnFailureListener { error ->
        promise.reject("PLAY_UPDATE_START_FAILED", "Could not retrieve update details from Google Play", error)
      }
  }

  @ReactMethod
  fun completeUpdate(promise: Promise) {
    manager.completeUpdate()
      .addOnSuccessListener { promise.resolve(true) }
      .addOnFailureListener { error ->
        promise.reject("PLAY_UPDATE_INSTALL_FAILED", "Google Play could not install the downloaded update", error)
      }
  }

  private fun updateInfoMap(info: com.google.android.play.core.appupdate.AppUpdateInfo): WritableMap {
    val result = Arguments.createMap()
    result.putBoolean("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
    result.putInt("availableVersionCode", info.availableVersionCode())
    result.putBoolean("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE))
    result.putBoolean("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
    result.putString("installStatus", installStatusName(info.installStatus()))
    return result
  }

  private fun installStatusName(status: Int): String = when (status) {
    InstallStatus.PENDING -> "PENDING"
    InstallStatus.DOWNLOADING -> "DOWNLOADING"
    InstallStatus.DOWNLOADED -> "DOWNLOADED"
    InstallStatus.INSTALLING -> "INSTALLING"
    InstallStatus.INSTALLED -> "INSTALLED"
    InstallStatus.FAILED -> "FAILED"
    InstallStatus.CANCELED -> "CANCELED"
    else -> "UNKNOWN"
  }

  private fun emitStatus(payload: WritableMap) {
    if (!reactApplicationContext.hasActiveReactInstance()) return
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(UPDATE_EVENT, payload)
  }

  companion object {
    private const val UPDATE_EVENT = "MoneySyncUpdateStatus"
    private const val UPDATE_REQUEST_CODE = 6102
  }
}
