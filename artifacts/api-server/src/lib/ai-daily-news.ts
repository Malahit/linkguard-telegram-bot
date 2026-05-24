import OpenAI from "openai";
import { logger } from "./logger";

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

export async function generateDailyNews(): Promise<string> {
  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set — skipping daily news generation");
    return "Сегодня без новостей — берегите себя в сети и проверяйте подозрительные ссылки через бота.";
  }

  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const systemPrompt = `Ты — редактор канала по цифровой безопасности @bezstrahavseti.
Пиши живо, по-человечески, без сухих терминов. Никаких звёздочек и Markdown.
Максимум 5 коротких абзацев.`;

  const userPrompt = `Напиши короткий дайджест по цифровой безопасности на ${today}.
Включи: 1-2 актуальных угрозы или схемы мошенников, практический совет для обычного пользователя.
Закончи призывом проверять подозрительные ссылки через бота.`;

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (text) return text;
    throw new Error("Empty AI response");
  } catch (err) {
    logger.warn({ err }, "Daily news generation failed");
    return "Сегодня без новостей — берегите себя в сети и проверяйте подозрительные ссылки через бота.";
  }
}
