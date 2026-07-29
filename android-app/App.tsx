import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as SQLite from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type EntryType = "debit" | "credit";
type Tab = "home" | "activity" | "insights";
type DateScope = "today" | "yesterday" | "custom" | "all";
type OverviewScope = "today" | "yesterday" | "custom" | "month";
type CalendarTarget = "activity" | "overview";

type Expense = {
  id: string;
  description: string;
  amount: number;
  type: EntryType;
  category: string;
  createdAt: string;
};

const COLORS = {
  ink: "#F7F4FC",
  muted: "#AAA4B4",
  cream: "#0D0C12",
  paper: "#18161F",
  line: "#2D2935",
  purple: "#7C68F2",
  purpleDark: "#5D49D6",
  coral: "#FF765B",
  green: "#49C990",
  gold: "#F1B950",
};

const categoryMeta: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  Food: { color: "#F06B4F", icon: "restaurant-outline" },
  Groceries: { color: "#E7A842", icon: "basket-outline" },
  Transport: { color: "#6554D9", icon: "car-outline" },
  Shopping: { color: "#D85F91", icon: "bag-handle-outline" },
  Bills: { color: "#3F8EBA", icon: "receipt-outline" },
  Home: { color: "#51A37E", icon: "home-outline" },
  Health: { color: "#E05D63", icon: "medkit-outline" },
  Income: { color: "#2E9B73", icon: "trending-up-outline" },
  Transfers: { color: "#8B75FF", icon: "swap-horizontal-outline" },
  Work: { color: "#4D9AD4", icon: "briefcase-outline" },
  Education: { color: "#E6A94A", icon: "school-outline" },
  Entertainment: { color: "#D66EAD", icon: "game-controller-outline" },
  Personal: { color: "#E68178", icon: "person-outline" },
  Travel: { color: "#52B5A9", icon: "airplane-outline" },
  Cash: { color: "#A08D72", icon: "cash-outline" },
  Other: { color: "#8A8790", icon: "ellipsis-horizontal-outline" },
};

const CATEGORY_OPTIONS = Object.keys(categoryMeta).filter((name) => name !== "Income");

let database: SQLite.SQLiteDatabase | null = null;
let nativeImportInFlight: Promise<boolean> | null = null;
let syncLoadInFlight: Promise<void> | null = null;

const money = (value: number) =>
  `Rs ${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(value)}`;

const shortMoney = (value: number) =>
  value >= 100000 ? `Rs ${(value / 100000).toFixed(1)}L` : value >= 1000 ? `Rs ${(value / 1000).toFixed(1)}k` : money(value);

const localDateKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};

function categorize(description: string, type: EntryType) {
  if (type === "credit") return "Income";
  const text = description.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["Food", ["lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee", "tea", "pizza", "burger", "biryani", "food"]],
    ["Groceries", ["grocery", "groceries", "mart", "supermarket", "milk", "vegetable", "fruit"]],
    ["Transport", ["careem", "uber", "indrive", "ride", "taxi", "fuel", "petrol", "bus", "metro", "parking"]],
    ["Shopping", ["shirt", "dress", "clothes", "clothing", "shoes", "shopping", "daraz", "mall"]],
    ["Bills", ["bill", "electricity", "internet", "mobile", "gas", "water", "subscription", "netflix"]],
    ["Home", ["rent", "repair", "furniture", "home", "cleaning"]],
    ["Health", ["doctor", "medicine", "pharmacy", "hospital", "clinic"]],
    ["Cash", ["atm", "cash withdrawal", "withdrawal", "cash out"]],
    ["Transfers", ["transfer", "ibft", "raast", "sent to", "send to", "advance", "loan", "lent", "borrowed"]],
    ["Work", ["office", "client", "work", "business", "freelance", "salary advance"]],
    ["Education", ["school", "college", "university", "tuition", "course", "textbook", "books", "stationery", "exam fee"]],
    ["Entertainment", ["cinema", "movie", "game", "gaming", "concert", "spotify", "youtube premium"]],
    ["Personal", ["salon", "barber", "spa", "gift", "skincare", "cosmetic", "makeup"]],
    ["Travel", ["hotel", "flight", "airline", "booking", "visa", "trip", "airbnb"]],
  ];
  const matched = rules.find(([, terms]) => terms.some((term) => text.includes(term)))?.[0];
  if (matched) return matched;
  const words = description.trim().split(/\s+/);
  const looksLikePersonName =
    words.length > 0 &&
    words.length <= 3 &&
    words.every((word) => /^[A-Z][a-z]{2,}$/.test(word.replace(/[^A-Za-z]/g, "")));
  return looksLikePersonName ? "Transfers" : "Other";
}

