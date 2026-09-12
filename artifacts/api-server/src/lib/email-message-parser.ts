import { simpleParser, type AddressObject } from "mailparser";
import { createHash } from "crypto";
import { logger } from "./logger";
import type { EmailAttachment, ParsedEmailMessage } from "./email-message";

const MAX_TEXT_LENGTH = 20_000;

/** Признак вложенного письма в тексте пересланного сообщения */
function findForwardedSection(text: string): string | null {
  const markers = [
    /----------\s*Пересланное сообщение\s*----------/i,
    /----------\s*Forwarded message\s*----------/i,
    /Forwarded message/i,
    /Пересылаемое сообщение/i,
    /ПЕРЕСЛАНО С:/i,
    /From:.*\n?(Send|Sent|Date|To):/i,
  ];
  for (const marker of markers) {
    const m = text.match(marker);
    if (m && m.index !== undefined) {
      return text.slice(m.index);
    }
  }
  return null;
}

function extractEmailAddress(value: string | AddressObject | AddressObject[] | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const m = value.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+/);
    return m ? m[0] : null;
  }
  if (Array.isArray(value)) {
    return extractEmailAddress(value[0]);
  }
  return value.value[0]?.address ?? null;
}

function extractName(value: string | AddressObject | AddressObject[] | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return extractName(value[0]);
  return value.value[0]?.name ?? null;
}

function extractLinks(text: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s<>"'\]]+/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[.,;!?)\]]+$/g, "");
    urls.add(raw);
  }
  return [...urls];
}

function detectSuspiciousFilename(filename: string): { suspicious: boolean; reason: string | null } {
  const name = filename.toLowerCase();
  const patterns: [RegExp, string][] = [
    [/\.(exe|scr|bat|cmd|com|pif|vbs|vbe|js|jse|wsf|jar|dmg|appimage|msi)$/, "исполняемый файл"],
    [/\.(docm|xlsm|pptm|doc|dotm)$/, "документ с возможными макросами"],
    [/\.(hta|lnk|url|cpl)$/, "файл, запускаемый при клике"],
    [/\.(apk|ipa)$/, "инсталлятор приложения"],
    [/\.(zip|rar|7z|tar|gz)$/, "архив (может скрывать файлы)"],
    [/\.(html|htm|svg)$/, "веб-файл (может содержать скрипты)"],
  ];
  if (/\.(doc|docx|xls|xlsx|pdf|txt|odt|ods|jpe?g|png|gif|bmp|tiff)$/i.test(name)) {
    return { suspicious: false, reason: null };
  }
  for (const [re, reason] of patterns) {
    if (re.test(name)) return { suspicious: true, reason };
  }
  if (!/\.[a-z0-9]{1,6}$/i.test(name)) {
    return { suspicious: true, reason: "файл без понятного расширения" };
  }
  return { suspicious: false, reason: null };
}

/** Извлекаем original письмо из вложенного .eml (обычно это пересланное письмо) */
async function parseEmlAttachment(buffer: Buffer): Promise<ParsedEmailMessage | null> {
  try {
    const parsed = await simpleParser(buffer);
    let text: string = parsed.text ?? "";
    if (!text || !text.trim()) {
      text = parsed.html ? String(parsed.html) : "";
    }

    const attachments: EmailAttachment[] = parsed.attachments.map((att) => {
      const hash = createHash("sha256").update(att.content).digest("hex");
      const { suspicious, reason } = detectSuspiciousFilename(att.filename ?? "");
      return {
        filename: att.filename ?? null,
        contentType: att.contentType ?? null,
        size: att.content.byteLength,
        hash,
        suspiciousType: suspicious,
        typeReason: reason ?? undefined,
      };
    });

    return {
      fromAddress: extractEmailAddress(parsed.from),
      fromName: extractName(parsed.from),
      subject: parsed.subject ?? null,
      textBody: text.slice(0, MAX_TEXT_LENGTH),
      links: extractLinks(text),
      attachments,
      originalRaw: buffer.toString("utf8"),
      toAddress: extractEmailAddress(parsed.to),
      date: parsed.date ?? null,
    };
  } catch (err) {
    logger.warn({ err }, "Failed to parse .eml attachment");
    return null;
  }
}

/** Парсим сырое сообщение, полученное ботом (пересланное письмо) */
export async function parseForwardedEmail(raw: Buffer | string): Promise<ParsedEmailMessage> {
  const parsed = await simpleParser(raw);

  // Текст тела (пересланное сообщение обычно лежит либо в attachment .eml, либо цитатой)
  let textBody: string = parsed.text ?? "";
  let attachments: EmailAttachment[] = [];
  let original: ParsedEmailMessage | null = null;

  // Ищем вложенный .eml — это оригинальное письмо
  for (const att of parsed.attachments) {
    const fileName = (att.filename ?? "").toLowerCase();
    if (
      fileName.endsWith(".eml") ||
      att.contentType === "message/rfc822" ||
      fileName.endsWith(".msg")
    ) {
      original = await parseEmlAttachment(att.content);
      if (original) break;
    }
  }

  const forwardedText = findForwardedSection(textBody);

  // Если вложенного eml нет — пытаемся вытащить из текста цитату
  if (!original) {
    // Пересланное письмо часто приходит с заголовками From/Subject в самом теле
    const fromMatch = forwardedText
      ? forwardedText.match(/^From:.+$/im)
      : textBody.match(/From:.+$/im);
    const subjectMatch = forwardedText
      ? forwardedText.match(/^Subject:.+$/im)
      : textBody.match(/^Тема:|^Subject:.+$/im);

    const fromAddress = fromMatch
      ? extractEmailAddress(fromMatch[0].replace(/^From:\s*/i, ""))
      : null;

    // Если сразу пришёл нормальный email-адрес в headers From
    if (!forwardedText) {
      const outerFrom = extractEmailAddress(parsed.from);
      if (outerFrom && !fromAddress) {
        // по умолчанию адрес оригинала = адрес От from самовходящего письма
      }
    }

    // ссылки и оставшийся текст
    const links = extractLinks(textBody);

    attachments = parsed.attachments
      .filter((a) => (a.filename ?? "").toLowerCase() !== ".eml")
      .map((att) => {
        const hash = createHash("sha256").update(att.content).digest("hex");
        const { suspicious, reason } = detectSuspiciousFilename(att.filename ?? "");
        return {
          filename: att.filename ?? null,
          contentType: att.contentType ?? null,
          size: att.content.byteLength,
          hash,
          suspiciousType: suspicious,
          typeReason: reason ?? undefined,
        };
      });

    return {
      fromAddress,
      fromName: fromMatch ? fromMatch[0].replace(/^From:\s*/i, "").trim() : null,
      subject: subjectMatch ? subjectMatch[0].replace(/^(Subject|Тема):\s*/i, "").trim() : null,
      textBody: textBody.slice(0, MAX_TEXT_LENGTH),
      links,
      attachments,
      toAddress: null,
      date: parsed.date ?? null,
    };
  }

  // Есть вложенный eml — анализируем именно пересланное письмо
  // Внутренние вложения уже собраны в original.attachments
  return {
    ...original,
    // если текст пересланного сообщения пустой, берём хотя бы текст обёртки
    textBody: original.textBody || textBody.slice(0, MAX_TEXT_LENGTH),
    links: original.links.length > 0 ? original.links : extractLinks(textBody),
  };
}