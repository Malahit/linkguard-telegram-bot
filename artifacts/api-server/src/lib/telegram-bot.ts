import { logger } from "./logger";
import { checkUrl } from "./risk-engine";
import { checkEmail, extractEmail } from "./email-check";
import { generateAiRecommendation, generateEmailRecommendation, generateForwardedEmailRecommendation, checkSenderDeep } from "./ai-recommendation";
import { checkRateLimit, peekRateLimit, timeUntilResetText } from "./rate-limiter";
import { saveReport, getPendingCount } from "./report-store";
import { generateDraftForDate } from "./post-generator";
import { getDraft, deleteDraft, listDrafts, todayKey } from "./draft-store";
import { sendToChannel } from "./telegram-bot";
import { pollNewMails, extractConfirmationCode, isMailboxConfigured } from "./mail-inbox";
import { checkForwardedEmail } from "./forwarded-email-check";
import type { ForwardedEmailResult } from "./forwarded-email-check";
import type { ParsedEmailMessage } from "./email-message";
import { db, linkChecksTable } from "@workspace/db";
import { sql, gt } from "drizzle-orm";

// Пользователи в режиме ожидания ссылки для репорта
const pendingReport = new Set<number>();

// Ожидание пересланного письма: telegramId -> код подтверждения
interface PendingMail {
  code: string;
  createdAt: number;
}
const pendingForwards = new Map<number, PendingMail>();

const MAIL_INBOX_ADDRESS = process.env["MAIL_INBOX_ADDRESS"];
const MAIL_CODE_EXPIRY_MS =
  Number(process.env["MAIL_CODE_EXPIRY_MIN"] ?? 30) * 60 * 1000;

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
const CHANNEL_ID = process.env["OPENCLAW_CHANNEL_ID"];
const ADMIN_CHAT_ID = process.env["ADMIN_CHAT_ID"];

