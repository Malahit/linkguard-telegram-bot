import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, linkChecksTable, usersTable } from "@workspace/db";
import {
  CheckLinkBody,
  CheckLinkResponse,
  GetLinkHistoryQueryParams,
  GetLinkHistoryResponse,
  GetLinkStatsQueryParams,
  GetLinkStatsResponse,
  ReportToParentBody,
  ReportToParentResponse,
} from "@workspace/api-zod";
import { checkUrl } from "../lib/risk-engine";

const router: IRouter = Router();

router.post("/links/check", async (req, res): Promise<void> => {
  const parsed = CheckLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { url, telegramUserId } = parsed.data;

  const user = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramUserId, telegramUserId))
    .limit(1);

  const trustedDomains = user[0]?.trustedDomains ?? [];

  const result = await checkUrl(url, trustedDomains);

  const [saved] = await db
    .insert(linkChecksTable)
    .values({
      telegramUserId,
      url,
      normalizedUrl: result.normalizedUrl,
      verdict: result.verdict,
      threatTypes: result.threatTypes,
      explanation: result.explanation,
      isTrustedDomain: trustedDomains.some((td) => result.normalizedUrl.includes(td)),
    })
    .returning();

  res.json(
    CheckLinkResponse.parse({
      id: saved.id,
      url: saved.url,
      normalizedUrl: saved.normalizedUrl,
      verdict: saved.verdict,
      threatTypes: saved.threatTypes,
      explanation: saved.explanation,
      checkedAt: saved.checkedAt,
      isTrustedDomain: saved.isTrustedDomain,
    })
  );
});

router.get("/links/history", async (req, res): Promise<void> => {
  const parsed = GetLinkHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { telegramUserId, limit } = parsed.data;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(linkChecksTable)
      .where(eq(linkChecksTable.telegramUserId, telegramUserId))
      .orderBy(desc(linkChecksTable.checkedAt))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(linkChecksTable)
      .where(eq(linkChecksTable.telegramUserId, telegramUserId)),
  ]);

  res.json(
    GetLinkHistoryResponse.parse({
      items: items.map((item) => ({
        id: item.id,
        url: item.url,
        verdict: item.verdict,
        explanation: item.explanation,
        checkedAt: item.checkedAt,
        reportedToParent: item.reportedToParent,
      })),
      total: countResult[0]?.count ?? 0,
    })
  );
});

router.get("/links/stats", async (req, res): Promise<void> => {
  const parsed = GetLinkStatsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { telegramUserId } = parsed.data;

  const rows = await db
    .select({
      verdict: linkChecksTable.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(linkChecksTable)
    .where(eq(linkChecksTable.telegramUserId, telegramUserId))
    .groupBy(linkChecksTable.verdict);

  const reportsRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(linkChecksTable)
    .where(
      and(
        eq(linkChecksTable.telegramUserId, telegramUserId),
        eq(linkChecksTable.reportedToParent, true)
      )
    );

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    counts[row.verdict] = row.count;
    total += row.count;
  }

  res.json(
    GetLinkStatsResponse.parse({
      totalChecked: total,
      safeCount: counts["safe"] ?? 0,
      cautionCount: counts["caution"] ?? 0,
      dangerCount: counts["danger"] ?? 0,
      unknownCount: counts["unknown"] ?? 0,
      reportsToParent: reportsRow[0]?.count ?? 0,
    })
  );
});

router.post("/links/report-to-parent", async (req, res): Promise<void> => {
  const parsed = ReportToParentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { linkCheckId, telegramUserId } = parsed.data;

  const [check] = await db
    .select()
    .from(linkChecksTable)
    .where(
      and(
        eq(linkChecksTable.id, linkCheckId),
        eq(linkChecksTable.telegramUserId, telegramUserId)
      )
    )
    .limit(1);

  if (!check) {
    res.status(404).json({ error: "Проверка не найдена" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.telegramUserId, telegramUserId))
    .limit(1);

  await db
    .update(linkChecksTable)
    .set({ reportedToParent: true, parentReportedAt: new Date() })
    .where(eq(linkChecksTable.id, linkCheckId));

  const parentContact = user?.parentContact;

  res.json(
    ReportToParentResponse.parse({
      success: true,
      message: parentContact
        ? `Результат проверки отправлен взрослому (@${parentContact}).`
        : "Результат сохранён. Добавь контакт взрослого в настройках, чтобы отправить им уведомление.",
    })
  );
});

export default router;
