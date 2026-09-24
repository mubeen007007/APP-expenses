import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as SQLite from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

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
type ThemeMode = "light" | "dark";
type DateScope = "today" | "yesterday" | "custom" | "all";
type OverviewScope = "today" | "yesterday" | "custom" | "month";
type CalendarTarget = "activity" | "overview";
type DialogTone = "neutral" | "success" | "warning" | "danger";
type DialogAction = { text: string; style?: "cancel" | "destructive"; onPress?: () => void | Promise<void> };
type AppDialog = { title: string; message: string; tone: DialogTone; actions: DialogAction[] };

type Expense = {
  id: string;
  description: string;
  amount: number;
  type: EntryType;
  category: string;
  createdAt: string;
};

const COLORS = {
  ink: "#111111",
  muted: "#817C77",
  cream: "#F4F1EE",
  paper: "#FCFBF8",
  line: "#E2DED8",
  purple: "#8E79B6",
  purpleDark: "#75609E",
  coral: "#D96F61",
  green: "#4E9C82",
  gold: "#B98C43",
};

const DIALOG_TONES: Record<DialogTone, { icon: keyof typeof Ionicons.glyphMap; color: string; background: string }> = {
  neutral: { icon: "sparkles-outline", color: "#75609E", background: "#E8E2F2" },
  success: { icon: "checkmark", color: "#347B64", background: "#DCEDE7" },
  warning: { icon: "alert-outline", color: "#9A6E28", background: "#F3E9D6" },
  danger: { icon: "close", color: "#B55247", background: "#F3E2DE" },
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
let databaseOpenInFlight: Promise<SQLite.SQLiteDatabase> | null = null;
let nativeImportInFlight: Promise<boolean> | null = null;
let syncLoadInFlight: Promise<void> | null = null;
let activeThemeDark = false;

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
  if (database) return database;
  if (databaseOpenInFlight) return databaseOpenInFlight;

  databaseOpenInFlight = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let candidate: SQLite.SQLiteDatabase | null = null;
      try {
        candidate = await SQLite.openDatabaseAsync("kharcha.db");
        await candidate.execAsync("PRAGMA busy_timeout = 10000;");
        try {
          await candidate.execAsync("PRAGMA journal_mode = WAL;");
        } catch (walError) {
          // WAL is an optimization, not a reason to hide the wallet. Some
          // Android builds briefly hold a native read connection at startup.
          console.warn("MoneySync will continue without changing journal mode", walError);
        }
        await candidate.execAsync(`
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
        database = candidate;
        return candidate;
      } catch (error) {
        lastError = error;
        if (candidate) {
          try {
            await candidate.closeAsync();
          } catch {
            // The failed connection may already be closed.
          }
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  })().finally(() => {
    databaseOpenInFlight = null;
  });

  return databaseOpenInFlight;
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

async function ensureNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("money-recaps", {
    name: "Money recaps",
    description: "Daily MoneySync spending summaries and reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180],
  });
}

async function scheduleReports() {
  if (Platform.OS !== "android") return;
  await ensureNotificationChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (scheduled.some((item) => item.identifier === "kharcha-daily")) return;

  await Notifications.scheduleNotificationAsync({
    identifier: "kharcha-daily",
    content: {
      title: "Your daily money recap is ready",
      body: "Open MoneySync to see today’s spending and what it means for your month.",
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
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("home");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  activeThemeDark = themeMode === "dark";
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);
  const descriptionRef = useRef<TextInput>(null);
  const amountRef = useRef<TextInput>(null);
  const pageScrollRef = useRef<ScrollView>(null);
  const activeTabRef = useRef<Tab>(tab);
  activeTabRef.current = tab;
  const homeScrollY = useRef(new Animated.Value(0)).current;
  const homeHeaderHeight = homeScrollY.interpolate({ inputRange: [-140, 0, 210], outputRange: [430, 318, 94], extrapolate: "clamp" });
  const homeHeaderRadius = homeScrollY.interpolate({ inputRange: [0, 210], outputRange: [30, 22], extrapolate: "clamp" });
  const expandedHeaderOpacity = homeScrollY.interpolate({ inputRange: [45, 150], outputRange: [1, 0], extrapolate: "clamp" });
  const homeBalanceTop = homeScrollY.interpolate({ inputRange: [0, 210], outputRange: [128, 15], extrapolate: "clamp" });
  const collapsedHeaderOpacity = homeScrollY.interpolate({ inputRange: [130, 195], outputRange: [0, 1], extrapolate: "clamp" });

  const showDialog = useCallback((
    title: string,
    message: string,
    actions: DialogAction[] = [{ text: "OK" }],
    tone: DialogTone = "neutral",
  ) => setAppDialog({ title, message, actions, tone }), []);

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    pageScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const tabSwipeResponder = useMemo(() => {
    const finishSwipe = (dx: number, dy: number, velocityX: number) => {
      const horizontal = Math.abs(dx);
      const vertical = Math.abs(dy);
      const isDeliberateSwipe = horizontal >= 48 || (horizontal >= 28 && Math.abs(velocityX) >= 0.45);
      if (!isDeliberateSwipe || horizontal <= vertical * 1.15) return;

      const tabs: Tab[] = ["home", "activity", "insights"];
      const current = tabs.indexOf(activeTabRef.current);
      const next = dx < 0
        ? Math.min(current + 1, tabs.length - 1)
        : Math.max(current - 1, 0);
      if (next !== current) selectTab(tabs[next]);
    };

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) => {
        const horizontal = Math.abs(gesture.dx);
        const vertical = Math.abs(gesture.dy);
        return horizontal >= 12 && horizontal > vertical * 1.15;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_event, gesture) => finishSwipe(gesture.dx, gesture.dy, gesture.vx),
      onPanResponderTerminate: (_event, gesture) => finishSwipe(gesture.dx, gesture.dy, gesture.vx),
      onShouldBlockNativeResponder: () => true,
    });
  }, [selectTab]);

  const toggleTheme = useCallback(() => {
    setThemeMode((current) => {
      const next: ThemeMode = current === "light" ? "dark" : "light";
      getDb()
        .then((db) => db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "theme_mode", next))
        .catch(() => undefined);
      return next;
    });
  }, []);

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
        console.warn("MoneySync native sync will retry", error);
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

  const refreshRuntimePermissionStates = useCallback(async () => {
    if (Platform.OS !== "android") return;
    const [sms, notifications] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS).catch(() => false),
      Notifications.getPermissionsAsync().catch(() => null),
    ]);
    setSmsEnabled(sms);
    setNotificationsEnabled(notifications?.status === "granted");
  }, []);

  useEffect(() => {
    getDb()
      .then((db) => db.getFirstAsync<{ value: ThemeMode }>("SELECT value FROM settings WHERE key = ?", "theme_mode"))
      .then((saved) => {
        if (saved?.value === "dark" || saved?.value === "light") setThemeMode(saved.value);
      })
      .catch(() => undefined);

    upgradeSmartCategories()
      .catch((error) => console.warn("Smart category upgrade will retry", error))
      .then(syncAndLoadExpenses)
      .catch((error) => {
        console.error("MoneySync wallet initialization failed", error);
        showDialog(
          "Couldn’t open your wallet",
          "The wallet is temporarily busy. Your data is safe—tap Retry to open it again.",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Retry",
              onPress: () => syncAndLoadExpenses()
                .catch(() => showDialog("Still busy", "Please wait a moment and pull down to refresh.", undefined, "warning")),
            },
          ],
          "warning",
        );
      })
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
  }, [showDialog, syncAndLoadExpenses, upgradeSmartCategories]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncAndLoadExpenses().catch(() => undefined);
        refreshRuntimePermissionStates().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [refreshRuntimePermissionStates, syncAndLoadExpenses]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active") syncAndLoadExpenses().catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [syncAndLoadExpenses]);

  useEffect(() => {
    refreshRuntimePermissionStates().catch(() => undefined);
  }, [refreshRuntimePermissionStates]);

  const requestSmsAccess = async () => {
    if (Platform.OS !== "android") return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, {
      title: "Enable bank SMS capture",
      message: "MoneySync will process new debit and credit alerts locally. OTPs and full message text are not stored.",
      buttonPositive: "Allow",
      buttonNegative: "Cancel",
    });
    const enabled = result === PermissionsAndroid.RESULTS.GRANTED;
    setSmsEnabled(enabled);
    const permanentlyDenied = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
    showDialog(
      enabled ? "SMS capture is on" : "SMS permission is off",
      enabled
        ? "Financial SMS alerts can now be added automatically with duplicate protection."
        : permanentlyDenied
          ? "Android will no longer show the SMS prompt. Open MoneySync permissions and allow SMS to enable automatic capture."
          : "You can enable SMS monitoring later from this screen.",
      permanentlyDenied
        ? [
          { text: "Later", style: "cancel" },
          { text: "Open settings", onPress: () => Linking.openSettings() },
        ]
        : undefined,
      enabled ? "success" : "warning",
    );
  };

  const requestGmailAccess = () => {
    showDialog(
      "Enable notification-bar capture",
      "On the next screen, turn on notification access for MoneySync. It will detect PKR/Rs debit and credit alerts from Gmail, Messages, banking and wallet apps without storing the full notification text.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open settings",
          onPress: () => Linking.sendIntent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            .catch(() => Linking.openSettings()),
        },
      ],
      "neutral",
    );
  };

  const requestDailyReports = async () => {
    await ensureNotificationChannel();
    const result = await Notifications.requestPermissionsAsync();
    setNotificationsEnabled(result.status === "granted");
    if (result.status === "granted") {
      await scheduleReports();
      showDialog("Daily recap is on", "We’ll remind you at 8:30 PM each evening.", undefined, "success");
    } else {
      showDialog("Notifications are off", "You can enable them later in Android Settings.", undefined, "warning");
    }
  };

  const requestOnboardingNotificationPermission = async () => {
    await ensureNotificationChannel();
    const result = await Notifications.requestPermissionsAsync();
    const enabled = result.status === "granted";
    setNotificationsEnabled(enabled);
    if (enabled) await scheduleReports();

    showDialog(
      "Enable money-alert access",
      `${enabled ? "MoneySync notifications are enabled. " : "MoneySync notifications were not enabled. "}Android keeps notification-bar access in a separate protected setting. Turn on MoneySync there so eligible bank, wallet, Messages and Gmail alerts can be captured locally.`,
      [
        { text: "Later", style: "cancel" },
        {
          text: "Open access",
          onPress: () => Linking.sendIntent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            .catch(() => Linking.openSettings()),
        },
      ],
      enabled ? "success" : "warning",
    );
  };

  const requestOnboardingSmsPermission = async () => {
    if (Platform.OS !== "android") return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, {
      title: "Allow financial SMS capture",
      message: "MoneySync checks new SMS messages for debit and credit alerts on this device. Unrelated messages and OTPs are ignored.",
      buttonPositive: "Allow",
      buttonNegative: "Not now",
    });
    const enabled = result === PermissionsAndroid.RESULTS.GRANTED;
    setSmsEnabled(enabled);

    showDialog(
      enabled ? "SMS capture enabled" : "SMS access not enabled",
      enabled
        ? "Financial SMS alerts can now be recorded automatically. Continue to enable MoneySync notifications and notification-bar capture."
        : "Manual entry still works. You can enable SMS later from Insights. Continue to configure notifications and notification-bar capture.",
      [
        { text: "Finish later", style: "cancel" },
        { text: "Continue", onPress: requestOnboardingNotificationPermission },
      ],
      enabled ? "success" : "warning",
    );
  };

  const beginPermissionSetup = useCallback(() => {
    showDialog(
      "Set up automatic tracking",
      "MoneySync needs SMS access to detect financial debit and credit alerts, notification permission for daily reports, and notification access to detect eligible banking, wallet, Messages and Gmail alerts. Processing stays on this device. Full messages, OTPs and unrelated content are not stored or shared. Manual entry works without these permissions.",
      [
        { text: "Not now", style: "cancel" },
        { text: "Set up", onPress: requestOnboardingSmsPermission },
      ],
      "neutral",
    );
  }, [showDialog]);

  useEffect(() => {
    if (Platform.OS !== "android" || loading || appDialog) return;
    let cancelled = false;
    getDb()
      .then(async (db) => {
        const seen = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key = ?",
          "permission_setup_v1",
        );
        if (seen || cancelled) return;
        await db.runAsync(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          "permission_setup_v1",
          "shown",
        );
        if (!cancelled) beginPermissionSetup();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appDialog, beginPermissionSetup, loading]);

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
      showDialog("Almost there", "Add a short description and a valid amount.", undefined, "warning");
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
      showDialog("Couldn’t save entry", "Nothing was changed. Please try again.", undefined, "danger");
    }
  };

  const removeEntry = (entry: Expense) => {
    showDialog("Remove transaction?", entry.description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            const db = await getDb();
            await db.runAsync("DELETE FROM expenses WHERE id = ?", entry.id);
            setExpenses((items) => items.filter((item) => item.id !== entry.id));
          } catch {
            showDialog("Couldn’t remove entry", "Nothing was changed. Please try again.", undefined, "danger");
          }
        },
      },
    ], "danger");
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
      showDialog("Almost there", "Add a description and a valid amount.", undefined, "warning");
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
      showDialog("Couldn’t update entry", "Nothing was changed. Please try again.", undefined, "danger");
    }
  };

  const exportCsv = async () => {
    if (!expenses.length) {
      showDialog("Nothing to export yet", "Add your first transaction, then try again.", undefined, "warning");
      return;
    }
    const rows = [
      ["Date", "Description", "Category", "Type", "Amount"],
      ...expenses.map((item) => [item.createdAt, item.description, item.category, item.type, String(item.amount)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const uri = `${FileSystem.cacheDirectory}moneysync-expenses.csv`;
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Export MoneySync expenses" });
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
    <SafeAreaView style={[styles.safe, tab === "home" && styles.homeSafe]} edges={["top", "left", "right"]}>
      <StatusBar style={themeMode === "dark" ? "light" : "dark"} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
        {...tabSwipeResponder.panHandlers}
      >
        <Animated.ScrollView
          ref={pageScrollRef}
          contentContainerStyle={[styles.scroll, tab === "home" && styles.homeScroll]}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={tab === "home" ? Animated.event(
            [{ nativeEvent: { contentOffset: { y: homeScrollY } } }],
            { useNativeDriver: false },
          ) : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
        >
          {tab !== "home" && (
            <View style={styles.header}>
              <View style={styles.brandLockup}>
                <Image source={require("./assets/icon.png")} style={styles.brandMark} />
                <View>
                  <Text style={styles.logo}>MoneySync<Text style={styles.logoDot}>.</Text></Text>
                  <Text style={styles.tagline}>PERSONAL FINANCE</Text>
                </View>
              </View>
              <View style={styles.headerActions}>
                <Pressable onPress={toggleTheme} style={styles.headerButton}><Ionicons name={themeMode === "dark" ? "sunny-outline" : "moon-outline"} size={19} color={themeMode === "dark" ? "#F4F5F2" : COLORS.ink} /></Pressable>
                <Pressable onPress={requestDailyReports} style={styles.headerButton}><Ionicons name="notifications-outline" size={19} color={themeMode === "dark" ? "#F4F5F2" : COLORS.ink} /></Pressable>
                <Pressable onPress={exportCsv} style={styles.headerButton}><Ionicons name="share-outline" size={20} color={themeMode === "dark" ? "#F4F5F2" : COLORS.ink} /></Pressable>
              </View>
            </View>
          )}

          {tab === "home" && (
            <>
              <View style={styles.homeSheet}>
                <View style={styles.quickHeader}>
                  <View style={styles.quickHeading}>
                    <Text style={styles.quickTitle}>Quick add</Text>
                    <Text style={styles.quickSubtitle}>A transaction in two taps</Text>
                  </View>
                  <View style={styles.todayMiniBadge}>
                    <Text style={styles.todayMiniLabel}>TODAY</Text>
                    <Text style={styles.todayMiniValue}>{shortMoney(todayTotal)}</Text>
                  </View>
                </View>
                <View style={styles.typeToggle}>
                  <Pressable onPress={() => setEntryType("debit")} style={[styles.typeButton, entryType === "debit" && styles.typeButtonDebit]}>
                    <Ionicons name="arrow-up-outline" size={13} color={entryType === "debit" ? "#FFF" : "#77736F"} />
                    <Text style={[styles.typeText, entryType === "debit" && styles.typeTextSelected]}>Expense</Text>
                  </Pressable>
                  <Pressable onPress={() => setEntryType("credit")} style={[styles.typeButton, entryType === "credit" && styles.typeButtonCredit]}>
                    <Ionicons name="arrow-down-outline" size={13} color={entryType === "credit" ? "#0B0B0B" : "#77736F"} />
                    <Text style={[styles.typeText, entryType === "credit" && styles.typeTextSelected, entryType === "credit" && styles.typeTextCreditSelected]}>Income</Text>
                  </Pressable>
                </View>
                <View style={styles.descriptionWrap}>
                  <Ionicons name="create-outline" size={17} color="#706B67" />
                  <TextInput
                    ref={descriptionRef}
                    value={description}
                    onChangeText={setDescription}
                    onSubmitEditing={() => amountRef.current?.focus()}
                    returnKeyType="next"
                    placeholder="e.g. Lunch, fuel or rent"
                    placeholderTextColor="#9A9590"
                    style={styles.descriptionInput}
                  />
                </View>
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
                      placeholderTextColor="#9A9590"
                      style={styles.amountInput}
                    />
                  </View>
                  <Pressable onPress={addEntry} style={styles.addButton}>
                    <Text style={styles.addButtonText}>Add</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFF" />
                  </Pressable>
                </View>

                <View style={styles.homeSectionTop}>
                  <Text style={styles.homeSectionTitle}>Top categories</Text>
                  <Pressable onPress={() => setTab("insights")}><Text style={styles.homeSectionAction}>View insights</Text></Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.homeCategoryRow}>
                  {(categories.length ? categories.slice(0, 3) : [
                    { name: "Food", value: 0 },
                    { name: "Transport", value: 0 },
                    { name: "Bills", value: 0 },
                  ]).map((item, index) => {
                    const meta = categoryMeta[item.name] ?? categoryMeta.Other;
                    return (
                      <View key={item.name} style={[styles.homeCategoryCard, index === 1 && styles.homeCategoryCardLilac, index === 2 && styles.homeCategoryCardMint]}>
                        <View style={styles.homeCategoryIcon}><Ionicons name={meta.icon} size={17} color="#111" /></View>
                        <Text numberOfLines={1} style={styles.homeCategoryName}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.homeCategoryValue}>{shortMoney(item.value)}</Text>
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={styles.homeSectionTop}>
                  <View>
                    <Text style={styles.homeSectionTitle}>Recent activity</Text>
                    <Text style={styles.homeSectionCaption}>Tap an entry to edit it</Text>
                  </View>
                  <Pressable onPress={() => setTab("activity")}><Ionicons name="arrow-forward" size={18} color="#111" /></Pressable>
                </View>
                <View style={styles.homeList}>
                  {expenses.slice(0, 5).map((item) => {
                    const meta = categoryMeta[item.category] ?? categoryMeta.Other;
                    return (
                      <Pressable key={item.id} onPress={() => openEditor(item)} onLongPress={() => removeEntry(item)} style={styles.homeTransaction}>
                        <View style={[styles.homeTransactionIcon, { backgroundColor: `${meta.color}22` }]}><Ionicons name={meta.icon} color={meta.color} size={17} /></View>
                        <View style={styles.transactionText}>
                          <Text numberOfLines={1} style={styles.homeTransactionTitle}>{item.description}</Text>
                          <Text style={styles.homeTransactionMeta}>{item.category} · {new Date(item.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</Text>
                        </View>
                        <Text style={[styles.homeTransactionAmount, item.type === "credit" && styles.homeCreditAmount]}>{item.type === "credit" ? "+" : "−"} {money(item.amount)}</Text>
                      </Pressable>
                    );
                  })}
                  {!expenses.length && <Text style={styles.homeEmpty}>Your first transaction will appear here.</Text>}
                </View>
              </View>
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

              <LinearGradient colors={["#090909", "#151515", "#211D24"]} locations={[0, .62, 1]} style={styles.insightHero}>
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
                          <LinearGradient colors={item.value ? ["#B29DCE", "#846DA9"] : ["#E5E0DA", "#E5E0DA"]} style={[styles.weekBar, { height }]} />
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
                  <View style={[styles.metricIcon, { backgroundColor: "#E8E2F2" }]}><Ionicons name="speedometer-outline" size={18} color={COLORS.purple} /></View>
                  <Text style={styles.metricLabel}>DAILY AVERAGE</Text>
                  <Text style={styles.metricValue}>{shortMoney(insightMetrics.average)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#F3E2DE" }]}><Ionicons name="flash-outline" size={18} color={COLORS.coral} /></View>
                  <Text style={styles.metricLabel}>LARGEST SPEND</Text>
                  <Text style={styles.metricValue}>{shortMoney(insightMetrics.largest)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#DCEDE7" }]}><Ionicons name="calendar-outline" size={18} color={COLORS.green} /></View>
                  <Text style={styles.metricLabel}>SPENDING DAYS</Text>
                  <Text style={styles.metricValue}>{insightMetrics.activeDays}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#F3E9D6" }]}><Ionicons name="trending-up-outline" size={18} color={COLORS.gold} /></View>
                  <Text style={styles.metricLabel}>SAVINGS RATE</Text>
                  <Text style={[styles.metricValue, { color: insightMetrics.savingsRate >= 0 ? COLORS.green : COLORS.coral }]}>{Math.round(insightMetrics.savingsRate)}%</Text>
                </View>
              </View>

              <View style={styles.monthCards}>
                <View style={[styles.monthCard, { backgroundColor: "#DCEDE7" }]}>
                  <Ionicons name="arrow-down-circle-outline" size={23} color={COLORS.green} />
                  <Text style={styles.monthCardLabel}>TOTAL CREDIT</Text>
                  <Text style={styles.monthCardValue}>{money(totals.credits)}</Text>
                </View>
                <View style={[styles.monthCard, { backgroundColor: "#F3E2DE" }]}>
                  <Ionicons name="arrow-up-circle-outline" size={23} color={COLORS.coral} />
                  <Text style={styles.monthCardLabel}>TOTAL DEBIT</Text>
                  <Text style={styles.monthCardValue}>{money(totals.debits)}</Text>
                </View>
              </View>

              <Pressable onPress={requestDailyReports} style={styles.notificationCard}>
                <View style={styles.notificationIcon}><Ionicons name="notifications-outline" size={21} color={COLORS.purple} /></View>
                <View style={styles.flex}><Text style={styles.notificationTitle}>Evening money recap</Text><Text style={styles.notificationCopy}>{notificationsEnabled ? "On · Daily reminder scheduled for 8:30 PM." : "Off · Tap to allow MoneySync notifications."}</Text></View>
                <Ionicons name={notificationsEnabled ? "checkmark-circle" : "chevron-forward"} size={20} color={notificationsEnabled ? COLORS.green : "#AAA5AD"} />
              </Pressable>

              <Pressable onPress={requestGmailAccess} style={styles.notificationCard}>
                <View style={[styles.notificationIcon, { backgroundColor: "#DCEDE7" }]}><Ionicons name="chatbox-ellipses-outline" size={21} color={COLORS.green} /></View>
                <View style={styles.flex}>
                  <Text style={styles.notificationTitle}>Notification-bar money capture</Text>
                  <Text style={styles.notificationCopy}>Gmail, Messages, banking and wallet alerts are checked locally.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#77717E" />
              </Pressable>

              <Pressable onPress={requestSmsAccess} style={styles.notificationCard}>
                <View style={[styles.notificationIcon, { backgroundColor: "#F3E9D6" }]}><Ionicons name="chatbubble-outline" size={21} color={COLORS.gold} /></View>
                <View style={styles.flex}>
                  <Text style={styles.notificationTitle}>Bank SMS backup capture</Text>
                  <Text style={styles.notificationCopy}>{smsEnabled ? "On · Works alongside Gmail with duplicate protection." : "Off · Tap to enable SMS monitoring."}</Text>
                </View>
                <Ionicons name={smsEnabled ? "checkmark-circle" : "chevron-forward"} size={20} color={smsEnabled ? COLORS.green : "#77717E"} />
              </Pressable>
            </>
          )}
        </Animated.ScrollView>
      </KeyboardAvoidingView>

      {tab === "home" && (
        <Animated.View
          key={`home-top-shell-${themeMode}`}
          style={[
            baseStyles.homeTopShell,
            themeMode === "dark"
              ? { backgroundColor: "#202622", borderColor: "#3A453E", shadowOpacity: .42 }
              : { backgroundColor: "#090909", borderColor: "#090909", shadowOpacity: .18 },
            {
              top: insets.top + 8,
              height: homeHeaderHeight,
              borderRadius: homeHeaderRadius,
            },
          ]}
        >
          <View style={[baseStyles.homeOrbitLarge, themeMode === "dark" && { borderColor: "#B8A7D52E" }]} />
          <View style={[baseStyles.homeOrbitSmall, themeMode === "dark" && { borderColor: "#9ED8C63D" }]} />

          <Animated.View style={[baseStyles.homeHeader, { opacity: expandedHeaderOpacity }]}>
            <View style={baseStyles.homeBrand}>
              <Image source={require("./assets/icon.png")} style={baseStyles.homeBrandMark} />
              <Text style={baseStyles.homeLogo}>MoneySync.</Text>
            </View>
            <View style={baseStyles.homeHeaderActions}>
              <Pressable onPress={toggleTheme} style={[baseStyles.homeRoundButton, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF24" }]}><Ionicons name={themeMode === "dark" ? "sunny-outline" : "moon-outline"} size={17} color="#F8F7F3" /></Pressable>
              <Pressable onPress={requestDailyReports} style={[baseStyles.homeRoundButton, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF24" }]}><Ionicons name="notifications-outline" size={17} color="#F8F7F3" /></Pressable>
              <Pressable onPress={exportCsv} style={[baseStyles.homeRoundButton, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF24" }]}><Ionicons name="share-outline" size={17} color="#F8F7F3" /></Pressable>
            </View>
          </Animated.View>

          <Animated.View style={[baseStyles.homeHeroSelector, { opacity: expandedHeaderOpacity }]}>
            <Pressable onPress={() => setOverviewSelectorVisible(true)} style={[baseStyles.heroPill, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF20" }]}>
              <View style={baseStyles.heroLiveDot} />
              <Text style={baseStyles.heroPillText}>{overviewLabel}</Text>
              <Ionicons name="chevron-down" size={11} color="#ECE9E2" />
            </Pressable>
            <Text numberOfLines={1} style={baseStyles.heroMonth}>{overviewPeriod}</Text>
          </Animated.View>

          <Animated.View style={[baseStyles.homeBalanceBlock, { top: homeBalanceTop }]}>
            <View style={baseStyles.homeBalanceLabelStack}>
              <Animated.Text style={[baseStyles.heroBalanceLabel, baseStyles.homeExpandedBalanceLabel, { opacity: expandedHeaderOpacity }]}>Your net position</Animated.Text>
              <Animated.Text style={[baseStyles.compactBalanceLabel, baseStyles.homeCollapsedBalanceLabel, { opacity: collapsedHeaderOpacity }]}>{overviewLabel} BALANCE</Animated.Text>
            </View>
            <Text numberOfLines={1} adjustsFontSizeToFit style={baseStyles.heroBalance}>{money(overviewTotals.balance)}</Text>
            <Animated.Text style={[baseStyles.heroBalanceCaption, { opacity: expandedHeaderOpacity }]}>Updated from {overviewExpenses.length} transaction{overviewExpenses.length === 1 ? "" : "s"}</Animated.Text>
          </Animated.View>

          <Animated.View style={[baseStyles.heroStats, baseStyles.homeHeroStats, themeMode === "dark" && { backgroundColor: "#0B0E0C66", borderWidth: 1, borderColor: "#FFFFFF12" }, { opacity: expandedHeaderOpacity }]}>
            <View style={baseStyles.heroStat}>
              <Text style={baseStyles.heroStatLabel}>MONEY IN</Text>
              <Text style={baseStyles.heroStatValue}>{shortMoney(overviewTotals.credits)}</Text>
            </View>
            <View style={baseStyles.heroStatDivider} />
            <View style={baseStyles.heroStat}>
              <Text style={baseStyles.heroStatLabel}>MONEY OUT</Text>
              <Text style={baseStyles.heroStatValue}>{shortMoney(overviewTotals.debits)}</Text>
            </View>
          </Animated.View>

          <Animated.View pointerEvents="none" style={[baseStyles.compactBalanceMark, themeMode === "dark" && { backgroundColor: "#A9D9CA" }, { opacity: collapsedHeaderOpacity }]}>
            <Ionicons name="wallet-outline" size={18} color="#0B0B0B" />
          </Animated.View>
        </Animated.View>
      )}

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(appDialog)}
        onRequestClose={() => setAppDialog(null)}
      >
        <View style={styles.appDialogBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAppDialog(null)} />
          {appDialog && (() => {
            const tone = DIALOG_TONES[appDialog.tone];
            return (
              <View style={styles.appDialogCard}>
                <View style={[styles.appDialogIcon, { backgroundColor: tone.background }]}>
                  <Ionicons name={tone.icon} size={24} color={tone.color} />
                </View>
                <Text style={styles.appDialogTitle}>{appDialog.title}</Text>
                <Text style={styles.appDialogMessage}>{appDialog.message}</Text>
                <View style={styles.appDialogActions}>
                  {appDialog.actions.map((action, index) => {
                    const isCancel = action.style === "cancel";
                    const isDanger = action.style === "destructive";
                    return (
                      <Pressable
                        key={`${action.text}-${index}`}
                        onPress={() => {
                          const callback = action.onPress;
                          setAppDialog(null);
                          if (callback) {
                            setTimeout(() => {
                              Promise.resolve(callback()).catch(() => showDialog(
                                "Something went wrong",
                                "Please try again.",
                                undefined,
                                "danger",
                              ));
                            }, 160);
                          }
                        }}
                        style={[
                          styles.appDialogButton,
                          isCancel && styles.appDialogButtonCancel,
                          isDanger && styles.appDialogButtonDanger,
                        ]}
                      >
                        <Text style={[
                          styles.appDialogButtonText,
                          isCancel && styles.appDialogButtonTextCancel,
                        ]}>{action.text}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>

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
                <Text style={[styles.editorTypeText, editType === "credit" && styles.editorTypeTextActive, editType === "credit" && styles.editorTypeTextCreditActive]}>CREDIT</Text>
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

      <View style={[styles.tabBar, styles.homeTabBar]}>
        <TabButton icon="home" label="Home" active={tab === "home"} light={!activeThemeDark} onPress={() => selectTab("home")} />
        <TabButton icon="receipt-outline" label="Activity" active={tab === "activity"} light={!activeThemeDark} onPress={() => selectTab("activity")} />
        <TabButton icon="pie-chart-outline" label="Insights" active={tab === "insights"} light={!activeThemeDark} onPress={() => selectTab("insights")} />
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

function TabButton({ icon, label, active, light = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; light?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <Ionicons name={icon} size={22} color={active ? (light ? "#111111" : COLORS.purple) : "#97939C"} />
      <Text style={[styles.tabText, active && styles.tabTextActive, light && active && styles.homeTabTextActive]}>{label}</Text>
      {active && <View style={styles.tabDot} />}
    </Pressable>
  );
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.cream },
  homeSafe: { backgroundColor: "#F4F1EE" },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 104 },
  homeScroll: { paddingTop: 334 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandMark: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 21, fontWeight: "900", color: COLORS.ink, letterSpacing: -.8 },
  logoDot: { color: COLORS.coral },
  tagline: { color: COLORS.muted, fontSize: 7.5, fontWeight: "900", letterSpacing: 1.05, marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center" },
  previewPill: { height: 29, borderRadius: 20, backgroundColor: "#FFF3DD", borderWidth: 1, borderColor: "#EFD8AE", paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  previewText: { color: "#8A5E16", fontSize: 8, fontWeight: "900", letterSpacing: .6 },
  greeting: { display: "none" },
  eyebrow: { color: "#969189", fontSize: 9, fontWeight: "900", letterSpacing: 1.25, marginBottom: 5 },
  title: { fontSize: 27, fontWeight: "900", color: COLORS.ink, letterSpacing: -1.1 },
  subtitle: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
  todayBadge: { alignItems: "flex-end", borderLeftWidth: 1, borderLeftColor: COLORS.line, paddingLeft: 14 },
  todayLabel: { color: "#99938B", fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  todayValue: { fontSize: 16, fontWeight: "900", color: COLORS.ink, marginTop: 3 },
  moneyHero: { position: "relative", borderRadius: 22, borderWidth: 1, borderColor: "#2A3934", paddingHorizontal: 18, paddingVertical: 16, overflow: "hidden" },
  homeTopShell: { position: "absolute", left: 18, right: 18, backgroundColor: "#090909", borderWidth: 1, borderColor: "#090909", padding: 18, overflow: "hidden", zIndex: 20, elevation: 16, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  homeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 2 },
  homeBrand: { flexDirection: "row", alignItems: "center", gap: 9 },
  homeBrandMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#BFE1DA", alignItems: "center", justifyContent: "center" },
  homeLogo: { color: "#F8F7F3", fontSize: 19, fontWeight: "900", letterSpacing: -.7 },
  homeHeaderActions: { flexDirection: "row", gap: 7 },
  homeRoundButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: "#343434", backgroundColor: "#161616", alignItems: "center", justifyContent: "center" },
  homeOrbitLarge: { position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: "#FFFFFF14", right: -50, top: -41 },
  homeOrbitSmall: { position: "absolute", width: 79, height: 79, borderRadius: 40, borderWidth: 2, borderColor: "#CFC4E52E", right: 35, top: 24 },
  homeHeroSelector: { position: "absolute", left: 18, right: 18, top: 76, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  homeBalanceBlock: { position: "absolute", left: 18, right: 72 },
  homeBalanceLabelStack: { height: 14, justifyContent: "center" },
  homeExpandedBalanceLabel: { position: "absolute", marginTop: 0 },
  compactBalanceLabel: { color: "#BFE1DA", fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  homeCollapsedBalanceLabel: { position: "absolute", textTransform: "uppercase" },
  homeHeroStats: { position: "absolute", left: 18, right: 18, top: 224, marginTop: 0 },
  compactBalanceMark: { position: "absolute", right: 16, top: 18, width: 38, height: 38, borderRadius: 12, backgroundColor: "#BFE1DA", alignItems: "center", justifyContent: "center" },
  heroOrbLarge: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: "#FFFFFF0A", right: -72, top: -78 },
  heroOrbSmall: { position: "absolute", width: 94, height: 94, borderRadius: 47, backgroundColor: "#A99CF812", right: 45, bottom: -55 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, backgroundColor: "#1B1B1B", borderWidth: 1, borderColor: "#343434", paddingHorizontal: 10, paddingVertical: 6 },
  heroLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#BFE1DA" },
  heroPillText: { color: "#ECE9E2", fontSize: 8, fontWeight: "800", letterSpacing: .5, textTransform: "uppercase" },
  heroMonth: { color: "#A7A39E", fontSize: 8, fontWeight: "800", letterSpacing: .7 },
  heroBalanceLabel: { color: "#BFE1DA", fontSize: 10.5, fontWeight: "600", marginTop: 18 },
  heroBalance: { color: "#FFF", fontSize: 36, fontWeight: "900", letterSpacing: -1.7, marginTop: 2 },
  heroBalanceCaption: { color: "#8E8B87", fontSize: 9, marginTop: 3 },
  heroDivider: { height: 1, backgroundColor: "#FFFFFF1F", marginVertical: 15 },
  heroStats: { flexDirection: "row", alignItems: "center", backgroundColor: "#171717", borderRadius: 16, marginTop: 20, paddingHorizontal: 15, paddingVertical: 12 },
  heroStat: { flex: 1 },
  heroStatLabel: { color: "#8D8985", fontSize: 7, fontWeight: "900", letterSpacing: .7, marginBottom: 4 },
  heroStatValue: { color: "#F7F5F0", fontSize: 12, fontWeight: "900" },
  heroStatDivider: { width: 1, height: 27, backgroundColor: "#343434", marginHorizontal: 15 },
  homeSheet: { backgroundColor: "#FCFBF8", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, padding: 18, marginTop: -12, zIndex: 3, shadowColor: "#181412", shadowOpacity: .08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  quickCard: { borderRadius: 20, borderWidth: 1, borderColor: "#E2DED8", padding: 15, marginTop: 12 },
  quickHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  bolt: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 10 },
  quickHeading: { flex: 1 },
  quickEyebrow: { color: "#938AA3", fontSize: 6.5, fontWeight: "900", letterSpacing: 1 },
  quickTitle: { color: "#111111", fontSize: 18, fontWeight: "900", letterSpacing: -.5 },
  quickSubtitle: { color: "#85807B", fontSize: 9, marginTop: 2 },
  todayMiniBadge: { alignItems: "flex-end" },
  todayMiniLabel: { color: "#9B9690", fontSize: 6.5, fontWeight: "900", letterSpacing: .8 },
  todayMiniValue: { color: "#111111", fontSize: 12, fontWeight: "900", marginTop: 2 },
  quickReady: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 14, backgroundColor: "#242B2A", paddingHorizontal: 8, paddingVertical: 6 },
  quickReadyDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.green },
  quickReadyText: { color: "#7BDDB5", fontSize: 6.5, fontWeight: "900", letterSpacing: .7 },
  typeToggle: { flexDirection: "row", backgroundColor: "#EFECE8", padding: 4, borderRadius: 12, marginBottom: 10 },
  typeButton: { flex: 1, height: 38, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  typeButtonDebit: { backgroundColor: "#111111" },
  typeButtonCredit: { backgroundColor: "#BFE1DA" },
  typeText: { color: "#77736F", fontSize: 10, fontWeight: "800" },
  typeTextSelected: { color: "#FFF" },
  typeTextCreditSelected: { color: "#111111" },
  quickFieldLabel: { color: "#A4ADA9", fontSize: 9, fontWeight: "700", marginLeft: 2, marginBottom: 6 },
  descriptionWrap: { height: 48, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F7F5F1", paddingHorizontal: 13, marginBottom: 9 },
  descriptionInput: { flex: 1, height: "100%", color: "#111111", paddingHorizontal: 0, fontSize: 13.5 },
  amountRow: { flexDirection: "row", gap: 8 },
  amountInputWrap: { flex: 1, height: 50, flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F7F5F1", paddingLeft: 8 },
  currencyBadge: { height: 34, minWidth: 34, borderRadius: 9, backgroundColor: "#E8E2F2", alignItems: "center", justifyContent: "center", marginRight: 7 },
  currency: { color: "#342F3A", fontSize: 10, fontWeight: "900" },
  amountInput: { flex: 1, height: "100%", color: "#111111", fontSize: 18, fontWeight: "900" },
  addButton: { width: 94, borderRadius: 12, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  addButtonText: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, marginLeft: 2 },
  hint: { color: "#8F8996", fontSize: 8.5 },
  homeSectionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 23, marginBottom: 10 },
  homeSectionTitle: { color: "#111111", fontSize: 15, fontWeight: "900", letterSpacing: -.35 },
  homeSectionCaption: { color: "#918C87", fontSize: 8.5, marginTop: 2 },
  homeSectionAction: { color: "#6C6560", fontSize: 8.5, fontWeight: "800" },
  homeCategoryRow: { gap: 9, paddingRight: 3 },
  homeCategoryCard: { width: 108, minHeight: 108, borderRadius: 18, backgroundColor: "#EEEAE5", padding: 12 },
  homeCategoryCardLilac: { backgroundColor: "#E7E0F1" },
  homeCategoryCardMint: { backgroundColor: "#CDE7E1" },
  homeCategoryIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#FFFFFFAA", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  homeCategoryName: { color: "#504B47", fontSize: 9, fontWeight: "700" },
  homeCategoryValue: { color: "#111111", fontSize: 13, fontWeight: "900", marginTop: 4 },
  homeList: { borderTopWidth: 1, borderTopColor: "#EAE6E0" },
  homeTransaction: { minHeight: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E4E0DA" },
  homeTransactionIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 10 },
  homeTransactionTitle: { color: "#111111", fontSize: 11.5, fontWeight: "800" },
  homeTransactionMeta: { color: "#918C87", fontSize: 8.5, marginTop: 3 },
  homeTransactionAmount: { color: "#111111", fontSize: 10.5, fontWeight: "900" },
  homeCreditAmount: { color: "#2B856B" },
  homeEmpty: { color: "#8E8984", fontSize: 10, textAlign: "center", paddingVertical: 25 },
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
  smartInsight: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: COLORS.paper, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, padding: 13, marginTop: 12 },
  smartInsightIcon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  smartInsightLabel: { color: "#91899C", fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  smartInsightTitle: { color: COLORS.ink, fontSize: 11.5, fontWeight: "900", marginTop: 3 },
  smartInsightCopy: { color: COLORS.muted, fontSize: 8.5, lineHeight: 12.5, marginTop: 2 },
  smartInsightArrow: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#20342D", alignItems: "center", justifyContent: "center" },
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
  insightLivePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#DCEDE7", borderWidth: 1, borderColor: "#C5DED5", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  insightLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  insightLiveText: { color: "#347B64", fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  insightHero: { position: "relative", borderRadius: 25, padding: 18, overflow: "hidden", marginBottom: 14, shadowColor: "#151210", shadowOpacity: .16, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 7 },
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
  dateFilterCard: { backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 20, padding: 14, marginBottom: 12 },
  dateFilterTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 13 },
  dateFilterEyebrow: { color: "#81798B", fontSize: 7, fontWeight: "900", letterSpacing: .9 },
  dateFilterTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "900", letterSpacing: -.25, marginTop: 3 },
  dateFilterIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#E8E2F2", alignItems: "center", justifyContent: "center" },
  dateChips: { flexDirection: "row", gap: 5 },
  dateChip: { flex: 1, height: 36, borderRadius: 10, backgroundColor: "#F0ECE7", borderWidth: 1, borderColor: "#E2DED8", alignItems: "center", justifyContent: "center" },
  customDateChip: { flexDirection: "row", gap: 4, flex: 1.25 },
  dateChipActive: { backgroundColor: "#111111", borderColor: "#111111" },
  dateChipText: { color: "#9992A1", fontSize: 8.5, fontWeight: "900" },
  dateChipTextActive: { color: "#FFF" },
  summaryStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 15, marginBottom: 14 },
  summaryLabel: { color: "#99938B", fontSize: 7, fontWeight: "900", letterSpacing: .7 },
  summaryValue: { color: COLORS.ink, fontSize: 14, fontWeight: "900", marginTop: 4 },
  summaryDivider: { width: 1, height: 28, backgroundColor: COLORS.line },
  outlineButton: { height: 44, borderWidth: 1, borderColor: COLORS.line, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 12, backgroundColor: COLORS.paper },
  outlineButtonText: { color: COLORS.purple, fontSize: 11, fontWeight: "800" },
  emptyDateCard: { minHeight: 180, backgroundColor: COLORS.paper, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 22 },
  emptyDateIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: "#E8E2F2", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyDateTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  emptyDateCopy: { color: COLORS.muted, fontSize: 9.5, textAlign: "center", lineHeight: 14, marginTop: 5, maxWidth: 220 },
  analysisCard: { backgroundColor: COLORS.paper, borderRadius: 22, borderWidth: 1, borderColor: COLORS.line, padding: 16, overflow: "hidden" },
  insightSectionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  insightSectionIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#E8E2F2", alignItems: "center", justifyContent: "center" },
  trendCard: { backgroundColor: COLORS.paper, borderRadius: 22, borderWidth: 1, borderColor: COLORS.line, padding: 16, marginTop: 14, overflow: "hidden" },
  cashflowCard: { backgroundColor: COLORS.paper, borderRadius: 22, borderWidth: 1, borderColor: COLORS.line, padding: 16, marginTop: 14 },
  chartHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  chartTitle: { color: COLORS.ink, fontSize: 16, fontWeight: "900", letterSpacing: -.4 },
  chartTotalPill: { backgroundColor: "#E8E2F2", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  chartTotalText: { color: "#705A99", fontSize: 9, fontWeight: "900" },
  weekChart: { height: 145, flexDirection: "row", alignItems: "flex-end", gap: 6, paddingTop: 4 },
  weekColumn: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  weekValue: { color: COLORS.muted, fontSize: 7, fontWeight: "800", width: "100%", textAlign: "center", marginBottom: 5 },
  weekBarSlot: { height: 92, width: "64%", justifyContent: "flex-end", borderRadius: 7, backgroundColor: "#ECE8E3", overflow: "hidden" },
  weekBar: { width: "100%", borderRadius: 7 },
  weekLabel: { color: "#8F8998", fontSize: 8, fontWeight: "800", marginTop: 7 },
  flowRow: { marginTop: 12 },
  flowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  flowLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  flowValue: { color: COLORS.ink, fontSize: 10.5, fontWeight: "900" },
  flowTrack: { height: 10, borderRadius: 8, backgroundColor: "#ECE8E3", overflow: "hidden" },
  flowFill: { height: "100%", borderRadius: 8 },
  netFlow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: 17, paddingTop: 13 },
  netFlowLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: .8 },
  netFlowValue: { fontSize: 14, fontWeight: "900" },
  trendDirection: { color: "#347B64", fontSize: 8, fontWeight: "900", backgroundColor: "#DCEDE7", borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6 },
  monthWeekChart: { height: 124, flexDirection: "row", alignItems: "flex-end", gap: 10 },
  monthWeekColumn: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  monthWeekSlot: { height: 78, width: "72%", justifyContent: "flex-end", backgroundColor: "#ECE8E3", borderRadius: 8, overflow: "hidden" },
  monthWeekBar: { width: "100%", borderRadius: 8, backgroundColor: COLORS.purple },
  monthWeekValue: { color: COLORS.ink, fontSize: 7, fontWeight: "800", marginTop: 3, maxWidth: 58 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  metricCard: { width: "48.4%", backgroundColor: COLORS.paper, borderRadius: 18, borderWidth: 1, borderColor: COLORS.line, padding: 14 },
  metricIcon: { width: 33, height: 33, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 11 },
  metricLabel: { color: COLORS.muted, fontSize: 7.5, fontWeight: "900", letterSpacing: .65 },
  metricValue: { color: COLORS.ink, fontSize: 16, fontWeight: "900", marginTop: 5 },
  chartRow: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  donutWrap: { width: 145, height: 145, alignItems: "center", justifyContent: "center" },
  donutGlow: { position: "absolute", width: 144, height: 144, borderRadius: 72 },
  donutRing: { width: 126, height: 126, borderRadius: 63, borderWidth: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#ECE8E3" },
  donutArcAccent: { position: "absolute", width: 126, height: 126, borderRadius: 63, borderWidth: 12, borderLeftColor: "transparent", borderBottomColor: "transparent", transform: [{ rotate: "18deg" }] },
  donutInner: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.paper, alignItems: "center" },
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
  barTrack: { height: 6, borderRadius: 5, backgroundColor: "#ECE8E3", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 5 },
  monthCards: { flexDirection: "row", gap: 12, marginTop: 14 },
  monthCard: { flex: 1, borderRadius: 16, padding: 15 },
  monthCardLabel: { color: COLORS.muted, fontSize: 8, fontWeight: "900", letterSpacing: .7, marginTop: 12 },
  monthCardValue: { color: COLORS.ink, fontSize: 16, fontWeight: "900", marginTop: 4 },
  notificationCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: COLORS.paper, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, padding: 14, marginTop: 14 },
  notificationIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#292341", alignItems: "center", justifyContent: "center" },
  notificationTitle: { color: COLORS.ink, fontSize: 11.5, fontWeight: "800" },
  notificationCopy: { color: COLORS.muted, fontSize: 9.5, marginTop: 3 },
  appDialogBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, backgroundColor: "#171411A8" },
  appDialogCard: { width: "100%", maxWidth: 390, borderRadius: 28, backgroundColor: "#FCFBF8", borderWidth: 1, borderColor: "#E2DED8", padding: 22, alignItems: "center", shadowColor: "#000", shadowOpacity: .24, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 22 },
  appDialogIcon: { width: 52, height: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  appDialogTitle: { color: "#111111", fontSize: 21, fontWeight: "900", letterSpacing: -.6, textAlign: "center" },
  appDialogMessage: { color: "#77716C", fontSize: 11.5, lineHeight: 17, textAlign: "center", marginTop: 8, maxWidth: 300 },
  appDialogActions: { width: "100%", flexDirection: "row", gap: 9, marginTop: 22 },
  appDialogButton: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  appDialogButtonCancel: { backgroundColor: "#EFECE8", borderWidth: 1, borderColor: "#E2DED8" },
  appDialogButtonDanger: { backgroundColor: "#D96F61" },
  appDialogButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  appDialogButtonTextCancel: { color: "#5F5954" },
  overviewPickerBackdrop: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 12, backgroundColor: "#000000C2" },
  overviewPickerCard: { backgroundColor: "#FCFBF8", borderRadius: 25, borderWidth: 1, borderColor: "#E2DED8", padding: 18, shadowColor: "#000", shadowOpacity: .22, shadowRadius: 25, elevation: 20 },
  overviewPickerHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  overviewPickerCopy: { color: COLORS.muted, fontSize: 9.5, marginTop: 5 },
  overviewPickerGrid: { gap: 8, marginTop: 18 },
  overviewPickerOption: { height: 62, borderRadius: 16, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F4F1EE", flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12 },
  overviewPickerOptionActive: { borderColor: "#111111", backgroundColor: "#E8E2F2" },
  overviewPickerIcon: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  overviewPickerLabel: { color: COLORS.ink, fontSize: 11.5, fontWeight: "900" },
  overviewPickerOptionCopy: { color: "#8D8695", fontSize: 8.5, marginTop: 3 },
  calendarBackdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 18, backgroundColor: "#000000C2" },
  calendarCard: { backgroundColor: "#FCFBF8", borderRadius: 24, borderWidth: 1, borderColor: "#E2DED8", padding: 18, shadowColor: "#000", shadowOpacity: .22, shadowRadius: 25, elevation: 20 },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarEyebrow: { color: "#938A9D", fontSize: 7.5, fontWeight: "900", letterSpacing: 1.1 },
  calendarTitle: { color: COLORS.ink, fontSize: 21, fontWeight: "900", letterSpacing: -.6, marginTop: 3 },
  calendarClose: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#F0ECE7", alignItems: "center", justifyContent: "center" },
  calendarMonthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 13 },
  calendarArrow: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#E8E2F2", alignItems: "center", justifyContent: "center" },
  calendarMonthText: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  calendarWeekRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E2DED8", paddingBottom: 9, marginBottom: 5 },
  calendarWeekday: { width: "14.285%", color: "#7F7788", fontSize: 8, fontWeight: "900", textAlign: "center" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDay: { width: "14.285%", height: 39, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  calendarDaySelected: { backgroundColor: COLORS.purple },
  calendarDayToday: { borderWidth: 1, borderColor: "#6D5BD1" },
  calendarDayText: { color: "#514C48", fontSize: 11, fontWeight: "700" },
  calendarDayTextSelected: { color: "#FFF", fontWeight: "900" },
  calendarTodayButton: { height: 44, borderRadius: 13, backgroundColor: "#E8E2F2", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12 },
  calendarTodayText: { color: "#67518F", fontSize: 10, fontWeight: "900" },
  editorBackdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 20, backgroundColor: "#000000B8" },
  editorCard: { backgroundColor: "#FCFBF8", borderRadius: 24, borderWidth: 1, borderColor: "#E2DED8", padding: 20, shadowColor: "#000", shadowOpacity: .22, shadowRadius: 24, elevation: 18 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  editorEyebrow: { color: "#938B9E", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  editorTitle: { color: COLORS.ink, fontSize: 22, fontWeight: "900", letterSpacing: -.7, marginTop: 4 },
  editorClose: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#F0ECE7", alignItems: "center", justifyContent: "center" },
  editorToggle: { flexDirection: "row", backgroundColor: "#F0ECE7", borderRadius: 12, padding: 4, marginBottom: 17 },
  editorTypeButton: { flex: 1, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  editorDebit: { backgroundColor: COLORS.coral },
  editorCredit: { backgroundColor: "#BFE1DA" },
  editorTypeText: { color: "#938D9B", fontSize: 9, fontWeight: "900", letterSpacing: .5 },
  editorTypeTextActive: { color: "#FFF" },
  editorTypeTextCreditActive: { color: "#111111" },
  editorLabel: { color: "#8F8898", fontSize: 8, fontWeight: "900", letterSpacing: 1, marginBottom: 7, marginTop: 2 },
  editorInput: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F7F5F1", color: COLORS.ink, paddingHorizontal: 14, fontSize: 14, marginBottom: 14 },
  editorAmountWrap: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F7F5F1", flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  editorCurrency: { color: COLORS.muted, fontSize: 13, fontWeight: "800", marginRight: 8 },
  editorAmountInput: { flex: 1, height: "100%", color: COLORS.ink, fontSize: 17, fontWeight: "900" },
  categoryPicker: { gap: 7, paddingRight: 8 },
  categoryChip: { height: 36, borderRadius: 11, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F4F1EE", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10 },
  categoryChipText: { color: COLORS.muted, fontSize: 9, fontWeight: "800" },
  editorSave: { height: 52, borderRadius: 14, backgroundColor: COLORS.purple, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 18 },
  editorSaveText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  editorDelete: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 5 },
  editorDeleteText: { color: COLORS.coral, fontSize: 10.5, fontWeight: "800" },
  tabBar: { position: "absolute", left: 16, right: 16, bottom: 14, height: 62, borderRadius: 18, borderWidth: 1, borderColor: COLORS.line, backgroundColor: "#FCFBF8", flexDirection: "row", paddingHorizontal: 14, elevation: 10 },
  homeTabBar: { backgroundColor: "#FCFBF8", borderColor: "#E2DED8", shadowColor: "#14110F", shadowOpacity: .12, shadowRadius: 12, shadowOffset: { width: 0, height: 7 } },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  tabText: { color: "#97939C", fontSize: 8.5, fontWeight: "700" },
  tabTextActive: { color: "#FFF" },
  homeTabTextActive: { color: "#111111" },
  tabDot: { position: "absolute", bottom: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.coral },
});

const darkStyles = StyleSheet.create({
  safe: { backgroundColor: "#0C0E0D" },
  homeSafe: { backgroundColor: "#0C0E0D" },
  headerButton: { backgroundColor: "#191C1A", borderColor: "#303531" },
  logo: { color: "#F4F5F2" },
  tagline: { color: "#959C97" },
  eyebrow: { color: "#9DA29E" },
  subtitle: { color: "#9DA29E" },
  pageTitle: { color: "#F4F5F2" },
  sectionTitle: { color: "#F4F5F2" },
  sectionAction: { color: "#B9A8D3" },

  homeSheet: { backgroundColor: "#151816", borderColor: "#2B302C", shadowOpacity: .32 },
  quickTitle: { color: "#F4F5F2" },
  quickSubtitle: { color: "#969C98" },
  todayMiniLabel: { color: "#8F9691" },
  todayMiniValue: { color: "#F4F5F2" },
  typeToggle: { backgroundColor: "#242825" },
  typeButtonDebit: { backgroundColor: "#F4F5F2" },
  typeButtonCredit: { backgroundColor: "#8FC8B6" },
  typeText: { color: "#9AA09C" },
  typeTextSelected: { color: "#111311" },
  descriptionWrap: { backgroundColor: "#1E221F", borderColor: "#343A35" },
  descriptionInput: { color: "#F4F5F2" },
  amountInputWrap: { backgroundColor: "#1E221F", borderColor: "#343A35" },
  currencyBadge: { backgroundColor: "#3A3345" },
  currency: { color: "#DED4EB" },
  amountInput: { color: "#F4F5F2" },
  addButton: { backgroundColor: "#080A09", borderWidth: 1, borderColor: "#363B37" },
  homeSectionTitle: { color: "#F4F5F2" },
  homeSectionCaption: { color: "#929994" },
  homeSectionAction: { color: "#B8AEA7" },
  homeCategoryCard: { backgroundColor: "#282A28" },
  homeCategoryCardLilac: { backgroundColor: "#322D3B" },
  homeCategoryCardMint: { backgroundColor: "#233832" },
  homeCategoryIcon: { backgroundColor: "#FFFFFF12" },
  homeCategoryName: { color: "#B6BBB7" },
  homeCategoryValue: { color: "#F4F5F2" },
  homeList: { borderTopColor: "#2E332F" },
  homeTransaction: { borderBottomColor: "#2E332F" },
  homeTransactionTitle: { color: "#F4F5F2" },
  homeTransactionMeta: { color: "#929994" },
  homeTransactionAmount: { color: "#F4F5F2" },
  homeEmpty: { color: "#929994" },

  dateFilterCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  dateFilterEyebrow: { color: "#969C98" },
  dateFilterTitle: { color: "#F4F5F2" },
  dateFilterIcon: { backgroundColor: "#352F40" },
  dateChip: { backgroundColor: "#242825", borderColor: "#343A35" },
  dateChipText: { color: "#A1A6A2" },
  summaryStrip: { backgroundColor: "#171A18", borderColor: "#303531" },
  summaryLabel: { color: "#929994" },
  summaryValue: { color: "#F4F5F2" },
  summaryDivider: { backgroundColor: "#303531" },
  listCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  transaction: { borderBottomColor: "#303531" },
  transactionTitle: { color: "#F4F5F2" },
  transactionMeta: { color: "#929994" },
  transactionAmount: { color: "#F4F5F2" },
  outlineButton: { backgroundColor: "#171A18", borderColor: "#303531" },
  outlineButtonText: { color: "#B9A8D3" },
  emptyDateCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  emptyDateIcon: { backgroundColor: "#352F40" },
  emptyDateTitle: { color: "#F4F5F2" },
  emptyDateCopy: { color: "#929994" },

  insightLivePill: { backgroundColor: "#20352E", borderColor: "#2C4A40" },
  insightLiveText: { color: "#82C9B1" },
  analysisCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  insightSectionIcon: { backgroundColor: "#352F40" },
  trendCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  cashflowCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  chartTitle: { color: "#F4F5F2" },
  chartTotalPill: { backgroundColor: "#352F40" },
  chartTotalText: { color: "#C1AFDC" },
  weekValue: { color: "#A0A6A1" },
  weekBarSlot: { backgroundColor: "#292D2A" },
  weekLabel: { color: "#9CA29D" },
  flowLabel: { color: "#9CA29D" },
  flowValue: { color: "#F4F5F2" },
  flowTrack: { backgroundColor: "#292D2A" },
  netFlow: { borderTopColor: "#303531" },
  netFlowLabel: { color: "#9CA29D" },
  trendDirection: { backgroundColor: "#20352E", color: "#82C9B1" },
  monthWeekSlot: { backgroundColor: "#292D2A" },
  monthWeekValue: { color: "#F4F5F2" },
  metricCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  metricLabel: { color: "#9CA29D" },
  metricValue: { color: "#F4F5F2" },
  donutRing: { backgroundColor: "#292D2A" },
  donutInner: { backgroundColor: "#171A18" },
  donutLabel: { color: "#969C98" },
  donutValue: { color: "#F4F5F2" },
  legendName: { color: "#A4AAA5" },
  legendValue: { color: "#F4F5F2" },
  categoryBarName: { color: "#A4AAA5" },
  categoryBarPercent: { color: "#969C98" },
  categoryBarValue: { color: "#F4F5F2" },
  barTrack: { backgroundColor: "#292D2A" },
  monthCardLabel: { color: "#A4AAA5" },
  monthCardValue: { color: "#F4F5F2" },
  notificationCard: { backgroundColor: "#171A18", borderColor: "#303531" },
  notificationTitle: { color: "#F4F5F2" },
  notificationCopy: { color: "#969C98" },

  appDialogCard: { backgroundColor: "#191C1A", borderColor: "#343A35" },
  appDialogTitle: { color: "#F4F5F2" },
  appDialogMessage: { color: "#A3A9A4" },
  appDialogButtonCancel: { backgroundColor: "#292D2A", borderColor: "#3A403B" },
  appDialogButtonTextCancel: { color: "#D2D6D2" },
  overviewPickerCard: { backgroundColor: "#191C1A", borderColor: "#343A35" },
  overviewPickerCopy: { color: "#9CA29D" },
  overviewPickerOption: { backgroundColor: "#232724", borderColor: "#363C37" },
  overviewPickerOptionActive: { backgroundColor: "#352F40", borderColor: "#A792C5" },
  overviewPickerLabel: { color: "#F4F5F2" },
  overviewPickerOptionCopy: { color: "#9CA29D" },
  calendarCard: { backgroundColor: "#191C1A", borderColor: "#343A35" },
  calendarEyebrow: { color: "#9CA29D" },
  calendarTitle: { color: "#F4F5F2" },
  calendarClose: { backgroundColor: "#292D2A" },
  calendarArrow: { backgroundColor: "#352F40" },
  calendarMonthText: { color: "#F4F5F2" },
  calendarWeekRow: { borderBottomColor: "#343A35" },
  calendarWeekday: { color: "#9CA29D" },
  calendarDayText: { color: "#D0D4D0" },
  calendarTodayButton: { backgroundColor: "#352F40" },
  calendarTodayText: { color: "#C1AFDC" },
  editorCard: { backgroundColor: "#191C1A", borderColor: "#343A35" },
  editorTitle: { color: "#F4F5F2" },
  editorClose: { backgroundColor: "#292D2A" },
  editorToggle: { backgroundColor: "#292D2A" },
  editorInput: { backgroundColor: "#232724", borderColor: "#3A403B", color: "#F4F5F2" },
  editorAmountWrap: { backgroundColor: "#232724", borderColor: "#3A403B" },
  editorAmountInput: { color: "#F4F5F2" },
  categoryChip: { backgroundColor: "#232724", borderColor: "#3A403B" },
  categoryChipText: { color: "#A3A9A4" },

  tabBar: { backgroundColor: "#171A18", borderColor: "#303531" },
  homeTabBar: { backgroundColor: "#171A18", borderColor: "#303531", shadowOpacity: .35 },
  tabText: { color: "#929994" },
  homeTabTextActive: { color: "#F4F5F2" },
});

const styles = new Proxy(baseStyles, {
  get(target, property: string) {
    const base = target[property as keyof typeof target];
    const dark = darkStyles[property as keyof typeof darkStyles];
    return activeThemeDark && dark ? [base, dark] : base;
  },
}) as typeof baseStyles;