const MINIAPP_URL =
  process.env["MINIAPP_URL"] ||
  (process.env["REPLIT_DOMAINS"]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}`
    : null);

export function isConfigured(): boolean {
  return !!(BOT_TOKEN && CHANNEL_ID);
}

// ─── Базовый вызов Telegram API ──────────────────────────────────────────────────

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

// ─── Постоянная клавиатура «Проверить ссылку» / «Проверить email» / «Проверить письмо» ───────

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "🔗 Проверить ссылку" }],
    [{ text: "✉️ Проверить email" }],
    [{ text: "📧 Проверить письмо" }],
  ],
  resize_keyboard: true,
  persistent: true,
};

// ─── Отправка сообщения пользователю ──────────────────────────────────────────────────

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

// ─── Индикатор «печатает...» ─────────────────────────────────────────────────────────────

async function sendTyping(chatId: number): Promise<void> {
  await tgCall("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

// ─── Отправка в канал ──────────────────────────────────────────────────────────────────────────

export async function sendToChannel(
  text: string,
  inlineKeyboard?: { text: string; url: string }[][]
): Promise<boolean> {
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
      ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
    });
    if (!data.ok) {
      logger.error({ description: data.description }, "Telegram channel post error");
      return false;
    }
    logger.info("Message sent to channel");
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send to channel");
    return false;
  }
}

// ─── Алерт админу о новом пользователе ──────────────────────────────────────────────────

async function notifyAdminNewUser(
  userId: number,
  firstName: string,
  username: string | undefined
): Promise<void> {
  if (!ADMIN_CHAT_ID) return;
  const userTag = username ? `@${username}` : `id:${userId}`;
  await tgCall("sendMessage", {
    chat_id: Number(ADMIN_CHAT_ID),
    text:
      `👋 <b>Новый пользователь</b>\n\n` +
      `Имя: ${firstName}\n` +
      `Аккаунт: ${userTag}\n` +
      `ID: <code>${userId}</code>`,
    parse_mode: "HTML",
  }).catch(() => {});
}

// ─── Статистика ──────────────────────────────────────────────────────────────────────────────

async function getStats(): Promise<{ today: number; week: number; total: number }> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(now.getUTCDate() - 7);

  const [todayRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(linkChecksTable)
    .where(gt(linkChecksTable.checkedAt, startOfDay));

  const [weekRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(linkChecksTable)
    .where(gt(linkChecksTable.checkedAt, startOfWeek));

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(linkChecksTable);

  return {
    today: todayRow?.count ?? 0,
    week: weekRow?.count ?? 0,
    total: totalRow?.count ?? 0,
  };
}

// ─── /start ───────────────────────────────────────────────────────────────────────────────

export async function handleStart(chatId: number, firstName: string, userId: number, username?: string): Promise<void> {
  const name = firstName ? ` ${firstName}` : "";
  const text =
    `👋 Привет${name}!\n\n` +
    `Я — бот канала <b>Без страха в сети</b>, твой помощник по цифровой безопасности.\n\n` +
    `🔗 Просто отправь мне любую подозрительную ссылку — я мгновенно проверю её и скажу человеческим языком: безопасно, осторожно или опасно.\n\n` +
    `✉️ А ещё я умею проверять <b>email-адреса</b> — например, адрес того, кто прислал тебе письмо: безопасный он или фишинговый.\n\n` +
    `📧 А если прислали подозрительное <b>письмо целиком</b> — перешли его мне, и я разберу отправителя, ссылки и вложения.\n\n` +
    `<b>Как использовать:</b>\n` +
    `Нажми кнопку <b>«🔗 Проверить ссылку»</b> внизу — или просто вставь адрес прямо в чат.\n\n` +
    `Чтобы проверить отправителя письма — нажми <b>«✉️ Проверить email»</b> и вставь email-адрес.\n\n` +
    `Чтобы разобрать <b>само письмо</b> — нажми <b>«📧 Проверить письмо»</b> и следуй инструкции.\n\n` +
    `📢 Каждый день в канале <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a> — ` +
    `советы по цифровой гигиене и разборы мошеннических схем.`;

  await sendMessage(chatId, text, {
    reply_markup: {
      ...MAIN_KEYBOARD,
      inline_keyboard: [
        [{ text: "📢 Подписаться на канал", url: "https://t.me/bezstrahavseti" }],
      ],
    },
  });

  notifyAdminNewUser(userId, firstName, username).catch(() => {});
}

// ─── Проверка ссылки через AI ────────────────────────────────────────────────────────────────

async function handleLinkCheck(chatId: number, rawUrl: string, footerHint = ""): Promise<void> {
  await sendTyping(chatId);
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
      `────────────────\n` +
      `📢 Больше советов: <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a>` +
      footerHint;

    const inlineKeyboard = risk.vtPermalink
      ? [[{ text: "🔎 Отчёт VirusTotal", url: risk.vtPermalink }]]
      : undefined;

    await sendMessage(chatId, responseText, {
      reply_markup: inlineKeyboard
        ? { ...MAIN_KEYBOARD, inline_keyboard: inlineKeyboard }
        : MAIN_KEYBOARD,
    });
  } catch (err) {
    logger.error({ err, rawUrl }, "Link check failed in bot");
    await sendMessage(
      chatId,
      "❌ Не удалось проверить ссылку. Попробуй ещё раз — просто отправь адрес заново.",
      { reply_markup: MAIN_KEYBOARD }
    );
  }
}

// ─── Проверка email-адреса ────────────────────────────────────────────────────────────────────

async function handleEmailCheck(chatId: number, rawEmail: string, footerHint = ""): Promise<void> {
  await sendTyping(chatId);
  await sendMessage(chatId, `🔍 Проверяю email-адрес...\n<code>${rawEmail}</code>`);
  await sendTyping(chatId);

  try {
    let risk = await checkEmail(rawEmail);

    // Углублённая AI-проверка отправителя, если адрес похож на компанию на бесплатной почте
    let deepSenderText: string | null = null;
    if (risk.senderNeedsAiCheck) {
      await sendTyping(chatId);
      const deep = await checkSenderDeep(rawEmail, risk.senderAiReason ?? "адрес похож на контакт компании");
      if (deep) {
        deepSenderText = deep.reasoning;
        if (deep.verdict === "danger") {
          risk = { ...risk, verdict: "danger", threatTypes: [...risk.threatTypes, "EMAIL_DEEP_DANGER"] };
        } else if (deep.verdict === "safe") {
          risk = {
            ...risk,
            verdict: "safe",
            suggestsDeepCheck: false,
            explanation: `Подтверждено: ${deep.reasoning}`,
          };
        } else {
          risk = { ...risk, verdict: "caution", explanation: `${risk.explanation}\n${deep.reasoning}` };
        }
      }
    }

    const aiText = await generateEmailRecommendation(rawEmail, risk);

    const verdictEmoji =
      risk.verdict === "safe" ? "✅" :
      risk.verdict === "caution" ? "⚠️" :
      risk.verdict === "danger" ? "🚫" : "❓";

    const verdictLabel =
      risk.verdict === "safe" ? "Безопасно" :
      risk.verdict === "caution" ? "Осторожно" :
      risk.verdict === "danger" ? "Опасно" : "Неизвестно";

    const mxLine = risk.mx
      ? risk.mx.hasMx
        ? risk.mx.providerName
          ? `🛰 Домен существует, почта через <b>${risk.mx.providerName}</b>\n`
          : "🛰 Домен существует и принимает почту\n"
        : "🛰 Домен <b>не</b> принимает почту — адрес, скорее всего, выдуман\n"
      : "";

    const deepLine = deepSenderText
      ? `🤖 Углублённая проверка: ${deepSenderText}\n`
      : "";

    const deepCheckOffer = risk.suggestsDeepCheck
      ? `\n\n🤔 Чтобы узнать точно, открой письмо и нажми «📧 Проверить письмо» — я разберу письмо целиком (адрес, ссылки, вложение).`
      : "";

    const responseText =
      `${verdictEmoji} <b>${verdictLabel}</b>\n` +
      `<code>${risk.normalizedEmail}</code>\n\n` +
      `${aiText}\n\n` +
      `${deepLine}` +
      `${mxLine}` +
      `────────────────\n` +
      `📢 Больше советов: <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a>` +
      footerHint +
      deepCheckOffer;

    await sendMessage(chatId, responseText, { reply_markup: MAIN_KEYBOARD });
  } catch (err) {
    logger.error({ err, rawEmail }, "Email check failed in bot");
    await sendMessage(
      chatId,
      "❌ Не удалось проверить email-адрес. Попробуй ещё раз — просто отправь адрес заново.",
      { reply_markup: MAIN_KEYBOARD }
    );
  }
}

// ─── Проверка пересланного письма ──────────────────────────────────────────────────────────

function generateConfirmationCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

async function sendMailInstruction(chatId: number): Promise<PendingMail | null> {
  if (!MAIL_INBOX_ADDRESS || !isMailboxConfigured()) {
    await sendMessage(
      chatId,
      `⚠️ Проверка писем пока не настроена.

