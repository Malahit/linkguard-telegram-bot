import cron from "node-cron";
import { eq, sql, and, gt } from "drizzle-orm";
import { db, linkChecksTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendToChannel } from "./telegram-bot";
import { formatDangerAlert } from "./posts-pool";
import { seedSourcesFromEnv, collectAllSources } from "./source-collector";
import { buildSourceDigest, contentHash } from "./source-digest";
import { generatePostForDate } from "./post-generator";
import { getRubricForDate } from "./posts-pool";

const alertedUrls = new Set<string>();

const BOT_URL = "https://t.me/chistyi_signal_bot";

// Повторная публикация идентичного текста допустима только раньше, чем через
// REPOST_GUARD_HOURS, — защита от дубля при рестарте процесса в один день.
// Сами рубрики из пула повторяются раз в ~8 недель — это нормальная ротация.
const REPOST_GUARD_HOURS = 40;

const RUBRIC_LABEL: Record<string, string> = {
  hygiene: "🧼 Гигиена",
  breakdown: "🎣 Разбор",
  tool: "🛠 Инструмент",
  quiz: "🧪 Проверь себя",
  story: "📖 История",
};

// Кнопка «проверить ссылку» в каждом посте (возвращена в 3657fe2).
const CHECK_BUTTON = [[{ text: "🔗 Проверить ссылку", url: BOT_URL }]];

/** Сбор материалов из источников (best-effort, без падения джобы). */
async function collectSources(): Promise<void> {
  try {
    await seedSourcesFromEnv();
    const stats = await collectAllSources();
    logger.info(stats, "Source collector: done");
  } catch (err) {
    logger.error({ err }, "Source collector failed");
  }
}

/** Воскресный пост = дайджест из материалов источников (10:00 MSK). */
async function publishDailyDigest(): Promise<void> {
  try {
    await collectSources();
    const digest = await buildSourceDigest();
    if (!digest) {
      logger.warn("Sunday digest: no fresh source material — post skipped");
      return;
    }

    const hash = contentHash(digest.text);
    const existing = await db
      .select({ id: channelPostsTable.id })
      .from(channelPostsTable)
      .where(eq(channelPostsTable.titleHash, hash))
      .limit(1);
    if (existing.length > 0) {
      logger.info("Sunday digest: already published, skipped");
      return;
    }

    const title =
      digest.text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
        ?.slice(0, 120) ?? "Дайджест";

    const ok = await sendToChannel(digest.text, CHECK_BUTTON);
    if (!ok) {
      logger.error("Sunday digest: sendToChannel failed");
      return;
    }

    await db
      .insert(channelPostsTable)
      .values({ postType: "digest", titleHash: hash, title, text: digest.text })
      .onConflictDoNothing();
    logger.info({ title }, "Sunday digest sent to channel");
  } catch (err) {
    logger.error({ err }, "Sunday digest job failed");
  }
}

/**
 * Ежедневный пост по рубрике (CONTENT_PLAN.md, пн–сб, 10:00 MSK):
 *   пн/чт — 🧼 гигиена, вт — 🎣 разбор, ср — 🛠 инструмент,
 *   пт — 🧪 проверь себя, сб — 📖 история.
 * Динамические рубрики (разбор/инструмент/история) сначала пробует AI,
 * при недоступности LLM берет статический пост из posts-pool.
 */
async function publishRubricPost(): Promise<void> {
  try {
    const now = new Date();
    const rubric = getRubricForDate(now);
    const text = await generatePostForDate(now);

    const hash = contentHash(text);
    const guardSince = new Date(Date.now() - REPOST_GUARD_HOURS * 60 * 60 * 1000);
    const existing = await db
      .select({ id: channelPostsTable.id })
      .from(channelPostsTable)
      .where(
        and(eq(channelPostsTable.titleHash, hash), gt(channelPostsTable.publishedAt, guardSince))
      )
      .limit(1);
    if (existing.length > 0) {
      logger.info("Rubric post: identical text already published recently, skipped");
      return;
    }

    const title =
      text
        .split("\n")
        .map((line) => line.replace(/<[^>]+>/g, "").trim())
        .find((line) => line.length > 0)
        ?.slice(0, 120) ?? "Пост";

    const ok = await sendToChannel(text, CHECK_BUTTON);
    if (!ok) {
      logger.error("Rubric post: sendToChannel failed");
      return;
    }

    await db
      .insert(channelPostsTable)
      .values({ postType: "rubric", titleHash: hash, title, text })
      .onConflictDoNothing();
    logger.info(
      { rubric: RUBRIC_LABEL[rubric] ?? rubric, title },
      "Rubric post sent to channel"
    );
  } catch (err) {
    logger.error({ err }, "Rubric post job failed");
  }
}

export function startScheduler(): void {
  // Ежедневный пост в 10:00 MSK (07:00 UTC):
  // воскресенье — дайджест источников, остальная неделя — рубрики CONTENT_PLAN.
  cron.schedule(
    "0 7 * * *",
    () => {
      const today = new Date();
      // Date.getDay(): 0 = воскресенье
      if (today.getDay() === 0) {
        void publishDailyDigest();
      } else {
        void publishRubricPost();
      }
    },
    { timezone: "UTC" }
  );

  // Промежуточный сбор материалов каждые 6 часов, чтобы накопить свежие посты
  cron.schedule(
    "20 */6 * * *",
    () => void collectSources(),
    { timezone: "UTC" },
  );

  const todayRubric = getRubricForDate(new Date());
  logger.info(
    { todayRubric: RUBRIC_LABEL[todayRubric] ?? todayRubric },
    "Scheduler started — rubric post daily at 10:00 MSK (Sun: source digest), collect every 6h"
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
