/**
 * source-collector.ts
 *
 * Сбор публичных постов telegram-каналов через веб-превью https://t.me/s/<slug>.
 * Без сессий, токенов и авторизации — только публично доступные данные.
 */
import { eq } from "drizzle-orm";
import { db, sourcesTable, sourceItemsTable } from "@workspace/db";
import { logger } from "./logger";
import { normalizeSlug, parseChannelHtml, type CollectedPost } from "./source-parser";

export { normalizeSlug, parseChannelHtml } from "./source-parser";
export type { CollectedPost } from "./source-parser";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 20_000;
const RATE_LIMIT_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Загружает и парсит посты одного публичного канала. При ошибке — []. */
export async function fetchChannelPosts(slug: string): Promise<CollectedPost[]> {
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) return [];
  const url = `https://t.me/s/${cleanSlug}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ slug: cleanSlug, status: res.status }, "Collector: bad response");
      return [];
    }
    const html = await res.text();
    const posts = parseChannelHtml(html, cleanSlug);
    logger.info({ slug: cleanSlug, posts: posts.length }, "Collector: channel parsed");
    return posts;
  } catch (err) {
    logger.warn({ err, slug: cleanSlug }, "Collector: fetch failed");
    return [];
  }
}

/**
 * Сидирует источники из env SOURCE_CHANNELS (список @slug через запятую).
 * Идемпотентно: повторный вызов включает источник и обновляет url.
 */
export async function seedSourcesFromEnv(): Promise<number> {
  const raw = process.env["SOURCE_CHANNELS"] ?? "";
  const slugs = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => normalizeSlug(s))
        .filter((s) => s.length > 0),
    ),
  );
  if (slugs.length === 0) return 0;

  for (const slug of slugs) {
    await db
      .insert(sourcesTable)
      .values({ kind: "telegram_channel", slug, url: `https://t.me/s/${slug}` })
      .onConflictDoUpdate({
        target: sourcesTable.slug,
        set: { enabled: true, url: `https://t.me/s/${slug}` },
      });
  }
  return slugs.length;
}

/** Собирает посты по всем включённым источникам, дедуп на уровне БД. */
export async function collectAllSources(): Promise<{ sources: number; inserted: number }> {
  const sources = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.enabled, true));

  let inserted = 0;
  for (const source of sources) {
    const posts = await fetchChannelPosts(source.slug);
    for (const post of posts) {
      const rows = await db
        .insert(sourceItemsTable)
        .values({
          sourceId: source.id,
          externalId: post.externalId,
          text: post.text,
          sourceUrl: post.sourceUrl,
          postedAt: post.postedAt,
        })
        .onConflictDoNothing({
          target: [sourceItemsTable.sourceId, sourceItemsTable.externalId],
        })
        .returning({ id: sourceItemsTable.id });
      if (rows.length > 0) inserted++;
    }
    await sleep(RATE_LIMIT_MS);
  }
  return { sources: sources.length, inserted };
}
