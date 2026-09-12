import OpenAI from "openai";
import { logger } from "./logger";
import type { RiskResult } from "./risk-engine";
import type { EmailRiskResult } from "./email-check";
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
  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set — skipping AI recommendation");
    return risk.explanation;
  }

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
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 512,
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

const EMAIL_VERDICT_CONTEXT: Record<string, string> = {
  safe: "безопасного",
  caution: "подозрительного",
  danger: "опасного",
  unknown: "неизвестного",
};

export async function generateEmailRecommendation(
  email: string,
  risk: EmailRiskResult
): Promise<string> {
  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set — skipping AI email recommendation");
    return risk.explanation;
  }

  const verdictWord = EMAIL_VERDICT_CONTEXT[risk.verdict] ?? "неизвестного";
  const threatInfo =
    risk.threatTypes.length > 0
      ? `Обнаруженные признаки: ${risk.threatTypes.join(", ")}.`
      : "";

  // Факты MX-проверки для обоснования
  const mxFacts = risk.mx
    ? risk.mx.hasMx
      ? risk.mx.providerName
        ? `Домен подтверждён: существует и принимает почту (MX: ${risk.mx.providerName}).`
        : "Домен подтверждён: существует и принимает почту."
      : "Домен НЕ принимает почту (нет MX-записей) — это сильный признак выдуманного адреса."
    : "MX-проверка не проводилась.";

  const systemPrompt = `Ты — дружелюбный эксперт по цифровой безопасности OpenClaw.
Ты разговариваешь с обычным пользователем в Telegram — простым языком, без сухих технических терминов.
Твоя задача: объяснить результат проверки email-адреса так, чтобы даже ребёнок понял, что делать.
Обязательно опирайся на факты: домен существует/не существует, известная ли это почтовая служба, похож ли адрес на подделку под организацию.
Говори про сам адрес и про то, откуда он мог прийти (в каком письме его видели).
Если вердикт осторожный или неизвестный — честно скажи, чего не хватает и предложи проверить само письмо.
Пиши живо и по-человечески. Никаких звёздочек (**) и Markdown. Максимум 4 коротких абзаца.`;

  const userPrompt = `Пользователь проверил email-адрес: ${email}
Вердикт системы: ${verdictWord}
${threatInfo}
Технический анализ: ${risk.explanation}
${mxFacts}

Напиши конкретную и понятную рекомендацию: что это за адрес, какие у тебя есть факты о его домене, стоит ли ему доверять и что именно делать пользователю, если он получил с него письмо.`;

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (text) return text;
    throw new Error("Empty AI response");
  } catch (err) {
    logger.warn({ err }, "AI email recommendation failed, using fallback");
    return risk.explanation;
  }
}

export interface DeepSenderCheck {
  verdict: "safe" | "caution" | "danger";
  reasoning: string;
}

/**
 * Углублённая AI-проверка отправителя: похоже ли, что это официальный
 * контакт компании/бренда (с веб-фактами модели), либо фишинг.
 * Вызывается только когда адрес «похож на компанию на бесплатной почте».
 */
export async function checkSenderDeep(
  email: string,
  reason: string
): Promise<DeepSenderCheck | null> {
  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set — skipping deep sender check");
    return null;
  }

  const systemPrompt = `Ты — эксперт по цифровой безопасности, проверяешь email-адрес.
Пользователь получил письмо с адреса, который похож на официальный контакт компании, но находится на бесплатной почте (ya.ru, mail.ru, gmail.com и т.п.).
Определи по открытым данным (веб-поиск): существует ли такая организация, есть ли у неё официальный домен, и может ли она писать с бесплатной почты.
Ответь строго в формате:
Вердикт: safe | caution | danger
Обоснование: 1-2 предложения на русском.
safe — если адрес явно принадлежит реальной компании и это её подтверждённый способ связи.
caution — если подтвердить надёжно нельзя.
danger — если это явная подделка/фишинг.`;

  const userPrompt = `Адрес: ${email}
Почему проверяем: ${reason}

Проверь, официальный ли это контакт компании, и ответь в требуемом формате.`;

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 300,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty AI response");

    const verdictMatch = text.match(/Вердикт:\s*(safe|caution|danger)/i);
    const reasoningMatch = text.match(/Обоснование:\s*(.+)/is);
    if (!verdictMatch) throw new Error("No verdict in AI response");

    return {
      verdict: verdictMatch[1].toLowerCase() as DeepSenderCheck["verdict"],
      reasoning: reasoningMatch ? reasoningMatch[1].trim().slice(0, 500) : text.slice(0, 500),
    };
  } catch (err) {
    logger.warn({ err, email }, "Deep sender check failed");
    return null;
  }
}

