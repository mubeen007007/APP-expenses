package com.moneysync.expensetracker;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.BufferedReader;
import java.io.FileReader;

public class QuickAddActivity extends Activity {
  private boolean isCredit = false;
  private boolean saving = false;
  private Button spendButton;
  private Button creditButton;
  private Button addButton;
  private boolean dark;
  private String ink, muted, surface, field, border, selected, selectedInk;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    try (BufferedReader reader = new BufferedReader(new FileReader(new File(getFilesDir(), "moneysync_theme.txt")))) {
      String preference = reader.readLine();
      dark = "dark".equals(preference) || (!"light".equals(preference)
        && (getResources().getConfiguration().uiMode
          & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
          == android.content.res.Configuration.UI_MODE_NIGHT_YES);
    } catch (Exception ignored) {
      dark = (getResources().getConfiguration().uiMode
        & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
        == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }
    ink = dark ? "#F8F4FA" : "#111111";
    muted = dark ? "#C1B7C6" : "#817C77";
    surface = dark ? "#24202B" : "#FCFBF8";
    field = dark ? "#2E2835" : "#F4F1EE";
    border = dark ? "#51475A" : "#E2DED8";
    selected = dark ? "#D6BEE8" : "#111111";
    selectedInk = dark ? "#281D32" : "#FFFFFF";
    Window window = getWindow();
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

    int pad = dp(20);
    LinearLayout card = new LinearLayout(this);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(pad, dp(20), pad, dp(22));
    card.setBackground(roundRect(surface, 27, border));

    LinearLayout heading = new LinearLayout(this);
    heading.setOrientation(LinearLayout.HORIZONTAL);
    heading.setGravity(Gravity.CENTER_VERTICAL);

    TextView mark = text("+", 23, "#111111", true);
    mark.setGravity(Gravity.CENTER);
    mark.setBackground(roundRect("#E8E2F2", 13, null));
    heading.addView(mark, new LinearLayout.LayoutParams(dp(46), dp(46)));

    LinearLayout headingCopy = new LinearLayout(this);
    headingCopy.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams headingCopyParams = new LinearLayout.LayoutParams(0, -2, 1);
    headingCopyParams.setMargins(dp(11), 0, 0, 0);
    heading.addView(headingCopy, headingCopyParams);

    TextView eyebrow = text("MONEYSYNC", 9, muted, true);
    eyebrow.setLetterSpacing(.16f);
    headingCopy.addView(eyebrow);
    TextView title = text("Quick add", 23, ink, true);
    title.setPadding(0, dp(2), 0, 0);
    headingCopy.addView(title);

    TextView close = text("×", 24, muted, false);
    close.setGravity(Gravity.CENTER);
    close.setBackground(roundRect(field, 12, null));
    close.setOnClickListener(v -> finish());
    heading.addView(close, new LinearLayout.LayoutParams(dp(38), dp(38)));
    card.addView(heading);

    TextView intro = text("A transaction in two taps.", 12, muted, false);
    intro.setPadding(0, dp(13), 0, dp(16));
    card.addView(intro);

    LinearLayout toggle = new LinearLayout(this);
    toggle.setOrientation(LinearLayout.HORIZONTAL);
    toggle.setPadding(dp(4), dp(4), dp(4), dp(4));
    toggle.setBackground(roundRect(field, 13, border));
    spendButton = toggleButton("Expense", true);
    creditButton = toggleButton("Income", false);
    toggle.addView(spendButton, new LinearLayout.LayoutParams(0, dp(48), 1));
    LinearLayout.LayoutParams creditParams = new LinearLayout.LayoutParams(0, dp(48), 1);
    creditParams.setMargins(dp(4), 0, 0, 0);
    toggle.addView(creditButton, creditParams);
    card.addView(toggle);

    TextView descriptionLabel = fieldLabel("DESCRIPTION");
    LinearLayout.LayoutParams descriptionLabelParams = new LinearLayout.LayoutParams(-1, -2);
    descriptionLabelParams.setMargins(dp(2), dp(15), 0, dp(6));
    card.addView(descriptionLabel, descriptionLabelParams);

    EditText description = input("e.g. Lunch, fuel or rent", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    LinearLayout.LayoutParams fieldParams = new LinearLayout.LayoutParams(-1, dp(60));
    card.addView(description, fieldParams);

    TextView amountLabel = fieldLabel("AMOUNT");
    LinearLayout.LayoutParams amountLabelParams = new LinearLayout.LayoutParams(-1, -2);
    amountLabelParams.setMargins(dp(2), dp(12), 0, dp(6));
    card.addView(amountLabel, amountLabelParams);

    EditText amount = input(ExpenseStore.readBaseCurrency(this) + "  0", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    LinearLayout.LayoutParams amountParams = new LinearLayout.LayoutParams(-1, dp(60));
    card.addView(amount, amountParams);

    addButton = new Button(this);
    addButton.setText("Add expense  →");
    addButton.setTextColor(Color.WHITE);
    addButton.setTextSize(14);
    addButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    addButton.setAllCaps(false);
    addButton.setBackground(roundRect(dark ? "#765591" : "#111111", 14, border));
    LinearLayout.LayoutParams addParams = new LinearLayout.LayoutParams(-1, dp(58));
    addParams.setMargins(0, dp(14), 0, 0);
    card.addView(addButton, addParams);

    addButton.setOnClickListener(v -> save(description, amount));
    amount.setOnEditorActionListener((v, actionId, event) -> {
      save(description, amount);
      return true;
    });

    LinearLayout outer = new LinearLayout(this);
    outer.setPadding(dp(8), dp(8), dp(8), dp(8));
    outer.addView(card, new LinearLayout.LayoutParams(-1, -2));
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setClipToPadding(false);
    scroll.addView(outer, new ScrollView.LayoutParams(-1, -2));
    setContentView(scroll);

    WindowManager.LayoutParams windowParams = window.getAttributes();
    int availableWidth = getResources().getDisplayMetrics().widthPixels - dp(24);
    windowParams.width = Math.min(availableWidth, dp(460));
    windowParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
    window.setAttributes(windowParams);

    description.requestFocus();
    description.postDelayed(() -> ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
      .showSoftInput(description, InputMethodManager.SHOW_IMPLICIT), 180);
  }

  private void save(EditText description, EditText amount) {
    if (saving) return;
    String label = description.getText().toString().trim();
    double value;
    try {
      value = Double.parseDouble(amount.getText().toString().replace(",", ""));
    } catch (Exception e) {
      value = 0;
    }
    if (label.isEmpty() || value <= 0) {
      Toast.makeText(this, "Enter a description and valid amount", Toast.LENGTH_SHORT).show();
      return;
    }
    saving = true;
    addButton.setEnabled(false);
    boolean saved = ExpenseStore.add(this, null, label, value, isCredit ? "credit" : "debit", System.currentTimeMillis());
    Toast.makeText(this, saved ? "Added to MoneySync" : "Could not save", Toast.LENGTH_SHORT).show();
    if (saved) finish();
    else {
      saving = false;
      addButton.setEnabled(true);
    }
  }

  private Button toggleButton(String label, boolean selected) {
    Button button = new Button(this);
    button.setText(label);
    button.setTextSize(13);
    button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    button.setMinWidth(0);
    button.setPadding(0, 0, 0, 0);
    button.setAllCaps(false);
    button.setTextColor(Color.parseColor(selected ? selectedInk : muted));
    button.setBackground(roundRect(selected ? this.selected : field, 12, null));
    button.setOnClickListener(v -> {
      isCredit = button == creditButton;
      updateToggle();
    });
    return button;
  }

  private void updateToggle() {
    spendButton.setTextColor(Color.parseColor(isCredit ? muted : selectedInk));
    spendButton.setBackground(roundRect(isCredit ? field : selected, 12, null));
    creditButton.setTextColor(Color.parseColor(isCredit ? "#281D32" : muted));
    creditButton.setBackground(roundRect(isCredit ? (dark ? "#BADEC9" : "#E8E2F2") : field, 12, null));
    if (addButton != null) {
      addButton.setText(isCredit ? "Add income  →" : "Add expense  →");
      addButton.setTextColor(Color.WHITE);
      addButton.setBackground(roundRect(dark ? "#765591" : (isCredit ? "#75609E" : "#111111"), 14, border));
    }
  }

  private EditText input(String hint, int inputType) {
    EditText view = new EditText(this);
    view.setHint(hint);
    view.setHintTextColor(Color.parseColor(muted));
    view.setTextColor(Color.parseColor(ink));
    view.setTextSize(15);
    view.setSingleLine(true);
    view.setInputType(inputType);
    view.setPadding(dp(15), 0, dp(15), 0);
    view.setBackground(roundRect(field, 13, border));
    return view;
  }

  private TextView fieldLabel(String value) {
    TextView label = text(value, 9, muted, true);
    label.setLetterSpacing(.13f);
    return label;
  }

  private TextView text(String value, int size, String color, boolean bold) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(Color.parseColor(color));
    if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    return view;
  }

  private GradientDrawable roundRect(String fill, int radius, String stroke) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setColor(Color.parseColor(fill));
    drawable.setCornerRadius(dp(radius));
    if (stroke != null) drawable.setStroke(dp(1), Color.parseColor(stroke));
    return drawable;
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
