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
  useColorScheme,
  AppState,
  DeviceEventEmitter,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  PanResponder,
  PermissionsAndroid,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MotionProvider, MotionView, MotionPressable as Pressable, useReducedMotion } from "./Motion";

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
type ThemePreference = ThemeMode | "system";
type ProfilePurpose = "Personal" | "Business" | "Both";
type DateScope = "today" | "yesterday" | "custom" | "all";
type OverviewScope = "today" | "yesterday" | "custom" | "month";
type CalendarTarget = "activity" | "overview";
type DialogTone = "neutral" | "success" | "warning" | "danger";
type DialogAction = { text: string; style?: "cancel" | "destructive"; onPress?: () => void | Promise<void> };
type AppDialog = { title: string; message: string; tone: DialogTone; actions: DialogAction[] };
type PlayUpdateInfo = { available: boolean; availableVersionCode: number; flexibleAllowed: boolean; immediateAllowed: boolean; installStatus: string };
type PlayUpdateState = { installStatus: string; bytesDownloaded: number; totalBytesToDownload: number; errorCode?: number };

type Expense = {
  id: string;
  description: string;
  amount: number;
  type: EntryType;
  category: string;
  createdAt: string;
  currency: string;
  sourceText?: string;
  sourceSender?: string;
  sourceChannel?: string;
  counterparty?: string;
  account?: string;
  reference?: string;
};
type ReviewEntry = Expense & { duplicateOf: string; source?: string; reviewStatus?: "pending" | "same" | "separate" };

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

function categoryAccent(name: string): string {
  const color = categoryMeta[name]?.color ?? categoryMeta.Other.color;
  if (!activeThemeDark) return color;
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => Math.round(channel + (255 - channel) * .38).toString(16).padStart(2, "0")).join("")}`;
}
const COMMON_CURRENCIES = ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR", "CAD", "AUD", "SGD", "JPY", "CNY", "CHF", "QAR", "KWD", "BHD", "OMR", "MYR", "THB", "BDT", "LKR", "NPR", "NZD", "ZAR", "HKD"];
const CRYPTO_CURRENCIES = ["USDT", "USDC", "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "LTC", "TRX", "TON", "DOT", "AVAX", "LINK", "XLM", "BCH", "SHIB", "DAI", "TUSD", "FDUSD"];
const isCryptoCurrency = (currency: string) => CRYPTO_CURRENCIES.includes(currency.toUpperCase());
const ONBOARDING_KEY = "onboarding_v2_complete";
const currencyOptionsForRates = (rates: Record<string, number>) => [
  ...COMMON_CURRENCIES,
  ...Object.keys(rates).filter((currency) => !COMMON_CURRENCIES.includes(currency)).sort(),
];
type RateSnapshot = { schemaVersion: 2; base: string; rates: Record<string, number>; updatedAt: number };

let database: SQLite.SQLiteDatabase | null = null;
let databaseOpenInFlight: Promise<SQLite.SQLiteDatabase> | null = null;
let nativeImportInFlight: Promise<boolean> | null = null;
let syncLoadInFlight: Promise<void> | null = null;
let importRecoverySnapshot = false;
let activeThemeDark = false;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function shareNativeTheme(theme: ThemePreference) {
  if (FileSystem.documentDirectory) {
    await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}moneysync_theme.txt`, theme);
    if (Platform.OS === "android") NativeModules.MoneySyncPermissions?.refreshWidgets?.();
  }
}

async function shareNativeCurrency(currency: string) {
  if (FileSystem.documentDirectory) {
    await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}moneysync_currency.txt`, currency);
  }
}

async function readRateCache(base: string): Promise<RateSnapshot | null> {
  if (!FileSystem.documentDirectory) return null;
  const uri = `${FileSystem.documentDirectory}moneysync_rates_${base}.json`;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as RateSnapshot;
    return parsed.schemaVersion === 2 && parsed.base === base && parsed.rates?.[base] === 1
      && Number.isFinite(parsed.updatedAt) && parsed.updatedAt > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchRates(base: string): Promise<RateSnapshot> {
  const cached = await readRateCache(base);
  if (cached && Date.now() - cached.updatedAt < 24 * 60 * 60 * 1000) return cached;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response: Response;
    try {
      response = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Rate service returned ${response.status}`);
    const payload = await response.json() as { result?: string; base_code?: string; rates?: Record<string, number> };
    if (payload.result !== "success" || payload.base_code !== base || !payload.rates || payload.rates[base] !== 1
      || Object.values(payload.rates).some((rate) => !Number.isFinite(rate) || rate <= 0)) throw new Error("Invalid rate response");
    const snapshot: RateSnapshot = { schemaVersion: 2, base, rates: payload.rates, updatedAt: Date.now() };
    if (FileSystem.documentDirectory) {
      await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}moneysync_rates_${base}.json`, JSON.stringify(snapshot));
    }
    return snapshot;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

async function preserveDamagedDatabase() {
  const directory = SQLite.defaultDatabaseDirectory;
  if (!directory) throw new Error("Wallet directory is unavailable");
  const base = `file://${directory}/kharcha.db`;
  const suffix = `.damaged-${Date.now()}`;
  for (const sidecar of ["", "-wal", "-shm"]) {
    const source = `${base}${sidecar}`;
    if ((await FileSystem.getInfoAsync(source)).exists) {
      await FileSystem.moveAsync({ from: source, to: `${source}${suffix}` });
    }
  }
  importRecoverySnapshot = true;
}

