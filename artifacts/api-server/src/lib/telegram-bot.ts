import { logger } from "./logger";
import { checkUrl } from "./risk-engine";
import { generateAiRecommendation } from "./ai-recommendation";
import { checkRateLimit, peekRateLimit, timeUntilResetText } from "./rate-limiter";

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
const CHANNEL_ID = process.env["OPENCLAW_CHANNEL_ID"];

const MINIAPP_URL =
  process.env["MINIAPP_URL"] ||
  (process.env["REPLIT_DOMAINS"]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
    : null);

export function isConfigured(): boolean {
  return !!(BOT_TOKEN && CHANNEL_ID);
}

// ─── Базовый вызов Telegram API ───────────────────────────────────────────────

async function tgCall(
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; description?: string; result?: unknown }>;
}

// ─── Постоянная клавиатура «Проверить ссылку» ─────────────────────────────────

const MAIN_KEYBOARD = {
  keyboard: [[{ text: "🔗 Проверить ссылку" }]],
  resize_keyboard: true,
  persistent: true,
};

// ─── Отправка сообщения пользователю ─────────────────────────────────────────

async function sendMessage(
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  try {
    const data = await tgCall("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    });
    if (!data.ok) {
      logger.error({ description: data.description, chatId }, "sendMessage error");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, chatId }, "Failed to sendMessage");
    return false;
  }
}

// ─── Индикатор «печатает...» ─────────────────────────────────────────────────