async function getDb() {
  if (!database) {
    database = await SQLite.openDatabaseAsync("kharcha.db");
    await database.execAsync(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
  }
  return database;
}

async function syncNativeEntries() {
  if (nativeImportInFlight) return nativeImportInFlight;
  nativeImportInFlight = (async () => {
    if (!FileSystem.documentDirectory) return false;
    const pendingUri = `${FileSystem.documentDirectory}kharcha_pending.jsonl`;
    const processingUri = `${FileSystem.documentDirectory}kharcha_pending_processing.jsonl`;
    const recoveryUri = `${FileSystem.documentDirectory}kharcha_recovery.jsonl`;
    const db = await getDb();

    const processFile = async (uri: string) => {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return false;
      const content = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      let handled = false;
      for (const line of content.split(/\r?\n/).filter(Boolean)) {
        let item: Expense;
        try {
          item = JSON.parse(line) as Expense;
        } catch {
          continue;
        }
        if (
          !item.id ||
          !item.description ||
          !Number.isFinite(Number(item.amount)) ||
          !["debit", "credit"].includes(item.type) ||
          !item.createdAt
        ) continue;
        // Database errors deliberately escape this function. The file is then
        // retained and retried instead of silently dropping a native entry.
        await db.runAsync(
          "INSERT OR IGNORE INTO expenses (id, description, amount, type, category, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          item.id,
          item.description.slice(0, 120),
          Number(item.amount),
          item.type,
          item.category || categorize(item.description, item.type),
          item.createdAt,
        );
        handled = true;
      }
      await FileSystem.deleteAsync(uri, { idempotent: true });
      return handled;
    };

    let imported = await processFile(recoveryUri);
    imported = (await processFile(processingUri)) || imported;
    const pending = await FileSystem.getInfoAsync(pendingUri);
    if (pending.exists) {
      await FileSystem.moveAsync({ from: pendingUri, to: processingUri });
      imported = (await processFile(processingUri)) || imported;
    }
    return imported;
  })().finally(() => {
    nativeImportInFlight = null;
  });
  return nativeImportInFlight;
}

async function scheduleReports() {
  if (Platform.OS !== "android") return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (scheduled.some((item) => item.identifier === "kharcha-daily")) return;

  await Notifications.scheduleNotificationAsync({
    identifier: "kharcha-daily",
    content: {
      title: "Your daily money recap is ready",
      body: "Open Kharcha to see today’s spending and what it means for your month.",
      data: { screen: "insights" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 20,
      minute: 30,
    },
  });
}

function DonutChart({ categories, total }: { categories: Array<{ name: string; value: number }>; total: number }) {
  const leadingColor = categoryMeta[categories[0]?.name]?.color ?? COLORS.purple;
  const leadingShare = total ? Math.round(((categories[0]?.value ?? 0) / total) * 100) : 0;
  const leadingIcon = categoryMeta[categories[0]?.name]?.icon ?? "sparkles-outline";
  return (
    <View style={styles.donutWrap}>
      <View style={[styles.donutGlow, { backgroundColor: `${leadingColor}18` }]} />
      <View style={[styles.donutRing, { borderColor: `${leadingColor}55` }]}>
        <View style={[styles.donutArcAccent, { borderTopColor: leadingColor, borderRightColor: leadingColor }]} />
        <View style={styles.donutInner}>
          <View style={[styles.donutIcon, { backgroundColor: `${leadingColor}20` }]}>
            <Ionicons name={leadingIcon} size={17} color={leadingColor} />
          </View>
        </View>
      </View>
      <View style={styles.donutText}>
        <Text style={styles.donutValue}>{shortMoney(total)}</Text>
        <Text style={styles.donutLabel}>THIS MONTH</Text>
        <Text style={[styles.donutShare, { color: leadingColor }]}>{leadingShare}% leading</Text>
      </View>
    </View>
  );
}

function KharchaApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState<EntryType>("debit");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [dateScope, setDateScope] = useState<DateScope>("today");
  const [customDateKey, setCustomDateKey] = useState(localDateKey(new Date()));
  const [overviewScope, setOverviewScope] = useState<OverviewScope>("month");
  const [overviewDateKey, setOverviewDateKey] = useState(localDateKey(new Date()));
  const [overviewSelectorVisible, setOverviewSelectorVisible] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<CalendarTarget | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editType, setEditType] = useState<EntryType>("debit");
  const [editCategory, setEditCategory] = useState("Other");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const descriptionRef = useRef<TextInput>(null);
  const amountRef = useRef<TextInput>(null);

  const loadExpenses = useCallback(async () => {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: string;
      description: string;
      amount: number;
      type: EntryType;
      category: string;
      created_at: string;
    }>("SELECT * FROM expenses ORDER BY created_at DESC");
    const next = rows.map((row) => ({ ...row, createdAt: row.created_at }));
    setExpenses((current) => {
      if (
        current.length === next.length &&
        current.every((item, index) =>
          item.id === next[index]?.id &&
          item.amount === next[index]?.amount &&
          item.description === next[index]?.description &&
          item.type === next[index]?.type &&
          item.category === next[index]?.category &&
          item.createdAt === next[index]?.createdAt
        )
      ) return current;
      return next;
    });
  }, []);

  const syncAndLoadExpenses = useCallback(async () => {
    if (syncLoadInFlight) return syncLoadInFlight;
    syncLoadInFlight = (async () => {
      try {
        await syncNativeEntries();
      } catch (error) {
        // The recovery and pending files stay on disk. A later foreground
        // refresh retries them without preventing the wallet from opening.
        console.warn("Kharcha native sync will retry", error);
      }
      await loadExpenses();
    })().finally(() => {
      syncLoadInFlight = null;
    });
    return syncLoadInFlight;
  }, [loadExpenses]);

  const upgradeSmartCategories = useCallback(async () => {
    const db = await getDb();
    const marker = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      "smart_categories_v1",
    );
    if (marker) return;
    const rows = await db.getAllAsync<{ id: string; description: string; type: EntryType }>(
      "SELECT id, description, type FROM expenses WHERE category = ?",
      "Other",
    );
    for (const row of rows) {
      const category = categorize(row.description, row.type);
      if (category !== "Other") {
        await db.runAsync("UPDATE expenses SET category = ? WHERE id = ?", category, row.id);
      }
    }
    await db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      "smart_categories_v1",
      "complete",
    );
  }, []);

  useEffect(() => {
    upgradeSmartCategories()
      .catch((error) => console.warn("Smart category upgrade will retry", error))
      .then(syncAndLoadExpenses)
      .catch(() => Alert.alert("Couldn’t open your wallet", "Please restart the app and try again."))
      .finally(() => setLoading(false));

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.screen === "insights") setTab("insights");
    });
    const openQuickAdd = (url: string | null) => {
      if (url?.startsWith("kharcha://quick-add")) {
        setTab("home");
        setTimeout(() => descriptionRef.current?.focus(), 350);
      }
    };
    Linking.getInitialURL().then(openQuickAdd);
    const linkSub = Linking.addEventListener("url", ({ url }) => openQuickAdd(url));
    return () => {
      responseSub.remove();
      linkSub.remove();
    };
  }, [syncAndLoadExpenses, upgradeSmartCategories]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") syncAndLoadExpenses().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [syncAndLoadExpenses]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active") syncAndLoadExpenses().catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [syncAndLoadExpenses]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)
      .then(setSmsEnabled)
      .catch(() => undefined);
  }, []);

  const requestSmsAccess = async () => {
    if (Platform.OS !== "android") return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, {
      title: "Enable bank SMS capture",
      message: "Kharcha will process new debit and credit alerts locally. OTPs and full message text are not stored.",
      buttonPositive: "Allow",
      buttonNegative: "Cancel",
    });
    const enabled = result === PermissionsAndroid.RESULTS.GRANTED;
    setSmsEnabled(enabled);
    Alert.alert(
      enabled ? "SMS capture is on" : "SMS permission is off",
      enabled ? "SMS and Gmail alerts now work together with duplicate protection." : "You can enable it later from this screen.",
    );
  };

  const requestGmailAccess = () => {
    Alert.alert(
      "Enable notification-bar capture",
      "On the next screen, turn on notification access for Kharcha. It will detect PKR/Rs debit and credit alerts from Gmail, Messages, banking and wallet apps without storing the full notification text.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open settings",
          onPress: () => Linking.sendIntent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            .catch(() => Linking.openSettings()),
        },
      ],
    );
  };

  const requestDailyReports = async () => {
    const result = await Notifications.requestPermissionsAsync();
    if (result.status === "granted") {
      await scheduleReports();
      Alert.alert("Daily recap is on", "We’ll remind you at 8:30 PM each evening.");
    } else {
      Alert.alert("Notifications are off", "You can enable them later in Android Settings.");
    }
  };

  const currentMonth = useMemo(() => {
    const now = new Date();
    return expenses.filter((item) => {
      const date = new Date(item.createdAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
  }, [expenses]);

  const totals = useMemo(() => {
    const credits = currentMonth.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.amount, 0);
    const debits = currentMonth.filter((item) => item.type === "debit").reduce((sum, item) => sum + item.amount, 0);
    return { credits, debits, balance: credits - debits };
  }, [currentMonth]);

  const overviewExpenses = useMemo(() => {
    if (overviewScope === "month") return currentMonth;
    let key = overviewDateKey;
    if (overviewScope !== "custom") {
      const date = new Date();
      if (overviewScope === "yesterday") date.setDate(date.getDate() - 1);
      key = localDateKey(date);
    }
    return expenses.filter((item) => localDateKey(item.createdAt) === key);
  }, [currentMonth, expenses, overviewDateKey, overviewScope]);

  const overviewTotals = useMemo(() => {
    const credits = overviewExpenses.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.amount, 0);
    const debits = overviewExpenses.filter((item) => item.type === "debit").reduce((sum, item) => sum + item.amount, 0);
    return { credits, debits, balance: credits - debits };
  }, [overviewExpenses]);

  const overviewLabel = overviewScope === "month"
    ? "MONTH"
    : overviewScope === "today"
      ? "TODAY"
      : overviewScope === "yesterday"
        ? "YESTERDAY"
        : "CUSTOM";

  const overviewPeriod = overviewScope === "month"
    ? new Date().toLocaleDateString("en-PK", { month: "short", year: "numeric" }).toUpperCase()
    : overviewScope === "custom"
      ? dateFromKey(overviewDateKey).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()
      : overviewScope === "today"
        ? "TODAY"
        : "YESTERDAY";

  const categories = useMemo(() => {
    const values = new Map<string, number>();
    currentMonth.filter((item) => item.type === "debit").forEach((item) => values.set(item.category, (values.get(item.category) ?? 0) + item.amount));
    return [...values.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [currentMonth]);

  const todayTotal = useMemo(() => {
    const today = new Date().toDateString();
    return expenses
      .filter((item) => item.type === "debit" && new Date(item.createdAt).toDateString() === today)
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses]);

  const lastSevenDays = useMemo(() => {
    const result: Array<{ key: string; label: string; value: number }> = [];
    const now = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = day.toDateString();
      const value = expenses
        .filter((item) => item.type === "debit" && new Date(item.createdAt).toDateString() === key)
        .reduce((sum, item) => sum + item.amount, 0);
      result.push({
        key,
        label: day.toLocaleDateString("en-PK", { weekday: "short" }).slice(0, 2),
        value,
      });
    }
    return result;
  }, [expenses]);

  const monthlyWeeks = useMemo(() => {
    const result = [0, 0, 0, 0, 0];
    currentMonth
      .filter((item) => item.type === "debit")
      .forEach((item) => {
        const week = Math.min(4, Math.floor((new Date(item.createdAt).getDate() - 1) / 7));
        result[week] += item.amount;
      });
    return result.map((value, index) => ({ label: `W${index + 1}`, value }));
  }, [currentMonth]);

  const insightMetrics = useMemo(() => {
    const debits = currentMonth.filter((item) => item.type === "debit");
    const activeDays = new Set(debits.map((item) => new Date(item.createdAt).toDateString())).size;
    const largest = debits.reduce((max, item) => Math.max(max, item.amount), 0);
    const elapsedDays = Math.max(1, new Date().getDate());
    const savingsRate = totals.credits > 0 ? ((totals.credits - totals.debits) / totals.credits) * 100 : 0;
    return {
      average: totals.debits / elapsedDays,
      largest,
      activeDays,
      savingsRate,
    };
  }, [currentMonth, totals]);

  const selectedDateKey = useMemo(() => {
    if (dateScope === "custom") return customDateKey;
    const date = new Date();
    if (dateScope === "yesterday") date.setDate(date.getDate() - 1);
    return localDateKey(date);
  }, [customDateKey, dateScope]);

  const filteredExpenses = useMemo(
    () => dateScope === "all" ? expenses : expenses.filter((item) => localDateKey(item.createdAt) === selectedDateKey),
    [dateScope, expenses, selectedDateKey],
  );

  const filteredTotals = useMemo(() => {
    const credits = filteredExpenses.filter((item) => item.type === "credit").reduce((sum, item) => sum + item.amount, 0);
    const debits = filteredExpenses.filter((item) => item.type === "debit").reduce((sum, item) => sum + item.amount, 0);
    return { credits, debits };
  }, [filteredExpenses]);

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1;
      if (day < 1 || day > count) return null;
      const date = new Date(year, month, day, 12);
      return { day, key: localDateKey(date), date };
    });
  }, [calendarMonth]);

  const addEntry = async () => {
    const parsed = Number(amount.replace(/,/g, ""));
    if (!description.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert("Almost there", "Add a short description and a valid amount.");
      return;
    }
    const entry: Expense = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      description: description.trim().slice(0, 120),
      amount: parsed,
      type: entryType,
      category: categorize(description, entryType),
      createdAt: new Date().toISOString(),
    };
    try {
      const db = await getDb();
      await db.runAsync(
        "INSERT INTO expenses (id, description, amount, type, category, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        entry.id,
        entry.description,
        entry.amount,
        entry.type,
        entry.category,
        entry.createdAt,
      );
      setExpenses((items) => [entry, ...items]);
      setDescription("");
      setAmount("");
      Keyboard.dismiss();
    } catch {
      Alert.alert("Couldn’t save entry", "Nothing was changed. Please try again.");
    }
  };

  const removeEntry = (entry: Expense) => {
    Alert.alert("Remove transaction?", entry.description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const db = await getDb();
          await db.runAsync("DELETE FROM expenses WHERE id = ?", entry.id);
          setExpenses((items) => items.filter((item) => item.id !== entry.id));
        },
      },
    ]);
  };

  const openEditor = (entry: Expense) => {
    setEditingExpense(entry);
    setEditDescription(entry.description);
    setEditAmount(String(entry.amount));
    setEditType(entry.type);
    setEditCategory(entry.category);
  };

  const saveEditedEntry = async () => {
    if (!editingExpense) return;
    const parsed = Number(editAmount.replace(/,/g, ""));
    if (!editDescription.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert("Almost there", "Add a description and a valid amount.");
      return;
    }
    const updated: Expense = {
      ...editingExpense,
      description: editDescription.trim().slice(0, 120),
      amount: parsed,
      type: editType,
      category: editType === "credit" ? "Income" : editCategory,
    };
    try {
      const db = await getDb();
      await db.runAsync(
        "UPDATE expenses SET description = ?, amount = ?, type = ?, category = ? WHERE id = ?",
        updated.description,
        updated.amount,
        updated.type,
        updated.category,
        updated.id,
      );
      setExpenses((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditingExpense(null);
      Keyboard.dismiss();
    } catch {
      Alert.alert("Couldn’t update entry", "Nothing was changed. Please try again.");
    }
  };

  const exportCsv = async () => {
    if (!expenses.length) {
      Alert.alert("Nothing to export yet", "Add your first transaction, then try again.");
      return;
    }
    const rows = [
      ["Date", "Description", "Category", "Type", "Amount"],
      ...expenses.map((item) => [item.createdAt, item.description, item.category, item.type, String(item.amount)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const uri = `${FileSystem.cacheDirectory}kharcha-expenses.csv`;
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export Kharcha expenses" });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await syncAndLoadExpenses();
    setRefreshing(false);
  };

  const renderTransaction = (item: Expense) => {
    const meta = categoryMeta[item.category] ?? categoryMeta.Other;
    return (
      <Pressable key={item.id} onPress={() => openEditor(item)} onLongPress={() => removeEntry(item)} style={styles.transaction}>
        <View style={[styles.transactionIcon, { backgroundColor: `${meta.color}18` }]}>
          <Ionicons name={meta.icon} color={meta.color} size={19} />
        </View>
        <View style={styles.transactionText}>
          <Text numberOfLines={1} style={styles.transactionTitle}>{item.description}</Text>
          <Text style={styles.transactionMeta}>{item.category} · {new Date(item.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</Text>
        </View>
        <Text style={[styles.transactionAmount, item.type === "credit" && styles.creditAmount]}>
          {item.type === "credit" ? "+" : "−"} {money(item.amount)}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
        >
          <View style={styles.header}>
            <View style={styles.brandLockup}>
              <LinearGradient colors={["#7D6CF0", "#5944CC"]} style={styles.brandMark}>
                <Ionicons name="wallet-outline" size={21} color="#FFF" />
              </LinearGradient>
              <View>
                <Text style={styles.logo}>Kharcha<Text style={styles.logoDot}>.</Text></Text>
                <Text style={styles.tagline}>PERSONAL FINANCE</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={requestDailyReports} style={styles.headerButton}><Ionicons name="notifications-outline" size={19} color={COLORS.ink} /></Pressable>
              <Pressable onPress={exportCsv} style={styles.headerButton}><Ionicons name="share-outline" size={20} color={COLORS.ink} /></Pressable>
            </View>
          </View>

          {tab === "home" && (
            <>
              <LinearGradient colors={["#3B2A79", "#21153F"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.moneyHero}>
                <View style={styles.heroOrbLarge} />
                <View style={styles.heroOrbSmall} />
                <View style={styles.heroTop}>
                  <Pressable onPress={() => setOverviewSelectorVisible(true)} style={styles.heroPill}>
                    <View style={styles.heroLiveDot} />
                    <Text style={styles.heroPillText}>{overviewLabel} OVERVIEW</Text>
                    <Ionicons name="chevron-down" size={11} color="#655D70" />
                  </Pressable>
                  <Text numberOfLines={1} style={styles.heroMonth}>{overviewPeriod}</Text>
                </View>
                <Text style={styles.heroBalanceLabel}>Net position</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.heroBalance}>{money(overviewTotals.balance)}</Text>
                <Text style={styles.heroBalanceCaption}>Money in minus money out for this overview</Text>
                <View style={styles.heroDivider} />
                <View style={styles.heroStats}>
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>ENTRIES</Text>
                    <Text style={styles.heroStatValue}>{overviewExpenses.length}</Text>
                  </View>
                  <View style={styles.heroStatDivider} />
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>MONEY IN</Text>
                    <Text style={[styles.heroStatValue, { color: "#78E2B6" }]}>{shortMoney(overviewTotals.credits)}</Text>
                  </View>
                  <View style={styles.heroStatDivider} />
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>MONEY OUT</Text>
                    <Text style={[styles.heroStatValue, { color: "#FFB0A1" }]}>{shortMoney(overviewTotals.debits)}</Text>
                  </View>
                </View>
              </LinearGradient>

              <View style={styles.greeting}>
                <View>
                  <Text style={styles.eyebrow}>YOUR MONEY, AT A GLANCE</Text>
                  <Text style={styles.title}>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"} 👋</Text>
                  <Text style={styles.subtitle}>Capture it now. Understand it later.</Text>
                </View>
                <View style={styles.todayBadge}>
                  <Text style={styles.todayLabel}>TODAY</Text>
                  <Text style={styles.todayValue}>{shortMoney(todayTotal)}</Text>
                </View>
              </View>

              <LinearGradient colors={["#24202F", "#191720"]} style={styles.quickCard}>
                <View style={styles.quickHeader}>
                  <LinearGradient colors={["#816CF5", "#5B46D5"]} style={styles.bolt}>
                    <Ionicons name="flash" size={17} color="#FFF" />
                  </LinearGradient>
                  <View style={styles.quickHeading}>
                    <Text style={styles.quickEyebrow}>FAST CAPTURE</Text>
                    <Text style={styles.quickTitle}>Quick add</Text>
                    <Text style={styles.quickSubtitle}>Two fields. Done in seconds.</Text>
                  </View>
                  <View style={styles.quickReady}>
                    <View style={styles.quickReadyDot} />
                    <Text style={styles.quickReadyText}>READY</Text>
                  </View>
                </View>
                <View style={styles.typeToggle}>
                  <Pressable onPress={() => setEntryType("debit")} style={[styles.typeButton, entryType === "debit" && styles.typeButtonDebit]}>
                    <Ionicons name="arrow-up-outline" size={13} color={entryType === "debit" ? "#FFF" : "#8E8799"} />
                    <Text style={[styles.typeText, entryType === "debit" && styles.typeTextSelected]}>MONEY OUT</Text>
                  </Pressable>
                  <Pressable onPress={() => setEntryType("credit")} style={[styles.typeButton, entryType === "credit" && styles.typeButtonCredit]}>
                    <Ionicons name="arrow-down-outline" size={13} color={entryType === "credit" ? "#FFF" : "#8E8799"} />
                    <Text style={[styles.typeText, entryType === "credit" && styles.typeTextSelected]}>MONEY IN</Text>
                  </Pressable>
                </View>
                <Text style={styles.quickFieldLabel}>DESCRIPTION</Text>
                <View style={styles.descriptionWrap}>
                  <Ionicons name="create-outline" size={17} color="#9B91B1" />
                  <TextInput
                    ref={descriptionRef}
                    value={description}
                    onChangeText={setDescription}
                    onSubmitEditing={() => amountRef.current?.focus()}
                    returnKeyType="next"
                    placeholder="What was it?"
                    placeholderTextColor="#777180"
                    style={styles.descriptionInput}
                  />
                </View>
                <Text style={styles.quickFieldLabel}>AMOUNT</Text>
                <View style={styles.amountRow}>
                  <View style={styles.amountInputWrap}>
                    <View style={styles.currencyBadge}><Text style={styles.currency}>Rs</Text></View>
                    <TextInput
                      ref={amountRef}
                      value={amount}
                      onChangeText={setAmount}
                      onSubmitEditing={addEntry}
                      returnKeyType="done"
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor="#918C98"
                      style={styles.amountInput}
                    />
                  </View>
                  <Pressable onPress={addEntry} style={styles.addButton}>
                    <Text style={styles.addButtonText}>{entryType === "credit" ? "Add income" : "Add expense"}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFF" />
                  </Pressable>
                </View>
                <View style={styles.hintRow}>
                  <Ionicons name="sparkles-outline" size={12} color="#A997FF" />
                  <Text style={styles.hint}>Category is detected automatically</Text>
                </View>
              </LinearGradient>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <View style={[styles.statIcon, { backgroundColor: "#292341" }]}><Ionicons name="wallet-outline" size={18} color={COLORS.purple} /></View>
                  <Text style={styles.statLabel}>BALANCE</Text>
                  <Text style={styles.statValue}>{shortMoney(totals.balance)}</Text>
                  <Text style={styles.statFoot}>Credits − spending</Text>
                </View>
                <View style={styles.statCard}>
                  <View style={[styles.statIcon, { backgroundColor: "#35221F" }]}><Ionicons name="arrow-up-outline" size={18} color={COLORS.coral} /></View>
                  <Text style={styles.statLabel}>SPENT</Text>
                  <Text style={styles.statValue}>{shortMoney(totals.debits)}</Text>
                  <Text style={styles.statFoot}>This month</Text>
                </View>
              </View>

              <LinearGradient colors={["#6B59DB", "#5140BE"]} style={styles.recapCard}>
                <View style={styles.recapHeader}>
                  <View style={styles.recapSpark}><Ionicons name="sparkles" size={18} color="#FFE18C" /></View>
                  <View style={styles.flex}><Text style={styles.recapEyebrow}>DAILY RECAP</Text><Text style={styles.recapTitle}>Today, in a nutshell</Text></View>
                  <Pressable onPress={requestDailyReports}><Ionicons name="notifications-outline" size={22} color="#FFF" /></Pressable>
                </View>
                <Text style={styles.recapLabel}>You spent</Text>
                <Text style={styles.recapAmount}>{money(todayTotal)}</Text>
                <View style={styles.recapInsight}>
                  <Ionicons name="bulb-outline" size={18} color="#FFD978" />
                  <Text style={styles.recapInsightText}>
                    <Text style={styles.recapStrong}>{categories[0]?.name ?? "Your top category"} leads this month. </Text>
                    {categories[0] ? `${Math.round((categories[0].value / Math.max(totals.debits, 1)) * 100)}% of your spending went there.` : "Add a few entries and Kharcha will spot your pattern."}
                  </Text>
                </View>
              </LinearGradient>

              <View style={styles.smartInsight}>
                <LinearGradient colors={["#33265F", "#28203E"]} style={styles.smartInsightIcon}>
                  <Ionicons name="sparkles" size={19} color="#D5CBFF" />
                </LinearGradient>
                <View style={styles.flex}>
                  <Text style={styles.smartInsightLabel}>SMART SPENDING SIGNAL</Text>
                  <Text style={styles.smartInsightTitle}>
                    {categories[0] ? `${categories[0].name} is your leading category` : "Your pattern will appear here"}
                  </Text>
                  <Text style={styles.smartInsightCopy}>
                    {categories[0] ? `${Math.round((categories[0].value / Math.max(totals.debits, 1)) * 100)}% of this month’s spending · ${money(categories[0].value)}` : "Add a few transactions and Kharcha will summarize the pattern."}
                  </Text>
                </View>
                <Pressable onPress={() => setTab("insights")} style={styles.smartInsightArrow}>
                  <Ionicons name="arrow-forward" size={17} color="#C5BBFF" />
                </Pressable>
              </View>

              <SectionHeader eyebrow="LATEST ACTIVITY" title="Recent transactions" action="See all" onAction={() => setTab("activity")} />
              <View style={styles.listCard}>{expenses.slice(0, 5).map(renderTransaction)}</View>
            </>
          )}

          {tab === "activity" && (
            <>
              <View style={styles.pageIntro}>
                <Text style={styles.eyebrow}>EVERY RUPEE, REMEMBERED</Text>
                <Text style={styles.pageTitle}>Transactions</Text>
                <Text style={styles.subtitle}>Tap to edit · Long-press to remove.</Text>
              </View>
              <View style={styles.dateFilterCard}>
                <View style={styles.dateFilterTop}>
                  <View>
                    <Text style={styles.dateFilterEyebrow}>VIEWING</Text>
                    <Text style={styles.dateFilterTitle}>
                      {dateScope === "all"
                        ? "All transactions"
                        : dateScope === "today"
                          ? "Today"
                          : dateScope === "yesterday"
                            ? "Yesterday"
                            : dateFromKey(customDateKey).toLocaleDateString("en-PK", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
                    </Text>
                  </View>
                  <View style={styles.dateFilterIcon}><Ionicons name="calendar-clear" size={18} color="#B9AEFF" /></View>
                </View>
                <View style={styles.dateChips}>
                  {([
                    { value: "today", label: "Today" },
                    { value: "yesterday", label: "Yesterday" },
                    { value: "all", label: "All" },
                  ] as Array<{ value: DateScope; label: string }>).map((item) => (
                    <Pressable
                      key={item.value}
                      onPress={() => { setDateScope(item.value); setShowAll(false); }}
                      style={[styles.dateChip, dateScope === item.value && styles.dateChipActive]}
                    >
                      <Text style={[styles.dateChipText, dateScope === item.value && styles.dateChipTextActive]}>{item.label}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => {
                      setCalendarMonth(new Date(dateFromKey(customDateKey).getFullYear(), dateFromKey(customDateKey).getMonth(), 1));
                      setCalendarTarget("activity");
                    }}
                    style={[styles.dateChip, styles.customDateChip, dateScope === "custom" && styles.dateChipActive]}
                  >
                    <Ionicons name="calendar-outline" size={13} color={dateScope === "custom" ? "#FFF" : "#9B93A5"} />
                    <Text style={[styles.dateChipText, dateScope === "custom" && styles.dateChipTextActive]}>Pick date</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.summaryStrip}>
                <View><Text style={styles.summaryLabel}>MONEY IN</Text><Text style={[styles.summaryValue, { color: COLORS.green }]}>{shortMoney(filteredTotals.credits)}</Text></View>
                <View style={styles.summaryDivider} />
                <View><Text style={styles.summaryLabel}>MONEY OUT</Text><Text style={[styles.summaryValue, { color: COLORS.coral }]}>{shortMoney(filteredTotals.debits)}</Text></View>
                <View style={styles.summaryDivider} />
                <View><Text style={styles.summaryLabel}>ENTRIES</Text><Text style={styles.summaryValue}>{filteredExpenses.length}</Text></View>
              </View>
              {filteredExpenses.length ? (
                <View style={styles.listCard}>{(showAll ? filteredExpenses : filteredExpenses.slice(0, 12)).map(renderTransaction)}</View>
              ) : (
                <View style={styles.emptyDateCard}>
                  <View style={styles.emptyDateIcon}><Ionicons name="receipt-outline" size={24} color="#8F84CD" /></View>
                  <Text style={styles.emptyDateTitle}>No transactions here</Text>
                  <Text style={styles.emptyDateCopy}>Choose another date or add a new expense from Home.</Text>
                </View>
              )}
              {filteredExpenses.length > 12 && (
                <Pressable onPress={() => setShowAll((value) => !value)} style={styles.outlineButton}>
                  <Text style={styles.outlineButtonText}>{showAll ? "Show less" : "Show all entries"}</Text>
                </Pressable>
              )}
            </>
          )}

          {tab === "insights" && (
            <>
              <View style={[styles.pageIntro, styles.insightPageIntro]}>
                <View>
                  <Text style={styles.eyebrow}>MONEY INTELLIGENCE</Text>
                  <Text style={styles.pageTitle}>Insights</Text>
                </View>
                <View style={styles.insightLivePill}>
                  <View style={styles.insightLiveDot} />
                  <Text style={styles.insightLiveText}>LIVE</Text>
                </View>
              </View>

              <LinearGradient colors={["#503CC0", "#2A1D60", "#191522"]} locations={[0, .62, 1]} style={styles.insightHero}>
                <View style={styles.insightOrbLarge} />
                <View style={styles.insightOrbSmall} />
                <View style={styles.insightHeroTop}>
                  <View style={styles.insightMonthPill}>
                    <Ionicons name="calendar-clear-outline" size={12} color="#D6CEFF" />
                    <Text style={styles.insightMonthText}>{new Date().toLocaleDateString("en-PK", { month: "long", year: "numeric" }).toUpperCase()}</Text>
                  </View>
                  <Ionicons name="analytics-outline" size={22} color="#CFC6FF" />
                </View>
                <Text style={styles.insightHeroLabel}>TOTAL MONEY OUT</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.insightHeroAmount}>{money(totals.debits)}</Text>
                <Text style={styles.insightHeroStory}>
                  {categories[0]
                    ? `${categories[0].name} leads your spending at ${Math.round((categories[0].value / Math.max(totals.debits, 1)) * 100)}% this month.`
                    : "Your spending story will become clearer as entries arrive."}
                </Text>
                <View style={styles.insightHeroDivider} />
                <View style={styles.insightHeroMetrics}>
                  <View style={styles.insightHeroMetric}>
                    <Text style={styles.insightHeroMetricLabel}>DAILY AVG</Text>
                    <Text style={styles.insightHeroMetricValue}>{shortMoney(insightMetrics.average)}</Text>
                  </View>
                  <View style={styles.insightHeroMetricDivider} />
                  <View style={styles.insightHeroMetric}>
                    <Text style={styles.insightHeroMetricLabel}>TOP SPEND</Text>
                    <Text style={styles.insightHeroMetricValue}>{shortMoney(insightMetrics.largest)}</Text>
                  </View>
                  <View style={styles.insightHeroMetricDivider} />
                  <View style={styles.insightHeroMetric}>
                    <Text style={styles.insightHeroMetricLabel}>SAVINGS</Text>
                    <Text style={[styles.insightHeroMetricValue, { color: insightMetrics.savingsRate >= 0 ? "#78E2B6" : "#FFB0A1" }]}>{Math.round(insightMetrics.savingsRate)}%</Text>
                  </View>
                </View>
              </LinearGradient>

              <View style={styles.analysisCard}>
                <View style={styles.insightSectionTop}>
                  <View>
                    <Text style={styles.eyebrow}>SPENDING MIX</Text>
                    <Text style={styles.chartTitle}>Where your money went</Text>
                  </View>
                  <View style={styles.insightSectionIcon}><Ionicons name="pie-chart" size={17} color="#A997FF" /></View>
                </View>
                <View style={styles.chartRow}>
                  <DonutChart categories={categories} total={totals.debits} />
                  <View style={styles.legend}>
                    {categories.slice(0, 5).map((item) => (
                      <View key={item.name} style={styles.legendRow}>
                        <View style={[styles.legendIcon, { backgroundColor: `${categoryMeta[item.name]?.color ?? categoryMeta.Other.color}20` }]}>
                          <Ionicons name={categoryMeta[item.name]?.icon ?? categoryMeta.Other.icon} size={12} color={categoryMeta[item.name]?.color ?? categoryMeta.Other.color} />
                        </View>
                        <Text style={styles.legendName}>{item.name}</Text>
                        <Text style={styles.legendValue}>{Math.round((item.value / Math.max(totals.debits, 1)) * 100)}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {categories.map((item) => (
                  <View key={item.name} style={styles.categoryBarRow}>
                    <View style={styles.categoryBarTop}>
                      <View style={styles.categoryBarIdentity}>
                        <View style={[styles.categoryBarDot, { backgroundColor: categoryMeta[item.name]?.color ?? categoryMeta.Other.color }]} />
                        <Text style={styles.categoryBarName}>{item.name}</Text>
                      </View>
                      <View style={styles.categoryBarNumbers}>
                        <Text style={styles.categoryBarPercent}>{Math.round((item.value / Math.max(totals.debits, 1)) * 100)}%</Text>
                        <Text style={styles.categoryBarValue}>{money(item.value)}</Text>
                      </View>
                    </View>
                    <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(5, (item.value / Math.max(categories[0]?.value ?? 1, 1)) * 100)}%`, backgroundColor: categoryMeta[item.name]?.color ?? categoryMeta.Other.color }]} /></View>
                  </View>
                ))}
              </View>

              <View style={styles.trendCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.eyebrow}>LAST 7 DAYS</Text>
                    <Text style={styles.chartTitle}>Daily spending pulse</Text>
                  </View>
                  <View style={styles.chartTotalPill}><Text style={styles.chartTotalText}>{shortMoney(lastSevenDays.reduce((sum, item) => sum + item.value, 0))}</Text></View>
                </View>
                <View style={styles.weekChart}>
                  {lastSevenDays.map((item) => {
                    const maximum = Math.max(...lastSevenDays.map((day) => day.value), 1);
                    const height = item.value ? Math.max(8, (item.value / maximum) * 92) : 4;
                    return (
                      <View key={item.key} style={styles.weekColumn}>
                        <Text numberOfLines={1} style={styles.weekValue}>{item.value ? shortMoney(item.value).replace("Rs ", "") : "—"}</Text>
                        <View style={styles.weekBarSlot}>
                          <LinearGradient colors={item.value ? ["#8B75FF", "#5E49D8"] : ["#2D2935", "#2D2935"]} style={[styles.weekBar, { height }]} />
                        </View>
                        <Text style={styles.weekLabel}>{item.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.cashflowCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.eyebrow}>MONTHLY CASH FLOW</Text>
                    <Text style={styles.chartTitle}>Money in vs money out</Text>
                  </View>
                  <Ionicons name="swap-vertical-outline" size={23} color={COLORS.purple} />
                </View>
                {[
                  { label: "CREDIT", value: totals.credits, color: COLORS.green },
                  { label: "DEBIT", value: totals.debits, color: COLORS.coral },
                ].map((item) => {
                  const maximum = Math.max(totals.credits, totals.debits, 1);
                  return (
                    <View key={item.label} style={styles.flowRow}>
                      <View style={styles.flowTop}><Text style={styles.flowLabel}>{item.label}</Text><Text style={styles.flowValue}>{money(item.value)}</Text></View>
                      <View style={styles.flowTrack}><View style={[styles.flowFill, { width: `${Math.max(item.value ? 4 : 0, (item.value / maximum) * 100)}%`, backgroundColor: item.color }]} /></View>
                    </View>
                  );
                })}
                <View style={styles.netFlow}>
                  <Text style={styles.netFlowLabel}>NET POSITION</Text>
                  <Text style={[styles.netFlowValue, { color: totals.balance >= 0 ? COLORS.green : COLORS.coral }]}>{money(totals.balance)}</Text>
                </View>
              </View>

              <View style={styles.trendCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.eyebrow}>THIS MONTH</Text>
                    <Text style={styles.chartTitle}>Week-by-week trend</Text>
                  </View>
                  <Text style={styles.trendDirection}>
                    {(() => {
                      const currentWeek = Math.min(4, Math.floor((new Date().getDate() - 1) / 7));
                      return currentWeek > 0 && monthlyWeeks[currentWeek].value > monthlyWeeks[currentWeek - 1].value ? "Trending up" : "Under control";
                    })()}
                  </Text>
                </View>
                <View style={styles.monthWeekChart}>
                  {monthlyWeeks.map((item) => {
                    const maximum = Math.max(...monthlyWeeks.map((week) => week.value), 1);
                    const height = item.value ? Math.max(8, (item.value / maximum) * 78) : 4;
                    return (
                      <View key={item.label} style={styles.monthWeekColumn}>
                        <View style={styles.monthWeekSlot}><View style={[styles.monthWeekBar, { height }]} /></View>
                        <Text style={styles.weekLabel}>{item.label}</Text>
                        <Text numberOfLines={1} style={styles.monthWeekValue}>{item.value ? shortMoney(item.value) : "Rs 0"}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.metricGrid}>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#28223E" }]}><Ionicons name="speedometer-outline" size={18} color={COLORS.purple} /></View>
                  <Text style={styles.metricLabel}>DAILY AVERAGE</Text>
                  <Text style={styles.metricValue}>{shortMoney(insightMetrics.average)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#35221F" }]}><Ionicons name="flash-outline" size={18} color={COLORS.coral} /></View>
                  <Text style={styles.metricLabel}>LARGEST SPEND</Text>
                  <Text style={styles.metricValue}>{shortMoney(insightMetrics.largest)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#1A2B25" }]}><Ionicons name="calendar-outline" size={18} color={COLORS.green} /></View>
                  <Text style={styles.metricLabel}>SPENDING DAYS</Text>
                  <Text style={styles.metricValue}>{insightMetrics.activeDays}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#2B2419" }]}><Ionicons name="trending-up-outline" size={18} color={COLORS.gold} /></View>
                  <Text style={styles.metricLabel}>SAVINGS RATE</Text>
                  <Text style={[styles.metricValue, { color: insightMetrics.savingsRate >= 0 ? COLORS.green : COLORS.coral }]}>{Math.round(insightMetrics.savingsRate)}%</Text>
                </View>
              </View>

              <View style={styles.monthCards}>
                <View style={[styles.monthCard, { backgroundColor: "#142820" }]}>
                  <Ionicons name="arrow-down-circle-outline" size={23} color={COLORS.green} />
                  <Text style={styles.monthCardLabel}>TOTAL CREDIT</Text>
                  <Text style={styles.monthCardValue}>{money(totals.credits)}</Text>
                </View>
                <View style={[styles.monthCard, { backgroundColor: "#30201D" }]}>
                  <Ionicons name="arrow-up-circle-outline" size={23} color={COLORS.coral} />
                  <Text style={styles.monthCardLabel}>TOTAL DEBIT</Text>
                  <Text style={styles.monthCardValue}>{money(totals.debits)}</Text>
                </View>
              </View>

              <Pressable onPress={requestDailyReports} style={styles.notificationCard}>
                <View style={styles.notificationIcon}><Ionicons name="notifications-outline" size={21} color={COLORS.purple} /></View>
                <View style={styles.flex}><Text style={styles.notificationTitle}>Evening money recap</Text><Text style={styles.notificationCopy}>Get a gentle daily reminder at 8:30 PM.</Text></View>
                <Ionicons name="chevron-forward" size={20} color="#AAA5AD" />
              </Pressable>

              <Pressable onPress={requestGmailAccess} style={styles.notificationCard}>
                <View style={[styles.notificationIcon, { backgroundColor: "#1A2B25" }]}><Ionicons name="chatbox-ellipses-outline" size={21} color={COLORS.green} /></View>
                <View style={styles.flex}>
                  <Text style={styles.notificationTitle}>Notification-bar money capture</Text>
                  <Text style={styles.notificationCopy}>Gmail, Messages, banking and wallet alerts are checked locally.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#77717E" />
              </Pressable>

              <Pressable onPress={requestSmsAccess} style={styles.notificationCard}>
                <View style={[styles.notificationIcon, { backgroundColor: "#2B2419" }]}><Ionicons name="chatbubble-outline" size={21} color={COLORS.gold} /></View>
                <View style={styles.flex}>
                  <Text style={styles.notificationTitle}>Bank SMS backup capture</Text>
                  <Text style={styles.notificationCopy}>{smsEnabled ? "On · Works alongside Gmail with duplicate protection." : "Off · Tap to enable SMS monitoring."}</Text>
                </View>
                <Ionicons name={smsEnabled ? "checkmark-circle" : "chevron-forward"} size={20} color={smsEnabled ? COLORS.green : "#77717E"} />
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        transparent
        visible={overviewSelectorVisible}
        onRequestClose={() => setOverviewSelectorVisible(false)}
      >
        <View style={styles.overviewPickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOverviewSelectorVisible(false)} />
          <View style={styles.overviewPickerCard}>
            <View style={styles.overviewPickerHeader}>
              <View>
                <Text style={styles.calendarEyebrow}>MAIN CARD</Text>
                <Text style={styles.calendarTitle}>Choose overview</Text>
                <Text style={styles.overviewPickerCopy}>Change the period shown on your Home summary.</Text>
              </View>
              <Pressable onPress={() => setOverviewSelectorVisible(false)} style={styles.calendarClose}>
                <Ionicons name="close" size={19} color={COLORS.muted} />
              </Pressable>
            </View>
            <View style={styles.overviewPickerGrid}>
              {([
                { value: "today", label: "Today", copy: "Current day", icon: "sunny-outline", color: COLORS.gold },
                { value: "yesterday", label: "Yesterday", copy: "Previous day", icon: "time-outline", color: "#8B75FF" },
                { value: "month", label: "This month", copy: "Monthly view", icon: "calendar-clear-outline", color: COLORS.green },
                { value: "custom", label: "Custom date", copy: "Choose a day", icon: "options-outline", color: COLORS.coral },
              ] as Array<{ value: OverviewScope; label: string; copy: string; icon: keyof typeof Ionicons.glyphMap; color: string }>).map((item) => {
                const active = overviewScope === item.value;
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => {
                      if (item.value === "custom") {
                        setOverviewSelectorVisible(false);
                        const selected = dateFromKey(overviewDateKey);
                        setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
                        setCalendarTarget("overview");
                      } else {
                        setOverviewScope(item.value);
                        setOverviewSelectorVisible(false);
                      }
                    }}
                    style={[styles.overviewPickerOption, active && styles.overviewPickerOptionActive]}
                  >
                    <View style={[styles.overviewPickerIcon, { backgroundColor: `${item.color}20` }]}>
                      <Ionicons name={item.icon} size={20} color={item.color} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.overviewPickerLabel}>{item.label}</Text>
                      <Text style={styles.overviewPickerOptionCopy}>{item.copy}</Text>
                    </View>
                    <Ionicons name={active ? "checkmark-circle" : "chevron-forward"} size={19} color={active ? COLORS.green : "#6F6876"} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(calendarTarget)}
        onRequestClose={() => setCalendarTarget(null)}
      >
        <View style={styles.calendarBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCalendarTarget(null)} />
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <View>
                <Text style={styles.calendarEyebrow}>CUSTOM DATE</Text>
                <Text style={styles.calendarTitle}>Choose a day</Text>
              </View>
              <Pressable onPress={() => setCalendarTarget(null)} style={styles.calendarClose}>
                <Ionicons name="close" size={19} color={COLORS.muted} />
              </Pressable>
            </View>
            <View style={styles.calendarMonthRow}>
              <Pressable
                onPress={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                style={styles.calendarArrow}
              >
                <Ionicons name="chevron-back" size={19} color="#B9AEFF" />
              </Pressable>
              <Text style={styles.calendarMonthText}>{calendarMonth.toLocaleDateString("en-PK", { month: "long", year: "numeric" })}</Text>
              <Pressable
                onPress={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                style={styles.calendarArrow}
              >
                <Ionicons name="chevron-forward" size={19} color="#B9AEFF" />
              </Pressable>
            </View>
            <View style={styles.calendarWeekRow}>
              {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => <Text key={`${label}-${index}`} style={styles.calendarWeekday}>{label}</Text>)}
            </View>
            <View style={styles.calendarGrid}>
              {calendarDays.map((item, index) => item ? (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    if (calendarTarget === "overview") {
                      setOverviewDateKey(item.key);
                      setOverviewScope("custom");
                    } else {
                      setCustomDateKey(item.key);
                      setDateScope("custom");
                      setShowAll(false);
                    }
                    setCalendarTarget(null);
                  }}
                  style={[
                    styles.calendarDay,
                    item.key === (calendarTarget === "overview" ? overviewDateKey : customDateKey) && styles.calendarDaySelected,
                    item.key === localDateKey(new Date()) && item.key !== (calendarTarget === "overview" ? overviewDateKey : customDateKey) && styles.calendarDayToday,
                  ]}
                >
                  <Text style={[styles.calendarDayText, item.key === (calendarTarget === "overview" ? overviewDateKey : customDateKey) && styles.calendarDayTextSelected]}>{item.day}</Text>
                </Pressable>
              ) : <View key={`blank-${index}`} style={styles.calendarDay} />)}
            </View>
            <Pressable
              onPress={() => {
                const now = new Date();
                setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                if (calendarTarget === "overview") {
                  setOverviewDateKey(localDateKey(now));
                  setOverviewScope("today");
                } else {
                  setCustomDateKey(localDateKey(now));
                  setDateScope("today");
                  setShowAll(false);
                }
                setCalendarTarget(null);
              }}
              style={styles.calendarTodayButton}
            >
              <Ionicons name="locate-outline" size={16} color="#B9AEFF" />
              <Text style={styles.calendarTodayText}>Jump to today</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(editingExpense)}
        onRequestClose={() => setEditingExpense(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.editorBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditingExpense(null)} />
          <View style={styles.editorCard}>
            <View style={styles.editorHeader}>
              <View>
                <Text style={styles.editorEyebrow}>EDIT TRANSACTION</Text>
                <Text style={styles.editorTitle}>Update expense</Text>
              </View>
              <Pressable onPress={() => setEditingExpense(null)} style={styles.editorClose}>
                <Ionicons name="close" size={20} color={COLORS.muted} />
              </Pressable>
            </View>

            <View style={styles.editorToggle}>
              <Pressable onPress={() => setEditType("debit")} style={[styles.editorTypeButton, editType === "debit" && styles.editorDebit]}>
                <Text style={[styles.editorTypeText, editType === "debit" && styles.editorTypeTextActive]}>SPEND</Text>
              </Pressable>
              <Pressable onPress={() => setEditType("credit")} style={[styles.editorTypeButton, editType === "credit" && styles.editorCredit]}>
                <Text style={[styles.editorTypeText, editType === "credit" && styles.editorTypeTextActive]}>CREDIT</Text>
              </Pressable>
            </View>

            <Text style={styles.editorLabel}>DESCRIPTION</Text>
            <TextInput
              autoFocus
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Description"
              placeholderTextColor="#77717E"
              style={styles.editorInput}
            />
            <Text style={styles.editorLabel}>AMOUNT</Text>
            <View style={styles.editorAmountWrap}>
              <Text style={styles.editorCurrency}>Rs</Text>
              <TextInput
                value={editAmount}
                onChangeText={setEditAmount}
                keyboardType="decimal-pad"
                onSubmitEditing={saveEditedEntry}
                style={styles.editorAmountInput}
              />
            </View>

            {editType === "debit" && (
              <>
                <Text style={[styles.editorLabel, { marginTop: 14 }]}>CATEGORY</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryPicker}>
                  {CATEGORY_OPTIONS.map((category) => {
                    const meta = categoryMeta[category];
                    const active = editCategory === category;
                    return (
                      <Pressable
                        key={category}
                        onPress={() => setEditCategory(category)}
                        style={[styles.categoryChip, active && { backgroundColor: `${meta.color}2B`, borderColor: meta.color }]}
                      >
                        <Ionicons name={meta.icon} size={14} color={active ? meta.color : COLORS.muted} />
                        <Text style={[styles.categoryChipText, active && { color: meta.color }]}>{category}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <Pressable onPress={saveEditedEntry} style={styles.editorSave}>
              <Ionicons name="checkmark" size={20} color="#FFF" />
              <Text style={styles.editorSaveText}>Save changes</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const entry = editingExpense;
                setEditingExpense(null);
                if (entry) setTimeout(() => removeEntry(entry), 180);
              }}
              style={styles.editorDelete}
            >
              <Ionicons name="trash-outline" size={17} color={COLORS.coral} />
              <Text style={styles.editorDeleteText}>Delete transaction</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <View style={styles.tabBar}>
        <TabButton icon="home" label="Home" active={tab === "home"} onPress={() => setTab("home")} />
        <TabButton icon="receipt-outline" label="Activity" active={tab === "activity"} onPress={() => setTab("activity")} />
        <TabButton icon="pie-chart-outline" label="Insights" active={tab === "insights"} onPress={() => setTab("insights")} />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <KharchaApp />
    </SafeAreaProvider>
  );
}

function SectionHeader({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View>
      {action && <Pressable onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable>}
    </View>
  );
}

function TabButton({ icon, label, active, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <Ionicons name={icon} size={22} color={active ? COLORS.purple : "#97939C"} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      {active && <View style={styles.tabDot} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.cream },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 110 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandMark: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", shadowColor: "#6F5AE6", shadowOpacity: .28, shadowRadius: 12, elevation: 7 },
  logo: { fontSize: 21, fontWeight: "900", color: COLORS.ink, letterSpacing: -.8 },
  logoDot: { color: COLORS.coral },
  tagline: { color: COLORS.muted, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.05, marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center" },
  previewPill: { height: 29, borderRadius: 20, backgroundColor: "#FFF3DD", borderWidth: 1, borderColor: "#EFD8AE", paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  previewText: { color: "#8A5E16", fontSize: 8, fontWeight: "900", letterSpacing: .6 },
  greeting: { display: "none" },
  eyebrow: { color: "#969189", fontSize: 9, fontWeight: "900", letterSpacing: 1.25, marginBottom: 5 },
  title: { fontSize: 27, fontWeight: "900", color: COLORS.ink, letterSpacing: -1.1 },
  subtitle: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
  todayBadge: { alignItems: "flex-end", borderLeftWidth: 1, borderLeftColor: COLORS.line, paddingLeft: 14 },
  todayLabel: { color: "#99938B", fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  todayValue: { fontSize: 16, fontWeight: "900", color: COLORS.ink, marginTop: 3 },
  moneyHero: { position: "relative", borderRadius: 26, paddingHorizontal: 19, paddingVertical: 17, overflow: "hidden", shadowColor: "#5D49D6", shadowOpacity: .24, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  heroOrbLarge: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: "#FFFFFF0A", right: -72, top: -78 },
  heroOrbSmall: { position: "absolute", width: 94, height: 94, borderRadius: 47, backgroundColor: "#A99CF812", right: 45, bottom: -55 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, backgroundColor: "#FFFFFFEA", paddingHorizontal: 10, paddingVertical: 6 },
  heroLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.green },
  heroPillText: { color: "#554D61", fontSize: 7.5, fontWeight: "900", letterSpacing: .7 },
  heroMonth: { color: "#FFFFFFA8", fontSize: 8, fontWeight: "900", letterSpacing: .9 },
  heroBalanceLabel: { color: "#D5CEF0", fontSize: 10.5, marginTop: 17 },
  heroBalance: { color: "#FFF", fontSize: 34, fontWeight: "900", letterSpacing: -1.5, marginTop: 2 },
  heroBalanceCaption: { color: "#FFFFFF8F", fontSize: 9, marginTop: 3 },
  heroDivider: { height: 1, backgroundColor: "#FFFFFF1F", marginVertical: 15 },
  heroStats: { flexDirection: "row", alignItems: "center" },
  heroStat: { flex: 1 },
  heroStatLabel: { color: "#FFFFFF8F", fontSize: 7, fontWeight: "900", letterSpacing: .7, marginBottom: 4 },
  heroStatValue: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  heroStatDivider: { width: 1, height: 27, backgroundColor: "#FFFFFF1F", marginHorizontal: 10 },
  quickCard: { borderRadius: 22, borderWidth: 1, borderColor: "#393244", padding: 16, marginTop: 14, shadowColor: "#000", shadowOpacity: .3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  quickHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  bolt: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 11 },
  quickHeading: { flex: 1 },
  quickEyebrow: { color: "#938AA3", fontSize: 6.5, fontWeight: "900", letterSpacing: 1 },
  quickTitle: { color: "#FFF", fontSize: 15, fontWeight: "900", letterSpacing: -.3, marginTop: 2 },
  quickSubtitle: { color: "#918B99", fontSize: 8.5, marginTop: 2 },
  quickReady: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 14, backgroundColor: "#242B2A", paddingHorizontal: 8, paddingVertical: 6 },
  quickReadyDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.green },
  quickReadyText: { color: "#7BDDB5", fontSize: 6.5, fontWeight: "900", letterSpacing: .7 },
  typeToggle: { flexDirection: "row", backgroundColor: "#201D27", padding: 4, borderRadius: 12, borderWidth: 1, borderColor: "#302A39", marginBottom: 14 },
  typeButton: { flex: 1, height: 38, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  typeButtonDebit: { backgroundColor: COLORS.coral },
  typeButtonCredit: { backgroundColor: COLORS.green },
  typeText: { color: "#8E8799", fontSize: 8, fontWeight: "900", letterSpacing: .25 },
  typeTextSelected: { color: "#FFF" },
  quickFieldLabel: { color: "#797281", fontSize: 6.5, fontWeight: "900", letterSpacing: .9, marginLeft: 2, marginBottom: 6 },
  descriptionWrap: { height: 49, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "#3D3747", backgroundColor: "#292530", paddingHorizontal: 13, marginBottom: 12 },
  descriptionInput: { flex: 1, height: "100%", color: "#FFF", paddingHorizontal: 0, fontSize: 13.5 },
  amountRow: { flexDirection: "row", gap: 8 },
  amountInputWrap: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#3D3747", backgroundColor: "#292530", paddingLeft: 8 },
  currencyBadge: { height: 34, minWidth: 34, borderRadius: 9, backgroundColor: "#373140", alignItems: "center", justifyContent: "center", marginRight: 7 },
  currency: { color: "#BDB5C9", fontSize: 10, fontWeight: "900" },
  amountInput: { flex: 1, height: "100%", color: "#FFF", fontSize: 18, fontWeight: "900" },
  addButton: { width: 122, borderRadius: 12, backgroundColor: COLORS.purple, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, shadowColor: COLORS.purple, shadowOpacity: .22, shadowRadius: 10, elevation: 4 },
  addButtonText: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, marginLeft: 2 },
  hint: { color: "#8F8996", fontSize: 8.5 },
  statsRow: { display: "none" },
  statCard: { flex: 1, backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 14 },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statLabel: { color: "#99938B", fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  statValue: { color: COLORS.ink, fontSize: 19, fontWeight: "900", letterSpacing: -.6, marginTop: 4 },
  statFoot: { color: COLORS.muted, fontSize: 9, marginTop: 4 },
  recapCard: { display: "none" },
  recapHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  recapSpark: { width: 36, height: 36, borderRadius: 11, backgroundColor: "#FFFFFF1C", alignItems: "center", justifyContent: "center" },
  recapEyebrow: { color: "#C9C1F0", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  recapTitle: { color: "#FFF", fontSize: 14, fontWeight: "800", marginTop: 2 },
  recapLabel: { color: "#CBC4EE", fontSize: 10, marginTop: 20 },
  recapAmount: { color: "#FFF", fontSize: 26, fontWeight: "900", marginTop: 2, marginBottom: 13 },
  recapInsight: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFFFFF14", borderRadius: 11, padding: 11 },
  recapInsightText: { flex: 1, color: "#DDD7F4", fontSize: 9.5, lineHeight: 14 },
  recapStrong: { color: "#FFF", fontWeight: "800" },
  smartInsight: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: COLORS.paper, borderRadius: 18, borderWidth: 1, borderColor: COLORS.line, padding: 13, marginTop: 14 },
  smartInsightIcon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  smartInsightLabel: { color: "#91899C", fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  smartInsightTitle: { color: COLORS.ink, fontSize: 11.5, fontWeight: "900", marginTop: 3 },
  smartInsightCopy: { color: COLORS.muted, fontSize: 8.5, lineHeight: 12.5, marginTop: 2 },
  smartInsightArrow: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#29233A", alignItems: "center", justifyContent: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 25, marginBottom: 10 },
  sectionTitle: { color: COLORS.ink, fontSize: 17, fontWeight: "900", letterSpacing: -.5 },
  sectionAction: { color: COLORS.purple, fontSize: 11, fontWeight: "800" },
  listCard: { backgroundColor: COLORS.paper, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, paddingHorizontal: 13 },
  transaction: { minHeight: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.line },
  transactionIcon: { width: 37, height: 37, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 10 },
  transactionText: { flex: 1, paddingRight: 8 },
  transactionTitle: { color: COLORS.ink, fontSize: 11.5, fontWeight: "700" },
  transactionMeta: { color: "#99938B", fontSize: 9, marginTop: 3 },
  transactionAmount: { color: COLORS.ink, fontSize: 10.5, fontWeight: "900" },
  creditAmount: { color: COLORS.green },
  pageIntro: { marginBottom: 20 },
  insightPageIntro: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  pageTitle: { color: COLORS.ink, fontSize: 30, fontWeight: "900", letterSpacing: -1.2 },
  insightLivePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#172A23", borderWidth: 1, borderColor: "#244638", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  insightLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  insightLiveText: { color: "#74DCAF", fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  insightHero: { position: "relative", borderRadius: 25, padding: 18, overflow: "hidden", marginBottom: 14, shadowColor: "#5D49D6", shadowOpacity: .26, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  insightOrbLarge: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: "#FFFFFF0A", right: -68, top: -92 },
  insightOrbSmall: { position: "absolute", width: 92, height: 92, borderRadius: 46, backgroundColor: "#B5A9FF0D", left: -34, bottom: -44 },
  insightHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  insightMonthPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFFFFF12", borderWidth: 1, borderColor: "#FFFFFF14", borderRadius: 18, paddingHorizontal: 9, paddingVertical: 6 },
  insightMonthText: { color: "#D6CEFF", fontSize: 7, fontWeight: "900", letterSpacing: .75 },
  insightHeroLabel: { color: "#B7ACEC", fontSize: 7.5, fontWeight: "900", letterSpacing: 1, marginTop: 18 },
  insightHeroAmount: { color: "#FFF", fontSize: 34, fontWeight: "900", letterSpacing: -1.4, marginTop: 2 },
  insightHeroStory: { color: "#C9C1E4", fontSize: 9.5, lineHeight: 14, marginTop: 4, maxWidth: "84%" },
  insightHeroDivider: { height: 1, backgroundColor: "#FFFFFF1C", marginVertical: 15 },
  insightHeroMetrics: { flexDirection: "row", alignItems: "center" },
  insightHeroMetric: { flex: 1 },
  insightHeroMetricLabel: { color: "#FFFFFF78", fontSize: 6.5, fontWeight: "900", letterSpacing: .65, marginBottom: 4 },
  insightHeroMetricValue: { color: "#FFF", fontSize: 11.5, fontWeight: "900" },
  insightHeroMetricDivider: { width: 1, height: 27, backgroundColor: "#FFFFFF1C", marginHorizontal: 9 },
  dateFilterCard: { backgroundColor: "#17151E", borderWidth: 1, borderColor: "#332E3D", borderRadius: 20, padding: 14, marginBottom: 12 },
  dateFilterTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 13 },
  dateFilterEyebrow: { color: "#81798B", fontSize: 7, fontWeight: "900", letterSpacing: .9 },
  dateFilterTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "900", letterSpacing: -.25, marginTop: 3 },
  dateFilterIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#29233E", alignItems: "center", justifyContent: "center" },
  dateChips: { flexDirection: "row", gap: 5 },
  dateChip: { flex: 1, height: 36, borderRadius: 10, backgroundColor: "#24212B", borderWidth: 1, borderColor: "#312B39", alignItems: "center", justifyContent: "center" },
  customDateChip: { flexDirection: "row", gap: 4, flex: 1.25 },
  dateChipActive: { backgroundColor: COLORS.purple, borderColor: "#8E7BF5" },
  dateChipText: { color: "#9992A1", fontSize: 8.5, fontWeight: "900" },
  dateChipTextActive: { color: "#FFF" },
  summaryStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 15, marginBottom: 14 },
  summaryLabel: { color: "#99938B", fontSize: 7, fontWeight: "900", letterSpacing: .7 },
  summaryValue: { color: COLORS.ink, fontSize: 14, fontWeight: "900", marginTop: 4 },
  summaryDivider: { width: 1, height: 28, backgroundColor: COLORS.line },
  outlineButton: { height: 44, borderWidth: 1, borderColor: COLORS.line, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 12, backgroundColor: COLORS.paper },
  outlineButtonText: { color: COLORS.purple, fontSize: 11, fontWeight: "800" },
  emptyDateCard: { minHeight: 180, backgroundColor: "#17151E", borderWidth: 1, borderColor: "#302B38", borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 22 },
  emptyDateIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: "#28223D", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyDateTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  emptyDateCopy: { color: COLORS.muted, fontSize: 9.5, textAlign: "center", lineHeight: 14, marginTop: 5, maxWidth: 220 },
  analysisCard: { backgroundColor: "#17151E", borderRadius: 22, borderWidth: 1, borderColor: "#332E3D", padding: 16, overflow: "hidden" },
  insightSectionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  insightSectionIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#29233E", alignItems: "center", justifyContent: "center" },
  trendCard: { backgroundColor: "#17151E", borderRadius: 22, borderWidth: 1, borderColor: "#302B38", padding: 16, marginTop: 14, overflow: "hidden" },
  cashflowCard: { backgroundColor: "#17151E", borderRadius: 22, borderWidth: 1, borderColor: "#302B38", padding: 16, marginTop: 14 },
  chartHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  chartTitle: { color: COLORS.ink, fontSize: 16, fontWeight: "900", letterSpacing: -.4 },
  chartTotalPill: { backgroundColor: "#28223E", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  chartTotalText: { color: "#A997FF", fontSize: 9, fontWeight: "900" },
  weekChart: { height: 145, flexDirection: "row", alignItems: "flex-end", gap: 6, paddingTop: 4 },
  weekColumn: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  weekValue: { color: COLORS.muted, fontSize: 7, fontWeight: "800", width: "100%", textAlign: "center", marginBottom: 5 },
  weekBarSlot: { height: 92, width: "64%", justifyContent: "flex-end", borderRadius: 7, backgroundColor: "#24212B", overflow: "hidden" },
  weekBar: { width: "100%", borderRadius: 7 },
  weekLabel: { color: "#8F8998", fontSize: 8, fontWeight: "800", marginTop: 7 },
  flowRow: { marginTop: 12 },
  flowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  flowLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  flowValue: { color: COLORS.ink, fontSize: 10.5, fontWeight: "900" },
  flowTrack: { height: 10, borderRadius: 8, backgroundColor: "#24212B", overflow: "hidden" },
  flowFill: { height: "100%", borderRadius: 8 },
  netFlow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: 17, paddingTop: 13 },
  netFlowLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  netFlowValue: { fontSize: 14, fontWeight: "900" },
  trendDirection: { color: COLORS.green, fontSize: 8, fontWeight: "900", backgroundColor: "#1A2B25", borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6 },
  monthWeekChart: { height: 124, flexDirection: "row", alignItems: "flex-end", gap: 10 },
  monthWeekColumn: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  monthWeekSlot: { height: 78, width: "72%", justifyContent: "flex-end", backgroundColor: "#24212B", borderRadius: 8, overflow: "hidden" },
  monthWeekBar: { width: "100%", borderRadius: 8, backgroundColor: COLORS.purple },
  monthWeekValue: { color: COLORS.ink, fontSize: 7, fontWeight: "800", marginTop: 3, maxWidth: 58 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  metricCard: { width: "48.4%", backgroundColor: "#17151E", borderRadius: 18, borderWidth: 1, borderColor: "#302B38", padding: 14 },
  metricIcon: { width: 33, height: 33, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 11 },
  metricLabel: { color: COLORS.muted, fontSize: 7.5, fontWeight: "900", letterSpacing: .65 },
  metricValue: { color: COLORS.ink, fontSize: 16, fontWeight: "900", marginTop: 5 },
  chartRow: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  donutWrap: { width: 145, height: 145, alignItems: "center", justifyContent: "center" },
  donutGlow: { position: "absolute", width: 144, height: 144, borderRadius: 72 },
  donutRing: { width: 126, height: 126, borderRadius: 63, borderWidth: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#24212B" },
  donutArcAccent: { position: "absolute", width: 126, height: 126, borderRadius: 63, borderWidth: 12, borderLeftColor: "transparent", borderBottomColor: "transparent", transform: [{ rotate: "18deg" }] },
  donutInner: { width: 96, height: 96, borderRadius: 48, backgroundColor: "#17151E", alignItems: "center" },
  donutIcon: { position: "absolute", top: 8, width: 27, height: 27, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  donutText: { position: "absolute", alignItems: "center", marginTop: 25 },
  donutLabel: { color: "#817A89", fontSize: 6.5, fontWeight: "900", letterSpacing: .65, marginTop: 1 },
  donutValue: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  donutShare: { fontSize: 7.5, fontWeight: "900", marginTop: 3 },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center" },
  legendDot: { width: 7, height: 7, borderRadius: 3, marginRight: 7 },
  legendIcon: { width: 25, height: 25, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 7 },
  legendName: { flex: 1, color: COLORS.muted, fontSize: 9.5 },
  legendValue: { color: COLORS.ink, fontSize: 10, fontWeight: "800" },
  categoryBarRow: { marginTop: 13 },
  categoryBarTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  categoryBarIdentity: { flexDirection: "row", alignItems: "center", gap: 7 },
  categoryBarDot: { width: 6, height: 6, borderRadius: 3 },
  categoryBarName: { color: COLORS.muted, fontSize: 9.5, fontWeight: "700" },
  categoryBarNumbers: { flexDirection: "row", alignItems: "center", gap: 9 },
  categoryBarPercent: { color: "#847D8E", fontSize: 8, fontWeight: "900" },
  categoryBarValue: { color: COLORS.ink, fontSize: 9.5, fontWeight: "900" },
  barTrack: { height: 6, borderRadius: 5, backgroundColor: "#24212B", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 5 },
  monthCards: { flexDirection: "row", gap: 12, marginTop: 14 },
  monthCard: { flex: 1, borderRadius: 16, padding: 15 },
  monthCardLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: .7, marginTop: 12 },
  monthCardValue: { color: COLORS.ink, fontSize: 16, fontWeight: "900", marginTop: 4 },
  notificationCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: COLORS.paper, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, padding: 14, marginTop: 14 },
  notificationIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#292341", alignItems: "center", justifyContent: "center" },
  notificationTitle: { color: COLORS.ink, fontSize: 11.5, fontWeight: "800" },
  notificationCopy: { color: COLORS.muted, fontSize: 9.5, marginTop: 3 },
  overviewPickerBackdrop: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 12, backgroundColor: "#000000C2" },
  overviewPickerCard: { backgroundColor: "#19161F", borderRadius: 25, borderWidth: 1, borderColor: "#403748", padding: 18, shadowColor: "#000", shadowOpacity: .55, shadowRadius: 25, elevation: 20 },
  overviewPickerHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  overviewPickerCopy: { color: COLORS.muted, fontSize: 9.5, marginTop: 5 },
  overviewPickerGrid: { gap: 8, marginTop: 18 },
  overviewPickerOption: { height: 62, borderRadius: 16, borderWidth: 1, borderColor: "#332D3B", backgroundColor: "#221F29", flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12 },
  overviewPickerOptionActive: { borderColor: "#6757C9", backgroundColor: "#29233C" },
  overviewPickerIcon: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  overviewPickerLabel: { color: COLORS.ink, fontSize: 11.5, fontWeight: "900" },
  overviewPickerOptionCopy: { color: "#8D8695", fontSize: 8.5, marginTop: 3 },
  calendarBackdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 18, backgroundColor: "#000000C2" },
  calendarCard: { backgroundColor: "#19161F", borderRadius: 24, borderWidth: 1, borderColor: "#403748", padding: 18, shadowColor: "#000", shadowOpacity: .55, shadowRadius: 25, elevation: 20 },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarEyebrow: { color: "#938A9D", fontSize: 7.5, fontWeight: "900", letterSpacing: 1.1 },
  calendarTitle: { color: COLORS.ink, fontSize: 21, fontWeight: "900", letterSpacing: -.6, marginTop: 3 },
  calendarClose: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#27232E", alignItems: "center", justifyContent: "center" },
  calendarMonthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 13 },
  calendarArrow: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#28233A", alignItems: "center", justifyContent: "center" },
  calendarMonthText: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  calendarWeekRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#302A38", paddingBottom: 9, marginBottom: 5 },
  calendarWeekday: { width: "14.285%", color: "#7F7788", fontSize: 8, fontWeight: "900", textAlign: "center" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDay: { width: "14.285%", height: 39, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  calendarDaySelected: { backgroundColor: COLORS.purple },
  calendarDayToday: { borderWidth: 1, borderColor: "#6D5BD1" },
  calendarDayText: { color: "#C2BCC8", fontSize: 11, fontWeight: "700" },
  calendarDayTextSelected: { color: "#FFF", fontWeight: "900" },
  calendarTodayButton: { height: 44, borderRadius: 13, backgroundColor: "#28233A", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12 },
  calendarTodayText: { color: "#B9AEFF", fontSize: 10, fontWeight: "900" },
  editorBackdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 20, backgroundColor: "#000000B8" },
  editorCard: { backgroundColor: "#1A171F", borderRadius: 24, borderWidth: 1, borderColor: "#3A3342", padding: 20, shadowColor: "#000", shadowOpacity: .5, shadowRadius: 24, elevation: 18 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  editorEyebrow: { color: "#938B9E", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  editorTitle: { color: COLORS.ink, fontSize: 22, fontWeight: "900", letterSpacing: -.7, marginTop: 4 },
  editorClose: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#25212B", alignItems: "center", justifyContent: "center" },
  editorToggle: { flexDirection: "row", backgroundColor: "#25212B", borderRadius: 12, padding: 4, marginBottom: 17 },
  editorTypeButton: { flex: 1, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  editorDebit: { backgroundColor: COLORS.coral },
  editorCredit: { backgroundColor: COLORS.green },
  editorTypeText: { color: "#938D9B", fontSize: 9, fontWeight: "900", letterSpacing: .5 },
  editorTypeTextActive: { color: "#FFF" },
  editorLabel: { color: "#8F8898", fontSize: 8, fontWeight: "900", letterSpacing: 1, marginBottom: 7, marginTop: 2 },
  editorInput: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: "#3D3645", backgroundColor: "#25212B", color: COLORS.ink, paddingHorizontal: 14, fontSize: 14, marginBottom: 14 },
  editorAmountWrap: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: "#3D3645", backgroundColor: "#25212B", flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  editorCurrency: { color: COLORS.muted, fontSize: 13, fontWeight: "800", marginRight: 8 },
  editorAmountInput: { flex: 1, height: "100%", color: COLORS.ink, fontSize: 17, fontWeight: "900" },
  categoryPicker: { gap: 7, paddingRight: 8 },
  categoryChip: { height: 36, borderRadius: 11, borderWidth: 1, borderColor: "#3D3645", backgroundColor: "#25212B", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10 },
  categoryChipText: { color: COLORS.muted, fontSize: 9, fontWeight: "800" },
  editorSave: { height: 52, borderRadius: 14, backgroundColor: COLORS.purple, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 18 },
  editorSaveText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  editorDelete: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 5 },
  editorDeleteText: { color: COLORS.coral, fontSize: 10.5, fontWeight: "800" },
  tabBar: { position: "absolute", left: 16, right: 16, bottom: 14, height: 66, borderRadius: 20, backgroundColor: "#292731", flexDirection: "row", paddingHorizontal: 14, shadowColor: "#1F1C25", shadowOpacity: .25, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 12 },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  tabText: { color: "#97939C", fontSize: 8.5, fontWeight: "700" },
  tabTextActive: { color: "#FFF" },
  tabDot: { position: "absolute", bottom: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.coral },
});
