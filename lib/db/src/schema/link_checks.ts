import { pgTable, text, boolean, timestamp, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const linkChecksTable = pgTable("link_checks", {
  id: serial("id").primaryKey(),
  telegramUserId: text("telegram_user_id").notNull(),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  verdict: text("verdict").notNull().$type<"safe" | "caution" | "danger" | "unknown">(),
  threatTypes: text("threat_types").array().notNull().default([]),
  explanation: text("explanation").notNull(),
  isTrustedDomain: boolean("is_trusted_domain").notNull().default(false),
  reportedToParent: boolean("reported_to_parent").notNull().default(false),
  parentReportedAt: timestamp("parent_reported_at"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});

export const insertLinkCheckSchema = createInsertSchema(linkChecksTable).omit({ id: true });
export type InsertLinkCheck = z.infer<typeof insertLinkCheckSchema>;
export type LinkCheck = typeof linkChecksTable.$inferSelect;
