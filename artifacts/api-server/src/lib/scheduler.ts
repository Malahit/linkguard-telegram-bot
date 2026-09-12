import cron from "node-cron";
import { eq, sql, and, gt } from "drizzle-orm";
import { db, linkChecksTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendToChannel } from "./telegram-bot";
import { formatDangerAlert } from "./posts-pool";
import { seedSourcesFromEnv, collectAllSources } from "./source-collector";
import { buildSourceDigest, contentHash } from "./source-digest";

const alertedUrls = new Set<string>();

const BOT_URL = "https://t.me/chistyi_signal_bot";

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

/** Ежедневный пост = дайджест из материалов источников (10:00 MSK). */
async function publishDailyDigest(): Promise<void> {
  try {
    await collectSources();
    const digest = await buildSourceDigest();
    if (!digest) {
      logger.warn("Daily digest: no fresh source material — post skipped");
      return;
    }

    const hash = contentHash(digest.text);
    const existing = await db
      .select({ id: channelPostsTable.id })
      .from(channelPostsTable)
      .where(eq(channelPostsTable.titleHash, hash))
      .limit(1);
    if (existing.length > 0) {
      logger.info("Daily digest: already published, skipped");
      return;
    }

    const title =
      digest.text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
        ?.slice(0, 120) ?? "Дайджест";

    const ok = await sendToChannel(digest.text, [
      [{ text: "🔗 Проверить ссылку", url: BOT_URL }],
    ]);
    if (!ok) {
      logger.error("Daily digest: sendToChannel failed");
      return;
    }

    await db
      .insert(channelPostsTable)
      .values({ postType: "digest", titleHash: hash, title, text: digest.text })
      .onConflictDoNothing();
    logger.info({ title }, "Daily digest sent to channel");
  } catch (err) {
    logger.error({ err }, "Daily digest job failed");
  }
}

export function startScheduler(): void {
  // Ежедневный дайджест из источников в 10:00 MSK (07:00 UTC)
  cron.schedule("0 7 * * *", () => void publishDailyDigest(), { timezone: "UTC" });

  // Промежуточный сбор материалов каждые 6 часов, чтобы накопить свежие посты
  cron.schedule(
    "20 */6 * * *",
    () => void collectSources(),
    { timezone: "UTC" },
  );

  logger.info(
    "Scheduler started — source digest daily at 10:00 MSK, collect every 6h",
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
