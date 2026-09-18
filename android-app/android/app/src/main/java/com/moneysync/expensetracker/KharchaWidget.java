package com.moneysync.expensetracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.widget.RemoteViews;

import java.io.File;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class KharchaWidget extends AppWidgetProvider {
  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
    for (int widgetId : widgetIds) {
      updateWidget(context, manager, widgetId);
    }
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    if ("com.moneysync.expensetracker.REFRESH_WIDGET".equals(intent.getAction())) {
      AppWidgetManager manager = AppWidgetManager.getInstance(context);
      int[] ids = manager.getAppWidgetIds(new ComponentName(context, KharchaWidget.class));
      onUpdate(context, manager, ids);
    }
  }

  static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.kharcha_widget);
    double today = readTodaySpending(context);
    views.setTextViewText(R.id.widget_amount, formatMoney(today));

    Intent quickAdd = new Intent(context, QuickAddActivity.class);
    quickAdd.setAction("com.moneysync.expensetracker.QUICK_ADD");
    quickAdd.setData(Uri.parse("kharcha://widget/quick-add/" + widgetId));
    quickAdd.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    quickAdd.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent quickPending = PendingIntent.getActivity(
      context,
      20000 + widgetId,
      quickAdd,
      PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    views.setOnClickPendingIntent(R.id.widget_quick_add, quickPending);
    views.setOnClickPendingIntent(R.id.widget_amount, quickPending);

    Intent refresh = new Intent(context, KharchaWidget.class);
    refresh.setAction("com.moneysync.expensetracker.REFRESH_WIDGET");
    PendingIntent refreshPending = PendingIntent.getBroadcast(
      context,
      widgetId + 10000,
      refresh,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    views.setOnClickPendingIntent(R.id.widget_refresh, refreshPending);
    manager.updateAppWidget(widgetId, views);
  }

  public static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, KharchaWidget.class));
    for (int id : ids) updateWidget(context, manager, id);
  }

  private static double readTodaySpending(Context context) {
    ExpenseStore.migrateLegacy(context);
    File databaseFile = ExpenseStore.databaseFile(context);
    if (!databaseFile.exists()) return 0;

    Calendar calendar = Calendar.getInstance();
    calendar.set(Calendar.HOUR_OF_DAY, 0);
    calendar.set(Calendar.MINUTE, 0);
    calendar.set(Calendar.SECOND, 0);
    calendar.set(Calendar.MILLISECOND, 0);
    SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    iso.setTimeZone(TimeZone.getTimeZone("UTC"));
    String start = iso.format(new Date(calendar.getTimeInMillis()));

    SQLiteDatabase db = null;
    Cursor cursor = null;
    try {
      db = SQLiteDatabase.openDatabase(databaseFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
      cursor = db.rawQuery(
        "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE type = ? AND created_at >= ?",
        new String[]{"debit", start}
      );
      return cursor.moveToFirst() ? cursor.getDouble(0) : 0;
    } catch (Exception ignored) {
      return 0;
    } finally {
      if (cursor != null) cursor.close();
      if (db != null) db.close();
    }
  }

  private static String formatMoney(double value) {
    if (value >= 100000) return "Rs " + new DecimalFormat("0.0").format(value / 100000) + "L";
    if (value >= 1000) return "Rs " + new DecimalFormat("0.0").format(value / 1000) + "k";
    return "Rs " + new DecimalFormat("0").format(value);
  }
}
