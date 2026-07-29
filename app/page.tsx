"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Coffee,
  CreditCard,
  Download,
  Home as HomeIcon,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Utensils,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type EntryType = "debit" | "credit";

type Expense = {
  id: string;
  description: string;
  amount: number;
  type: EntryType;
  category: string;
  createdAt: string;
};

const demoExpenses: Expense[] = [
  { id: "demo-1", description: "Dinner at Spice Route", amount: 4250, type: "debit", category: "Food", createdAt: new Date().toISOString() },
  { id: "demo-2", description: "Careem ride to office", amount: 780, type: "debit", category: "Transport", createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: "demo-3", description: "Monthly salary", amount: 185000, type: "credit", category: "Income", createdAt: new Date(Date.now() - 172800000).toISOString() },
  { id: "demo-4", description: "Grocery run", amount: 8350, type: "debit", category: "Groceries", createdAt: new Date(Date.now() - 172800000).toISOString() },
  { id: "demo-5", description: "Internet bill", amount: 4999, type: "debit", category: "Bills", createdAt: new Date(Date.now() - 259200000).toISOString() },
  { id: "demo-6", description: "Linen shirt", amount: 6290, type: "debit", category: "Shopping", createdAt: new Date(Date.now() - 345600000).toISOString() },
];

const categoryMeta: Record<string, { color: string; icon: typeof Coffee }> = {
  Food: { color: "#f9734e", icon: Utensils },
  Groceries: { color: "#e8a542", icon: ShoppingBag },
  Transport: { color: "#6457d9", icon: Zap },
  Shopping: { color: "#d95b91", icon: ShoppingBag },
  Bills: { color: "#3d8db8", icon: ReceiptText },
  Home: { color: "#51a37e", icon: HomeIcon },
  Income: { color: "#2f9c73", icon: TrendingUp },
  Other: { color: "#8a8a98", icon: MoreHorizontal },
};

