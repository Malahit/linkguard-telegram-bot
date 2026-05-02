import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import type { RiskResult } from "./risk-engine";

const VERDICT_CONTEXT: Record<string, string> = {
  safe: "безопасной",
  caution: "подозрительной",
  danger: "опасной",
  unknown: "неизвестной",
};

export async function generateAiRecommendation(
  url: string,
  risk: RiskResult
): Promise<string> {
  const verdictWord = VERDICT_CONTEXT[risk.verdict] ?? "неизвестной";
  const threatInfo =
    risk.threatTypes.length > 0
      ? `Обнаруженные угрозы: ${risk.threatTypes.join(", ")}.`
      : "";

  const systemPrompt = `Ты — дружелюбный эксперт по цифровой безопасности OpenClaw. 
Ты разговариваешь с обычным пользователем в Telegram — простым языком, без сухих технических терминов.
Твоя задача: объяснить результат проверки ссылки так, чтобы даже ребёнок понял, что делать.
Пиши живо и по-человечески. Никаких звёздочек (**) и Markdown. Максимум 4 коротких абзаца.`;

  const userPrompt = `Пользователь проверил ссылку: ${url}
Домен: ${risk.normalizedUrl}
Вердикт системы: ${verdictWord}
${threatInfo}
Технический анализ: ${risk.explanation}

Напиши понятную рекомендацию: что это за ссылка, безопасно ли её открывать и что именно делать пользователю.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (text) return text;
    throw new Error("Empty AI response");
  } catch (err) {
    logger.warn({ err }, "AI recommendation failed, using fallback");
    return risk.explanation;
  }
}