А пока могу сказать, что обычно тот же результат получается при отдельной проверке email и ссылок из письма — нажми «🔗 Проверить ссылку» или «✉️ Проверить email».

Напиши админу, чтобы включили режим писем.`,
      { reply_markup: MAIN_KEYBOARD }
    );
    return null;
  }

  const code = generateConfirmationCode();
  pendingForwards.set(chatId, { code, createdAt: Date.now() });

  await sendMessage(
    chatId,
    `📧 <b>Проверить письмо</b>\n\n` +
    `Перешли подозрительное письмо на адрес бота:\n\n` +
    `<code>${MAIL_INBOX_ADDRESS}</code>\n\n` +
    `Чтобы я понял, что письмо твоё, впиши код: <b>${code}</b>\n` +
    `в <b>тему письма</b> или первой строкой — рядом с оригиналом.\n\n` +
    `⏳ Не забудь нажать кнопку <b>«✅ Переслал(а)»</b> ниже, когда отправишь.\n` +
    `Если письмо не дойдёт, можно нажать кнопку ещё раз.`,
    {
      reply_markup: {
        ...MAIN_KEYBOARD,
        inline_keyboard: [
          [{ text: "✅ Переслал(а)", callback_data: "mail_forwarded" }],
        ],
      },
    }
  );
  return { code, createdAt: Date.now() };
}

// Поиск ожидающего кода для пользователя, ищем письмо по коду
async function resolveForwardedMail(chatId: number): Promise<ParsedEmailMessage | null> {
  const pending = pendingForwards.get(chatId);
  if (!pending || Date.now() - pending.createdAt > MAIL_CODE_EXPIRY_MS) {
    pendingForwards.delete(chatId);
    return null;
  }

  const mails = await pollNewMails(10);
  if (mails.length === 0) return null;

  // Сначала ищем совпадение по коду
  for (const m of mails) {
    if (extractConfirmationCode(m) === pending.code) {
      return m.message;
    }
  }

  // Если пользователь — единственный «ожидающий», берём самое свежее письмо
  const otherWaiters = [...pendingForwards.keys()].filter((id) => id !== chatId);
  if (otherWaiters.length === 0) {
    return mails[mails.length - 1].message;
  }

  return null;
}

async function handleForwardedCheck(chatId: number, emailMsg: ParsedEmailMessage): Promise<void> {
  await sendTyping(chatId);

  try {
    const result = await checkForwardedEmail(emailMsg, true);
    await sendMailReport(chatId, emailMsg, result);
  } catch (err) {
    logger.error({ err, chatId }, "Forwarded email check failed");
    await sendMessage(
      chatId,
      "❌ Не удалось разобрать письмо. Попробуй ещё раз, или проверь адрес и ссылки из письма отдельно.",
      { reply_markup: MAIN_KEYBOARD }
    );
  }
}

async function sendMailReport(
  chatId: number,
  emailMsg: ParsedEmailMessage,
  result: ForwardedEmailResult
): Promise<void> {
  const emoji =
    result.verdict === "safe" ? "✅" :
    result.verdict === "caution" ? "⚠️" :
    result.verdict === "danger" ? "🚫" : "❓";

  const label =
    result.verdict === "safe" ? "Письмо не вызывая подозрений" :
    result.verdict === "caution" ? "Осторожно — лучше не вскрывать" :
    result.verdict === "danger" ? "Письмо похоже на мошенническое" : "Неясно";

  const parts: string[] = [];
  if (emailMsg.fromAddress) parts.push(`От: <code>${emailMsg.fromAddress}</code>`);
  if (emailMsg.subject) parts.push(`Тема: <code>${emailMsg.subject}</code>`);
  parts.push(`\n${result.explanation}`);
  if (result.aiText) parts.push(`\n${result.aiText}`);

  const text =
    `${emoji} <b>${label}</b>\n\n` +
    parts.join("\n") +
    `\n\n────────────────\n` +
    `📢 Больше советов: <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a>`;

  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

// ─── Обработка репорта опасной ссылки ──────────────────────────────────────────────────

async function handleReport(
  chatId: number,
  userId: number,
  username: string | undefined,
  url: string
): Promise<void> {
  await sendTyping(chatId);

  const id = await saveReport({ telegramId: userId, username, url });

  if (id === null) {
    await sendMessage(chatId, "❌ Не удалось сохранить жалобу. Попробуй позже.", {
      reply_markup: MAIN_KEYBOARD,
    });
    return;
  }

  if (ADMIN_CHAT_ID) {
    const pendingTotal = await getPendingCount();
    const userTag = username ? `@${username}` : `id:${userId}`;
    await tgCall("sendMessage", {
      chat_id: Number(ADMIN_CHAT_ID),
      text:
        `🚩 <b>Новый репорт #${id}</b>\n\n` +
        `Ссылка: <code>${url}</code>\n` +
        `От: ${userTag}\n\n` +
        `📋 Всего на рассмотрении: <b>${pendingTotal}</b>`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }

  await sendMessage(
    chatId,
    `✅ <b>Спасибо! Жалоба #${id} принята.</b>\n\n` +
    `Ссылка <code>${url}</code> отправлена на ручную проверку.\n\n` +
    `Если она окажется опасной — обновим базу и защитим других пользователей. ` +
    `Именно такие репорты делают бота лучше 💪`,
    { reply_markup: MAIN_KEYBOARD }
  );

  logger.info({ reportId: id, url, userId }, "URL report submitted by user");
}

