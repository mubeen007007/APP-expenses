package com.moneysync.expensetracker;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

public class KharchaCompactWidget extends AppWidgetProvider {
  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
    for (int id : widgetIds) KharchaWidget.updateWidget(context, manager, id, true);
    KharchaWidget.publishPreview(context, manager, true);
  }

  @Override
  public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
      int widgetId, Bundle newOptions) {
    KharchaWidget.updateWidget(context, manager, widgetId, true);
  }
}
