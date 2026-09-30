import OpenAI from "openai";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, sourceItemsTable, sourcesTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { buildEditorialPrompts } from "./channel-editorial";

export { contentHash } from "./content-utils";

const LOOKBACK_HOURS = Number(process.env["SOURCE_LOOKBACK_HOURS"] ?? 48);
const AI_MODEL = process.env["OPENAI_MODEL"] ?? "sonar";
const MAX_ITEM_CHARS = 1_200;

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!process.env["OPENAI_API_KEY"]) return null;
  if (!client) client = new OpenAI({
    apiKey: process.env["OPENAI_API_KEY"], baseURL: process.env["OPENAI_BASE_URL"],
  });
  return client;
}

export interface SourceDigest { text: string; itemIds: number[]; }
type LlmChoice = { finish_reason: string | null; message?: { content?: string | null } };

function buildFooter(): string {
  return '\n\n🔗 <a href="https://t.me/bezstrahavseti">Без страха в сети</a>';
}

export function isCompleteLlmResponse(choice: LlmChoice | undefined): boolean {
  return choice?.finish_reason === "stop" && Boolean(choice.message?.content?.trim());
}

/** Вызывается только после успешной отправки в Telegram. */
export async function markSourceItemsUsed(itemIds: number[]): Promise<void> {
  if (!itemIds.length) return;
  await db.update(sourceItemsTable).set({ usedAt: new Date() })
    .where(inArray(sourceItemsTable.id, itemIds));
}

/** Генерирует пост из одного свежего материала, не меняя used_at. */
export async function buildSourceDigest(): Promise<SourceDigest | null> {
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);
  const items = await db.select({
    id: sourceItemsTable.id, text: sourceItemsTable.text,
    sourceUrl: sourceItemsTable.sourceUrl, sourceSlug: sourcesTable.slug,
    sourceTitle: sourcesTable.title,
  }).from(sourceItemsTable).innerJoin(sourcesTable, eq(sourceItemsTable.sourceId, sourcesTable.id))
    .where(and(isNull(sourceItemsTable.usedAt), gte(sourceItemsTable.collectedAt, since), eq(sourcesTable.enabled, true)))
    .orderBy(desc(sourceItemsTable.collectedAt)).limit(1);

  if (!items.length) { logger.info("Source digest: no fresh unused material"); return null; }
  const api = getClient();
  if (!api) { logger.warn("Source digest: OPENAI_API_KEY not set — skipped"); return null; }

  const recent = await db.select({ title: channelPostsTable.title }).from(channelPostsTable)
    .orderBy(desc(channelPostsTable.publishedAt)).limit(30);
  const item = items[0]!;
  const source = item.sourceTitle ?? `@${item.sourceSlug}`;
  const materials = `[1] Источник: ${source}\nСсылка на исходный пост: ${item.sourceUrl ?? "не указана"}\n${item.text.slice(0, MAX_ITEM_CHARS)}`;
  const today = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const { systemPrompt, userPrompt } = buildEditorialPrompts({
    date: now, today, materials, avoid: recent.map((row) => row.title).filter(Boolean),
  });

  try {
    const response = await api.chat.completions.create({
      model: AI_MODEL, max_tokens: 900,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    });
    const choice = response.choices[0];
    if (!isCompleteLlmResponse(choice)) {
      logger.warn({ finishReason: choice?.finish_reason }, "Source digest: incomplete or empty LLM response");
      return null;
    }
    logger.info({ items: 1 }, "Source digest: generated");
    return { text: choice.message.content.trim() + buildFooter(), itemIds: [item.id] };
  } catch (err) {
    logger.warn({ err }, "Source digest: LLM generation failed");
    return null;
  }
}