// ─── /draft — сгенерировать черновик (только для админа) ─────────────────────

async function handleDraft(chatId: number): Promise<void> {
  if (!ADMIN_CHAT_ID || chatId !== Number(ADMIN_CHAT_ID)) {
    await sendMessage(chatId, "🚫 Команда недоступна.", { reply_markup: MAIN_KEYBOARD });
    return;
  }

  await sendTyping(chatId);
  await sendMessage(chatId, "⏳ Генерирую черновик поста...");

  try {
    const text = await generateDraftForDate(new Date());
    const dateKey = todayKey();

    await sendMessage(
      chatId,
      `📝 <b>Черновик на ${dateKey}</b>\n\n` +
      `─────────────────────\n\n` +
      text +
      `\n\n─────────────────────\n\n` +
      `✅ /approve — опубликовать\n` +
      `🗑 /discard — удалить черновик`
    );
  } catch (err) {
    logger.error({ err }, "Failed to generate draft");
    await sendMessage(chatId, "❌ Не удалось сгенерировать черновик.");
  }
}

// ─── /approve — опубликовать черновик (только для админа) ────────────────────

async function handleApprove(chatId: number): Promise<void> {
  if (!ADMIN_CHAT_ID || chatId !== Number(ADMIN_CHAT_ID)) {
    await sendMessage(chatId, "🚫 Команда недоступна.", { reply_markup: MAIN_KEYBOARD });
    return;
  }

  const dateKey = todayKey();
  const draft = getDraft(dateKey);

  if (!draft) {
    await sendMessage(
      chatId,
      `⚠️ Черновик на <b>${dateKey}</b> не найден.\n\nСначала сгенерируй его: /draft`
    );
    return;
  }

  await sendTyping(chatId);

  const ok = await sendToChannel(draft.text);

  if (ok) {
    deleteDraft(dateKey);
    await sendMessage(
      chatId,
      `✅ <b>Пост за ${dateKey} опубликован в канале!</b>\n\n` +
      `Черновик удалён.`
    );
    logger.info({ dateKey }, "Draft approved and published");
  } else {
    await sendMessage(
      chatId,
      `❌ Не удалось отправить пост в канал.\nЧерновик сохранён — попробуй /approve снова.`
    );
  }
}

