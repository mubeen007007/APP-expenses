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
import android.widget.TextView;
import android.widget.Toast;

public class QuickAddActivity extends Activity {
  private boolean isCredit = false;
  private Button spendButton;
  private Button creditButton;
  private Button addButton;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Window window = getWindow();
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

    int pad = dp(18);
    LinearLayout card = new LinearLayout(this);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(pad, dp(17), pad, dp(18));
    card.setBackground(roundRect("#1A171F", 24, "#40374B"));

    LinearLayout heading = new LinearLayout(this);
    heading.setOrientation(LinearLayout.HORIZONTAL);
    heading.setGravity(Gravity.CENTER_VERTICAL);

    TextView mark = text("⚡", 17, "#FFFFFF", true);
    mark.setGravity(Gravity.CENTER);
    mark.setBackground(roundRect("#705BE8", 13, null));
    heading.addView(mark, new LinearLayout.LayoutParams(dp(42), dp(42)));

    LinearLayout headingCopy = new LinearLayout(this);
    headingCopy.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams headingCopyParams = new LinearLayout.LayoutParams(0, -2, 1);
    headingCopyParams.setMargins(dp(11), 0, 0, 0);
    heading.addView(headingCopy, headingCopyParams);

    TextView eyebrow = text("FAST CAPTURE", 9, "#968DA3", true);
    eyebrow.setLetterSpacing(.16f);
    headingCopy.addView(eyebrow);
    TextView title = text("Quick add", 21, "#F7F4FC", true);
    title.setPadding(0, dp(2), 0, 0);
    headingCopy.addView(title);

    TextView close = text("×", 24, "#A49BAD", false);
    close.setGravity(Gravity.CENTER);
    close.setBackground(roundRect("#27232E", 12, null));
    close.setOnClickListener(v -> finish());
    heading.addView(close, new LinearLayout.LayoutParams(dp(38), dp(38)));
    card.addView(heading);

    TextView intro = text("Add a transaction without opening the full app.", 12, "#8F8798", false);
    intro.setPadding(0, dp(11), 0, dp(14));
    card.addView(intro);

    LinearLayout toggle = new LinearLayout(this);
    toggle.setOrientation(LinearLayout.HORIZONTAL);
    toggle.setPadding(dp(4), dp(4), dp(4), dp(4));
    toggle.setBackground(roundRect("#211E28", 13, "#342E3D"));
    spendButton = toggleButton("SPEND", true);
    creditButton = toggleButton("CREDIT", false);
    toggle.addView(spendButton, new LinearLayout.LayoutParams(0, dp(40), 1));
    LinearLayout.LayoutParams creditParams = new LinearLayout.LayoutParams(0, dp(40), 1);
    creditParams.setMargins(dp(4), 0, 0, 0);
    toggle.addView(creditButton, creditParams);
    card.addView(toggle);

    TextView descriptionLabel = fieldLabel("DESCRIPTION");
    LinearLayout.LayoutParams descriptionLabelParams = new LinearLayout.LayoutParams(-1, -2);
    descriptionLabelParams.setMargins(dp(2), dp(15), 0, dp(6));
    card.addView(descriptionLabel, descriptionLabelParams);

    EditText description = input("What was it?", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    LinearLayout.LayoutParams fieldParams = new LinearLayout.LayoutParams(-1, dp(54));
    card.addView(description, fieldParams);

    TextView amountLabel = fieldLabel("AMOUNT");
    LinearLayout.LayoutParams amountLabelParams = new LinearLayout.LayoutParams(-1, -2);
    amountLabelParams.setMargins(dp(2), dp(12), 0, dp(6));
    card.addView(amountLabel, amountLabelParams);

    EditText amount = input("Rs  0", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    LinearLayout.LayoutParams amountParams = new LinearLayout.LayoutParams(-1, dp(54));
    card.addView(amount, amountParams);

    addButton = new Button(this);
    addButton.setText("Add expense  →");
    addButton.setTextColor(Color.WHITE);
    addButton.setTextSize(12);
    addButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    addButton.setAllCaps(false);
    addButton.setBackground(roundRect("#705BE8", 14, null));
    LinearLayout.LayoutParams addParams = new LinearLayout.LayoutParams(-1, dp(52));
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
    setContentView(outer);

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
    boolean saved = ExpenseStore.add(this, null, label, value, isCredit ? "credit" : "debit", System.currentTimeMillis());
    Toast.makeText(this, saved ? "Added to MoneySync" : "Could not save", Toast.LENGTH_SHORT).show();
    if (saved) finish();
  }

  private Button toggleButton(String label, boolean selected) {
    Button button = new Button(this);
    button.setText(label);
    button.setTextSize(11);
    button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    button.setMinWidth(0);
    button.setPadding(0, 0, 0, 0);
    button.setTextColor(selected ? Color.WHITE : Color.parseColor("#A9A2B1"));
    button.setBackground(roundRect(selected ? "#FF765B" : "#29252F", 12, null));
    button.setOnClickListener(v -> {
      isCredit = button == creditButton;
      updateToggle();
    });
    return button;
  }

  private void updateToggle() {
    spendButton.setTextColor(isCredit ? Color.parseColor("#A9A2B1") : Color.WHITE);
    spendButton.setBackground(roundRect(isCredit ? "#29252F" : "#FF765B", 12, null));
    creditButton.setTextColor(isCredit ? Color.WHITE : Color.parseColor("#A9A2B1"));
    creditButton.setBackground(roundRect(isCredit ? "#49C990" : "#29252F", 12, null));
    if (addButton != null) {
      addButton.setText(isCredit ? "Add income  →" : "Add expense  →");
      addButton.setBackground(roundRect(isCredit ? "#36B77D" : "#705BE8", 14, null));
    }
  }

  private EditText input(String hint, int inputType) {
    EditText view = new EditText(this);
    view.setHint(hint);
    view.setHintTextColor(Color.parseColor("#756E7D"));
    view.setTextColor(Color.parseColor("#F7F4FC"));
    view.setTextSize(15);
    view.setSingleLine(true);
    view.setInputType(inputType);
    view.setPadding(dp(15), 0, dp(15), 0);
    view.setBackground(roundRect("#27232E", 13, "#413848"));
    return view;
  }

  private TextView fieldLabel(String value) {
    TextView label = text(value, 9, "#807789", true);
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
