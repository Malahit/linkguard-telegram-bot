import { db, urlReportsTable } from "@workspace/db";
import { desc, eq, count } from "drizzle-orm";
import { logger } from "./logger";

export type ReportStatus = "pending" | "reviewed" | "confirmed" | "dismissed";

export interface SaveReportInput {
  telegramId: number;
  username?: string;
  url: string;
  comment?: string;
}

export async function saveReport(input: SaveReportInput): Promise<number | null> {
  try {
    const [row] = await db
      .insert(urlReportsTable)
      .values({
        reportedByTelegramId: String(input.telegramId),
        reportedByUsername: input.username ?? null,
        url: input.url,
        comment: input.comment ?? null,
      })
      .returning({ id: urlReportsTable.id });
    logger.info({ id: row?.id, url: input.url }, "URL report saved");
    return row?.id ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to save URL report");
    return null;
  }
}

export async function getPendingReports(limit = 20) {
  return db
    .select()
    .from(urlReportsTable)
    .where(eq(urlReportsTable.status, "pending"))
    .orderBy(desc(urlReportsTable.reportedAt))
    .limit(limit);
}

export async function getPendingCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(urlReportsTable)
    .where(eq(urlReportsTable.status, "pending"));
  return row?.value ?? 0;
}

export async function updateReportStatus(
  id: number,
  status: ReportStatus
): Promise<boolean> {
  try {
    await db
      .update(urlReportsTable)
      .set({ status, reviewedAt: new Date() })
      .where(eq(urlReportsTable.id, id));
    logger.info({ id, status }, "Report status updated");
    return true;
  } catch (err) {
    logger.error({ err, id }, "Failed to update report status");
    return false;
  }
}
