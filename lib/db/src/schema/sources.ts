import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Источники материала для ежедневного дайджеста канала @bezstrahavseti.
 * Читаются публично через https://t.me/s/<slug> (без сессий и токенов).
 */
export const sourcesTable = pgTable("sources", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().default("telegram_channel"),
  slug: text("slug").notNull().unique(),
  url: text("url").notNull(),
  title: text("title"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Собранные посты источников (дедуп по source_id + external_id). */
export const sourceItemsTable = pgTable(
  "source_items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sourcesTable.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title"),
    text: text("text").notNull(),
    sourceUrl: text("source_url"),
    postedAt: timestamp("posted_at"),
    collectedAt: timestamp("collected_at").notNull().defaultNow(),
    /** Когда материал попал в опубликованный дайджест. */
    usedAt: timestamp("used_at"),
  },
  (table) => ({
    uniqSourceExternal: uniqueIndex("ux_source_items_source_external").on(
      table.sourceId,
      table.externalId,
    ),
  }),
);

/** История публикаций канала — защита от повторной отправки. */
export const channelPostsTable = pgTable("channel_posts", {
  id: serial("id").primaryKey(),
  postType: text("post_type").notNull().default("digest"),
  titleHash: text("title_hash").notNull().unique(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  messageId: integer("message_id"),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
});

export type Source = typeof sourcesTable.$inferSelect;
export type SourceItem = typeof sourceItemsTable.$inferSelect;
export type ChannelPost = typeof channelPostsTable.$inferSelect;