const money = (value: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(value);

const shortMoney = (value: number) =>
  value >= 100000
    ? `Rs ${(value / 100000).toFixed(1)}L`
    : value >= 1000
      ? `Rs ${(value / 1000).toFixed(1)}k`
      : `Rs ${value}`;

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [entryType, setEntryType] = useState<EntryType>("debit");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const descriptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/expenses")
      .then((response) => response.json())
      .then((data: { expenses?: Expense[] }) => {
        if (data.expenses?.length) {
          setExpenses(data.expenses);
        } else {
          setExpenses(demoExpenses);
          setIsDemo(true);
        }
      })
      .catch(() => {
        setExpenses(demoExpenses);
        setIsDemo(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const realExpenses = isDemo ? [] : expenses;
  const currentMonthExpenses = useMemo(() => {
    const now = new Date();
    return expenses.filter((item) => {
      const date = new Date(item.createdAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
  }, [expenses]);

  const totals = useMemo(() => {
    const credits = currentMonthExpenses
      .filter((item) => item.type === "credit")
      .reduce((sum, item) => sum + item.amount, 0);
    const debits = currentMonthExpenses
      .filter((item) => item.type === "debit")
      .reduce((sum, item) => sum + item.amount, 0);
    return { credits, debits, balance: credits - debits };
  }, [currentMonthExpenses]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    currentMonthExpenses
      .filter((item) => item.type === "debit")
      .forEach((item) => map.set(item.category, (map.get(item.category) || 0) + item.amount));
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [currentMonthExpenses]);

  const todayTotal = useMemo(() => {
    const now = new Date();
    return expenses
      .filter((item) => {
        const date = new Date(item.createdAt);
        return item.type === "debit" && date.toDateString() === now.toDateString();
      })
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses]);

  const maxCategory = Math.max(...categories.map((item) => item.value), 1);
  const spendTotal = Math.max(totals.debits, 1);
  const donutStops = useMemo(() => {
    let cursor = 0;
    const stops = categories.slice(0, 5).map((item) => {
      const start = cursor;
      cursor += (item.value / spendTotal) * 100;
      return `${categoryMeta[item.name]?.color || categoryMeta.Other.color} ${start}% ${cursor}%`;
    });
    if (cursor < 100) stops.push(`#eee9df ${cursor}% 100%`);
    return stops.join(", ");
  }, [categories, spendTotal]);

  const addExpense = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAmount = Number(amount.replace(/,/g, ""));
    if (!description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setNotice("Add a description and a valid amount.");
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), amount: parsedAmount, type: entryType }),
      });
      if (!response.ok) throw new Error("Unable to save");
      const data = (await response.json()) as { expense: Expense };
      setExpenses((current) => [data.expense, ...(isDemo ? [] : current)]);
      setIsDemo(false);
      setDescription("");
      setAmount("");
      setNotice(`${entryType === "debit" ? "Expense" : "Credit"} added — categorized as ${data.expense.category}.`);
      descriptionRef.current?.focus();
    } catch {
      setNotice("Couldn’t save that entry. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (id: string) => {
    if (id.startsWith("demo-")) return;
    const previous = expenses;
    setExpenses((items) => items.filter((item) => item.id !== id));
    try {
      const response = await fetch(`/api/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
    } catch {
      setExpenses(previous);
      setNotice("Couldn’t remove that entry.");
    }
  };

  const exportCsv = () => {
    const rows = [
      ["Date", "Description", "Category", "Type", "Amount"],
      ...expenses.map((item) => [
        new Date(item.createdAt).toLocaleDateString("en-PK"),
        item.description,
        item.category,
        item.type,
        String(item.amount),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kharcha-expenses.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>Kharcha</strong>
            <span>Money, made simple.</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#overview"><LayoutDashboard size={18} /> Overview</a>
          <a className="nav-item" href="#transactions"><ReceiptText size={18} /> Transactions</a>
          <a className="nav-item" href="#analytics"><TrendingUp size={18} /> Analytics</a>
          <a className="nav-item" href="#goals"><Target size={18} /> Budget goals <span className="soon">Soon</span></a>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><CircleHelp size={18} /> Help & tips</button>
          <button className="nav-item"><Settings size={18} /> Settings</button>
          <div className="profile">
            <div className="avatar">ME</div>
            <div><strong>My wallet</strong><span>Personal account</span></div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>

      {mobileMenu && <button aria-label="Close menu" className="menu-scrim" onClick={() => setMobileMenu(false)} />}

      <section className="content">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu(true)} aria-label="Open navigation">
            <MoreHorizontal size={22} />
          </button>
          <div className="date-chip"><CalendarDays size={16} /> {new Date().toLocaleDateString("en-PK", { month: "long", year: "numeric" })} <ChevronDown size={15} /></div>
          <div className="top-actions">
            {isDemo && <span className="demo-badge"><Sparkles size={14} /> Preview data</span>}
            <button className="icon-button" aria-label="Search"><Search size={19} /></button>
            <button className="export-button" onClick={exportCsv}><Download size={16} /> Export</button>
          </div>
        </header>

        <div className="dashboard" id="overview">
          <section className="welcome">
            <div>
              <p className="eyebrow">YOUR MONEY, AT A GLANCE</p>
              <h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"} <span>👋</span></h1>
              <p>Capture it now. Understand it later.</p>
            </div>
            <div className="daily-pill">
              <span>SPENT TODAY</span>
              <strong>{money(todayTotal)}</strong>
              <small><TrendingDown size={13} /> On track for your daily pace</small>
            </div>
          </section>

          <section className="quick-entry">
            <div className="quick-entry-copy">
              <div className="zap-icon"><Zap size={20} fill="currentColor" /></div>
              <div><strong>Quick add</strong><span>Type it like you’d say it.</span></div>
            </div>
            <form onSubmit={addExpense}>
              <div className="type-toggle" aria-label="Entry type">
                <button type="button" className={entryType === "debit" ? "selected" : ""} onClick={() => setEntryType("debit")}>Expense</button>
                <button type="button" className={entryType === "credit" ? "selected credit" : ""} onClick={() => setEntryType("credit")}>Credit</button>
              </div>
              <label className="description-field">
                <span className="sr-only">Description</span>
                <input ref={descriptionRef} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What did you spend on?" autoComplete="off" />
              </label>
              <label className="amount-field">
                <span>Rs</span>
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" aria-label="Amount" />
              </label>
              <button className="add-button" disabled={saving} type="submit"><Plus size={19} /> {saving ? "Adding…" : "Add"}</button>
            </form>
            <div className="entry-foot">
              <span>{notice || "Try “lunch with Ali” or “electricity bill” — we’ll sort the category."}</span>
              <span className="shortcut">Press <kbd>Enter</kbd></span>
            </div>
          </section>

          <section className="metrics-grid">
            <article className="metric-card">
              <div className="metric-icon purple"><WalletCards size={19} /></div>
              <div className="metric-label">AVAILABLE BALANCE <CircleHelp size={13} /></div>
              <strong>{money(totals.balance)}</strong>
              <span className="positive"><TrendingUp size={14} /> Credits minus spending</span>
            </article>
            <article className="metric-card">
              <div className="metric-icon coral"><ArrowUpRight size={19} /></div>
              <div className="metric-label">MONTHLY SPENDING</div>
              <strong>{money(totals.debits)}</strong>
              <span className="neutral">Across {categories.length || 0} categories</span>
            </article>
            <article className="metric-card">
              <div className="metric-icon green"><ArrowDownLeft size={19} /></div>
              <div className="metric-label">MONEY IN</div>
              <strong>{money(totals.credits)}</strong>
              <span className="positive"><TrendingUp size={14} /> Credits this month</span>
            </article>
          </section>

          <section className="insights-grid" id="analytics">
            <article className="panel category-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">MONTHLY ANALYSIS</p><h2>Where your money went</h2></div>
                <button aria-label="More options"><MoreHorizontal size={19} /></button>
              </div>
              <div className="category-chart">
                <div className="donut" style={{ background: `conic-gradient(${donutStops})` }}>
                  <div className="donut-center"><span>Total spent</span><strong>{shortMoney(totals.debits)}</strong></div>
                </div>
                <div className="category-list">
                  {categories.slice(0, 5).map((item) => (
                    <div className="category-row" key={item.name}>
                      <div className="category-name"><span style={{ background: categoryMeta[item.name]?.color || categoryMeta.Other.color }} />{item.name}</div>
                      <div className="bar-track"><div style={{ width: `${Math.max(8, (item.value / maxCategory) * 100)}%`, background: categoryMeta[item.name]?.color || categoryMeta.Other.color }} /></div>
                      <strong>{money(item.value)}</strong>
                    </div>
                  ))}
                  {!categories.length && <p className="empty-copy">Your category breakdown will appear after your first expense.</p>}
                </div>
              </div>
            </article>

            <article className="panel recap-panel">
              <div className="recap-top">
                <span className="recap-icon"><Sparkles size={19} /></span>
                <div><p className="eyebrow">DAILY RECAP</p><h2>Today, in a nutshell</h2></div>
              </div>
              <div className="recap-number">
                <span>You spent</span>
                <strong>{money(todayTotal)}</strong>
                <small>{todayTotal > 0 ? "Your daily report updates with every entry." : "No expenses recorded today yet."}</small>
              </div>
              <div className="insight-note">
                <Coffee size={18} />
                <p><strong>{categories[0]?.name || "Your top category"} leads this month.</strong> {categories[0] ? `${Math.round((categories[0].value / spendTotal) * 100)}% of spending went there.` : "Add a few entries and Kharcha will spot your patterns."}</p>
              </div>
              <div className="month-progress">
                <div><span>Month progress</span><strong>{Math.round((new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 100)}%</strong></div>
                <div className="progress-track"><span style={{ width: `${(new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 100}%` }} /></div>
              </div>
            </article>
          </section>

          <section className="panel transactions-panel" id="transactions">
            <div className="panel-heading">
              <div><p className="eyebrow">LATEST ACTIVITY</p><h2>Recent transactions</h2></div>
              <span>{expenses.length} entries</span>
            </div>
            <div className="transaction-list">
              {loading ? (
                <div className="loading-row">Loading your wallet…</div>
              ) : expenses.slice(0, 7).map((item) => {
                const meta = categoryMeta[item.category] || categoryMeta.Other;
                const Icon = meta.icon;
                return (
                  <div className="transaction" key={item.id}>
                    <div className="transaction-icon" style={{ color: meta.color, background: `${meta.color}18` }}><Icon size={18} /></div>
                    <div className="transaction-copy"><strong>{item.description}</strong><span>{item.category} · {new Date(item.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</span></div>
                    <span className={`transaction-amount ${item.type}`}>{item.type === "credit" ? "+" : "−"} {money(item.amount)}</span>
                    {!item.id.startsWith("demo-") && <button className="delete-button" onClick={() => deleteExpense(item.id)} aria-label={`Delete ${item.description}`}><Trash2 size={16} /></button>}
                  </div>
                );
              })}
            </div>
          </section>

          <footer>Kharcha keeps your money story simple, private, and useful.</footer>
        </div>
      </section>
    </main>
  );
}