async function sendTyping(chatId: number): Promise<void> {
  await tgCall("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

// ─── Отправка в канал ────────────────────────────────────────────────────────

export async function sendToChannel(text: string): Promise<boolean> {
  if (!isConfigured()) {
    logger.warn("Telegram bot not configured — missing TELEGRAM_BOT_TOKEN or OPENCLAW_CHANNEL_ID");
    return false;
  }
  try {
    const data = await tgCall("sendMessage", {
      chat_id: CHANNEL_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!data.ok) {
      logger.error({ description: data.description }, "Telegram channel post error");
      return false;
    }
    logger.info("Message sent to OpenClaw channel");
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send to channel");
    return false;
  }
}

// ─── /start ──────────────────────────────────────────────────────────────────

export async function handleStart(chatId: number, firstName: string): Promise<void> {
  const name = firstName ? ` ${firstName}` : "";
  const text =
    `👋 Привет${name}!\n\n` +
    `Я — бот <b>OpenClaw</b>, твой помощник по цифровой безопасности.\n\n` +
    `🔗 Нажми кнопку <b>«Проверить ссылку»</b> внизу и отправь мне любую подозрительную ссылку — ` +
    `я проверю её и расскажу человеческим языком, что это такое и стоит ли её открывать.\n\n` +
    `📢 Каждый день в канале <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a> — ` +
    `советы по цифровой гигиене, разборы мошеннических схем и полезные инструменты.`;

  const inlineKeyboard = {
    inline_keyboard: [
      ...(MINIAPP_URL
        ? [[{ text: "🔗 Открыть LinkGuard (мини-апп)", web_app: { url: MINIAPP_URL } }]]
        : []),
      [{ text: "📢 Канал @bezstrahavseti", url: "https://t.me/bezstrahavseti" }],
    ],
  };

  await sendMessage(chatId, text, {
    reply_markup: MAIN_KEYBOARD,
  });

  // Небольшая задержка — потом инлайн-кнопки
  if (inlineKeyboard.inline_keyboard.length > 0) {
    await sendMessage(chatId, "Или открой мини-апп для полноценного интерфейса:", {
      reply_markup: inlineKeyboard,
    });
  }
}

// ─── Проверка ссылки через AI ─────────────────────────────────────────────────

async function handleLinkCheck(chatId: number, rawUrl: string, footerHint = ""): Promise<void> {
  await sendTyping(chatId);

  // Стартовое сообщение
  await sendMessage(chatId, `🔍 Проверяю ссылку...\n<code>${rawUrl}</code>`);

  await sendTyping(chatId);

  try {
    const risk = await checkUrl(rawUrl);
    const aiText = await generateAiRecommendation(rawUrl, risk);

    const verdictEmoji =
      risk.verdict === "safe" ? "✅" :
      risk.verdict === "caution" ? "⚠️" :
      risk.verdict === "danger" ? "🚫" : "❓";

    const verdictLabel =
      risk.verdict === "safe" ? "Безопасно" :
      risk.verdict === "caution" ? "Осторожно" :
      risk.verdict === "danger" ? "Опасно" : "Неизвестно";

    const responseText =
      `${verdictEmoji} <b>${verdictLabel}</b>\n` +
      `<code>${risk.normalizedUrl}</code>\n\n` +
      `${aiText}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `📢 Больше советов: <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a>` +
      footerHint;

    await sendMessage(chatId, responseText, {
      reply_markup: MAIN_KEYBOARD,
    });
  } catch (err) {
    logger.error({ err, rawUrl }, "Link check failed in bot");
    await sendMessage(
      chatId,
      "❌ Не удалось проверить ссылку. Попробуй ещё раз или воспользуйся мини-аппом.",
      { reply_markup: MAIN_KEYBOARD }
    );
  }
}

// ─── Детектор URL в тексте ───────────────────────────────────────────────────

function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  // Прямая ссылка с протоколом
  if (/^https?:\/\//i.test(trimmed)) return trimmed.split(/\s/)[0];
  // Домен без протокола (example.com, t.me/something)
  if (/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})(\/\S*)?$/.test(trimmed)) {
    return trimmed;
  }
  // Ссылка внутри текста
  const match = trimmed.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ─── /help ───────────────────────────────────────────────────────────────────

export async function handleHelp(chatId: number): Promise<void> {
  const text =
    `<b>Как пользоваться OpenClaw:</b>\n\n` +
    `1️⃣ Нажми кнопку <b>«🔗 Проверить ссылку»</b> внизу\n` +
    `2️⃣ Отправь мне ссылку которую хочешь проверить\n` +
    `3️⃣ Получишь подробный разбор от AI — что это, безопасно ли и что делать\n\n` +
    `<b>Советы:</b>\n` +
    `• Проверяй ссылки из незнакомых сообщений\n` +
    `• Особенно осторожно с сокращёнными ссылками (bit.ly и т.п.)\n` +
    `• Подписывайся на канал — там разборы реальных схем мошенников\n\n` +
    `📢 <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a> — канал о цифровой безопасности`;

  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

// ─── Главный обработчик update ────────────────────────────────────────────────

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (!BOT_TOKEN) return;

  if (update.message) {
    const { chat, from, text } = update.message;
    const chatId = chat.id;
    const firstName = from?.first_name ?? "";

    if (!text) return;

    if (text === "/start" || text.startsWith("/start ")) {
      await handleStart(chatId, firstName);
      return;
    }

    if (text === "/help") {
      await handleHelp(chatId);
      return;
    }

    if (text === "/status") {
      const userId = from?.id ?? chatId;
      const rate = peekRateLimit(userId);
      const barFilled = Math.round((rate.used / rate.limit) * 10);
      const bar = "🟩".repeat(barFilled) + "⬜".repeat(10 - barFilled);
      await sendMessage(
        chatId,
        `📊 <b>Твой лимит проверок</b>\n\n` +
        `${bar}\n` +
        `Использовано: <b>${rate.used} из ${rate.limit}</b>\n` +
        `Осталось: <b>${rate.remaining}</b>\n\n` +
        (rate.remaining === 0
          ? `⏳ Лимит исчерпан. Сбросится <b>${timeUntilResetText()}</b>.`
          : `✅ Можешь проверить ещё ${rate.remaining} ${rate.remaining === 1 ? "ссылку" : rate.remaining < 5 ? "ссылки" : "ссылок"} сегодня.`),
        { reply_markup: MAIN_KEYBOARD }
      );
      return;
    }

    if (text === "/channel") {
      await sendMessage(
        chatId,
        `📢 Канал OpenClaw — <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a>\n\nКаждый день советы по цифровой гигиене и разборы мошеннических схем.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Открыть канал", url: "https://t.me/bezstrahavseti" }],
            ],
          },
        }
      );
      return;
    }

    // Кнопка «Проверить ссылку» — просим прислать ссылку
    if (text === "🔗 Проверить ссылку") {
      await sendMessage(
        chatId,
        `Отправь мне ссылку которую хочешь проверить 👇\n\nМожно вставить адрес целиком, например:\n<code>https://example.com/some-page</code>`,
        { reply_markup: { force_reply: true, selective: true } }
      );
      return;
    }

    // Попытка найти URL в сообщении
    const url = extractUrl(text);
    if (url) {
      const userId = from?.id ?? chatId;
      const rate = checkRateLimit(userId);

      if (!rate.allowed) {
        await sendMessage(
          chatId,
          `⏳ <b>Лимит на сегодня исчерпан</b>\n\n` +
          `Ты уже проверил ${rate.limit} ссылок за сегодня — это максимум для одного аккаунта в сутки.\n\n` +
          `Счётчик обнулится <b>${timeUntilResetText()}</b> (в полночь по UTC).\n\n` +
          `Пока что можешь почитать советы по безопасности в канале 👇`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "📢 Канал @bezstrahavseti", url: "https://t.me/bezstrahavseti" }],
              ],
            },
          }
        );
        logger.info({ userId, limit: rate.limit }, "Rate limit exceeded");
        return;
      }

      // Показываем остаток только когда мало осталось (≤ 5)
      const footerHint = rate.remaining <= 5
        ? `\n\n💡 Осталось проверок на сегодня: <b>${rate.remaining}</b>`
        : "";

      await handleLinkCheck(chatId, url, footerHint);
      return;
    }

    // Не URL и не команда — напоминаем что делать
    await sendMessage(
      chatId,
      `Отправь мне ссылку для проверки — или нажми кнопку внизу 👇`,
      { reply_markup: MAIN_KEYBOARD }
    );
  }

  // Callback от inline-кнопок
  if (update.callback_query) {
    const { id, from, data } = update.callback_query;
    await tgCall("answerCallbackQuery", { callback_query_id: id });
    if (data === "help") {
      await handleHelp(from.id);
    }
  }
}

