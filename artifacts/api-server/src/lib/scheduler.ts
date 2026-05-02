import cron from "node-cron";
import { logger } from "./logger";
import { sendToChannel } from "./telegram-bot";
import { getPostForDate, formatPost, formatDangerAlert, getRubricForDate } from "./posts-pool";
import { db, linkChecksTable } from "@workspace/db";
import { eq, sql, and, gt } from "drizzle-orm";

const alertedUrls = new Set<string>();

const RUBRIC_LABEL: Record<string, string> = {
  hygiene:   "🧼 Гигиена",
  breakdown: "🎣 Разбор",
  tool:      "🛠 Инструмент",
  quiz:      "🧪 Проверь себя",
  story:     "📖 История",
};

export function startScheduler(): void {
  // Daily post at 10:00 Moscow time (UTC+3 → 07:00 UTC)
  cron.schedule(
    "0 7 * * *",
    async () => {
      const now = new Date();
      const rubric = getRubricForDate(now);
      const post = getPostForDate(now);
      const text = formatPost(post);

      logger.info({ rubric, title: post.title }, `Scheduler: sending daily post [${RUBRIC_LABEL[rubric]}]`);

      const ok = await sendToChannel(text);
      if (ok) {
        logger.info({ rubric, title: post.title }, "Daily post sent to channel");
      }
    },
    { timezone: "UTC" }
  );

  const today = new Date();
  const rubric = getRubricForDate(today);
  logger.info(
    { rubric: RUBRIC_LABEL[rubric] },
    "Scheduler started — daily posts at 10:00 MSK"
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