async function writeRecoverySnapshot(entries: Expense[]) {
  if (!FileSystem.documentDirectory) return;
  const db = await getDb();
  const reviews = await db.getAllAsync<{ payload: string; status: string }>("SELECT payload, status FROM duplicate_reviews");
  const uri = `${FileSystem.documentDirectory}kharcha_recovery.jsonl`;
  const content = [...entries.map((entry) => JSON.stringify(entry)),
    ...reviews.map((row) => JSON.stringify({ ...JSON.parse(row.payload), reviewStatus: row.status }))].join("\n");
  await FileSystem.writeAsStringAsync(uri, content ? `${content}\n` : "", {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

async function snapshotDatabase(db: SQLite.SQLiteDatabase) {
  const rows = await db.getAllAsync<{
    id: string; description: string; amount: number; type: EntryType;
    category: string; created_at: string; currency: string;
    source_text: string; source_sender: string; source_channel: string;
    counterparty: string; account: string; reference: string;
  }>("SELECT * FROM expenses ORDER BY created_at DESC");
  await writeRecoverySnapshot(rows.map((row) => ({ ...row, createdAt: row.created_at,
    sourceText: row.source_text, sourceSender: row.source_sender, sourceChannel: row.source_channel })));
}

const currencyDigits = (currency: string) => currency === "JPY" ? 0 : ["KWD", "BHD", "OMR"].includes(currency) ? 3 : 2;

const money = (value: number, currency = "PKR", useCurrencyCode = false) => {
  const digits = currencyDigits(currency);
  const wholeRupees = currency === "PKR" && Math.abs(value - Math.round(value)) < 0.000001;
  const number = new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: wholeRupees ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${currency === "PKR" && !useCurrencyCode ? "Rs" : currency} ${number}`;
};

const shortMoney = (value: number, currency = "PKR") => {
  const prefix = currency === "PKR" ? "Rs" : currency;
  if (Math.abs(value) >= 1000000) return `${prefix} ${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${prefix} ${(value / 1000).toFixed(1)}k`;
  return money(value, currency);
};

const entryDateTime = (value: string) => {
  const date = new Date(value);
  const day = date.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${day}, ${time}`;
};

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

const categoryPatternCache = new Map<string, RegExp>();

function categorize(description: string, type: EntryType) {
  if (type === "credit") return "Income";
  const text = description.toLowerCase();
  const has = (terms: string[]) => terms.some((term) => {
    let pattern = categoryPatternCache.get(term);
    if (!pattern) {
      pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${term}($|[^\\p{L}\\p{N}])`, "u");
      categoryPatternCache.set(term, pattern);
    }
    return pattern.test(text);
  });
  const rules: Array<[string, string[]]> = [
    ["Food", ["foodpanda", "uber eats", "ubereats", "deliveroo", "doordash", "talabat", "grubhub", "just eat", "justeat", "zomato", "swiggy", "lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee", "tea", "pizza", "burger", "biryani", "food", "kfc", "mcdonald", "hardees", "domino", "cheezious"]],
    ["Groceries", ["grocery", "groceries", "supermarket", "milk", "vegetable", "fruit", "imtiaz", "carrefour", "naheed", "alfatah", "al-fatah"]],
    ["Transport", ["careem", "uber", "indrive", "bykea", "ride", "taxi", "fuel", "petrol", "shell", "pso", "total parco", "bus", "metro", "parking"]],
    ["Shopping", ["shirt", "dress", "clothes", "clothing", "shoes", "shopping", "daraz", "mall"]],
    ["Cash", ["atm", "cash withdrawal", "withdrawal", "cash out"]],
    ["Transfers", ["transfer", "ibft", "raast", "sent to", "send to", "advance", "loan", "lent", "borrowed"]],
    ["Health", ["doctor", "medicine", "pharmacy", "hospital", "clinic"]],
    ["Bills", ["bill", "electricity", "internet", "mobile bill", "gas bill", "water bill", "subscription", "ptcl", "lesco", "wapda", "jazz", "zong", "telenor", "ufone", "netflix", "spotify"]],
    ["Home", ["rent", "repair", "furniture", "cleaning"]],
    ["Work", ["office", "client", "work", "business", "freelance", "salary advance"]],
    ["Education", ["school", "college", "university", "tuition", "course", "textbook", "books", "stationery", "exam fee"]],
    ["Entertainment", ["cinema", "movie", "game", "gaming", "concert", "spotify", "youtube premium"]],
    ["Personal", ["salon", "barber", "spa", "gift", "skincare", "cosmetic", "makeup"]],
    ["Travel", ["hotel", "flight", "airline", "booking", "visa", "trip", "airbnb"]],
  ];
  const matched = rules.find(([, terms]) => has(terms))?.[0];
  if (matched) return matched;
  if (has(["mart"])) return "Groceries";
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
    // Android can reconnect the notification listener at the same moment the
    // activity starts. Its very short native write may temporarily lock this
    // file, so give SQLite enough time to settle instead of treating that as a
    // broken wallet.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let candidate: SQLite.SQLiteDatabase | null = null;
      try {
        candidate = await SQLite.openDatabaseAsync("kharcha.db");
        await candidate.execAsync("PRAGMA busy_timeout = 15000;");
        try {
          await candidate.execAsync("PRAGMA journal_mode = WAL;");
        } catch (walError) {
          // WAL is an optimization, not a reason to hide the wallet. Some
          // Android builds briefly hold a native read connection at startup.
          console.warn("MoneySync will continue without changing journal mode", walError);
        }
        const integrity = await candidate.getFirstAsync<{ quick_check: string }>("PRAGMA quick_check;");
        if (integrity?.quick_check !== "ok") throw new Error(`Wallet database is malformed: ${integrity?.quick_check}`);
        await candidate.execAsync(`
          CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL,
            category TEXT NOT NULL,
            created_at TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'PKR',
            source_text TEXT NOT NULL DEFAULT '',
            source_sender TEXT NOT NULL DEFAULT '',
            source_channel TEXT NOT NULL DEFAULT '',
            counterparty TEXT NOT NULL DEFAULT '',
            account TEXT NOT NULL DEFAULT '',
            reference TEXT NOT NULL DEFAULT ''
          );
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS duplicate_reviews (
            id TEXT PRIMARY KEY NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
          );
        `);
        const expenseColumns = await candidate.getAllAsync<{ name: string }>("PRAGMA table_info(expenses)");
        if (!expenseColumns.some((column) => column.name === "currency")) {
          await candidate.execAsync("ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'PKR'");
        }
        for (const column of ["source_text", "source_sender", "source_channel", "counterparty", "account", "reference"]) {
          if (!expenseColumns.some((existing) => existing.name === column)) {
            await candidate.execAsync(`ALTER TABLE expenses ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
          }
        }
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
        if (/malformed|corrupt/i.test(String(error))) {
          await preserveDamagedDatabase();
          console.warn("MoneySync preserved a damaged wallet database and will restore its last snapshot");
        }
        if (attempt < 7) await wait(Math.min(250 * (attempt + 1), 1500));
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
        let item: ReviewEntry;
        try {
          item = JSON.parse(line) as ReviewEntry;
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
        if (item.duplicateOf) {
          await db.runAsync("INSERT OR IGNORE INTO duplicate_reviews (id, payload, status) VALUES (?, ?, ?)",
            item.id, JSON.stringify(item), ["same", "separate"].includes(item.reviewStatus || "") ? item.reviewStatus! : "pending");
          handled = true;
          continue;
        }
        // Native automatic imports share a canonical transaction ID across
        // channels. Never discard real payments merely for equal amount/time.
        // Database errors deliberately escape this function. The file is then
        // retained and retried instead of silently dropping a native entry.
        await db.runAsync(
          "INSERT OR IGNORE INTO expenses (id, description, amount, type, category, created_at, currency, source_text, source_sender, source_channel, counterparty, account, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          item.id,
          item.description.slice(0, 120),
          Number(item.amount),
          item.type,
          item.category || categorize(item.description, item.type),
          item.createdAt,
          (item.currency || "PKR").toUpperCase(),
          item.sourceText || "", item.sourceSender || "", item.sourceChannel || item.source || "",
          item.counterparty || "", item.account || "", item.reference || "",
        );
        handled = true;
      }
      await FileSystem.deleteAsync(uri, { idempotent: true });
      return handled;
    };

    let imported = false;
    if (importRecoverySnapshot) {
      imported = await processFile(recoveryUri);
      importRecoverySnapshot = false;
    }
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

function DonutChart({ categories, total, currency }: { categories: Array<{ name: string; value: number }>; total: number; currency: string }) {
  const leadingColor = categoryAccent(categories[0]?.name ?? "Other");
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
        <Text style={styles.donutValue}>{shortMoney(total, currency)}</Text>
        <Text style={styles.donutLabel}>THIS MONTH</Text>
        <Text style={[styles.donutShare, { color: leadingColor }]}>{leadingShare}% leading</Text>
      </View>
    </View>
  );
}

function KharchaApp() {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const systemColorScheme = useColorScheme();
  const systemTheme: ThemeMode = systemColorScheme === "dark" ? "dark" : "light";
  const [tab, setTab] = useState<Tab>("home");
  const [themeMode, setThemeMode] = useState<ThemeMode>(systemTheme);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  activeThemeDark = themeMode === "dark";
  const [baseCurrency, setBaseCurrency] = useState("PKR");
  const [currencyConfigured, setCurrencyConfigured] = useState(false);
  const [currencyPickerVisible, setCurrencyPickerVisible] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [currencyOptions, setCurrencyOptions] = useState(COMMON_CURRENCIES);
  const transactionCurrencyOptions = useMemo(() => [...currencyOptions, ...CRYPTO_CURRENCIES], [currencyOptions]);
  const [profileName, setProfileName] = useState("");
  const [profilePurpose, setProfilePurpose] = useState<ProfilePurpose>("Personal");
  const [openingBalance, setOpeningBalance] = useState("");
  const [settingsNameDraft, setSettingsNameDraft] = useState("");
  const [settingsPurposeDraft, setSettingsPurposeDraft] = useState<ProfilePurpose>("Personal");
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsCurrencyOpen, setSettingsCurrencyOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState("");
  const [accessFeedback, setAccessFeedback] = useState("");
  const [rateSnapshot, setRateSnapshot] = useState<RateSnapshot | null>(null);
  const rates = useMemo(() => rateSnapshot?.base === baseCurrency ? rateSnapshot.rates : { [baseCurrency]: 1 }, [baseCurrency, rateSnapshot]);
  const ratesUpdatedAt = rateSnapshot?.base === baseCurrency ? rateSnapshot.updatedAt : null;
  const rateRequestId = useRef(0);
  const [ratesUnavailable, setRatesUnavailable] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [duplicateReviews, setDuplicateReviews] = useState<ReviewEntry[]>([]);
  const reviewBusy = useRef(false);
  const [reviewSaving, setReviewSaving] = useState(false);
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
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCurrency, setEditCurrency] = useState("PKR");
  const [editType, setEditType] = useState<EntryType>("debit");
  const [editCategory, setEditCategory] = useState("Other");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [dailyRecapEnabled, setDailyRecapEnabled] = useState(false);
  const [recapChanging, setRecapChanging] = useState(false);
  const recapChangeInFlight = useRef(false);
  const [notificationAccessEnabled, setNotificationAccessEnabled] = useState(false);
  const [permissionsChecked, setPermissionsChecked] = useState(false);
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);
  const [playUpdateInfo, setPlayUpdateInfo] = useState<PlayUpdateInfo | null>(null);
  const [playUpdateState, setPlayUpdateState] = useState<PlayUpdateState | null>(null);
  const [playUpdateBusy, setPlayUpdateBusy] = useState(false);
  const updatePromptedVersion = useRef<number | null>(null);
  const downloadedPrompted = useRef(false);
  const descriptionRef = useRef<TextInput>(null);
  const amountRef = useRef<TextInput>(null);
  const pageScrollRef = useRef<ScrollView>(null);
  const activeTabRef = useRef<Tab>(tab);
  activeTabRef.current = tab;
  // Each tab visit owns its scroll animation. Late scroll events from the
  // previous native view must not collapse a newly opened Home header.
  const homeScrollY = useMemo(() => new Animated.Value(0), [tab]);
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

  const checkForPlayUpdate = useCallback(async (showCurrent = false) => {
    if (Platform.OS !== "android" || !NativeModules.MoneySyncUpdates?.checkForUpdate) return;
    setPlayUpdateBusy(true);
    try {
      const info = await NativeModules.MoneySyncUpdates.checkForUpdate() as PlayUpdateInfo;
      setPlayUpdateInfo(info);
      if (info.installStatus === "DOWNLOADING" || info.installStatus === "PENDING") {
        setPlayUpdateState((current) => current ?? { installStatus: info.installStatus, bytesDownloaded: 0, totalBytesToDownload: 0 });
      }
      if (info.installStatus === "DOWNLOADED") {
        setPlayUpdateState((current) => current ?? { installStatus: "DOWNLOADED", bytesDownloaded: 0, totalBytesToDownload: 0 });
        if (!downloadedPrompted.current) {
          downloadedPrompted.current = true;
          showDialog("Update ready to install", "MoneySync has downloaded the update. Restart now to finish installing it?", [
            { text: "Later", style: "cancel" },
            { text: "Restart now", onPress: async () => {
              try { await NativeModules.MoneySyncUpdates.completeUpdate(); }
              catch { showDialog("Couldn’t install update", "The downloaded update is safe. Please try again from Settings.", undefined, "warning"); }
            } },
          ], "success");
        }
        return;
      }
      if (info.available && (info.flexibleAllowed || info.immediateAllowed) && (showCurrent || updatePromptedVersion.current !== info.availableVersionCode)) {
        updatePromptedVersion.current = info.availableVersionCode;
        const flexible = info.flexibleAllowed;
        showDialog("MoneySync update available", flexible
          ? "A newer version is ready. Download it in the background while you keep using the app."
          : "A newer version is ready. Google Play will guide you through installing it now.", [
          { text: "Later", style: "cancel" },
          { text: "Update now", onPress: async () => {
            setPlayUpdateBusy(true);
            try {
              const started = await NativeModules.MoneySyncUpdates.startUpdate();
              if (!started) showDialog("Update unavailable", "Google Play could not start this update. Please try again later.", undefined, "warning");
            } catch {
              showDialog("Couldn’t start update", "Open this app from Google Play and try again. Updates are available only for Play-installed copies.", undefined, "warning");
            } finally { setPlayUpdateBusy(false); }
          } },
        ], "neutral");
      } else if (showCurrent && !info.available) {
        showDialog("You’re up to date", "You’re using the latest version of MoneySync available on Google Play.", undefined, "success");
      }
    } catch {
      if (showCurrent) showDialog("Couldn’t check for updates", "Connect to the internet and make sure MoneySync was installed from Google Play, then try again.", undefined, "warning");
    } finally {
      setPlayUpdateBusy(false);
    }
  }, [showDialog]);

  const completePlayUpdate = useCallback(async () => {
    try {
      await NativeModules.MoneySyncUpdates.completeUpdate();
    } catch {
      showDialog("Couldn’t install update", "The downloaded update is safe. Please try again from Settings.", undefined, "warning");
    }
  }, [showDialog]);

  const selectTab = useCallback((next: Tab) => {
    if (next === activeTabRef.current) {
      pageScrollRef.current?.scrollTo({ y: 0, animated: false });
      homeScrollY.setValue(0);
      return;
    }
    activeTabRef.current = next;
    setTab(next);
  }, [homeScrollY]);

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
      setThemePreference(next);
      shareNativeTheme(next).catch(() => undefined);
      getDb()
        .then((db) => db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "theme_mode", next))
        .catch(() => undefined);
      return next;
    });
  }, []);

  const selectThemePreference = useCallback(async (preference: ThemePreference) => {
    setThemePreference(preference);
    const resolved = preference === "system" ? systemTheme : preference;
    setThemeMode(resolved);
    await shareNativeTheme(preference);
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "theme_mode", preference);
  }, [systemTheme]);

  useEffect(() => {
    if (themePreference !== "system") return;
    setThemeMode(systemTheme);
    shareNativeTheme("system").catch(() => undefined);
  }, [systemTheme, themePreference]);

  const updateRates = useCallback(async (currency: string) => {
    const requestId = ++rateRequestId.current;
    try {
      const snapshot = await fetchRates(currency);
      if (requestId !== rateRequestId.current) return;
      setRateSnapshot(snapshot);
      setCurrencyOptions(currencyOptionsForRates(snapshot.rates));
      setRatesUnavailable(false);
    } catch {
      if (requestId !== rateRequestId.current) return;
      setRateSnapshot(null);
      setRatesUnavailable(true);
    }
  }, []);

  const chooseBaseCurrency = useCallback(async (currency: string) => {
    const next = currency.toUpperCase();
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "base_currency", next);
    await shareNativeCurrency(next).catch((error) => console.warn("Native currency preference will retry", error));
    setBaseCurrency(next);
    setCurrencyConfigured(true);
    setCurrencyPickerVisible(false);
    setCurrencySearch("");
    await updateRates(next);
  }, [updateRates]);

  const saveProfile = useCallback(async () => {
    const name = profileName.trim();
    if (!name) throw new Error("Enter your name to continue.");
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "profile_name", name);
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "profile_purpose", profilePurpose);
    setProfileName(name);
  }, [profileName, profilePurpose]);

  const finishOnboarding = useCallback(async () => {
    if (onboardingSaving) return;
    setOnboardingSaving(true);
    setOnboardingError("");
    try {
      if (!currencyConfigured) throw new Error("Choose your base currency to continue.");
      await saveProfile();
      const db = await getDb();
      const normalizedOpeningBalance = openingBalance.trim().replace(/,/g, "");
      const openingAmount = normalizedOpeningBalance ? Number(normalizedOpeningBalance) : 0;
      if (normalizedOpeningBalance && (!Number.isFinite(openingAmount) || openingAmount < 0)) {
        throw new Error("Enter a valid starting balance, or leave it blank to skip.");
      }
      if (openingAmount > 0) {
        const openingCreatedAt = new Date().toISOString();
        await db.runAsync(
          "INSERT OR IGNORE INTO expenses (id, description, amount, type, category, created_at, currency) VALUES (?, ?, ?, ?, ?, ?, ?)",
          "opening-balance-initial",
          "Opening balance",
          openingAmount,
          "credit",
          "Other",
          openingCreatedAt,
          baseCurrency,
        );
        await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "opening_balance", String(openingAmount));
        setExpenses((items) => items.some((item) => item.id === "opening-balance-initial") ? items : [{
          id: "opening-balance-initial",
          description: "Opening balance",
          amount: openingAmount,
          type: "credit",
          category: "Other",
          createdAt: openingCreatedAt,
          currency: baseCurrency,
          sourceText: "",
          sourceSender: "",
          sourceChannel: "manual",
        }, ...items]);
      }
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ONBOARDING_KEY, "yes");
      setOnboardingVisible(false);
    } catch (error) {
      setOnboardingError(error instanceof Error ? error.message : "Couldn’t save setup. Please try again.");
    } finally {
      setOnboardingSaving(false);
    }
  }, [baseCurrency, currencyConfigured, onboardingSaving, openingBalance, saveProfile]);

  const openSettings = () => {
    setSettingsNameDraft(profileName);
    setSettingsPurposeDraft(profilePurpose);
    setProfileFeedback("");
    setAccessFeedback("");
    setSettingsCurrencyOpen(false);
    setCurrencySearch("");
    setSettingsVisible(true);
  };

  const saveSettingsProfile = async () => {
    const name = settingsNameDraft.trim();
    if (!name) {
      setProfileFeedback("Enter your name before saving.");
      return;
    }
    setProfileSaving(true);
    setProfileFeedback("");
    try {
      const db = await getDb();
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "profile_name", name);
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", "profile_purpose", settingsPurposeDraft);
      setProfileName(name);
      setProfilePurpose(settingsPurposeDraft);
      setSettingsNameDraft(name);
      setProfileFeedback("Profile saved on this device.");
    } catch {
      setProfileFeedback("Couldn’t save your profile. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  };

  const loadExpenses = useCallback(async () => {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: string;
      description: string;
      amount: number;
      type: EntryType;
      category: string;
      created_at: string;
      currency: string;
      source_text: string; source_sender: string; source_channel: string;
      counterparty: string; account: string; reference: string;
    }>("SELECT * FROM expenses ORDER BY created_at DESC");
    const next = rows.map((row) => ({ ...row, currency: row.currency || "PKR", createdAt: row.created_at,
      sourceText: row.source_text, sourceSender: row.source_sender, sourceChannel: row.source_channel }));
    const reviews = await db.getAllAsync<{ payload: string }>("SELECT payload FROM duplicate_reviews WHERE status = 'pending' ORDER BY rowid DESC");
    setDuplicateReviews(reviews.map((row) => {
      const item = JSON.parse(row.payload) as ReviewEntry;
      return { ...item, currency: item.currency || "PKR" };
    }));
    await writeRecoverySnapshot(next).catch((error) => console.warn("MoneySync snapshot will retry", error));
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
          && item.currency === next[index]?.currency
        )
      ) return current;
      return next;
    });
  }, []);

  const resolveDuplicate = async (entry: ReviewEntry, decision: "same" | "separate") => {
    if (reviewBusy.current) return;
    reviewBusy.current = true;
    setReviewSaving(true);
    try {
      const db = await getDb();
      await db.withExclusiveTransactionAsync(async (tx) => {
        const row = await tx.getFirstAsync<{ status: string }>("SELECT status FROM duplicate_reviews WHERE id = ?", entry.id);
        if (row?.status !== "pending") return;
        if (decision === "separate") {
          await tx.runAsync("INSERT OR IGNORE INTO expenses (id, description, amount, type, category, created_at, currency, source_text, source_sender, source_channel, counterparty, account, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            entry.id, entry.description, entry.amount, entry.type, entry.category || categorize(entry.description, entry.type), entry.createdAt, entry.currency || "PKR",
            entry.sourceText || "", entry.sourceSender || "", entry.sourceChannel || entry.source || "",
            entry.counterparty || "", entry.account || "", entry.reference || "");
        }
        await tx.runAsync("UPDATE duplicate_reviews SET status = ? WHERE id = ?", decision, entry.id);
      });
      await loadExpenses();
    } catch {
      showDialog("Couldn’t save your choice", "Please try again. The alert remains available for review.", undefined, "warning");
    } finally {
      reviewBusy.current = false;
      setReviewSaving(false);
    }
  };

  const syncAndLoadExpenses = useCallback(async () => {
    if (syncLoadInFlight) return syncLoadInFlight;
    syncLoadInFlight = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          try {
            await syncNativeEntries();
          } catch (error) {
            // The recovery and pending files stay on disk. Loading the wallet
            // can still succeed, and another pass will retry the native import.
            console.warn("MoneySync native sync will retry", error);
          }
          await loadExpenses();
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 4) await wait(300 * (attempt + 1));
        }
      }
      throw lastError;
    })().finally(() => {
      syncLoadInFlight = null;
    });
    return syncLoadInFlight;
  }, [loadExpenses]);

  const upgradeSmartCategories = useCallback(async () => {
    const db = await getDb();
    const marker = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      "smart_categories_v2",
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
      "smart_categories_v2",
      "complete",
    );
  }, []);

  const refreshRuntimePermissionStates = useCallback(async () => {
    if (Platform.OS !== "android") return;
    const [sms, notifications, listener, scheduled] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS).catch(() => false),
      Notifications.getPermissionsAsync().catch(() => null),
      NativeModules.MoneySyncPermissions.hasNotificationAccess().catch(() => false),
      Notifications.getAllScheduledNotificationsAsync().catch(() => []),
    ]);
    setSmsEnabled(sms);
    setNotificationsEnabled(notifications?.status === "granted");
    setDailyRecapEnabled(notifications?.status === "granted" && scheduled.some((item) => item.identifier === "kharcha-daily"));
    setNotificationAccessEnabled(listener === true);
    setPermissionsChecked(true);
  }, []);

  useEffect(() => {
    getDb()
      .then((db) => db.getFirstAsync<{ value: ThemeMode }>("SELECT value FROM settings WHERE key = ?", "theme_mode"))
      .then((saved) => {
        if (saved?.value === "dark" || saved?.value === "light") {
          setThemePreference(saved.value);
          setThemeMode(saved.value);
          shareNativeTheme(saved.value).catch(() => undefined);
        } else {
          setThemePreference("system");
          setThemeMode(systemTheme);
          shareNativeTheme("system").catch(() => undefined);
        }
      })
      .catch(() => undefined);

    getDb()
      .then(async (db) => {
        const [saved, name, purpose, completed] = await Promise.all([
          db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", "base_currency"),
          db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", "profile_name"),
          db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", "profile_purpose"),
          db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", ONBOARDING_KEY),
        ]);
        setProfileName(name?.value ?? "");
        if (purpose?.value === "Business" || purpose?.value === "Both") setProfilePurpose(purpose.value);
        const currency = saved?.value?.toUpperCase();
        if (currency && /^[A-Z]{3}$/.test(currency)) {
          setBaseCurrency(currency);
          setCurrencyConfigured(true);
          shareNativeCurrency(currency).catch(() => undefined);
          updateRates(currency).catch(() => undefined);
        } else {
          setCurrencyConfigured(false);
          fetchRates("USD").then((snapshot) => {
            setCurrencyOptions(currencyOptionsForRates(snapshot.rates));
          }).catch(() => undefined);
        }
        if (completed?.value !== "yes") setOnboardingVisible(true);
      })
      .catch((error) => console.warn("MoneySync setup will retry", error));

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
  }, [showDialog, syncAndLoadExpenses, updateRates, upgradeSmartCategories]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncAndLoadExpenses().catch(() => undefined);
        refreshRuntimePermissionStates().catch(() => undefined);
        checkForPlayUpdate(false).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [checkForPlayUpdate, refreshRuntimePermissionStates, syncAndLoadExpenses]);

  useEffect(() => {
    if (Platform.OS !== "android" || loading || onboardingVisible) return;
    const timer = setTimeout(() => checkForPlayUpdate(false).catch(() => undefined), 1800);
    const statusSub = DeviceEventEmitter.addListener("MoneySyncUpdateStatus", (status: PlayUpdateState) => {
      setPlayUpdateState(status);
      if (status.installStatus === "DOWNLOADED" && !downloadedPrompted.current) {
        downloadedPrompted.current = true;
        showDialog("Update ready to install", "MoneySync has downloaded the update. Restart now to finish installing it?", [
          { text: "Later", style: "cancel" },
          { text: "Restart now", onPress: completePlayUpdate },
        ], "success");
      } else if (status.installStatus === "FAILED") {
        showDialog("Update couldn’t download", "Google Play could not finish downloading the update. You can try again from Settings.", undefined, "warning");
      }
    });
    return () => {
      clearTimeout(timer);
      statusSub.remove();
    };
  }, [checkForPlayUpdate, completePlayUpdate, loading, onboardingVisible, showDialog]);

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
      "On the next screen, turn on notification access for MoneySync. It will detect supported-currency debit and credit alerts from Gmail, Messages, banking and wallet apps without storing the full notification text.",
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
      setDailyRecapEnabled(true);
      showDialog("Daily recap is on", "We’ll remind you at 8:30 PM each evening.", undefined, "success");
    } else {
      showDialog("Notifications are off", "Allow notifications in Android Settings to receive daily recaps.", [
        { text: "Later", style: "cancel" },
        { text: "Open settings", onPress: () => Linking.openSettings() },
      ], "warning");
    }
  };

  const toggleDailyReports = async () => {
    if (recapChangeInFlight.current) return;
    recapChangeInFlight.current = true;
    setRecapChanging(true);
    try {
      if (dailyRecapEnabled) {
        await Notifications.cancelScheduledNotificationAsync("kharcha-daily");
        setDailyRecapEnabled(false);
      } else {
        await requestDailyReports();
      }
    } catch {
      showDialog("Couldn’t update recap", "Please try again. Your other notification settings have not been changed.", undefined, "warning");
    } finally {
      recapChangeInFlight.current = false;
      setRecapChanging(false);
    }
  };

  const requestSetupSmsAccess = async () => {
    if (Platform.OS !== "android") return;
    setAccessFeedback("");
    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, {
        title: "Allow financial SMS capture",
        message: "MoneySync checks new SMS messages for debit and credit alerts on this device. Unrelated messages and OTPs are ignored.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      });
      setSmsEnabled(result === PermissionsAndroid.RESULTS.GRANTED);
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        setAccessFeedback("Android blocked another SMS prompt. Allow SMS in MoneySync's app settings.");
        await Linking.openSettings();
      }
    } catch {
      setAccessFeedback("Couldn’t request SMS access. Try again from Settings.");
    }
  };

  const requestSetupNotifications = async () => {
    setAccessFeedback("");
    try {
      await ensureNotificationChannel();
      const current = await Notifications.getPermissionsAsync();
      if (current.status !== "granted" && !current.canAskAgain) {
        setAccessFeedback("Allow MoneySync notifications in Android settings.");
        await Linking.openSettings();
        return;
      }
      const result = await Notifications.requestPermissionsAsync();
      setNotificationsEnabled(result.status === "granted");
      if (result.status !== "granted") setAccessFeedback("Notifications are off. You can enable them later in Settings.");
    } catch {
      setAccessFeedback("Couldn’t request notifications. Try again from Settings.");
    }
  };

  const openAlertAccessSettings = async () => {
    setAccessFeedback("Turn on MoneySync notification access, then return here. The status will update automatically.");
    try {
      await Linking.sendIntent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
    } catch {
      await Linking.openSettings();
    }
  };

  const amountInBase = useCallback((item: Expense) => {
    const source = (item.currency || "PKR").toUpperCase();
    if (source === baseCurrency) return item.amount;
    const sourcePerBase = rates[source];
    return Number.isFinite(sourcePerBase) && sourcePerBase > 0 ? item.amount / sourcePerBase : 0;
  }, [baseCurrency, rates]);

  const transactionDisplay = (item: Expense) => {
    const originalCurrency = (item.currency || "PKR").toUpperCase();
    if (!currencyOptions.includes(originalCurrency) && !isCryptoCurrency(originalCurrency)) return {
      amount: `${baseCurrency} —`, original: "Currency needs review · amount preserved", converted: null,
    };
    if (originalCurrency === baseCurrency) return { amount: money(item.amount, baseCurrency, true), original: "", converted: item.amount };
    const original = `Original: ${money(item.amount, originalCurrency, true)}`;
    if (!(rates[originalCurrency] > 0)) return {
      amount: isCryptoCurrency(originalCurrency) ? money(item.amount, originalCurrency, true) : `${baseCurrency} —`,
      original: isCryptoCurrency(originalCurrency) ? "Crypto amount · no fiat conversion" : original,
      converted: null,
    };
    return {
      amount: `≈ ${money(amountInBase(item), baseCurrency, true)}`,
      original,
      converted: amountInBase(item),
    };
  };

  const unconvertedCurrencies = useMemo(() => [...new Set(expenses
    .map((item) => (item.currency || "PKR").toUpperCase())
    .filter((currency) => (currencyOptions.includes(currency) || isCryptoCurrency(currency))
      && currency !== baseCurrency && !(rates[currency] > 0)))], [baseCurrency, expenses, rates, currencyOptions]);
  const invalidCurrencyCount = useMemo(() => expenses.filter((item) =>
    !currencyOptions.includes((item.currency || "PKR").toUpperCase())
      && !isCryptoCurrency(item.currency || "PKR")).length, [expenses, currencyOptions]);
  const visibleCurrencies = useMemo(() => currencyOptions.filter((currency) =>
    !currencySearch.trim() || currency.includes(currencySearch.trim().toUpperCase())), [currencyOptions, currencySearch]);

  const currentMonth = useMemo(() => {
    const now = new Date();
    return expenses.filter((item) => {
      const date = new Date(item.createdAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
  }, [expenses]);

  const totals = useMemo(() => {
    const credits = currentMonth.filter((item) => item.type === "credit").reduce((sum, item) => sum + amountInBase(item), 0);
    const debits = currentMonth.filter((item) => item.type === "debit").reduce((sum, item) => sum + amountInBase(item), 0);
    return { credits, debits, balance: credits - debits };
  }, [amountInBase, currentMonth]);

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
    const credits = overviewExpenses.filter((item) => item.type === "credit").reduce((sum, item) => sum + amountInBase(item), 0);
    const debits = overviewExpenses.filter((item) => item.type === "debit").reduce((sum, item) => sum + amountInBase(item), 0);
    return { credits, debits, balance: credits - debits };
  }, [amountInBase, overviewExpenses]);

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
    currentMonth.filter((item) => item.type === "debit").forEach((item) => values.set(item.category, (values.get(item.category) ?? 0) + amountInBase(item)));
    return [...values.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [amountInBase, currentMonth]);

  const todayTotal = useMemo(() => {
    const today = new Date().toDateString();
    return expenses
      .filter((item) => item.type === "debit" && new Date(item.createdAt).toDateString() === today)
      .reduce((sum, item) => sum + amountInBase(item), 0);
  }, [amountInBase, expenses]);

  const lastSevenDays = useMemo(() => {
    const result: Array<{ key: string; label: string; value: number }> = [];
    const now = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = day.toDateString();
      const value = expenses
        .filter((item) => item.type === "debit" && new Date(item.createdAt).toDateString() === key)
        .reduce((sum, item) => sum + amountInBase(item), 0);
      result.push({
        key,
        label: day.toLocaleDateString("en-PK", { weekday: "short" }).slice(0, 2),
        value,
      });
    }
    return result;
  }, [amountInBase, expenses]);

  const monthlyWeeks = useMemo(() => {
    const result = [0, 0, 0, 0, 0];
    currentMonth
      .filter((item) => item.type === "debit")
      .forEach((item) => {
        const week = Math.min(4, Math.floor((new Date(item.createdAt).getDate() - 1) / 7));
        result[week] += amountInBase(item);
      });
    return result.map((value, index) => ({ label: `W${index + 1}`, value }));
  }, [amountInBase, currentMonth]);

  const insightMetrics = useMemo(() => {
    const debits = currentMonth.filter((item) => item.type === "debit");
    const activeDays = new Set(debits.map((item) => new Date(item.createdAt).toDateString())).size;
    const largest = debits.reduce((max, item) => Math.max(max, amountInBase(item)), 0);
    const elapsedDays = Math.max(1, new Date().getDate());
    const savingsRate = totals.credits > 0 ? ((totals.credits - totals.debits) / totals.credits) * 100 : 0;
    return {
      average: totals.debits / elapsedDays,
      largest,
      activeDays,
      savingsRate,
    };
  }, [amountInBase, currentMonth, totals]);

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
    const credits = filteredExpenses.filter((item) => item.type === "credit").reduce((sum, item) => sum + amountInBase(item), 0);
    const debits = filteredExpenses.filter((item) => item.type === "debit").reduce((sum, item) => sum + amountInBase(item), 0);
    return { credits, debits };
  }, [amountInBase, filteredExpenses]);

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
      currency: baseCurrency,
    };
    try {
      const db = await getDb();
      await db.runAsync(
        "INSERT INTO expenses (id, description, amount, type, category, created_at, currency) VALUES (?, ?, ?, ?, ?, ?, ?)",
        entry.id,
        entry.description,
        entry.amount,
        entry.type,
        entry.category,
        entry.createdAt,
        entry.currency,
      );
      await snapshotDatabase(db).catch((error) => console.warn("MoneySync snapshot will retry", error));
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
            await snapshotDatabase(db).catch((error) => console.warn("MoneySync snapshot will retry", error));
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
    const savedCurrency = (entry.currency || baseCurrency).toUpperCase();
    setEditCurrency(currencyOptions.includes(savedCurrency) || isCryptoCurrency(savedCurrency) ? savedCurrency : baseCurrency);
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
      currency: editCurrency,
      type: editType,
      category: editType === "credit" ? "Income" : editCategory,
    };
    try {
      const db = await getDb();
      await db.runAsync(
        "UPDATE expenses SET description = ?, amount = ?, currency = ?, type = ?, category = ? WHERE id = ?",
        updated.description,
        updated.amount,
        updated.currency,
        updated.type,
        updated.category,
        updated.id,
      );
      await snapshotDatabase(db).catch((error) => console.warn("MoneySync snapshot will retry", error));
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
      ["Date", "Description", "Category", "Type", "Amount", "Currency", "Original Amount", "Original Currency"],
      ...expenses.map((item) => {
        const display = transactionDisplay(item);
        return [
          item.createdAt,
          `${item.description}${display.original ? ` · ${display.original}` : ""}`,
          item.category,
          item.type,
          display.converted === null ? "" : display.converted.toFixed(currencyDigits(baseCurrency)),
          baseCurrency,
          String(item.amount),
          item.currency || "PKR",
        ];
      }),
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
    const display = transactionDisplay(item);
    return (
      <Pressable key={item.id} onPress={() => setDetailExpense(item)} onLongPress={() => removeEntry(item)} style={styles.transaction}>
        <View style={[styles.transactionIcon, { backgroundColor: `${categoryAccent(item.category)}28` }]}>
          <Ionicons name={meta.icon} color={categoryAccent(item.category)} size={19} />
        </View>
        <View style={styles.transactionText}>
          <Text numberOfLines={1} style={styles.transactionTitle}>{item.description}</Text>
          {display.original ? <Text style={styles.transactionOriginal}>{display.original}</Text> : null}
          <Text style={styles.transactionMeta}>{item.category} · {entryDateTime(item.createdAt)}</Text>
        </View>
        <Text style={[styles.transactionAmount, item.type === "credit" && styles.creditAmount]}>
          {item.type === "credit" ? "+" : "−"} {display.amount}
        </Text>
      </Pressable>
    );
  };

  const missingPermissions = [
    ...(!smsEnabled ? [{ label: "Enable SMS", action: requestSmsAccess }] : []),
    ...(!notificationsEnabled ? [{ label: "Enable notifications", action: requestDailyReports }] : []),
    ...(!notificationAccessEnabled ? [{ label: "Enable alert access", action: requestGmailAccess }] : []),
  ];
  const permissionBanner = Platform.OS === "android" && permissionsChecked && missingPermissions.length > 0 ? (
    <View accessibilityLiveRegion="polite" style={{ padding: 14, marginBottom: 18, borderRadius: 16, borderWidth: 1, borderColor: themeMode === "dark" ? "#6B5779" : "#BDD8CF", backgroundColor: themeMode === "dark" ? "#362B41" : "#DCEDE7" }}>
      <Text style={{ color: themeMode === "dark" ? "#F4F5F2" : "#111111", fontSize: 14, fontWeight: "800" }}>Permission needed</Text>
      <Text style={{ color: themeMode === "dark" ? "#D9CBDF" : "#496057", fontSize: 12, lineHeight: 18, marginTop: 4 }}>Give access to capture money alerts and receive recaps. Manual entry still works.</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {missingPermissions.map(({ label, action }) => (
          <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={action} style={{ minHeight: 44, paddingHorizontal: 13, paddingVertical: 10, justifyContent: "center", borderRadius: 11, backgroundColor: themeMode === "dark" ? "#CDB1E2" : "#111111" }}>
            <Text style={{ color: themeMode === "dark" ? "#291D32" : "#FFFFFF", fontSize: 12, fontWeight: "700" }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  const setupInk = themeMode === "dark" ? "#F8F4FA" : COLORS.ink;
  const setupMuted = themeMode === "dark" ? "#C1B7C6" : COLORS.muted;
  const setupSurface = themeMode === "dark" ? "#211D27" : COLORS.paper;
  const setupLine = themeMode === "dark" ? "#494150" : COLORS.line;
  const setupInput = themeMode === "dark" ? "#2D2833" : "#F7F5F1";
  const setupBackdrop = themeMode === "dark" ? "#100E15" : COLORS.cream;
  const purposeChoices: ProfilePurpose[] = ["Personal", "Business", "Both"];
  const renderPurposeChoices = (selected: ProfilePurpose, onSelect: (purpose: ProfilePurpose) => void) => (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 9 }}>
      {purposeChoices.map((purpose) => (
        <Pressable key={purpose} accessibilityRole="button" onPress={() => onSelect(purpose)} style={{ flex: 1, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: selected === purpose ? (themeMode === "dark" ? "#BA9CD0" : COLORS.green) : setupLine, backgroundColor: selected === purpose ? (themeMode === "dark" ? "#463453" : "#DCEDE7") : setupInput, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: setupInk, fontSize: 12, fontWeight: "800" }}>{purpose}</Text>
        </Pressable>
      ))}
    </View>
  );
  const renderCurrencyChoices = (onSelect: (currency: string) => void) => (
    <>
      <TextInput value={currencySearch} onChangeText={setCurrencySearch} autoCapitalize="characters" placeholder="Search a currency, e.g. USD" placeholderTextColor={setupMuted} style={{ height: 52, borderRadius: 14, backgroundColor: setupInput, borderColor: setupLine, borderWidth: 1, paddingHorizontal: 15, color: setupInk, fontSize: 15, marginTop: 12 }} />
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 226, marginTop: 6 }}>
        {visibleCurrencies.map((currency) => (
          <Pressable key={currency} accessibilityRole="button" accessibilityLabel={`Choose ${currency}`} onPress={() => onSelect(currency)} style={{ flexDirection: "row", alignItems: "center", minHeight: 46, paddingHorizontal: 12, marginTop: 5, borderRadius: 12, borderWidth: 1, borderColor: currency === baseCurrency && currencyConfigured ? (themeMode === "dark" ? "#BA9CD0" : COLORS.green) : setupLine, backgroundColor: currency === baseCurrency && currencyConfigured ? (themeMode === "dark" ? "#463453" : "#DCEDE7") : setupSurface }}>
            <Text style={{ flex: 1, color: setupInk, fontSize: 14, fontWeight: "700" }}>{currency}</Text>
            {currency === baseCurrency && currencyConfigured && <Ionicons name="checkmark-circle" color={COLORS.green} size={20} />}
          </Pressable>
        ))}
        {visibleCurrencies.length === 0 && <Text style={{ color: setupMuted, marginTop: 12 }}>No matching currency.</Text>}
      </ScrollView>
    </>
  );
  const renderAccessRow = (label: string, detail: string, enabled: boolean, action: () => void | Promise<void>) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: setupLine, backgroundColor: setupSurface, padding: 13, marginTop: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: setupInk, fontSize: 14, fontWeight: "800" }}>{label}</Text>
        <Text style={{ color: setupMuted, fontSize: 11, lineHeight: 16, marginTop: 3 }}>{detail}</Text>
        <Text style={{ color: enabled ? COLORS.green : COLORS.gold, fontSize: 11, fontWeight: "800", marginTop: 6 }}>{enabled ? "Access on" : "Access off"}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${enabled ? "Manage" : "Enable"} ${label}`} onPress={() => { Promise.resolve(action()).catch(() => setAccessFeedback("Couldn’t open permission settings.")); }} style={{ minWidth: 68, minHeight: 42, paddingHorizontal: 10, borderRadius: 11, justifyContent: "center", alignItems: "center", backgroundColor: enabled ? setupInput : COLORS.ink, borderWidth: enabled ? 1 : 0, borderColor: setupLine }}>
        <Text style={{ color: enabled ? setupInk : "#FFFFFF", fontSize: 11, fontWeight: "800" }}>{enabled ? "Manage" : "Enable"}</Text>
      </Pressable>
    </View>
  );
  const accessRows = Platform.OS === "android" ? (
    <>
      {renderAccessRow("Financial SMS", "Detect eligible debit and credit SMS on this device.", smsEnabled, smsEnabled ? () => Linking.openSettings() : requestSetupSmsAccess)}
      {renderAccessRow("Money alerts", "Read eligible banking, wallet, Messages and Gmail notifications.", notificationAccessEnabled, openAlertAccessSettings)}
      {renderAccessRow("App notifications", "Allow MoneySync to deliver its own reminders and status alerts.", notificationsEnabled, notificationsEnabled ? () => Linking.openSettings() : requestSetupNotifications)}
    </>
  ) : null;

  return (
    <SafeAreaView style={[styles.safe, tab === "home" && styles.homeSafe]} edges={["top", "left", "right"]}>
      <StatusBar style={themeMode === "dark" ? "light" : "dark"} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
        {...tabSwipeResponder.panHandlers}
      >
        <MotionView enterKey={tab} fromY={10} style={styles.flex}>
        <Animated.ScrollView
          key={tab}
          ref={pageScrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 90 + Math.max(insets.bottom, 14) },
            tab === "home" && styles.homeScroll,
          ]}
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
                  <Text style={styles.tagline}>{profilePurpose === "Business" ? "BUSINESS FINANCE" : profilePurpose === "Both" ? "PERSONAL + BUSINESS" : "PERSONAL FINANCE"}</Text>
                </View>
              </View>
              <View style={styles.headerActions}>
                <Pressable onPress={toggleTheme} style={styles.headerButton}><Ionicons name={themeMode === "dark" ? "sunny-outline" : "moon-outline"} size={19} color={themeMode === "dark" ? "#F4F5F2" : COLORS.ink} /></Pressable>
                <Pressable onPress={toggleDailyReports} style={styles.headerButton}><Ionicons name="notifications-outline" size={19} color={themeMode === "dark" ? "#F4F5F2" : COLORS.ink} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={openSettings} style={styles.headerButton}><Ionicons name="settings-outline" size={20} color={themeMode === "dark" ? "#F4F5F2" : COLORS.ink} /></Pressable>
              </View>
            </View>
          )}

          {tab !== "home" && permissionBanner}
          {tab === "home" && (
            <>
              <View style={styles.homeSheet}>
                {permissionBanner}
                {invalidCurrencyCount > 0 && <Pressable style={styles.dateFilterCard} onPress={() => selectTab("activity")}>
                  <Text style={styles.dateFilterTitle}>Review {invalidCurrencyCount} transaction {invalidCurrencyCount === 1 ? "currency" : "currencies"}</Text>
                  <Text style={styles.subtitle}>Some older entries have unrecognized currency labels. Their amounts are preserved and excluded from totals until you edit the entry and select its currency.</Text>
                </Pressable>}
                {(ratesUnavailable || unconvertedCurrencies.length > 0) && <Pressable style={styles.dateFilterCard} onPress={() => updateRates(baseCurrency)}>
                  <Text style={styles.dateFilterTitle}>Currency conversion needs attention</Text>
                  <Text style={styles.subtitle}>{ratesUnavailable
                    ? `Couldn’t refresh ${baseCurrency} rates. Tap to retry; cached rates are used when available.`
                    : `${unconvertedCurrencies.join(", ")} ${unconvertedCurrencies.length === 1 ? "has" : "have"} no rate. Original amounts remain in descriptions; converted totals exclude them.`}</Text>
                </Pressable>}
                {duplicateReviews.length > 0 && <Pressable style={styles.dateFilterCard} onPress={() => selectTab("activity")}>
                  <Text style={styles.dateFilterTitle}>{duplicateReviews.length} possible duplicate{duplicateReviews.length === 1 ? "" : "s"}</Text>
                  <Text style={styles.subtitle}>Not included in totals · Tap to review</Text>
                </Pressable>}
                <View style={styles.quickHeader}>
                  <View style={styles.quickHeading}>
                    <Text style={styles.quickTitle}>Quick add</Text>
                    <Text style={styles.quickSubtitle}>A transaction in two taps</Text>
                  </View>
                  <View style={styles.todayMiniBadge}>
                    <Text style={styles.todayMiniLabel}>TODAY</Text>
                    <Text style={styles.todayMiniValue}>{shortMoney(todayTotal, baseCurrency)}</Text>
                  </View>
                </View>
                <View style={styles.typeToggle}>
                  <Pressable onPress={() => setEntryType("debit")} style={[styles.typeButton, entryType === "debit" && styles.typeButtonDebit]}>
                    <Ionicons name="arrow-up-outline" size={17} color={entryType === "debit" ? (themeMode === "dark" ? "#241A2C" : "#FFF") : (themeMode === "dark" ? "#C3B9C8" : "#77736F")} />
                    <Text style={[styles.typeText, entryType === "debit" && styles.typeTextSelected]}>Expense</Text>
                  </Pressable>
                  <Pressable onPress={() => setEntryType("credit")} style={[styles.typeButton, entryType === "credit" && styles.typeButtonCredit]}>
                    <Ionicons name="arrow-down-outline" size={17} color={entryType === "credit" ? "#241A2C" : (themeMode === "dark" ? "#C3B9C8" : "#77736F")} />
                    <Text style={[styles.typeText, entryType === "credit" && styles.typeTextSelected, entryType === "credit" && styles.typeTextCreditSelected]}>Income</Text>
                  </Pressable>
                </View>
                <View style={styles.descriptionWrap}>
                  <Ionicons name="create-outline" size={19} color={themeMode === "dark" ? "#C8BDD0" : "#706B67"} />
                  <TextInput
                    ref={descriptionRef}
                    value={description}
                    onChangeText={setDescription}
                    onSubmitEditing={() => amountRef.current?.focus()}
                    returnKeyType="next"
                    placeholder="e.g. Lunch, fuel or rent"
                    placeholderTextColor={themeMode === "dark" ? "#AFA5B6" : "#9A9590"}
                    style={styles.descriptionInput}
                  />
                </View>
                <View style={styles.amountRow}>
                  <View style={styles.amountInputWrap}>
                    <View style={styles.currencyBadge}><Text style={styles.currency}>{baseCurrency}</Text></View>
                    <TextInput
                      ref={amountRef}
                      value={amount}
                      onChangeText={setAmount}
                      onSubmitEditing={addEntry}
                      returnKeyType="done"
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={themeMode === "dark" ? "#AFA5B6" : "#9A9590"}
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
                        <View style={[styles.homeCategoryIcon, themeMode === "dark" && { backgroundColor: `${categoryAccent(item.name)}55` }]}>
                          <Ionicons name={meta.icon} size={20} color={themeMode === "dark" ? "#FFFFFF" : "#111111"} />
                        </View>
                        <Text numberOfLines={1} style={styles.homeCategoryName}>{item.name}</Text>
                        <Text numberOfLines={1} style={styles.homeCategoryValue}>{shortMoney(item.value, baseCurrency)}</Text>
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={styles.homeSectionTop}>
                  <View>
                    <Text style={styles.homeSectionTitle}>Recent activity</Text>
                    <Text style={styles.homeSectionCaption}>Tap an entry for full details</Text>
                  </View>
                  <Pressable onPress={() => setTab("activity")}><Ionicons name="arrow-forward" size={18} color={themeMode === "dark" ? "#E8DAF3" : "#111"} /></Pressable>
                </View>
                <View style={styles.homeList}>
                  {expenses.slice(0, 5).map((item) => {
                    const meta = categoryMeta[item.category] ?? categoryMeta.Other;
                    const display = transactionDisplay(item);
                    return (
                      <Pressable key={item.id} onPress={() => setDetailExpense(item)} onLongPress={() => removeEntry(item)} style={styles.homeTransaction}>
                        <View style={[styles.homeTransactionIcon, { backgroundColor: `${categoryAccent(item.category)}28` }]}><Ionicons name={meta.icon} color={categoryAccent(item.category)} size={18} /></View>
                        <View style={styles.transactionText}>
                          <Text numberOfLines={1} style={styles.homeTransactionTitle}>{item.description}</Text>
                          {display.original ? <Text style={styles.homeTransactionOriginal}>{display.original}</Text> : null}
                          <Text style={styles.homeTransactionMeta}>{item.category} · {entryDateTime(item.createdAt)}</Text>
                        </View>
                        <Text style={[styles.homeTransactionAmount, item.type === "credit" && styles.homeCreditAmount]}>{item.type === "credit" ? "+" : "−"} {display.amount}</Text>
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
                <Text style={styles.eyebrow}>EVERY TRANSACTION, REMEMBERED</Text>
                <Text style={styles.pageTitle}>Transactions</Text>
                <Text style={styles.subtitle}>Tap for details · Long-press to remove.</Text>
              </View>
              {duplicateReviews.length > 0 && <View style={styles.dateFilterCard}>
                <Text style={styles.dateFilterTitle}>Possible duplicates</Text>
                <Text style={styles.subtitle}>These alerts are not included in totals. Compare them before deciding.</Text>
                {duplicateReviews.map((entry) => {
                  const original = expenses.find((item) => item.id === entry.duplicateOf);
                  const display = transactionDisplay(entry);
                  const recordedDisplay = original ? transactionDisplay(original) : null;
                  return <View key={entry.id} style={{ marginTop: 18, gap: 8 }}>
                    <Text style={styles.dateFilterTitle}>{display.amount} · {entry.type === "credit" ? "Money in" : "Money out"}</Text>
                    <Text style={styles.subtitle}>{entry.description}{display.original ? ` · ${display.original}` : ""}{"\n"}{entry.source === "sms" ? "SMS" : entry.source?.replace("notification:", "") || "Notification"} · {new Date(entry.createdAt).toLocaleString("en-PK")}</Text>
                    <Text style={styles.subtitle}>Already recorded: {original ? `${original.description}${recordedDisplay?.original ? ` · ${recordedDisplay.original}` : ""} · ${recordedDisplay?.amount} · ${new Date(original.createdAt).toLocaleString("en-PK")}` : "Original entry no longer available"}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable disabled={reviewSaving} style={styles.appDialogButton} onPress={() => showDialog("Same payment?", "Keep the recorded payment and dismiss this extra alert. It will not increase your totals.", [{ text: "Cancel", style: "cancel" }, { text: "Same payment", onPress: () => resolveDuplicate(entry, "same") }])}>
                        <Text style={styles.appDialogButtonText}>Same payment</Text>
                      </Pressable>
                      <Pressable disabled={reviewSaving} style={[styles.appDialogButton, styles.appDialogButtonCancel]} onPress={() => resolveDuplicate(entry, "separate")}>
                        <Text style={[styles.appDialogButtonText, styles.appDialogButtonTextCancel]}>Separate payment</Text>
                      </Pressable>
                    </View>
                  </View>;
                })}
              </View>}
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
                    <Ionicons name="calendar-outline" size={13} color={dateScope === "custom" ? "#FFF" : (themeMode === "dark" ? "#C3B9C8" : "#9B93A5")} />
                    <Text style={[styles.dateChipText, dateScope === "custom" && styles.dateChipTextActive]}>Pick date</Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.summaryStrip}>
                <View><Text style={styles.summaryLabel}>MONEY IN</Text><Text style={[styles.summaryValue, { color: themeMode === "dark" ? "#80D5B5" : COLORS.green }]}>{shortMoney(filteredTotals.credits, baseCurrency)}</Text></View>
                <View style={styles.summaryDivider} />
                <View><Text style={styles.summaryLabel}>MONEY OUT</Text><Text style={[styles.summaryValue, { color: themeMode === "dark" ? "#F3998A" : COLORS.coral }]}>{shortMoney(filteredTotals.debits, baseCurrency)}</Text></View>
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
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.insightHeroAmount}>{money(totals.debits, baseCurrency)}</Text>
                <Text style={styles.insightHeroStory}>
                  {categories[0]
                    ? `${categories[0].name} leads your spending at ${Math.round((categories[0].value / Math.max(totals.debits, 1)) * 100)}% this month.`
                    : "Your spending story will become clearer as entries arrive."}
                </Text>
                <View style={styles.insightHeroDivider} />
                <View style={styles.insightHeroMetrics}>
                  <View style={styles.insightHeroMetric}>
                    <Text style={styles.insightHeroMetricLabel}>DAILY AVG</Text>
                    <Text style={styles.insightHeroMetricValue}>{shortMoney(insightMetrics.average, baseCurrency)}</Text>
                  </View>
                  <View style={styles.insightHeroMetricDivider} />
                  <View style={styles.insightHeroMetric}>
                    <Text style={styles.insightHeroMetricLabel}>TOP SPEND</Text>
                    <Text style={styles.insightHeroMetricValue}>{shortMoney(insightMetrics.largest, baseCurrency)}</Text>
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
                  <DonutChart categories={categories} total={totals.debits} currency={baseCurrency} />
                  <View style={styles.legend}>
                    {categories.slice(0, 5).map((item) => (
                      <View key={item.name} style={styles.legendRow}>
                        <View style={[styles.legendIcon, { backgroundColor: `${categoryAccent(item.name)}2F` }]}>
                          <Ionicons name={categoryMeta[item.name]?.icon ?? categoryMeta.Other.icon} size={15} color={categoryAccent(item.name)} />
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
                        <View style={[styles.categoryBarDot, { backgroundColor: categoryAccent(item.name) }]} />
                        <Text style={styles.categoryBarName}>{item.name}</Text>
                      </View>
                      <View style={styles.categoryBarNumbers}>
                        <Text style={styles.categoryBarPercent}>{Math.round((item.value / Math.max(totals.debits, 1)) * 100)}%</Text>
                        <Text style={styles.categoryBarValue}>{money(item.value, baseCurrency)}</Text>
                      </View>
                    </View>
                    <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(5, (item.value / Math.max(categories[0]?.value ?? 1, 1)) * 100)}%`, backgroundColor: categoryAccent(item.name) }]} /></View>
                  </View>
                ))}
              </View>

              <View style={styles.trendCard}>
                <View style={styles.chartHeader}>
                  <View>
                    <Text style={styles.eyebrow}>LAST 7 DAYS</Text>
                    <Text style={styles.chartTitle}>Daily spending pulse</Text>
                  </View>
                  <View style={styles.chartTotalPill}><Text style={styles.chartTotalText}>{shortMoney(lastSevenDays.reduce((sum, item) => sum + item.value, 0), baseCurrency)}</Text></View>
                </View>
                <View style={styles.weekChart}>
                  {lastSevenDays.map((item) => {
                    const maximum = Math.max(...lastSevenDays.map((day) => day.value), 1);
                    const height = item.value ? Math.max(8, (item.value / maximum) * 92) : 4;
                    return (
                      <View key={item.key} style={styles.weekColumn}>
                        <Text numberOfLines={1} style={styles.weekValue}>{item.value ? shortMoney(item.value, baseCurrency).replace(`${baseCurrency === "PKR" ? "Rs" : baseCurrency} `, "") : "—"}</Text>
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
                      <View style={styles.flowTop}><Text style={styles.flowLabel}>{item.label}</Text><Text style={styles.flowValue}>{money(item.value, baseCurrency)}</Text></View>
                      <View style={styles.flowTrack}><View style={[styles.flowFill, { width: `${Math.max(item.value ? 4 : 0, (item.value / maximum) * 100)}%`, backgroundColor: item.color }]} /></View>
                    </View>
                  );
                })}
                <View style={styles.netFlow}>
                  <Text style={styles.netFlowLabel}>NET POSITION</Text>
                  <Text style={[styles.netFlowValue, { color: totals.balance >= 0 ? COLORS.green : COLORS.coral }]}>{money(totals.balance, baseCurrency)}</Text>
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
                        <Text numberOfLines={1} style={styles.monthWeekValue}>{item.value ? shortMoney(item.value, baseCurrency) : money(0, baseCurrency)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.metricGrid}>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#E8E2F2" }]}><Ionicons name="speedometer-outline" size={18} color={COLORS.purple} /></View>
                  <Text style={styles.metricLabel}>DAILY AVERAGE</Text>
                  <Text style={styles.metricValue}>{shortMoney(insightMetrics.average, baseCurrency)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <View style={[styles.metricIcon, { backgroundColor: "#F3E2DE" }]}><Ionicons name="flash-outline" size={18} color={COLORS.coral} /></View>
                  <Text style={styles.metricLabel}>LARGEST SPEND</Text>
                  <Text style={styles.metricValue}>{shortMoney(insightMetrics.largest, baseCurrency)}</Text>
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
                <View style={[styles.monthCard, { backgroundColor: themeMode === "dark" ? "#20352D" : "#DCEDE7" }]}>
                  <Ionicons name="arrow-down-circle-outline" size={23} color={COLORS.green} />
                  <Text style={styles.monthCardLabel}>TOTAL CREDIT</Text>
                  <Text style={styles.monthCardValue}>{money(totals.credits, baseCurrency)}</Text>
                </View>
                <View style={[styles.monthCard, { backgroundColor: themeMode === "dark" ? "#3A2926" : "#F3E2DE" }]}>
                  <Ionicons name="arrow-up-circle-outline" size={23} color={COLORS.coral} />
                  <Text style={styles.monthCardLabel}>TOTAL DEBIT</Text>
                  <Text style={styles.monthCardValue}>{money(totals.debits, baseCurrency)}</Text>
                </View>
              </View>

              <Pressable onPress={() => setCurrencyPickerVisible(true)} style={styles.notificationCard}>
                <View style={[styles.notificationIcon, { backgroundColor: "#DCEDE7" }]}><Ionicons name="cash-outline" size={21} color={COLORS.green} /></View>
                <View style={styles.flex}>
                  <Text style={styles.notificationTitle}>Base currency · {baseCurrency}</Text>
                  <Text style={styles.notificationCopy}>{ratesUpdatedAt
                    ? `Converted with a cached daily rate · ${new Date(ratesUpdatedAt).toLocaleDateString("en-PK")}`
                    : "Choose the currency used for totals and manual entries."}</Text>
                  <Text onPress={(event) => { event.stopPropagation(); Linking.openURL("https://www.exchangerate-api.com"); }} style={[styles.notificationCopy, { color: COLORS.green, marginTop: 3 }]}>Rates by Exchange Rate API</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#77717E" />
              </Pressable>

              <View style={styles.notificationCard}>
                <View style={styles.notificationIcon}><Ionicons name="notifications-outline" size={21} color={COLORS.purple} /></View>
                <View style={styles.flex}><Text style={styles.notificationTitle}>Evening money recap</Text><Text style={styles.notificationCopy}>{dailyRecapEnabled ? "On · Daily reminder scheduled for 8:30 PM." : "Off · Turn on for a daily reminder at 8:30 PM."}</Text></View>
                <Switch accessibilityLabel="Evening money recap" value={dailyRecapEnabled} disabled={recapChanging} onValueChange={toggleDailyReports} trackColor={{ false: "#817C77", true: "#4E9C82" }} thumbColor="#FCFBF8" />
              </View>

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
        </MotionView>
      </KeyboardAvoidingView>

      {tab === "home" && (
        <Animated.View
          key={`home-top-shell-${themeMode}`}
          style={[
            baseStyles.homeTopShell,
            themeMode === "dark"
              ? { backgroundColor: "#28232E", borderColor: "#4B4153", shadowOpacity: .42 }
              : { backgroundColor: "#090909", borderColor: "#090909", shadowOpacity: .18 },
            {
              top: insets.top + 8,
              height: homeHeaderHeight,
              borderRadius: homeHeaderRadius,
            },
          ]}
        >
          <View style={[baseStyles.homeOrbitLarge, themeMode === "dark" && { borderColor: "#B8A7D52E" }]} />
          <View style={[baseStyles.homeOrbitSmall, themeMode === "dark" && { borderColor: "#D5B5E34D" }]} />

          <Animated.View style={[baseStyles.homeHeader, { opacity: expandedHeaderOpacity }]}>
            <View style={baseStyles.homeBrand}>
              <Image source={require("./assets/icon.png")} style={baseStyles.homeBrandMark} />
              <Text style={baseStyles.homeLogo}>MoneySync.</Text>
            </View>
            <View style={baseStyles.homeHeaderActions}>
              <Pressable onPress={toggleTheme} style={[baseStyles.homeRoundButton, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF24" }]}><Ionicons name={themeMode === "dark" ? "sunny-outline" : "moon-outline"} size={17} color="#F8F7F3" /></Pressable>
              <Pressable onPress={toggleDailyReports} style={[baseStyles.homeRoundButton, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF24" }]}><Ionicons name="notifications-outline" size={17} color="#F8F7F3" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={openSettings} style={[baseStyles.homeRoundButton, themeMode === "dark" && { backgroundColor: "#FFFFFF0D", borderColor: "#FFFFFF24" }]}><Ionicons name="settings-outline" size={17} color="#F8F7F3" /></Pressable>
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
            <Text numberOfLines={1} adjustsFontSizeToFit style={baseStyles.heroBalance}>{money(overviewTotals.balance, baseCurrency)}</Text>
            <Animated.Text style={[baseStyles.heroBalanceCaption, { opacity: expandedHeaderOpacity }]}>Updated from {overviewExpenses.length} transaction{overviewExpenses.length === 1 ? "" : "s"}</Animated.Text>
          </Animated.View>

          <Animated.View style={[baseStyles.heroStats, baseStyles.homeHeroStats, themeMode === "dark" && { backgroundColor: "#0B0E0C66", borderWidth: 1, borderColor: "#FFFFFF12" }, { opacity: expandedHeaderOpacity }]}>
            <View style={baseStyles.heroStat}>
              <Text style={baseStyles.heroStatLabel}>MONEY IN</Text>
              <Text style={baseStyles.heroStatValue}>{shortMoney(overviewTotals.credits, baseCurrency)}</Text>
            </View>
            <View style={baseStyles.heroStatDivider} />
            <View style={baseStyles.heroStat}>
              <Text style={baseStyles.heroStatLabel}>MONEY OUT</Text>
              <Text style={baseStyles.heroStatValue}>{shortMoney(overviewTotals.debits, baseCurrency)}</Text>
            </View>
          </Animated.View>

          <Animated.View pointerEvents="box-none" style={[baseStyles.compactBalanceMark, themeMode === "dark" && { backgroundColor: "#A9D9CA" }, { opacity: collapsedHeaderOpacity }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={openSettings} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="settings-outline" size={18} color="#0B0B0B" />
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      <Modal visible={onboardingVisible} animationType={reducedMotion ? "none" : "slide"} onRequestClose={() => undefined}>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: setupBackdrop }}>
          <StatusBar style={themeMode === "dark" ? "light" : "dark"} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 25 }}>
            <View style={{ minHeight: 168, borderRadius: 26, backgroundColor: themeMode === "dark" ? "#28232E" : "#0B0D0C", padding: 22, justifyContent: "space-between", overflow: "hidden" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                <Image source={require("./assets/icon.png")} style={{ width: 38, height: 38, borderRadius: 11 }} />
                <Text style={{ color: "#FFFFFF", fontSize: 23, fontWeight: "900", letterSpacing: -.8 }}>MoneySync.</Text>
              </View>
              <View>
                <Text style={{ color: "#BFE1DA", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }}>YOUR MONEY, YOUR WAY</Text>
                <Text style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 5 }}>{onboardingStep === 0 ? "Welcome to your wallet" : onboardingStep === 1 ? "Make it yours" : onboardingStep === 2 ? "Set your starting point" : "Stay in the loop"}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 7, marginTop: 20, marginBottom: 20 }}>
              {[0, 1, 2, 3].map((step) => <View key={step} style={{ height: 4, flex: 1, borderRadius: 3, backgroundColor: step <= onboardingStep ? (themeMode === "dark" ? "#C5A6DC" : COLORS.green) : setupLine }} />)}
            </View>

            {onboardingStep === 0 && <View>
              <Text style={{ color: setupInk, fontSize: 20, fontWeight: "900" }}>A little about you</Text>
              <Text style={{ color: setupMuted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>Your profile stays on this device. Existing transactions remain in your wallet through this update.</Text>
              <Text style={{ color: setupInk, fontSize: 12, fontWeight: "800", marginTop: 24 }}>YOUR NAME</Text>
              <TextInput accessibilityLabel="Your name" value={profileName} onChangeText={(value) => { setProfileName(value); setOnboardingError(""); }} maxLength={60} autoCapitalize="words" placeholder="What should we call you?" placeholderTextColor={setupMuted} style={{ height: 54, borderRadius: 14, borderWidth: 1, borderColor: setupLine, backgroundColor: setupInput, color: setupInk, paddingHorizontal: 15, fontSize: 15, marginTop: 9 }} />
              <Text style={{ color: setupInk, fontSize: 12, fontWeight: "800", marginTop: 22 }}>PROFILE TYPE</Text>
              {renderPurposeChoices(profilePurpose, setProfilePurpose)}
              <Text style={{ color: setupMuted, fontSize: 11, lineHeight: 17, marginTop: 10 }}>This labels your profile; transactions stay in one wallet.</Text>
            </View>}

            {onboardingStep === 1 && <View>
              <Text style={{ color: setupInk, fontSize: 20, fontWeight: "900" }}>Currency & appearance</Text>
              <Text style={{ color: setupMuted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>Choose the currency for totals and new manual entries. Imported alerts retain their original currency.</Text>
              <Text style={{ color: setupInk, fontSize: 12, fontWeight: "800", marginTop: 22 }}>BASE CURRENCY {currencyConfigured ? `· ${baseCurrency}` : "· REQUIRED"}</Text>
              {renderCurrencyChoices((currency) => { chooseBaseCurrency(currency).catch(() => setOnboardingError("Couldn’t save currency. Please try again.")); setOnboardingError(""); })}
              <Text style={{ color: setupInk, fontSize: 12, fontWeight: "800", marginTop: 22 }}>THEME</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 9 }}>
                {(["system", "light", "dark"] as ThemePreference[]).map((mode) => <Pressable key={mode} accessibilityRole="button" onPress={() => { selectThemePreference(mode).catch(() => setOnboardingError("Couldn’t save theme.")); }} style={{ flex: 1, minHeight: 50, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: themePreference === mode ? (themeMode === "dark" ? "#BA9CD0" : COLORS.green) : setupLine, backgroundColor: setupSurface }}><Ionicons name={mode === "dark" ? "moon-outline" : mode === "system" ? "phone-portrait-outline" : "sunny-outline"} size={17} color={setupInk} /><Text style={{ color: setupInk, fontWeight: "800", fontSize: 12 }}>{mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light"}</Text></Pressable>)}
              </View>
              <Text style={{ color: setupMuted, fontSize: 11, lineHeight: 17, marginTop: 17 }}>Exchange rates are cached daily. Only currency codes go to the rate provider.</Text>
            </View>}

            {onboardingStep === 2 && <View>
              <Text style={{ color: setupInk, fontSize: 20, fontWeight: "900" }}>Start with your current balance</Text>
              <Text style={{ color: setupMuted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>Optional: tell MoneySync how much you currently have so your net balance starts from the right place. You can skip this and add it later as a normal transaction.</Text>
              <Text style={{ color: setupInk, fontSize: 12, fontWeight: "800", marginTop: 24 }}>STARTING BALANCE · {baseCurrency}</Text>
              <TextInput accessibilityLabel="Optional starting balance" value={openingBalance} onChangeText={(value) => { setOpeningBalance(value.replace(/[^0-9.,]/g, "")); setOnboardingError(""); }} keyboardType="decimal-pad" inputMode="decimal" placeholder="e.g. 50000" placeholderTextColor={setupMuted} style={{ height: 58, borderRadius: 14, borderWidth: 1, borderColor: setupLine, backgroundColor: setupInput, color: setupInk, paddingHorizontal: 15, fontSize: 21, fontWeight: "800", marginTop: 9 }} />
              <Text style={{ color: setupMuted, fontSize: 11, lineHeight: 17, marginTop: 10 }}>This is stored only on your device. Leave it blank if you prefer not to share it.</Text>
            </View>}

            {onboardingStep === 3 && <View>
              <Text style={{ color: setupInk, fontSize: 20, fontWeight: "900" }}>Choose your access</Text>
              <Text style={{ color: setupMuted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>Allow the alerts you want MoneySync to capture. Android will show its own permission screen for each one. Manual entry works without them.</Text>
              {accessRows}
              {accessFeedback ? <Text style={{ color: COLORS.gold, fontSize: 12, lineHeight: 18, marginTop: 14 }}>{accessFeedback}</Text> : null}
              <Text style={{ color: setupMuted, fontSize: 11, lineHeight: 18, marginTop: 18 }}>Financial messages are processed locally. OTPs and unrelated notifications are ignored; full message text is not saved or sent to the rate provider.</Text>
            </View>}
            {onboardingError ? <Text accessibilityRole="alert" style={{ color: COLORS.coral, fontSize: 12, fontWeight: "700", marginTop: 18 }}>{onboardingError}</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderColor: setupLine }}>
            {onboardingStep > 0 && <Pressable accessibilityRole="button" onPress={() => { setOnboardingStep(onboardingStep - 1); setOnboardingError(""); }} style={{ minHeight: 52, minWidth: 95, borderRadius: 14, borderWidth: 1, borderColor: setupLine, alignItems: "center", justifyContent: "center" }}><Text style={{ color: setupInk, fontWeight: "800" }}>Back</Text></Pressable>}
            <Pressable accessibilityRole="button" disabled={onboardingSaving} onPress={() => {
              if (onboardingStep === 0 && !profileName.trim()) { setOnboardingError("Enter your name to continue."); return; }
              if (onboardingStep === 1 && !currencyConfigured) { setOnboardingError("Choose your base currency to continue."); return; }
              if (onboardingStep < 3) { Keyboard.dismiss(); setOnboardingError(""); setOnboardingStep(onboardingStep + 1); return; }
              finishOnboarding();
            }} style={{ flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: themeMode === "dark" ? "#765591" : COLORS.ink, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>{onboardingStep === 3 ? (onboardingSaving ? "Saving…" : "Finish setup") : "Continue"}</Text></Pressable>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={settingsVisible} animationType={reducedMotion ? "none" : "slide"} onRequestClose={() => setSettingsVisible(false)}>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: setupBackdrop }}>
          <StatusBar style={themeMode === "dark" ? "light" : "dark"} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderColor: setupLine }}>
            <View style={{ flex: 1 }}><Text style={{ color: setupMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 }}>MONEYSYNC</Text><Text style={{ color: setupInk, fontSize: 25, fontWeight: "900" }}>Settings</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={() => setSettingsVisible(false)} style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: setupSurface, borderWidth: 1, borderColor: setupLine, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={22} color={setupInk} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 18, paddingBottom: 36 }}>
            <Text style={{ color: setupInk, fontSize: 17, fontWeight: "900" }}>Your profile</Text>
            <Text style={{ color: setupMuted, fontSize: 12, marginTop: 4 }}>Saved locally on this device.</Text>
            <TextInput accessibilityLabel="Your name" value={settingsNameDraft} onChangeText={(value) => { setSettingsNameDraft(value); setProfileFeedback(""); }} maxLength={60} autoCapitalize="words" placeholder="Your name" placeholderTextColor={setupMuted} style={{ height: 52, borderRadius: 14, borderWidth: 1, borderColor: setupLine, backgroundColor: setupInput, color: setupInk, paddingHorizontal: 15, fontSize: 15, marginTop: 14 }} />
            {renderPurposeChoices(settingsPurposeDraft, (purpose) => { setSettingsPurposeDraft(purpose); setProfileFeedback(""); })}
            <Text style={{ color: setupMuted, fontSize: 11, marginTop: 9 }}>Profile type does not separate transactions.</Text>
            <Pressable accessibilityRole="button" disabled={profileSaving} onPress={saveSettingsProfile} style={{ minHeight: 46, borderRadius: 13, backgroundColor: themeMode === "dark" ? "#765591" : COLORS.ink, alignItems: "center", justifyContent: "center", marginTop: 11 }}><Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{profileSaving ? "Saving…" : "Save profile"}</Text></Pressable>
            {profileFeedback ? <Text accessibilityRole="alert" style={{ color: profileFeedback.startsWith("Profile saved") ? COLORS.green : COLORS.coral, marginTop: 9, fontSize: 12 }}>{profileFeedback}</Text> : null}

            <Text style={{ color: setupInk, fontSize: 17, fontWeight: "900", marginTop: 30 }}>Preferences</Text>
            {Platform.OS === "android" && <Pressable accessibilityRole="button" disabled={playUpdateBusy} onPress={() => {
              if (playUpdateState?.installStatus === "DOWNLOADED") completePlayUpdate();
              else checkForPlayUpdate(true).catch(() => undefined);
            }} style={{ flexDirection: "row", alignItems: "center", minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: setupLine, backgroundColor: setupSurface, paddingHorizontal: 15, marginTop: 12, opacity: playUpdateBusy ? 0.65 : 1 }}>
              <Ionicons name={playUpdateState?.installStatus === "DOWNLOADED" ? "download-outline" : "refresh-outline"} size={20} color={setupInk} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: setupInk, fontSize: 14, fontWeight: "800" }}>{playUpdateState?.installStatus === "DOWNLOADED" ? "Install MoneySync update" : "Check for app updates"}</Text>
                <Text style={{ color: setupMuted, fontSize: 11, marginTop: 4 }}>
                  {playUpdateState?.installStatus === "DOWNLOADING" && playUpdateState.totalBytesToDownload > 0
                    ? `Downloading · ${Math.round(playUpdateState.bytesDownloaded / playUpdateState.totalBytesToDownload * 100)}%`
                : playUpdateInfo?.available ? "An update is available on Google Play" : "Checks Google Play for a newer version"}
                </Text>
              </View>
              {playUpdateBusy ? <Text style={{ color: setupMuted, fontSize: 11 }}>Checking…</Text> : <Ionicons name="chevron-forward" size={18} color={setupMuted} />}
            </Pressable>}
            <Pressable accessibilityRole="button" onPress={() => { setSettingsCurrencyOpen(!settingsCurrencyOpen); setCurrencySearch(""); }} style={{ flexDirection: "row", alignItems: "center", minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: setupLine, backgroundColor: setupSurface, paddingHorizontal: 15, marginTop: 12 }}><View style={{ flex: 1 }}><Text style={{ color: setupInk, fontSize: 14, fontWeight: "800" }}>Base currency · {baseCurrency}</Text><Text style={{ color: setupMuted, fontSize: 11, marginTop: 4 }}>{ratesUpdatedAt ? `Rates cached ${new Date(ratesUpdatedAt).toLocaleDateString()}` : "Used for totals and manual entries"}</Text></View><Ionicons name={settingsCurrencyOpen ? "chevron-up" : "chevron-down"} size={18} color={setupInk} /></Pressable>
            {settingsCurrencyOpen && renderCurrencyChoices((currency) => { chooseBaseCurrency(currency).catch(() => setProfileFeedback("Couldn’t save currency.")); setSettingsCurrencyOpen(false); })}
            <Text style={{ color: setupInk, fontSize: 14, fontWeight: "800", marginTop: 18 }}>Appearance</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 9 }}>
              {(["system", "light", "dark"] as ThemePreference[]).map((mode) => <Pressable key={mode} accessibilityRole="button" accessibilityLabel={`${mode === "system" ? "Use system theme" : `Use ${mode} theme`}`} onPress={() => { selectThemePreference(mode).catch(() => setProfileFeedback("Couldn’t save theme.")); }} style={{ flex: 1, minHeight: 46, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: themePreference === mode ? (themeMode === "dark" ? "#BA9CD0" : COLORS.green) : setupLine, backgroundColor: setupSurface }}><Ionicons name={mode === "dark" ? "moon-outline" : mode === "system" ? "phone-portrait-outline" : "sunny-outline"} size={16} color={setupInk} /><Text style={{ color: setupInk, fontSize: 12, fontWeight: "800" }}>{mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light"}</Text></Pressable>)}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: setupLine, backgroundColor: setupSurface, paddingHorizontal: 15, marginTop: 10 }}><View style={{ flex: 1 }}><Text style={{ color: setupInk, fontSize: 14, fontWeight: "800" }}>Evening money recap</Text><Text style={{ color: setupMuted, fontSize: 11, marginTop: 4 }}>{dailyRecapEnabled ? "On · 8:30 PM" : "Off"}</Text></View><Switch accessibilityLabel="Evening money recap" value={dailyRecapEnabled} disabled={recapChanging} onValueChange={toggleDailyReports} trackColor={{ false: themeMode === "dark" ? "#625968" : "#817C77", true: themeMode === "dark" ? "#9E7FBA" : "#4E9C82" }} thumbColor="#FCFBF8" /></View>

            {Platform.OS === "android" && <><Text style={{ color: setupInk, fontSize: 17, fontWeight: "900", marginTop: 30 }}>Access</Text><Text style={{ color: setupMuted, fontSize: 12, lineHeight: 18, marginTop: 4 }}>Choose which automatic capture features MoneySync can use.</Text>{accessRows}{accessFeedback ? <Text style={{ color: COLORS.gold, fontSize: 12, marginTop: 10 }}>{accessFeedback}</Text> : null}</>}
            <Text style={{ color: setupInk, fontSize: 17, fontWeight: "900", marginTop: 30 }}>Your data</Text>
            <Pressable accessibilityRole="button" onPress={exportCsv} style={{ flexDirection: "row", alignItems: "center", minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: setupLine, backgroundColor: setupSurface, paddingHorizontal: 15, marginTop: 12 }}><Ionicons name="share-outline" size={20} color={setupInk} /><Text style={{ flex: 1, color: setupInk, fontSize: 14, fontWeight: "800", marginLeft: 12 }}>Export transactions as CSV</Text><Ionicons name="chevron-forward" size={18} color={setupMuted} /></Pressable>
            <Text onPress={() => Linking.openURL("https://www.exchangerate-api.com")} style={{ color: COLORS.green, fontSize: 11, marginTop: 22 }}>Rates by Exchange Rate API</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        transparent
        visible={Boolean(appDialog)}
        onRequestClose={() => setAppDialog(null)}
      >
        <View style={styles.appDialogBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAppDialog(null)} />
          {appDialog && (() => {
            const tone = DIALOG_TONES[appDialog.tone];
            return (
              <MotionView enterKey={appDialog} fromY={14} style={styles.appDialogCard}>
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
              </MotionView>
            );
          })()}
        </View>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        transparent
        visible={currencyPickerVisible}
        onRequestClose={() => { if (currencyConfigured) setCurrencyPickerVisible(false); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.editorBackdrop}>
          {currencyConfigured && <Pressable style={StyleSheet.absoluteFill} onPress={() => setCurrencyPickerVisible(false)} />}
          <MotionView enterKey={currencyPickerVisible} fromY={18} style={[styles.editorCard, { maxHeight: "78%" }]}>
            <View style={styles.editorHeader}>
              <View style={styles.flex}>
                <Text style={styles.editorEyebrow}>{currencyConfigured ? "DISPLAY SETTINGS" : "WELCOME TO MONEYSYNC"}</Text>
                <Text style={styles.editorTitle}>Choose your base currency</Text>
                <Text style={[styles.notificationCopy, { marginTop: 6 }]}>Totals and manual entries use this currency. Imported alerts keep their original currency.</Text>
              </View>
              {currencyConfigured && <Pressable onPress={() => setCurrencyPickerVisible(false)} style={styles.editorClose}>
                <Ionicons name="close" size={20} color={COLORS.muted} />
              </Pressable>}
            </View>
            <TextInput
              autoCapitalize="characters"
              value={currencySearch}
              onChangeText={setCurrencySearch}
              placeholder="Search currency code, e.g. PKR or USD"
              placeholderTextColor="#77717E"
              style={styles.editorInput}
            />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {visibleCurrencies.map((currency) => (
                <Pressable key={currency} onPress={() => chooseBaseCurrency(currency).catch(() => showDialog("Couldn’t save currency", "Please try again.", undefined, "warning"))} style={[styles.notificationCard, { marginTop: 6 }] }>
                  <View style={[styles.notificationIcon, { backgroundColor: currency === baseCurrency ? "#DCEDE7" : "#E8E2F2" }]}>
                    <Text style={{ fontWeight: "900", color: currency === baseCurrency ? COLORS.green : COLORS.purple }}>{currency.slice(0, 2)}</Text>
                  </View>
                  <Text style={[styles.notificationTitle, styles.flex]}>{currency}</Text>
                  {currency === baseCurrency && currencyConfigured && <Ionicons name="checkmark-circle" size={20} color={COLORS.green} />}
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[styles.notificationCopy, { marginTop: 10 }]}>Exchange rates are indicative daily rates. Only currency codes are sent; notification and transaction data stay on this device.</Text>
          </MotionView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        transparent
        visible={overviewSelectorVisible}
        onRequestClose={() => setOverviewSelectorVisible(false)}
      >
        <View style={styles.overviewPickerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOverviewSelectorVisible(false)} />
          <MotionView enterKey={overviewSelectorVisible} fromY={18} style={styles.overviewPickerCard}>
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
          </MotionView>
        </View>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        transparent
        visible={Boolean(calendarTarget)}
        onRequestClose={() => setCalendarTarget(null)}
      >
        <View style={styles.calendarBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCalendarTarget(null)} />
          <MotionView enterKey={calendarTarget} fromY={18} style={styles.calendarCard}>
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
          </MotionView>
        </View>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        transparent
        visible={Boolean(detailExpense)}
        onRequestClose={() => setDetailExpense(null)}
      >
        <View style={styles.editorBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetailExpense(null)} />
          {detailExpense && <MotionView enterKey={detailExpense.id} fromY={18} style={[styles.editorCard, {
            maxHeight: "86%", backgroundColor: activeThemeDark ? "#24202B" : "#FCFBF8",
            borderColor: activeThemeDark ? "#51475A" : "#E2DED8",
          }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.editorHeader}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.editorEyebrow}>TRANSACTION DETAILS</Text>
                  <Text style={[styles.editorTitle, { color: activeThemeDark ? "#F8F4FA" : "#111111" }]}>{detailExpense.description}</Text>
                </View>
                <Pressable onPress={() => setDetailExpense(null)} style={styles.editorClose} accessibilityLabel="Close transaction details">
                  <Ionicons name="close" size={20} color={activeThemeDark ? "#E8DDEB" : COLORS.muted} />
                </Pressable>
              </View>
              <Text style={{ fontSize: 30, fontWeight: "800", marginVertical: 14,
                color: detailExpense.type === "credit" ? (activeThemeDark ? "#80D5B5" : "#35A57C") : activeThemeDark ? "#F8F4FA" : "#111111" }}>
                {detailExpense.type === "credit" ? "+" : "−"} {transactionDisplay(detailExpense).amount}
              </Text>
              {transactionDisplay(detailExpense).original ? <Text style={{ color: activeThemeDark ? "#C9BECE" : "#706B66", marginBottom: 12 }}>{transactionDisplay(detailExpense).original}</Text> : null}
              {([
                ["Date & time", entryDateTime(detailExpense.createdAt)],
                ["Category", detailExpense.category],
                [detailExpense.type === "credit" ? "From" : "To", detailExpense.counterparty || "Not identified in alert"],
                ["Your account", detailExpense.account || "Not included in alert"],
                ["Reference", detailExpense.reference || "Not included in alert"],
                ["Source", detailExpense.sourceSender || (detailExpense.sourceChannel ? detailExpense.sourceChannel : "Manual entry")],
              ] as [string, string][]).map(([label, value]) => <View key={label} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: activeThemeDark ? "#51475A" : "#E2DED8" }}>
                <Text style={{ color: activeThemeDark ? "#C4B9CA" : "#817C77", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
                <Text selectable style={{ color: activeThemeDark ? "#F8F4FA" : "#111111", fontSize: 15, marginTop: 4 }}>{value}</Text>
              </View>)}
              {detailExpense.sourceText ? <View style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: activeThemeDark ? "#51475A" : "#E2DED8" }}>
                <Text style={{ color: activeThemeDark ? "#C4B9CA" : "#817C77", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>ORIGINAL ALERT</Text>
                <Text selectable style={{ color: activeThemeDark ? "#F8F4FA" : "#111111", lineHeight: 22, fontSize: 14, marginTop: 8 }}>{detailExpense.sourceText}</Text>
              </View> : null}
            </ScrollView>
            <Pressable onPress={() => { const entry = detailExpense; setDetailExpense(null); setTimeout(() => openEditor(entry), 150); }} style={styles.editorSave}>
              <Ionicons name="create-outline" size={18} color="#FFF" />
              <Text style={styles.editorSaveText}>Edit transaction</Text>
            </Pressable>
          </MotionView>}
        </View>
      </Modal>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        transparent
        visible={Boolean(editingExpense)}
        onRequestClose={() => setEditingExpense(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.editorBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditingExpense(null)} />
          <MotionView enterKey={editingExpense?.id} fromY={18} style={styles.editorCard}>
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
              <Text style={styles.editorCurrency}>{editCurrency}</Text>
              <TextInput
                value={editAmount}
                onChangeText={setEditAmount}
                keyboardType="decimal-pad"
                onSubmitEditing={saveEditedEntry}
                style={styles.editorAmountInput}
              />
            </View>
            <Text style={[styles.editorLabel, { marginTop: 12 }]}>CURRENCY · AMOUNT IS PRESERVED</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryPicker}>
              {transactionCurrencyOptions.map((currency) => {
                const active = editCurrency === currency;
                return (
                  <Pressable
                    key={currency}
                    accessibilityRole="button"
                    accessibilityLabel={`Set transaction currency to ${currency}`}
                    onPress={() => setEditCurrency(currency)}
                    style={[styles.categoryChip, active && { backgroundColor: themeMode === "dark" ? "#3A2D48" : "#DCEDE7", borderColor: themeMode === "dark" ? "#BDA6D9" : COLORS.green }]}
                  >
                    <Text style={[styles.categoryChipText, active && { color: themeMode === "dark" ? "#E8D8F4" : COLORS.green }]}>{currency}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

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
                        style={[styles.categoryChip, active && { backgroundColor: `${categoryAccent(category)}2B`, borderColor: categoryAccent(category) }]}
                      >
                        <Ionicons name={meta.icon} size={14} color={active ? categoryAccent(category) : (themeMode === "dark" ? "#B9AEBD" : COLORS.muted)} />
                        <Text style={[styles.categoryChipText, active && { color: categoryAccent(category) }]}>{category}</Text>
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
          </MotionView>
        </KeyboardAvoidingView>
      </Modal>

      <View style={[styles.tabBar, styles.homeTabBar, { bottom: Math.max(14, insets.bottom + 8) }]}>
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
      <MotionProvider>
      <KharchaApp />
      </MotionProvider>
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
  typeToggle: { flexDirection: "row", backgroundColor: "#EFECE8", padding: 4, borderRadius: 14, marginBottom: 12 },
  typeButton: { flex: 1, minHeight: 52, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 11 },
  typeButtonDebit: { backgroundColor: "#111111" },
  typeButtonCredit: { backgroundColor: "#BFE1DA" },
  typeText: { color: "#77736F", fontSize: 13, fontWeight: "800" },
  typeTextSelected: { color: "#FFF" },
  typeTextCreditSelected: { color: "#111111" },
  quickFieldLabel: { color: "#A4ADA9", fontSize: 9, fontWeight: "700", marginLeft: 2, marginBottom: 6 },
  descriptionWrap: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 15, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F7F5F1", paddingHorizontal: 16, marginBottom: 10 },
  descriptionInput: { flex: 1, minHeight: 58, color: "#111111", paddingHorizontal: 0, fontSize: 15 },
  amountRow: { flexDirection: "row", gap: 8 },
  amountInputWrap: { flex: 1, minHeight: 60, flexDirection: "row", alignItems: "center", borderRadius: 15, borderWidth: 1, borderColor: "#E2DED8", backgroundColor: "#F7F5F1", paddingLeft: 10 },
  currencyBadge: { height: 34, minWidth: 34, borderRadius: 9, backgroundColor: "#E8E2F2", alignItems: "center", justifyContent: "center", marginRight: 7 },
  currency: { color: "#342F3A", fontSize: 10, fontWeight: "900" },
  amountInput: { flex: 1, height: "100%", color: "#111111", fontSize: 18, fontWeight: "900" },
  addButton: { width: 112, minHeight: 60, borderRadius: 15, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  addButtonText: { color: "#FFF", fontSize: 14, fontWeight: "900" },
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
  homeCategoryIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#FFFFFFAA", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  homeCategoryName: { color: "#504B47", fontSize: 9, fontWeight: "700" },
  homeCategoryValue: { color: "#111111", fontSize: 13, fontWeight: "900", marginTop: 4 },
  homeList: { borderTopWidth: 1, borderTopColor: "#EAE6E0" },
  homeTransaction: { minHeight: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E4E0DA" },
  homeTransactionIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 10 },
  homeTransactionTitle: { color: "#111111", fontSize: 11.5, fontWeight: "800" },
  homeTransactionOriginal: { color: "#6F6863", fontSize: 9, fontWeight: "700", marginTop: 2 },
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
  transactionOriginal: { color: "#6F6863", fontSize: 9.5, fontWeight: "700", marginTop: 2 },
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
  safe: { backgroundColor: "#100E15" },
  homeSafe: { backgroundColor: "#100E15" },
  headerButton: { backgroundColor: "#24202B", borderColor: "#47404D" },
  logo: { color: "#F8F4FA" },
  tagline: { color: "#C1B8C5" },
  eyebrow: { color: "#BBB0C2" },
  subtitle: { color: "#BAB0C0" },
  pageTitle: { color: "#F8F4FA" },
  sectionTitle: { color: "#F8F4FA" },
  sectionAction: { color: "#D6BCEB" },

  homeSheet: { backgroundColor: "#1C1922", borderColor: "#3B3442", shadowOpacity: .32 },
  quickTitle: { color: "#F8F4FA" },
  quickSubtitle: { color: "#BCB2C0" },
  todayMiniLabel: { color: "#BAAFBF" },
  todayMiniValue: { color: "#F8F4FA" },
  typeToggle: { backgroundColor: "#2B2632" },
  typeButtonDebit: { backgroundColor: "#D6BEE8" },
  typeButtonCredit: { backgroundColor: "#BADEC9" },
  typeText: { color: "#C0B6C4" },
  typeTextSelected: { color: "#281D32" },
  descriptionWrap: { backgroundColor: "#27232D", borderColor: "#4C4353" },
  descriptionInput: { color: "#F8F4FA" },
  amountInputWrap: { backgroundColor: "#27232D", borderColor: "#4C4353" },
  currencyBadge: { backgroundColor: "#41334E" },
  currency: { color: "#E8D8F4" },
  amountInput: { color: "#F8F4FA" },
  addButton: { backgroundColor: "#765591", borderWidth: 1, borderColor: "#9272AC" },
  homeSectionTitle: { color: "#F8F4FA" },
  homeSectionCaption: { color: "#B6ACB9" },
  homeSectionAction: { color: "#D4BAE8" },
  homeCategoryCard: { backgroundColor: "#29252F" },
  homeCategoryCardLilac: { backgroundColor: "#352B42" },
  homeCategoryCardMint: { backgroundColor: "#263630" },
  homeCategoryIcon: { backgroundColor: "#FFFFFF12" },
  homeCategoryName: { color: "#D1C7D5" },
  homeCategoryValue: { color: "#F8F4FA" },
  homeList: { borderTopColor: "#403946" },
  homeTransaction: { borderBottomColor: "#403946" },
  homeTransactionTitle: { color: "#F8F4FA" },
  homeTransactionOriginal: { color: "#C4BAC8" },
  homeTransactionMeta: { color: "#B2A9B6" },
  homeTransactionAmount: { color: "#F8F4FA" },
  homeEmpty: { color: "#B2A9B6" },

  dateFilterCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  dateFilterEyebrow: { color: "#B9AEBD" },
  dateFilterTitle: { color: "#F8F4FA" },
  dateFilterIcon: { backgroundColor: "#3B3049" },
  dateChip: { backgroundColor: "#2D2833", borderColor: "#4A4152" },
  dateChipActive: { backgroundColor: "#765591", borderColor: "#A587BB" },
  dateChipText: { color: "#C1B7C5" },
  summaryStrip: { backgroundColor: "#211D27", borderColor: "#403947" },
  summaryLabel: { color: "#B6ABBB" },
  summaryValue: { color: "#F8F4FA" },
  summaryDivider: { backgroundColor: "#4A4152" },
  listCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  transaction: { borderBottomColor: "#403947" },
  transactionTitle: { color: "#F8F4FA" },
  transactionOriginal: { color: "#C4BAC8" },
  transactionMeta: { color: "#B4AABA" },
  transactionAmount: { color: "#F8F4FA" },
  outlineButton: { backgroundColor: "#211D27", borderColor: "#403947" },
  outlineButtonText: { color: "#D6BCEB" },
  emptyDateCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  emptyDateIcon: { backgroundColor: "#3B3049" },
  emptyDateTitle: { color: "#F8F4FA" },
  emptyDateCopy: { color: "#B8AEBD" },

  insightLivePill: { backgroundColor: "#362942", borderColor: "#5D486B" },
  insightLiveText: { color: "#E5C9F5" },
  analysisCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  insightSectionIcon: { backgroundColor: "#3B3049" },
  trendCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  cashflowCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  chartTitle: { color: "#F8F4FA" },
  chartTotalPill: { backgroundColor: "#3B3049" },
  chartTotalText: { color: "#DFC8F0" },
  weekValue: { color: "#B9AEBD" },
  weekBarSlot: { backgroundColor: "#312B38" },
  weekLabel: { color: "#C2B7C7" },
  flowLabel: { color: "#C2B7C7" },
  flowValue: { color: "#F8F4FA" },
  flowTrack: { backgroundColor: "#312B38" },
  netFlow: { borderTopColor: "#403947" },
  netFlowLabel: { color: "#C2B7C7" },
  trendDirection: { backgroundColor: "#2A443B", color: "#9BE4CA" },
  monthWeekSlot: { backgroundColor: "#312B38" },
  monthWeekValue: { color: "#F8F4FA" },
  metricCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  metricLabel: { color: "#C2B7C7" },
  metricValue: { color: "#F8F4FA" },
  donutRing: { backgroundColor: "#312B38" },
  donutInner: { backgroundColor: "#211D27" },
  donutLabel: { color: "#BEB3C4" },
  donutValue: { color: "#F8F4FA" },
  legendName: { color: "#CDC3D0" },
  legendValue: { color: "#F8F4FA" },
  categoryBarName: { color: "#CDC3D0" },
  categoryBarPercent: { color: "#BEB3C4" },
  categoryBarValue: { color: "#F8F4FA" },
  barTrack: { backgroundColor: "#312B38" },
  monthCardLabel: { color: "#D2DDD5" },
  monthCardValue: { color: "#F8F4FA" },
  notificationCard: { backgroundColor: "#211D27", borderColor: "#403947" },
  notificationTitle: { color: "#F8F4FA" },
  notificationCopy: { color: "#BEB3C4" },

  appDialogCard: { backgroundColor: "#24202B", borderColor: "#51475A" },
  appDialogTitle: { color: "#F8F4FA" },
  appDialogMessage: { color: "#C8BECD" },
  appDialogButton: { backgroundColor: "#765591" },
  appDialogButtonCancel: { backgroundColor: "#332D3A", borderColor: "#51475A" },
  appDialogButtonTextCancel: { color: "#E5DAE9" },
  overviewPickerCard: { backgroundColor: "#24202B", borderColor: "#51475A" },
  overviewPickerCopy: { color: "#C4B9CA" },
  overviewPickerOption: { backgroundColor: "#2E2835", borderColor: "#51475A" },
  overviewPickerOptionActive: { backgroundColor: "#463453", borderColor: "#BC9BD2" },
  overviewPickerLabel: { color: "#F8F4FA" },
  overviewPickerOptionCopy: { color: "#C4B9CA" },
  calendarCard: { backgroundColor: "#24202B", borderColor: "#51475A" },
  calendarEyebrow: { color: "#C4B9CA" },
  calendarTitle: { color: "#F8F4FA" },
  calendarClose: { backgroundColor: "#342D3B" },
  calendarArrow: { backgroundColor: "#40334C" },
  calendarMonthText: { color: "#F8F4FA" },
  calendarWeekRow: { borderBottomColor: "#51475A" },
  calendarWeekday: { color: "#C4B9CA" },
  calendarDayText: { color: "#E7DEEA" },
  calendarTodayButton: { backgroundColor: "#40334C" },
  calendarTodayText: { color: "#E2CBF0" },
  editorCard: { backgroundColor: "#24202B", borderColor: "#51475A" },
  editorEyebrow: { color: "#C4B9CA" },
  editorTitle: { color: "#F8F4FA" },
  editorClose: { backgroundColor: "#342D3B" },
  editorToggle: { backgroundColor: "#332D3A" },
  editorTypeText: { color: "#C4B9CA" },
  editorLabel: { color: "#C4B9CA" },
  editorCurrency: { color: "#C4B9CA" },
  editorInput: { backgroundColor: "#2E2835", borderColor: "#51475A", color: "#F8F4FA" },
  editorAmountWrap: { backgroundColor: "#2E2835", borderColor: "#51475A" },
  editorAmountInput: { color: "#F8F4FA" },
  categoryChip: { backgroundColor: "#2E2835", borderColor: "#51475A" },
  categoryChipText: { color: "#D0C5D4" },
  editorSave: { backgroundColor: "#765591" },

  tabBar: { backgroundColor: "#211D27", borderColor: "#494150" },
  homeTabBar: { backgroundColor: "#211D27", borderColor: "#494150", shadowOpacity: .35 },
  tabText: { color: "#B9AFBF" },
  homeTabTextActive: { color: "#F8F4FA" },
});

const styles = new Proxy(baseStyles, {
  get(target, property: string) {
    const base = target[property as keyof typeof target];
    const dark = darkStyles[property as keyof typeof darkStyles];
    return activeThemeDark && dark ? [base, dark] : base;
  },
}) as typeof baseStyles;