// ─── Настройка webhook и команд ───────────────────────────────────────────────

export async function setupBot(webhookUrl: string): Promise<void> {
  if (!BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot setup skipped");
    return;
  }

  try {
    // Устанавливаем webhook
    const webhookResult = await tgCall("setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    if (webhookResult.ok) {
      logger.info({ webhookUrl }, "Telegram webhook set");
    } else {
      logger.error({ description: webhookResult.description }, "Failed to set webhook");
    }

    // Устанавливаем команды в меню
    await tgCall("setMyCommands", {
      commands: [
        { command: "start", description: "Запустить бота" },
        { command: "help", description: "Как пользоваться" },
        { command: "status", description: "Сколько проверок осталось сегодня" },
        { command: "channel", description: "Канал @bezstrahavseti" },
      ],
    });
    logger.info("Bot commands set");

    // Устанавливаем кнопку меню (Menu Button) — открывает мини-апп
    if (MINIAPP_URL) {
      await tgCall("setChatMenuButton", {
        menu_button: {
          type: "web_app",
          text: "Проверить ссылку",
          web_app: { url: MINIAPP_URL },
        },
      });
      logger.info({ MINIAPP_URL }, "Bot menu button set to mini app");
    }
  } catch (err) {
    logger.error({ err }, "Bot setup error");
  }
}

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    data?: string;
  };
}