// ─── /discard — удалить черновик (только для админа) ─────────────────────────

async function handleDiscard(chatId: number): Promise<void> {
  if (!ADMIN_CHAT_ID || chatId !== Number(ADMIN_CHAT_ID)) {
    await sendMessage(chatId, "🚫 Команда недоступна.", { reply_markup: MAIN_KEYBOARD });
    return;
  }

  const dateKey = todayKey();
  const deleted = deleteDraft(dateKey);

  if (deleted) {
    await sendMessage(
      chatId,
      `🗑 Черновик на <b>${dateKey}</b> удалён.\n\nСоздать новый: /draft`
    );
    logger.info({ dateKey }, "Draft discarded");
  } else {
    await sendMessage(
      chatId,
      `⚠️ Черновик на <b>${dateKey}</b> не найден — возможно, уже удалён.`
    );
  }
}

// ─── /drafts — список всех черновиков (только для админа) ────────────────────

async function handleDraftsList(chatId: number): Promise<void> {
  if (!ADMIN_CHAT_ID || chatId !== Number(ADMIN_CHAT_ID)) {
    await sendMessage(chatId, "🚫 Команда недоступна.", { reply_markup: MAIN_KEYBOARD });
    return;
  }

  const drafts = listDrafts();

  if (drafts.length === 0) {
    await sendMessage(chatId, `📭 Черновиков нет.\n\nСоздать на сегодня: /draft`);
    return;
  }

  const lines = drafts.map((d) => {
    const age = Math.round((Date.now() - d.createdAt) / 60_000);
    const ageStr = age < 60 ? `${age} мин. назад` : `${Math.round(age / 60)} ч. назад`;
    return `• <b>${d.date}</b> — создан ${ageStr}`;
  });

  await sendMessage(
    chatId,
    `📋 <b>Черновики (${drafts.length}):</b>\n\n` +
    lines.join("\n") +
    `\n\n/approve — опубликовать сегодняшний\n/discard — удалить сегодняшний`
  );
}

