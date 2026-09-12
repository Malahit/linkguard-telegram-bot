/**
 * source-parser.ts
 *
 * Чистый парсер HTML веб-превью telegram-канала (https://t.me/s/<slug>).
 * Без зависимостей и без импорта БД — пригоден для unit-тестов.
 */

export interface CollectedPost {
  externalId: string;
  text: string;
  postedAt: Date | null;
  sourceUrl: string;
}

const MAX_TEXT_LENGTH = 4_000;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = hex
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return ENTITIES[entity.toLowerCase()] ?? full;
  });
}

function findClosingDiv(html: string, from: number): number {
  let depth = 1;
  let i = from;
  const openRe = /<div\b/gi;
  const closeRe = /<\/div>/gi;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose.index;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

function extractMessageText(block: string): string {
  const marker = block.indexOf("tgme_widget_message_text");
  if (marker === -1) return "";
  const openEnd = block.indexOf(">", marker);
  if (openEnd === -1) return "";
  const contentStart = openEnd + 1;
  const contentEnd = findClosingDiv(block, contentStart);
  const raw = block.slice(contentStart, contentEnd === -1 ? undefined : contentEnd);
  const withBreaks = raw.replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return decodeEntities(stripped)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/** Приводит любой ввод (@name, t.me/name, https://t.me/s/name) к slug канала. */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^t\.me\/(s\/)?/i, "")
    .replace(/^telegram\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .trim();
}

/** Парсит HTML веб-превью канала в список постов. Чистая функция. */
export function parseChannelHtml(html: string, slug: string): CollectedPost[] {
  const cleanSlug = normalizeSlug(slug);
  const markers: { id: string; index: number }[] = [];
  const re = /data-post="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    markers.push({ id: match[1]!, index: match.index });
  }

  const posts: CollectedPost[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index;
    const end = i + 1 < markers.length ? markers[i + 1]!.index : html.length;
    const block = html.slice(start, end);

    const text = extractMessageText(block);
    if (!text) continue;

    const externalId = markers[i]!.id;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const dateMatch = /<time[^>]*datetime="([^"]+)"/.exec(block);
    let postedAt: Date | null = null;
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]!);
      if (!Number.isNaN(parsed.getTime())) postedAt = parsed;
    }

    const numericId = externalId.includes("/")
      ? externalId.slice(externalId.lastIndexOf("/") + 1)
      : externalId;

    posts.push({
      externalId,
      text,
      postedAt,
      sourceUrl: `https://t.me/${cleanSlug}/${numericId}`,
    });
  }
  return posts;
}
