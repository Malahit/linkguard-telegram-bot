import cron from "node-cron";
import { logger } from "./logger";
import { sendToChannel } from "./telegram-bot";
import { getPostForDay, formatPost, formatDangerAlert } from "./posts-pool";
import { db, linkChecksTable } from "@workspace/db";
import { eq, sql, and, gt } from "drizzle-orm";

// Track which danger URLs we've already alerted about (in-memory, resets on restart)
const alertedUrls = new Set<string>();

export function startScheduler(): void {
  // Daily post at 10:00 Moscow time (UTC+3 = 07:00 UTC)
  cron.schedule(
    "0 7 * * *",
    async () => {
      logger.info("Scheduler: sending daily hygiene post");
      const post = getPostForDay();
      const text = formatPost(post);
      const ok = await sendToChannel(text);
      if (ok) {
        logger.info({ title: post.title }, "Daily post sent to channel");
      }
    },
    { timezone: "UTC" }
  );

  logger.info("Scheduler started — daily posts at 10:00 MSK");
}

export async function checkAndAlertDangerousUrl(
  normalizedUrl: string,
  threatTypes: string[],
  explanation: string
): Promise<void> {
  if (alertedUrls.has(normalizedUrl)) return;

  try {
    // Extract domain for grouping (avoid counting subpaths separately)
    let domain = normalizedUrl;
    try {
      domain = new URL(normalizedUrl.startsWith("http") ? normalizedUrl : `https://${normalizedUrl}`).hostname;
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