// ─── Детектор URL в тексте ─────────────────────────────────────────────────────────────────────

function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.split(/\s/)[0];
  if (/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})(\/\S*)?$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ─── /help ────────────────────────────────────────────────────────────────────────────────

export async function handleHelp(chatId: number): Promise<void> {
  const text =
    `<b>Как пользоваться ботом:</b>\n\n` +
    `1️⃣ Нажми кнопку <b>«🔗 Проверить ссылку»</b> внизу экрана\n` +
    `2️⃣ Вставь ссылку которую хочешь проверить и отправь\n` +
    `3️⃣ Получишь разбор от AI — что это за сайт, безопасно ли и что делать\n\n` +
    `Можно также просто вставить адрес прямо в чат — без нажатия кнопки.\n\n` +
    `✉️ <b>Проверить email-адрес:</b>\n` +
    `1️⃣ Нажми кнопку <b>«✉️ Проверить email»</b> внизу экрана\n` +
    `2️⃣ Вставь email-адрес (например, того, кто прислал письмо) и отправь\n` +
    `3️⃣ Получишь вердикт: безопасный адрес или фишинговый\n\n` +
    `📧 <b>Проверить письмо целиком:</b>\n` +
    `1️⃣ Нажми кнопку <b>«📧 Проверить письмо»</b> внизу экрана\n` +
    `2️⃣ Перешли подозрительное письмо на адрес, который покажет бот (впиши туда код)\n` +
    `3️⃣ Нажми «✅ Переслал(а)» — получишь разбор всего письма: отправитель, ссылки, вложения\n\n` +
    `<b>Советы:</b>\n` +
    `• Проверяй ссылки и адреса из незнакомых сообщений и SMS\n` +
    `• Особенно осторожно с сокращёнными ссылками (bit.ly, tinyurl и т.п.)\n` +
    `• Проверяй email отправителя, если письмо просит пароль, деньги или данные\n` +
    `• Подписывайся на канал — там разборы реальных схем мошенников\n\n` +
    `📢 <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a> — канал о цифровой безопасности`;

  await sendMessage(chatId, text, { reply_markup: MAIN_KEYBOARD });
}

// ─── /stats (только для админа) ─────────────────────────────────────────────────────────────

async function handleStats(chatId: number): Promise<void> {
  if (!ADMIN_CHAT_ID || chatId !== Number(ADMIN_CHAT_ID)) {
    await sendMessage(chatId, "🚫 Команда недоступна.", { reply_markup: MAIN_KEYBOARD });
    return;
  }
  try {
    const stats = await getStats();
    await sendMessage(
      chatId,
      `📊 <b>Статистика проверок</b>\n\n` +
      `Сегодня: <b>${stats.today}</b>\n` +
      `За 7 дней: <b>${stats.week}</b>\n` +
      `Всего за всё время: <b>${stats.total}</b>`,
      { reply_markup: MAIN_KEYBOARD }
    );
  } catch (err) {
    logger.error({ err }, "Failed to get stats");
    await sendMessage(chatId, "❌ Не удалось получить статистику.");
  }
}