// ─── Разбор пересланного письма целиком ────────────────────────────────────────
const FORWARDED_VERDICT_CONTEXT: Record<string, string> = {
  safe: "безопасного",
  caution: "подозрительного",
  danger: "опасного",
  unknown: "неясного",
};

export async function generateForwardedEmailRecommendation(
  raw: { fromAddress: string | null; subject: string | null; textBody: string; links: string[] },
  verdict: string,
  threatTypes: string[],
  bodySignals: string[]
): Promise<string> {
  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set — skipping AI forwarded-email recommendation");
    return buildForwardedFallback(raw, verdict, threatTypes, bodySignals);
  }

  const verdictWord = FORWARDED_VERDICT_CONTEXT[verdict] ?? "неясного";
  const sender = raw.fromAddress ?? "неизвестный отправитель";
  const subject = raw.subject ?? "без темы";

  const systemPrompt = `Ты — дружелюбный эксперт по цифровой безопасности OpenClaw.
Пользователь переслал тебе письмо целиком для проверки. Ты должен объяснить, опасное ли это письмо, на основе фактов:
- кто отправитель и совпадает ли его имя/домен с текстом письма;
- какие ссылки внутри и куда они ведут;
- что написано в тексте (срочность, деньги, пароли, угрозы, просьбы перейти);
- какие вложения (исполняемые/документы с макросами).
Пиши конкретно и понятно, как для ребёнка: что в письме подозрительного, что делать пользователю.
Никаких звёздочек (**) и Markdown. Максимум 5 коротких абзацев.`;

  const userPrompt = `Сводный вердикт системы: ${verdictWord}
Признаки угроз: ${threatTypes.join(", ") || "не найдено"}
Сигналы текста: ${bodySignals.join("; ") || "не найдено"}
Отправитель: ${sender}
Тема: ${subject}
Ссылки в письме: ${raw.links.slice(0, 5).join(", ") || "нет"}

Текст письма (фрагмент):
${raw.textBody.slice(0, 3000)}

Дай понятный разбор: можно ли доверять письму, что именно в нём намекает на опасность, и что конкретно сделать пользователю (открывать ссылки или нет, отвечать или нет, что с вложением).`;

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: 650,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim();
    if (text) return text;
    throw new Error("Empty AI response");
  } catch (err) {
    logger.warn({ err }, "AI forwarded-email recommendation failed, using fallback");
    return buildForwardedFallback(raw, verdict, threatTypes, bodySignals);
  }
}

function buildForwardedFallback(
  raw: { fromAddress: string | null; subject: string | null; textBody: string; links: string[] },
  verdict: string,
  threatTypes: string[],
  bodySignals: string[]
): string {
  const parts: string[] = [];
  if (raw.fromAddress) parts.push(`Отправитель: ${raw.fromAddress}.`);
  if (raw.subject) parts.push(`Тема: «${raw.subject}».`);
  if (threatTypes.length > 0) parts.push(`Найдены признаки угроз: ${threatTypes.join(", ")}.`);
  if (bodySignals.length > 0) parts.push(`Текст подозрителен: ${bodySignals.join("; ")}.`);
  if (raw.links.length > 0) parts.push(`Ссылки в письме: ${raw.links.slice(0, 3).join(", ")}.`);
  if (parts.length === 0) parts.push("В письме не нашлось явных признаков угрозы.");

  const action =
    verdict === "danger"
      ? "Не открывай ссылки и вложения, не отвечай на письмо — удали его."
      : verdict === "caution"
        ? "Не открывай ссылки и вложения, пока не проверишь их отдельно. Если сомневаешься — удали письмо."
        : "Если ты ждёшь это письмо и отправитель тебе знаком — всё в порядке. В противном случае будь осторожен со ссылками и вложениями.";

  return `${parts.join("\n")}\n\n${action}`;
}
