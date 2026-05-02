import { pgTable, text, timestamp, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const urlReportsTable = pgTable("url_reports", {
  id: serial("id").primaryKey(),
  reportedByTelegramId: text("reported_by_telegram_id").notNull(),
  reportedByUsername: text("reported_by_username"),
  url: text("url").notNull(),
  comment: text("comment"),
  status: text("status").notNull().default("pending").$type<"pending" | "reviewed" | "confirmed" | "dismissed">(),
  reviewedAt: timestamp("reviewed_at"),
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
});

export const insertUrlReportSchema = createInsertSchema(urlReportsTable).omit({ id: true });
export type InsertUrlReport = z.infer<typeof insertUrlReportSchema>;
export type UrlReport = typeof urlReportsTable.$inferSelect;
