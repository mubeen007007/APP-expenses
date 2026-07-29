import { env } from "cloudflare:workers";

export const runtime = "edge";

type EntryType = "debit" | "credit";

const createTableSql = `CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('debit', 'credit')),
  category TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

const createIndexSql = "CREATE INDEX IF NOT EXISTS expenses_created_at_idx ON expenses (created_at DESC)";

async function ensureDb() {
  if (!env.DB) throw new Error("Database binding is unavailable");
  await env.DB.batch([
    env.DB.prepare(createTableSql),
    env.DB.prepare(createIndexSql),
  ]);
  return env.DB;
}

function categorize(description: string, type: EntryType) {
  if (type === "credit") return "Income";
  const value = description.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["Food", ["lunch", "dinner", "breakfast", "restaurant", "cafe", "coffee", "tea", "pizza", "burger", "biryani", "food"]],
    ["Groceries", ["grocery", "groceries", "mart", "supermarket", "milk", "vegetable", "fruit"]],
    ["Transport", ["careem", "uber", "indrive", "ride", "taxi", "fuel", "petrol", "bus", "metro", "parking"]],
    ["Shopping", ["shirt", "dress", "clothes", "clothing", "shoes", "shopping", "daraz", "mall"]],
    ["Bills", ["bill", "electricity", "internet", "mobile", "gas", "water", "subscription", "netflix"]],
    ["Home", ["rent", "repair", "furniture", "home", "cleaning"]],
  ];
  return rules.find(([, terms]) => terms.some((term) => value.includes(term)))?.[0] || "Other";
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    description: String(row.description),
    amount: Number(row.amount) / 100,
    type: row.type as EntryType,
    category: String(row.category),
    createdAt: String(row.created_at),
  };
}

export async function GET() {
  try {
    const db = await ensureDb();
    const result = await db.prepare("SELECT id, description, amount, type, category, created_at FROM expenses ORDER BY created_at DESC LIMIT 500").all();
    return Response.json({ expenses: result.results.map((row) => mapRow(row as Record<string, unknown>)) });
  } catch {
    return Response.json({ expenses: [] }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { description?: string; amount?: number; type?: EntryType };
    const description = body.description?.trim();
    const amount = Number(body.amount);
    const type: EntryType = body.type === "credit" ? "credit" : "debit";
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "Description and a positive amount are required." }, { status: 400 });
    }
    const expense = {
      id: crypto.randomUUID(),
      description: description.slice(0, 180),
      amount,
      type,
      category: categorize(description, type),
      createdAt: new Date().toISOString(),
    };
    const db = await ensureDb();
    await db
      .prepare("INSERT INTO expenses (id, description, amount, type, category, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(expense.id, expense.description, Math.round(expense.amount * 100), expense.type, expense.category, expense.createdAt)
      .run();
    return Response.json({ expense }, { status: 201 });
  } catch {
    return Response.json({ error: "Unable to save expense." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
    const db = await ensureDb();
    await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Unable to delete expense." }, { status: 500 });
  }
}
