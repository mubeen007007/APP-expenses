import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  amount: integer("amount").notNull(),
  type: text("type", { enum: ["debit", "credit"] }).notNull(),
  category: text("category").notNull(),
  createdAt: text("created_at").notNull(),
});
