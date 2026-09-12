/**
 * source-digest.ts
 *
 * Собирает ежедневный дайджест канала @bezstrahavseti из материалов,
 * собранных коллектором (source-collector) из профильных telegram-каналов.
 * В отличие от прежнего generateDailyNews — не «выдумывает» новости
 * свободным веб-поиском, а перерабатывает конкретные посты источников.
 */
import OpenAI from "openai";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, sourceItemsTable, sourcesTable, channelPostsTable } from "@workspace/db";
import { logger } from "./logger";

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

/**
 * Формирует дайджест из свежих неиспользованных материалов источников.
 * Возвращает null, если материалов нет или LLM недоступна.
 * Успешно использованные материалы помечаются used_at.
 */
export async function buildSourceDigest(): Promise<SourceDigest | null> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

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
      return `[${idx + 1}] Источник: ${source}\n${item.text.slice(0, MAX_ITEM_CHARS)}`;
    })
    .join("\n\n");

  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const systemPrompt = `Ты — редактор Telegram-канала @bezstrahavseti о цифровой безопасности для обычных людей (подростки 12–18 и родители).
Стиль: живой, человечный, без занудства и запугивания. Без звёздочек и Markdown-разметки.
Аудитория: подростки и родители, не специалисты по ИБ.`;

  const userPrompt = `Ниже — свежие материалы из профильных каналов по безопасности за ${today}.
Сделай из них короткий дайджест для канала @bezstrahavseti.

Требования:
- 2–4 коротких пункта (абзаца), каждый — отдельная тема/угроза
- Пиши своими словами, не копируй тексты дословно
- Практическая польза: что делать или чего избегать
- Без хэштегов и без заголовка «Дайджест»
- В конце — одна строка с призывом проверять подозрительные ссылки через бота
- Не повторяй темы из списка уже опубликованного: ${avoid.length > 0 ? avoid.join("; ") : "нет"}
- Объём: 150–250 слов

Материалы:
${materials}`;

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
