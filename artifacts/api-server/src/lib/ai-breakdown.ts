import { logger } from "./logger";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "sonar";
const AI_BREAKDOWN_ENABLED = process.env.AI_BREAKDOWN_ENABLED === "true";

/**
 * Generates a daily #разбор post for the channel «Без страха в сети»
 * using the Perplexity API (sonar model with live web search).
 *
 * Returns the post text, or null if generation is disabled / fails.
 * The scheduler falls back to the static posts-pool on null.
 */
export async function generateAiBreakdown(date: Date): Promise<string | null> {
  if (!AI_BREAKDOWN_ENABLED) return null;
  if (!PERPLEXITY_API_KEY) {
    logger.warn("AI breakdown disabled: missing PERPLEXITY_API_KEY");
    return null;
  }

  const today = date.toISOString().slice(0, 10);

  const userPrompt = `\
Ты пишешь пост для Telegram-канала «Без страха в сети» (@bezstrahavseti) о цифровой гигиене.

Аудитория: подростки, молодые взрослые и родители.
Стиль: разговорный, спокойный, поддерживающий, на «ты», без канцелярита и без запугивания.
Нельзя стыдить жертву мошенничества.
Нужно объяснять просто, без жаргона или с короткой расшифровкой.
Пост должен закончиться конкретным действием, которое можно сделать за 1–5 минут.

Задача:
Найди один свежий и понятный пример интернет-мошенничества, фишинга, поддельного сайта, scam-схемы или социальной инженерии за последние 7 дней.
Сделай рубрику #разбор.

Структура:
1. Короткий заход (1–2 предложения).
2. Что произошло.
3. Как именно работает схема.
4. Почему люди на неё попадаются.
5. Как распознать (чёткие признаки).
6. Что сделать прямо сейчас (2–4 шага на 1–5 минут).
7. Спокойное завершение.
8. Одна строка — органичный призыв поделиться. Выбери подходящий по контексту:
   - «Перешли это другу, который думает, что с ним такого не случится.»
   - «Покажи кому-нибудь из близких — может пригодиться прямо сейчас.»
   - «Сохрани — и кинь тому, кто недавно жаловался на подозрительные сообщения.»
   - «Если кто-то из твоих недавно чуть не попался — перешли. Без комментариев.»
   Призыв — последняя строка перед хэштегами, без лишних слов.

Требования:
- Пиши на русском.
- Объём: 900–1400 знаков.
- Без заголовка уровня статьи.
- Хэштеги внизу: #разбор и ещё 1–2 по теме (#фишинг, #скам, #банк, #соцсети).
- Не выдумывай кейсы: опирайся на реальные инциденты за последние 7 дней.
- Если подходящих кейсов нет или источники сомнительные — верни только слово FAIL.

Сегодня: ${today}`;

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Ты редактор Telegram-канала о цифровой гигиене. Стиль: спокойно, на «ты», без запугивания, с практическими шагами.",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "Perplexity API error for breakdown");
      return null;
    }

    const data: any = await response.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content?.trim();

    if (!text || text.toUpperCase().includes("FAIL")) {
      logger.warn("AI breakdown returned FAIL or empty, falling back to static post");
      return null;
    }

    return text;
  } catch (err) {
    logger.error({ err }, "Failed to fetch AI breakdown from Perplexity");
    return null;
  }
}