// ─── Главный обработчик update ──────────────────────────────────────────────────────────────────

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (!BOT_TOKEN) return;

  if (update.message) {
    const { chat, from, text, caption, forward_date, forward_from, forward_from_chat, forward_sender_name } = update.message;
    const chatId = chat.id;
    const firstName = from?.first_name ?? "";
    const isForwarded = !!forward_date;

    if (isForwarded) {
      const content = text || caption || "";
      const url = extractUrl(content);

      if (!url) {
        await sendMessage(
          chatId,
          `📨 Вижу пересланное сообщение, но не нашёл в нём ссылки.\n\nЕсли хочешь проверить адрес — вставь его вручную.`,
          { reply_markup: MAIN_KEYBOARD }
        );
        return;
      }

      let sourceLabel = "";
      if (forward_from_chat?.username) {
        sourceLabel = ` из канала @${forward_from_chat.username}`;
      } else if (forward_from_chat?.title) {
        sourceLabel = ` из «${forward_from_chat.title}»`;
      } else if (forward_from?.username) {
        sourceLabel = ` от @${forward_from.username}`;
      } else if (forward_sender_name) {
        sourceLabel = ` от ${forward_sender_name}`;
      }

      await sendMessage(
        chatId,
        `📨 Нашёл ссылку в пересланном сообщении${sourceLabel}:\n<code>${url}</code>\n\nПроверяю...`
      );

      const userId = from?.id ?? chatId;
      const rate = checkRateLimit(userId);

      if (!rate.allowed) {
        await sendMessage(
          chatId,
          `⏳ <b>Лимит на сегодня исчерпан</b>\n\nСчётчик обнулится <b>${timeUntilResetText()}</b>.`,
          { reply_markup: { inline_keyboard: [[{ text: "📢 Канал @bezstrahavseti", url: "https://t.me/bezstrahavseti" }]] } }
        );
        return;
      }

      const footerHint = rate.remaining <= 5
        ? `\n\n💡 Осталось проверок на сегодня: <b>${rate.remaining}</b>`
        : "";

      await handleLinkCheck(chatId, url, footerHint);
      return;
    }

    if (!text) return;

    if (text === "/start" || text.startsWith("/start ")) {
      await handleStart(chatId, firstName, from?.id ?? chatId, from?.username);
      return;
    }

    if (text === "/help") {
      await handleHelp(chatId);
      return;
    }

    if (text === "/stats") {
      await handleStats(chatId);
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

    if (text === "/report" || text.startsWith("/report ")) {
      const inlineUrl = text.startsWith("/report ") ? text.slice(8).trim() : null;

      if (inlineUrl) {
        await handleReport(chatId, from?.id ?? chatId, from?.username, inlineUrl);
      } else {
        pendingReport.add(from?.id ?? chatId);
        await sendMessage(
          chatId,
          `🚩 <b>Сообщить об опасной ссылке</b>\n\n` +
          `Отправь мне ссылку, которую бот пропустил или неверно оценил — я передам её на проверку.\n\n` +
          `Просто вставь адрес и отправь:`,
          { reply_markup: { force_reply: true, selective: true } }
        );
      }
      return;
    }

    if (text === "/channel") {
      await sendMessage(
        chatId,
        `📢 <b>Без страха в сети</b> — <a href="https://t.me/bezstrahavseti">@bezstrahavseti</a>\n\nКаждый день советы по цифровой гигиене и разборы мошеннических схем.`,
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

    // ─── Черновик-режим (только для админа) ──────────────────────────────────

    if (text === "/draft") {
      await handleDraft(chatId);
      return;
    }

    if (text === "/approve") {
      await handleApprove(chatId);
      return;
    }

    if (text === "/discard") {
      await handleDiscard(chatId);
      return;
    }

    if (text === "/drafts") {
      await handleDraftsList(chatId);
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────

    if (text === "🔗 Проверить ссылку") {
      await sendMessage(
        chatId,
        `Отправь мне ссылку которую хочешь проверить 👇\n\nМожно вставить адрес целиком, например:\n<code>https://example.com/some-page</code>`,
        { reply_markup: { force_reply: true, selective: true } }
      );
      return;
    }

    if (text === "✉️ Проверить email") {
      await sendMessage(
        chatId,
        `Отправь мне email-адрес который хочешь проверить 👇\n\nНапример, адрес отправителя подозрительного письма:\n<code>support@example.com</code>`,
        { reply_markup: { force_reply: true, selective: true } }
      );
      return;
    }

    if (text === "📧 Проверить письмо") {
      await sendMailInstruction(chatId);
      return;
    }

    const email = extractEmail(text);
    if (email) {
      const userId = from?.id ?? chatId;

      if (pendingReport.has(userId)) {
        pendingReport.delete(userId);
        await handleReport(chatId, userId, from?.username, email);
        return;
      }

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
        logger.info({ userId, limit: rate.limit }, "Rate limit exceeded (email)");
        return;
      }

      const footerHint = rate.remaining <= 5
        ? `\n\n💡 Осталось проверок на сегодня: <b>${rate.remaining}</b>`
        : "";

      await handleEmailCheck(chatId, email, footerHint);
      return;
    }

    const url = extractUrl(text);
    if (url) {
      const userId = from?.id ?? chatId;

      if (pendingReport.has(userId)) {
        pendingReport.delete(userId);
        await handleReport(chatId, userId, from?.username, url);
        return;
      }

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

      const footerHint = rate.remaining <= 5
        ? `\n\n💡 Осталось проверок на сегодня: <b>${rate.remaining}</b>`
        : "";

      await handleLinkCheck(chatId, url, footerHint);
      return;
    }

    await sendMessage(
      chatId,
      `Отправь мне ссылку или email-адрес для проверки — или нажми кнопку внизу 👇`,
      { reply_markup: MAIN_KEYBOARD }
    );
  }

  if (update.callback_query) {
    const { id, from, data } = update.callback_query;
    await tgCall("answerCallbackQuery", { callback_query_id: id });
    if (data === "help") {
      await handleHelp(from.id);
    } else if (data === "mail_forwarded") {
      const chatId = from.id;
      const pending = pendingForwards.get(chatId);
      if (!pending || Date.now() - pending.createdAt > MAIL_CODE_EXPIRY_MS) {
        pendingForwards.delete(chatId);
        await sendMessage(
          chatId,
          `⚠️ Код подтверждения устарел (или письма ещё не было).\n\nНажми «📧 Проверить письмо» ещё раз и пошли письмо заново.`,
          { reply_markup: MAIN_KEYBOARD }
        );
        return;
      }

      await sendTyping(chatId);
      await sendMessage(chatId, "📨 Ищу твоё письмо во входящих...");

      const mails = await pollNewMails(10);
      if (mails.length === 0) {
        await sendMessage(
          chatId,
          `📭 Пока не нашёл письмо на ${MAIL_INBOX_ADDRESS ?? "адрес бота"}.\n\nПроверь, что переслал его с кодом <b>${pending.code}</b>, и нажми «✅ Переслал(а)» ещё раз.`,
          { reply_markup: MAIN_KEYBOARD }
        );
        return;
      }

      let matched = mails.find((m) => extractConfirmationCode(m) === pending.code);
      if (!matched) {
        const otherWaiters = [...pendingForwards.keys()].filter((c) => c !== chatId);
        if (otherWaiters.length === 0) {
          matched = mails[mails.length - 1];
        }
      }

      if (!matched) {
        await sendMessage(
          chatId,
          `ℹ️ Письмо пришло, но я не нашёл в нём твой код <b>${pending.code}</b>.\n\nПопробуй ещё раз: перешли письмо заново с кодом в теме или первым словом.`,
          { reply_markup: MAIN_KEYBOARD }
        );
        return;
      }

      pendingForwards.delete(chatId);
      await handleForwardedCheck(chatId, matched.message);
    }
  }
}

// ─── Настройка webhook и команд ───────────────────────────────────────────────────────────────

export async function setupBot(webhookUrl: string): Promise<void> {
  if (!BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — bot setup skipped");
    return;
  }

  try {
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

    await tgCall("setMyCommands", {
      commands: [
        { command: "start", description: "Запустить бота" },
        { command: "help", description: "Как пользоваться" },
        { command: "status", description: "Сколько проверок осталось сегодня" },
        { command: "report", description: "Сообщить об опасной ссылке" },
        { command: "channel", description: "Канал @bezstrahavseti" },
      ],
    });
    logger.info("Bot commands set");

    await tgCall("setChatMenuButton", {
      menu_button: { type: "default" },
    });
    logger.info("Bot menu button set to default");
  } catch (err) {
    logger.error({ err }, "Bot setup error");
  }
}

// ─── Типы ──────────────────────────────────────────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    forward_date?: number;
    forward_from?: { id: number; first_name: string; username?: string };
    forward_from_chat?: { id: number; title?: string; username?: string; type: string };
    forward_sender_name?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    data?: string;
  };
}
