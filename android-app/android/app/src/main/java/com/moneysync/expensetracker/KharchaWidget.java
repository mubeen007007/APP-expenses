package com.moneysync.expensetracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.math.RoundingMode;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

public class KharchaWidget extends AppWidgetProvider {
  private static final String ACTION_REFRESH = "com.moneysync.expensetracker.REFRESH_WIDGET";
  private static final String ACTION_PERIOD = "com.moneysync.expensetracker.WIDGET_PERIOD";
  private static final String EXTRA_PERIOD = "period";
  private static final String PERIOD_TODAY = "today";
  private static final String PERIOD_YESTERDAY = "yesterday";
  private static final String PERIOD_MONTH = "month";
  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
    for (int widgetId : widgetIds) {
      updateWidget(context, manager, widgetId);
    }
    publishPreview(context, manager, false);
  }

  @Override
  public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
      int widgetId, Bundle newOptions) {
    updateWidget(context, manager, widgetId);
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    super.onReceive(context, intent);
    if (ACTION_REFRESH.equals(intent.getAction())) {
      refreshAll(context);
    } else if (ACTION_PERIOD.equals(intent.getAction())) {
      int widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
      String period = intent.getStringExtra(EXTRA_PERIOD);
      if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID && validPeriod(period)) {
        context.getSharedPreferences("moneysync_widget_periods", Context.MODE_PRIVATE)
          .edit().putString(String.valueOf(widgetId), period).apply();
        updateWidget(context, AppWidgetManager.getInstance(context), widgetId);
      }
    }
  }

  static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
    updateWidget(context, manager, widgetId, false);
  }

  static void updateWidget(Context context, AppWidgetManager manager, int widgetId, boolean compact) {
    boolean dark = isDarkTheme(context);
    int layout = compact ? R.layout.kharcha_widget_compact : R.layout.kharcha_widget;
    RemoteViews views = new RemoteViews(context.getPackageName(), layout);
    int ink = android.graphics.Color.parseColor(dark ? "#F5EDF8" : "#3E285C");
    int muted = android.graphics.Color.parseColor(dark ? "#C8B7D0" : "#604C67");
    views.setTextColor(R.id.widget_brand, ink);
    views.setTextColor(R.id.widget_label, muted);
    views.setTextColor(R.id.widget_amount, ink);
    views.setTextColor(R.id.widget_refresh, muted);
    views.setTextColor(R.id.widget_quick_add, android.graphics.Color.WHITE);
    views.setInt(compact ? R.id.widget_root : R.id.widget_card, "setBackgroundResource",
      compact ? (dark ? R.drawable.widget_background_dark : R.drawable.widget_background)
        : (dark ? R.drawable.widget_amount_card_dark : R.drawable.widget_amount_card));
    String base = readBaseCurrency(context);
    WidgetTotals totals = readTotals(context, base);
    String period = compact ? PERIOD_MONTH : selectedPeriod(context, widgetId);
    PeriodTotals selected = totals.forPeriod(period);
    String netAmount = formatMoney(compact ? totals.month.net() : selected.net(), base);
    views.setTextViewText(R.id.widget_amount, netAmount);
    fitAmountText(views, netAmount, compact ? 21f : 50f, compact ? 12f : 24f);
    if (!compact) {
      views.setInt(R.id.widget_stat_in, "setBackgroundResource", dark ? R.drawable.widget_stat_card_dark : R.drawable.widget_stat_card);
      views.setInt(R.id.widget_stat_out, "setBackgroundResource", dark ? R.drawable.widget_stat_card_dark : R.drawable.widget_stat_card);
      views.setTextColor(R.id.widget_hero_hint, muted);
      views.setTextColor(R.id.widget_net_label, muted);
      views.setTextColor(R.id.widget_out_label, muted);
      views.setTextColor(R.id.widget_money_in, ink);
      views.setTextColor(R.id.widget_money_out, ink);
      views.setTextViewText(R.id.widget_label, period.toUpperCase(Locale.US) + " · NET BALANCE");
      views.setTextViewText(R.id.widget_money_in, formatMoney(selected.in, base));
      views.setTextViewText(R.id.widget_money_out, formatMoney(selected.out, base));
      bindPeriod(context, views, widgetId, PERIOD_TODAY, R.id.widget_period_today, period, dark);
      bindPeriod(context, views, widgetId, PERIOD_YESTERDAY, R.id.widget_period_yesterday, period, dark);
      bindPeriod(context, views, widgetId, PERIOD_MONTH, R.id.widget_period_month, period, dark);
    }

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
    refresh.setAction(ACTION_REFRESH);
    PendingIntent refreshPending = PendingIntent.getBroadcast(
      context,
      widgetId + 10000,
      refresh,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    views.setOnClickPendingIntent(R.id.widget_refresh, refreshPending);
    manager.updateAppWidget(widgetId, views);
  }

  private static void bindPeriod(Context context, RemoteViews views, int widgetId, String period,
      int viewId, String selected, boolean dark) {
    boolean active = period.equals(selected);
    int background = dark
      ? (active ? R.drawable.widget_period_active_dark : R.drawable.widget_period_inactive_dark)
      : (active ? R.drawable.widget_period_active : R.drawable.widget_period_inactive);
    views.setInt(viewId, "setBackgroundResource", background);
    views.setTextColor(viewId, android.graphics.Color.parseColor(dark
      ? (active ? "#251B31" : "#D7C8DE") : (active ? "#FFFFFF" : "#493856")));
    Intent choose = new Intent(context, KharchaWidget.class);
    choose.setAction(ACTION_PERIOD);
    choose.setData(Uri.parse("moneysync://widget/" + widgetId + "/" + period));
    choose.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    choose.putExtra(EXTRA_PERIOD, period);
    views.setOnClickPendingIntent(viewId, PendingIntent.getBroadcast(context, 30000 + widgetId * 3 + periodIndex(period),
      choose, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
  }

  private static int periodIndex(String period) {
    return PERIOD_TODAY.equals(period) ? 0 : PERIOD_YESTERDAY.equals(period) ? 1 : 2;
  }

  private static boolean validPeriod(String period) {
    return PERIOD_TODAY.equals(period) || PERIOD_YESTERDAY.equals(period) || PERIOD_MONTH.equals(period);
  }

  private static String selectedPeriod(Context context, int widgetId) {
    String period = context.getSharedPreferences("moneysync_widget_periods", Context.MODE_PRIVATE)
      .getString(String.valueOf(widgetId), PERIOD_MONTH);
    return validPeriod(period) ? period : PERIOD_MONTH;
  }

  public static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, KharchaWidget.class));
    for (int id : ids) updateWidget(context, manager, id);
    int[] compactIds = manager.getAppWidgetIds(new ComponentName(context, KharchaCompactWidget.class));
    for (int id : compactIds) updateWidget(context, manager, id, true);
    publishPreview(context, manager, false);
    publishPreview(context, manager, true);
  }

  static void refreshIfPreferencesChanged(Context context) {
    // App edits change the SQLite wallet without touching the theme or currency.
    // Refresh when the user returns home so the widget shows the saved balance.
    refreshAll(context);
  }

  static void publishPreview(Context context, AppWidgetManager manager, boolean compact) {
    if (android.os.Build.VERSION.SDK_INT < 35) return;
    boolean dark = isDarkTheme(context);
    String key = (compact ? "compact_preview_period_v2_" : "full_preview_period_v2_") + (dark ? "dark" : "light");
    android.content.SharedPreferences prefs = context.getSharedPreferences("moneysync_widget_previews", Context.MODE_PRIVATE);
    if (prefs.getInt(key, 0) == BuildConfig.VERSION_CODE) return;
    int layout = compact ? R.layout.kharcha_widget_compact : R.layout.kharcha_widget;
    RemoteViews preview = new RemoteViews(context.getPackageName(), layout);
    int ink = android.graphics.Color.parseColor(dark ? "#F5EDF8" : "#3E285C");
    int muted = android.graphics.Color.parseColor(dark ? "#C8B7D0" : "#604C67");
    preview.setTextColor(R.id.widget_brand, ink);
    preview.setTextColor(R.id.widget_label, muted);
    preview.setTextColor(R.id.widget_amount, ink);
    preview.setTextColor(R.id.widget_refresh, muted);
    preview.setInt(compact ? R.id.widget_root : R.id.widget_card, "setBackgroundResource",
      compact ? (dark ? R.drawable.widget_background_dark : R.drawable.widget_background)
        : (dark ? R.drawable.widget_amount_card_dark : R.drawable.widget_amount_card));
    String base = readBaseCurrency(context);
    WidgetTotals totals = readTotals(context, base);
    String previewAmount = formatMoney(totals.month.net(), base);
    preview.setTextViewText(R.id.widget_amount, previewAmount);
    fitAmountText(preview, previewAmount, compact ? 21f : 50f, compact ? 12f : 24f);
    if (!compact) {
      preview.setInt(R.id.widget_stat_in, "setBackgroundResource", dark ? R.drawable.widget_stat_card_dark : R.drawable.widget_stat_card);
      preview.setInt(R.id.widget_stat_out, "setBackgroundResource", dark ? R.drawable.widget_stat_card_dark : R.drawable.widget_stat_card);
      preview.setTextColor(R.id.widget_hero_hint, muted);
      preview.setTextColor(R.id.widget_net_label, muted);
      preview.setTextColor(R.id.widget_out_label, muted);
      preview.setTextColor(R.id.widget_money_in, ink);
      preview.setTextColor(R.id.widget_money_out, ink);
      for (String period : new String[] { PERIOD_TODAY, PERIOD_YESTERDAY, PERIOD_MONTH }) {
        int viewId = PERIOD_TODAY.equals(period) ? R.id.widget_period_today
          : PERIOD_YESTERDAY.equals(period) ? R.id.widget_period_yesterday : R.id.widget_period_month;
        boolean active = PERIOD_MONTH.equals(period);
        preview.setInt(viewId, "setBackgroundResource", dark
          ? (active ? R.drawable.widget_period_active_dark : R.drawable.widget_period_inactive_dark)
          : (active ? R.drawable.widget_period_active : R.drawable.widget_period_inactive));
        preview.setTextColor(viewId, android.graphics.Color.parseColor(dark
          ? (active ? "#251B31" : "#D7C8DE") : (active ? "#FFFFFF" : "#493856")));
      }
      preview.setTextViewText(R.id.widget_money_in, formatMoney(totals.month.in, base));
      preview.setTextViewText(R.id.widget_money_out, formatMoney(totals.month.out, base));
    }
    try {
      Class<?> provider = compact ? KharchaCompactWidget.class : KharchaWidget.class;
      if (manager.setWidgetPreview(new ComponentName(context, provider),
          AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN, preview)) {
        prefs.edit().putInt(key, BuildConfig.VERSION_CODE).apply();
      }
    } catch (RuntimeException error) {
      android.util.Log.w("MoneySyncWidget", "Widget preview will use its XML fallback", error);
    }
  }

  private static final class WidgetTotals {
    final PeriodTotals month = new PeriodTotals();
    final PeriodTotals today = new PeriodTotals();
    final PeriodTotals yesterday = new PeriodTotals();

    PeriodTotals forPeriod(String period) {
      return PERIOD_TODAY.equals(period) ? today : PERIOD_YESTERDAY.equals(period) ? yesterday : month;
    }
  }

  private static final class PeriodTotals {
    double in;
    double out;

    double net() { return in - out; }
  }

  private static WidgetTotals readTotals(Context context, String base) {
    ExpenseStore.migrateLegacy(context);
    Calendar calendar = Calendar.getInstance();
    calendar.set(Calendar.HOUR_OF_DAY, 0);
    calendar.set(Calendar.MINUTE, 0);
    calendar.set(Calendar.SECOND, 0);
    calendar.set(Calendar.MILLISECOND, 0);
    SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    iso.setTimeZone(TimeZone.getTimeZone("UTC"));
    String dayStart = iso.format(new Date(calendar.getTimeInMillis()));
    calendar.add(Calendar.DAY_OF_MONTH, -1);
    String yesterdayStart = iso.format(new Date(calendar.getTimeInMillis()));
    calendar.add(Calendar.DAY_OF_MONTH, 1);
    calendar.set(Calendar.DAY_OF_MONTH, 1);
    String monthStart = iso.format(new Date(calendar.getTimeInMillis()));
    String earliest = monthStart.compareTo(yesterdayStart) < 0 ? monthStart : yesterdayStart;

    WidgetTotals totals = new WidgetTotals();
    Set<String> countedIds = new HashSet<>();
    File files = context.getFilesDir();
    JSONObject rates = readRates(context, base);
    File database = ExpenseStore.databaseFile(context);
    boolean databaseRead = false;
    if (database.exists()) {
      try (SQLiteDatabase db = SQLiteDatabase.openDatabase(database.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
           Cursor cursor = db.rawQuery("SELECT id, amount, type, created_at, currency FROM expenses WHERE created_at >= ?", new String[] { earliest })) {
        while (cursor.moveToNext()) {
          String id = cursor.getString(0);
          countedIds.add(id);
          addAmount(totals, cursor.getDouble(1), cursor.getString(2), cursor.getString(3),
            cursor.getString(4), monthStart, yesterdayStart, dayStart, base, rates);
        }
        databaseRead = true;
      } catch (Exception error) {
        android.util.Log.w("MoneySyncWidget", "Wallet read will retry; showing recovery snapshot", error);
      }
    }
    // The recovery file is only a fallback. Counting it alongside live SQLite
    // brought back deleted/edited transactions and made the widget diverge.
    if (!databaseRead) readEntries(new File(files, "kharcha_recovery.jsonl"), earliest,
      monthStart, yesterdayStart, dayStart, countedIds, base, rates, totals);
    readEntries(new File(files, "kharcha_pending_processing.jsonl"), earliest,
      monthStart, yesterdayStart, dayStart, countedIds, base, rates, totals);
    readEntries(new File(files, "kharcha_pending.jsonl"), earliest,
      monthStart, yesterdayStart, dayStart, countedIds, base, rates, totals);
    return totals;
  }

  private static void readEntries(File file, String earliest, String monthStart, String yesterdayStart, String dayStart,
      Set<String> countedIds, String base, JSONObject rates, WidgetTotals totals) {
    if (!file.exists()) return;
    try (BufferedReader reader = new BufferedReader(
      new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        try {
          JSONObject item = new JSONObject(line);
          // Review alerts are never part of spending until confirmed in-app.
          if (!item.optString("duplicateOf", "").isEmpty()) continue;
          String id = item.optString("id", "");
          String createdAt = item.optString("createdAt", "");
          if (!id.isEmpty() && !countedIds.contains(id) && createdAt.compareTo(earliest) >= 0) {
            countedIds.add(id);
            addAmount(totals, item.optDouble("amount", 0), item.optString("type"), createdAt,
              item.optString("currency", "PKR"), monthStart, yesterdayStart, dayStart, base, rates);
          }
        } catch (Exception ignored) {
          // A partial trailing line never prevents earlier entries from showing.
        }
      }
    } catch (Exception ignored) {
      // Pending entries remain on disk and the next refresh can retry.
    }
  }

  private static void addAmount(WidgetTotals totals, double amount, String type, String createdAt,
      String currency, String monthStart, String yesterdayStart, String dayStart, String base, JSONObject rates) {
    if (!"debit".equals(type) && !"credit".equals(type)) return;
    String source = currency == null ? "PKR" : currency.toUpperCase(Locale.US);
    double converted = source.equals(base) ? amount : amount / rates.optDouble(source, 0);
    if (!Double.isFinite(converted)) return;
    if (createdAt.compareTo(monthStart) >= 0) addToPeriod(totals.month, type, converted);
    if (createdAt.compareTo(dayStart) >= 0) addToPeriod(totals.today, type, converted);
    else if (createdAt.compareTo(yesterdayStart) >= 0) addToPeriod(totals.yesterday, type, converted);
  }

  private static void addToPeriod(PeriodTotals period, String type, double amount) {
    if ("credit".equals(type)) period.in += amount;
    else period.out += amount;
  }

  private static String readBaseCurrency(Context context) {
    String value = readText(new File(context.getFilesDir(), "moneysync_currency.txt")).trim().toUpperCase(Locale.US);
    return value.matches("[A-Z]{3}") ? value : "PKR";
  }

  private static boolean isDarkTheme(Context context) {
    String preference = readText(new File(context.getFilesDir(), "moneysync_theme.txt")).trim();
    if ("dark".equals(preference)) return true;
    if ("light".equals(preference)) return false;
    int nightMode = context.getResources().getConfiguration().uiMode
      & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
    return nightMode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
  }

  private static JSONObject readRates(Context context, String base) {
    try {
      JSONObject snapshot = new JSONObject(readText(new File(context.getFilesDir(), "moneysync_rates_" + base + ".json")));
      if (snapshot.optInt("schemaVersion") != 2 || !base.equals(snapshot.optString("base"))) return new JSONObject();
      return snapshot.optJSONObject("rates") == null ? new JSONObject() : snapshot.getJSONObject("rates");
    } catch (Exception ignored) {
      return new JSONObject();
    }
  }

  private static String readText(File file) {
    if (!file.exists()) return "";
    StringBuilder content = new StringBuilder();
    try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) content.append(line);
    } catch (Exception ignored) {
      return "";
    }
    return content.toString();
  }

  static String formatMoney(double value, String currency) {
    String code = currency == null ? "PKR" : currency.toUpperCase(Locale.US);
    String prefix = "PKR".equals(code) ? "Rs" : code;
    int digits = "JPY".equals(code) ? 0 : ("KWD".equals(code) || "BHD".equals(code) || "OMR".equals(code)) ? 3 : 2;
    boolean wholeRupees = "PKR".equals(code) && Math.abs(value - Math.rint(value)) < 0.000001;
    int minimumDigits = wholeRupees ? 0 : digits;
    DecimalFormat format = new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.forLanguageTag("en-PK")));
    format.setGroupingUsed(true);
    format.setMinimumFractionDigits(minimumDigits);
    format.setMaximumFractionDigits(digits);
    format.setRoundingMode(RoundingMode.HALF_UP);
    return prefix + " " + format.format(value);
  }

  private static void fitAmountText(RemoteViews views, String text, float maxSp, float minSp) {
    // Keep the full-precision value visible on narrow/resized widgets instead of ellipsizing it.
    float size = Math.max(minSp, maxSp - Math.max(0, text.length() - 11) * (maxSp - minSp) / 8f);
    views.setTextViewTextSize(R.id.widget_amount, android.util.TypedValue.COMPLEX_UNIT_SP, size);
  }
}
