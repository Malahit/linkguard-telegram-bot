import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { eq, sql, and, gt } from "drizzle-orm";
import { db, linkChecksTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendToChannel, sendPollToChannel } from "./telegram-bot";
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

// ─── Вечерний практический блок ───────────────────────────────────────────────
// Формат: один пост в 18:30 МСК, тема зависит от дня недели:
//   пн — разбор реального сообщения, вт — схема (3 красных флага),
//   ср — опрос «проверь себя» (json), чт — слово дня, пт — чек-лист,
//   сб — родительский уголок, вс — «мир за неделю».
// Файлы: artifacts/api-server/evening/<weekday>/NNN-*.txt (или .json для опроса).

const EVENING_DIR =
  process.env["EVENING_DIR"]?.trim() ||
  path.resolve(process.cwd(), "artifacts/api-server/evening");

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function listEveningFiles(weekday: string): string[] {
  try {
    return fs
      .readdirSync(path.join(EVENING_DIR, weekday))
      .filter((name) => name.endsWith(".txt") || name.endsWith(".json"))
      .sort();
  } catch (err) {
    logger.error({ err, weekday, dir: EVENING_DIR }, "Evening: cannot read directory");
    return [];
  }
}

async function publishEveningPost(): Promise<void> {
  const now = new Date();
  const weekday = WEEKDAYS[now.getDay()]!;
  const files = listEveningFiles(weekday);
  if (files.length === 0) {
    logger.warn({ weekday }, "Evening: no posts for today — skipped");
    return;
  }

  // Ротация по неделям: на каждой следующей неделе берём следующий файл.
  const weekIndex = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
  const file = files[weekIndex % files.length]!;
  const dateKey = now.toISOString().slice(0, 10);
  const hash = contentHash(`evening:${weekday}:${file}:${dateKey}`);

  const existing = await db
    .select({ id: channelPostsTable.id })
    .from(channelPostsTable)
    .where(eq(channelPostsTable.titleHash, hash))
    .limit(1);
  if (existing.length > 0) {
    logger.info({ file }, "Evening: already published today, skipped");
    return;
  }

  const fullPath = path.join(EVENING_DIR, weekday, file);
  let ok = false;
  let title = file;

  if (file.endsWith(".json")) {
    try {
      const poll = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as {
        question: string;
        options: string[];
        correct?: number;
      };
      ok = await sendPollToChannel(poll.question, poll.options, poll.correct);
      title = poll.question.slice(0, 120);
    } catch (err) {
      logger.error({ err, file }, "Evening: invalid poll json");
      return;
    }
  } else {
    const text = fs.readFileSync(fullPath, "utf-8").trim();
    ok = await sendToChannel(text, CHECK_BUTTON);
    title = storyTitle(text);
  }

  if (!ok) {
    logger.error({ file }, "Evening: publish failed");
    return;
  }

  await db
    .insert(channelPostsTable)
    .values({ postType: "evening", titleHash: hash, title, text: title })
    .onConflictDoNothing();
  logger.info({ weekday, file, title }, "Evening: published");
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

  // Вечерний практический пост в 18:30 МСК (15:30 UTC), ротация по дням недели.
  cron.schedule(
    "30 15 * * *",
    () => {
      void publishEveningPost().catch((err) => logger.error({ err }, "Evening: job failed"));
    },
    { timezone: "UTC" }
  );

  logger.info(
    { storiesDir: STORIES_DIR, eveningDir: EVENING_DIR },
    "Scheduler started — story 10:00 MSK, evening practice 18:30 MSK"
  );
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
