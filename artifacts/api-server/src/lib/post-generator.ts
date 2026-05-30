import OpenAI from "openai";
import { logger } from "./logger";
import { getPostForDate, formatPost, getRubricForDate } from "./posts-pool";
import { saveDraft, todayKey } from "./draft-store";
import type { Rubric } from "./posts-pool";

// ─── OpenAI client (shared pattern from ai-daily-news.ts) ────────────────────

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

const AI_MODEL = process.env["OPENAI_MODEL"] ?? "sonar";

// ─── Rubrics where AI generates fresh content ────────────────────────────────

const DYNAMIC_RUBRICS: Set<Rubric> = new Set(["breakdown", "story", "tool"]);

// ─── Prompts per rubric ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — редактор Telegram-канала @bezstrahavseti о цифровой безопасности для обычных людей.
Стиль: живой, человечный, без занудства и запугивания. Без звёздочек и Markdown-разметки.
Аудитория: подростки и молодые взрослые (16–35 лет).
Принципы: конкретно, одно действие или одно знание на пост, теория только если ведёт к практике.`;

const USER_PROMPTS: Record<string, (date: string) => string> = {
  breakdown: (date) =>
    `Напиши пост-разбор реальной схемы мошенников для канала @bezstrahavseti. Дата: ${date}.

Требования:
- Найди актуальную схему мошенничества (за последние 1–2 недели) или опиши вечно актуальный сценарий
- Структура: как начинается → что происходит дальше → как распознать → одно конкретное правило
- Используй эмодзи-маркеры (🔴 для опасного, ✅ для защиты)
- Длина: 150–220 слов
- Начни с заголовка вида: 🎣 Разбор: [название схемы]
- В конце добавь: #разбор и 2–3 тематических хэштега
- Заголовок должен содержать поисковую фразу — то, что люди реально вводят в Google.
  Пример: «Как распознать фишинг за 10 секунд», «Мошенники в Telegram: новая схема»
- Одна строка — органичный призыв поделиться. Помести её последней строкой перед хэштегами.`,

  story: (date) =>
    `Напиши пост-историю от первого лица (или от лица персонажа) для канала @bezstrahavseti. Дата: ${date}.

Требования:
- Реалистичная история: человек попался на мошенников или почти попался
- Герой — обычный человек (имя, возраст, что произошло)
- Структура: завязка → момент когда всё пошло не так → последствия → что помогло бы
- Без морализаторства — история сама говорит за себя
- Длина: 150–220 слов
- Начни с заголовка вида: 📖 История: «[короткая фраза от героя]»
- В конце: #история и 2–3 тематических хэштега
- Заголовок должен содержать поисковую фразу — то, что люди реально вводят в Google.
- Одна строка — органичный призыв поделиться. Помести её последней строкой перед хэштегами.`,

  tool: (date) =>
    `Напиши пост-обзор конкретного инструмента для цифровой безопасности для канала @bezstrahavseti. Дата: ${date}.

Требования:
- Один конкретный инструмент (приложение, сайт, настройка, расширение)
- Предпочти что-то актуальное или малоизвестное — не Bitwarden/Signal (уже были)
- Структура: что делает → почему стоит доверять → как начать за 3 шага
- Используй ✅ для преимуществ
- Длина: 150–220 слов
- Начни с заголовка вида: 🛠 Инструмент: [название]
- В конце: #инструмент и 2–3 тематических хэштега
- Заголовок должен содержать поисковую фразу — то, что люди реально вводят в Google.
- Одна строка — органичный призыв поделиться. Помести её последней строкой перед хэштегами.`,
};

// ─── Footer appended to every AI-generated post ──────────────────────────────

function buildFooter(): string {
  return "\n\n🔗 <a href=\"https://t.me/bezstrahavseti\">Без страха в сети</a>";
}

// ─── Core text generation (shared) ───────────────────────────────────────────

async function generateText(rubric: string, date: Date): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const userPromptFn = USER_PROMPTS[rubric];
  if (!userPromptFn) return null;

  const today = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const response = await client.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 700,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPromptFn(today) },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim();
  return text || null;
}

// ─── Generate a DRAFT (admin preview, not published yet) ─────────────────────

/**
 * Generates the post for today, saves it to draft-store, and returns
 * the draft text. The admin can then /approve or /discard it.
 */
export async function generateDraftForDate(date: Date = new Date()): Promise<string> {
  const rubric = getRubricForDate(date);
  const staticPost = getPostForDate(date);
  const dateKey = todayKey();

  let text: string;

  if (!DYNAMIC_RUBRICS.has(rubric)) {
    text = formatPost(staticPost);
  } else {
    try {
      const aiText = await generateText(rubric, date);
      text = aiText ? aiText + buildFooter() : formatPost(staticPost);
    } catch (err) {
      logger.warn({ err, rubric }, "Draft generation: AI failed — using pool post");
      text = formatPost(staticPost);
    }
  }

  saveDraft(dateKey, text);
  logger.info({ dateKey, rubric }, "Draft saved");
  return text;
}

// ─── Main export (auto-publish path, unchanged behaviour) ─────────────────────

/**
 * Returns a formatted post text for the given date.
 *
 * - For dynamic rubrics (breakdown / story / tool): tries AI generation first,
 *   falls back to the static pool post if AI is unavailable or fails.
 * - For static rubrics (hygiene / quiz): always returns pool post (no AI needed).
 */
export async function generatePostForDate(date: Date = new Date()): Promise<string> {
  const rubric = getRubricForDate(date);
  const staticPost = getPostForDate(date);

  if (!DYNAMIC_RUBRICS.has(rubric)) {
    logger.info({ rubric }, "Post generator: static rubric — using pool post");
    return formatPost(staticPost);
  }

  const client = getClient();
  if (!client) {
    logger.warn({ rubric }, "Post generator: OPENAI_API_KEY not set — falling back to pool post");
    return formatPost(staticPost);
  }

  try {
    logger.info({ rubric }, "Post generator: requesting AI-generated post");
    const text = await generateText(rubric, date);
    if (!text) throw new Error("Empty AI response");
    logger.info({ rubric }, "Post generator: AI post generated successfully");
    return text + buildFooter();
  } catch (err) {
    logger.warn({ err, rubric }, "Post generator: AI generation failed — falling back to pool post");
    return formatPost(staticPost);
  }
}
