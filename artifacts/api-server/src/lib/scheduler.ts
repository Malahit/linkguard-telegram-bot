import cron from "node-cron";
import { eq, sql, and, gt } from "drizzle-orm";
import { db, linkChecksTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { sendToChannel } from "./telegram-bot";
import { formatDangerAlert } from "./posts-pool";
import { seedSourcesFromEnv, collectAllSources } from "./source-collector";
import { buildSourceDigest, contentHash, markSourceItemsUsed } from "./source-digest";

const alertedUrls = new Set<string>();
const BOT_URL = "https://t.me/chistyi_signal_bot";

async function collectSources(): Promise<void> {
  try {
    await seedSourcesFromEnv();
    logger.info(await collectAllSources(), "Source collector: done");
  } catch (err) {
    logger.error({ err }, "Source collector failed");
  }
}

async function publishDailyDigest(): Promise<void> {
  try {
    await collectSources();
    const digest = await buildSourceDigest();
    if (!digest) {
      logger.warn("Daily digest: no fresh source material — post skipped");
      return;
    }

    const hash = contentHash(digest.text);
    const existing = await db.select({ id: channelPostsTable.id }).from(channelPostsTable)
      .where(eq(channelPostsTable.titleHash, hash)).limit(1);
    if (existing.length) {
      logger.info("Daily digest: already published, skipped");
      return;
    }

    const title = digest.text.split("\n").map((line) => line.trim())
      .find((line) => line.length > 0)?.slice(0, 120) ?? "Пост";
    const ok = await sendToChannel(digest.text, [[{ text: "🔗 Проверить ссылку", url: BOT_URL }]]);
    if (!ok) {
      logger.error("Daily digest: sendToChannel failed");
      return;
    }

    try {
      await markSourceItemsUsed(digest.itemIds);
    } catch (err) {
      logger.error({ err, itemIds: digest.itemIds }, "Daily digest: could not mark source item used");
    }

    await db.insert(channelPostsTable).values({ postType: "digest", titleHash: hash, title, text: digest.text }).onConflictDoNothing();
    logger.info({ title, itemIds: digest.itemIds }, "Daily digest sent to channel");
  } catch (err) {
    logger.error({ err }, "Daily digest job failed");
  }
}

export function startScheduler(): void {
  cron.schedule("0 7 * * *", () => void publishDailyDigest(), { timezone: "UTC" });
  cron.schedule("20 */6 * * *", () => void collectSources(), { timezone: "UTC" });
  logger.info("Scheduler started — source post daily at 10:00 MSK, collect every 6h");
}

export async function checkAndAlertDangerousUrl(normalizedUrl: string, threatTypes: string[], explanation: string): Promise<void> {
  if (alertedUrls.has(normalizedUrl)) return;
  try {
    let domain = normalizedUrl;
    try { domain = new URL(normalizedUrl.startsWith("http") ? normalizedUrl : `https://${normalizedUrl}`).hostname; } catch {}
    const since = new Date(Date.now() - 48 * 3_600_000);
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(linkChecksTable)
      .where(and(eq(linkChecksTable.verdict, "danger"), sql`${linkChecksTable.normalizedUrl} ILIKE ${`%${domain}%`}`, gt(linkChecksTable.checkedAt, since)));
    const count = row?.count ?? 0;
    if (count < 10) return;
    alertedUrls.add(normalizedUrl);
    if (await sendToChannel(formatDangerAlert(domain, count, threatTypes, explanation))) {
      logger.info({ domain, count }, "Danger URL alert posted to channel");
    }
  } catch (err) {
    logger.error({ err, normalizedUrl }, "Failed to check danger URL alert");
  }
}
