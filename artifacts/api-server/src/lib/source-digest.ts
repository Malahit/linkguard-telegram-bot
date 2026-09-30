/**
 * source-digest.ts
 *
 * Собирает ежедневный практический пост канала @bezstrahavseti из материалов
 * профильных telegram-каналов. Название модуля и интерфейс сохранены
 * для совместимости с планировщиком.
 */
import OpenAI from "openai";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, sourceItemsTable, sourcesTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";
import { buildEditorialPrompts } from "./channel-editorial";

export { contentHash } from "./content-utils";

const LOOKBACK_HOURS = Number(process.env["SOURCE_LOOKBACK_HOURS"] ?? 48);
const MAX_ITEMS = Number(process.env["SOURCE_MAX_ITEMS"] ?? 10);
const AI_MODEL = process.env["OPENAI_MODEL"] ?? "sonar";
const MAX_ITEM_CHARS = 1_200;

let _openai: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!process.env["OPENAI_API_KEY"]) return null;
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env["OPENAI_API_KEY"],
      baseURL: process.env["OPENAI_BASE_URL"],
    });
  }
  return _openai;
}

export interface SourceDigest {
  text: string;
  itemIds: number[];
}

function buildFooter(): string {
  return '\n\n🔗 <a href="https://t.me/bezstrahavseti">Без страха в сети</a>';
}

/** Возвращает null, если материалов нет или LLM недоступна. */
export async function buildSourceDigest(): Promise<SourceDigest | null> {
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const items = await db
    .select({
      id: sourceItemsTable.id,
      text: sourceItemsTable.text,
      sourceUrl: sourceItemsTable.sourceUrl,
      sourceSlug: sourcesTable.slug,
      sourceTitle: sourcesTable.title,
    })
    .from(sourceItemsTable)
    .innerJoin(sourcesTable, eq(sourceItemsTable.sourceId, sourcesTable.id))
    .where(
      and(
        isNull(sourceItemsTable.usedAt),
        gte(sourceItemsTable.collectedAt, since),
        eq(sourcesTable.enabled, true),
      ),
    )
    .orderBy(desc(sourceItemsTable.collectedAt))
    .limit(MAX_ITEMS);

  if (items.length === 0) {
    logger.info("Source digest: no fresh unused material");
    return null;
  }

  const client = getClient();
  if (!client) {
    logger.warn("Source digest: OPENAI_API_KEY not set — skipped");
    return null;
  }

  const recent = await db
    .select({ title: channelPostsTable.title })
    .from(channelPostsTable)
    .orderBy(desc(channelPostsTable.publishedAt))
    .limit(30);
  const avoid = recent.map((r) => r.title).filter(Boolean);

  const materials = items
    .map((item, idx) => {
      const source = item.sourceTitle ?? `@${item.sourceSlug}`;
      return `[${idx + 1}] Источник: ${source}\nСсылка на исходный пост: ${item.sourceUrl ?? "не указана"}\n${item.text.slice(0, MAX_ITEM_CHARS)}`;
    })
    .join("\n\n");

  const today = now.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const { systemPrompt, userPrompt } = buildEditorialPrompts({
    date: now, today, materials, avoid,
  });

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 900,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const body = response.choices[0]?.message?.content?.trim();
    if (!body) {
      logger.warn("Source digest: empty LLM response");
      return null;
    }

    const itemIds = items.map((i) => i.id);
    await db
      .update(sourceItemsTable)
      .set({ usedAt: new Date() })
      .where(inArray(sourceItemsTable.id, itemIds));

    logger.info({ items: itemIds.length }, "Source digest: generated");
    return { text: body + buildFooter(), itemIds };
  } catch (err) {
    logger.warn({ err }, "Source digest: LLM generation failed");
    return null;
  }
}
