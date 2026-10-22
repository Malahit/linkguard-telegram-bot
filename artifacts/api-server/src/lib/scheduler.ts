import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { eq, sql, and, gt } from "drizzle-orm";
import { db, linkChecksTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendToChannel } from "./telegram-bot";
import { formatDangerAlert } from "./posts-pool";
import { contentHash } from "./content-utils";

const alertedUrls = new Set<string>();

const BOT_URL = "https://t.me/chistyi_signal_bot";

// Кнопка «проверить ссылку» в каждом посте канала.
const CHECK_BUTTON = [[{ text: "🔗 Проверить ссылку", url: BOT_URL }]];

// Рубрика канала с 2026-10-22 — истории обычных людей: один файл = один пост.
// Публикуем по одной в день, по порядку имён файлов; факт публикации пишем в
// channel_posts (post_type='story'), чтобы одна и та же история не вышла дважды.
const STORIES_DIR =
  process.env["STORIES_DIR"]?.trim() ||
  path.resolve(process.cwd(), "artifacts/api-server/stories");

function listStoryFiles(): string[] {
  try {
    return fs
      .readdirSync(STORIES_DIR)
      .filter((name) => name.endsWith(".txt"))
      .sort();
  } catch (err) {
    logger.error({ err, dir: STORIES_DIR }, "Stories: cannot read directory");
    return [];
  }
}

function storyTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? "История").slice(0, 120);
}

/** Публикует первую ещё не опубликованную историю из очереди. */
async function publishNextStory(): Promise<void> {
  const files = listStoryFiles();
  if (files.length === 0) {
    logger.warn("Stories: queue is empty — post skipped");
    return;
  }

  for (const file of files) {
    // Идентификатор — имя файла: переименование даст дубль, поэтому имена стабильны.
    const hash = contentHash(`story:${file}`);
    const existing = await db
      .select({ id: channelPostsTable.id })
      .from(channelPostsTable)
      .where(eq(channelPostsTable.titleHash, hash))
      .limit(1);
    if (existing.length > 0) continue;

    const text = fs.readFileSync(path.join(STORIES_DIR, file), "utf-8").trim();
    if (!text) {
      logger.warn({ file }, "Stories: empty file — skipped");
      continue;
    }

    const ok = await sendToChannel(text, CHECK_BUTTON);
    if (!ok) {
      logger.error({ file }, "Stories: sendToChannel failed");
      return;
    }

    const title = storyTitle(text);
    await db
      .insert(channelPostsTable)
      .values({ postType: "story", titleHash: hash, title, text })
      .onConflictDoNothing();
    logger.info({ file, title }, "Stories: published");
    return;
  }

  logger.warn("Stories: all stories already published — add new files");
}

export function startScheduler(): void {
  // Одна история в день в 10:00 МСК (07:00 UTC).
  cron.schedule(
    "0 7 * * *",
    () => {
      void publishNextStory().catch((err) => logger.error({ err }, "Stories: job failed"));
    },
    { timezone: "UTC" }
  );

  logger.info({ dir: STORIES_DIR }, "Scheduler started — daily story at 10:00 MSK");
}

export async function checkAndAlertDangerousUrl(
  normalizedUrl: string,
  threatTypes: string[],
  explanation: string
): Promise<void> {
  if (alertedUrls.has(normalizedUrl)) return;

  try {
    let domain = normalizedUrl;
    try {
      domain = new URL(
        normalizedUrl.startsWith("http") ? normalizedUrl : `https://${normalizedUrl}`
      ).hostname;
    } catch {
      // keep as-is
    }

    const ALERT_THRESHOLD = 10;
    const WINDOW_HOURS = 48;
    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(linkChecksTable)
      .where(
        and(
          eq(linkChecksTable.verdict, "danger"),
          sql`${linkChecksTable.normalizedUrl} ILIKE ${"%" + domain + "%"}`,
          gt(linkChecksTable.checkedAt, since)
        )
      );

    const count = row?.count ?? 0;

    if (count >= ALERT_THRESHOLD) {
      alertedUrls.add(normalizedUrl);
      const text = formatDangerAlert(domain, count, threatTypes, explanation);
      const ok = await sendToChannel(text);
      if (ok) {
        logger.info({ domain, count }, "Danger URL alert posted to channel");
      }
    }
  } catch (err) {
    logger.error({ err, normalizedUrl }, "Failed to check danger URL alert");
  }
}
