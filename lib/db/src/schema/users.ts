import { pgTable, text, boolean, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramUserId: text("telegram_user_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  username: text("username"),
  parentContact: text("parent_contact"),
  trustedDomains: text("trusted_domains").array().notNull().default([]),
  notifyParentOnDanger: boolean("notify_parent_on_danger").notNull().default(false),
  language: text("language").notNull().default("ru"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
