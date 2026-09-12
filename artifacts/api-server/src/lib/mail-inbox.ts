import { ImapFlow } from "imapflow";
import { logger } from "./logger";
import { parseForwardedEmail } from "./email-message-parser";
import type { ParsedEmailMessage } from "./email-message";

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
  /** Интервал поллинга в секундах */
  pollIntervalSeconds?: number;
}

export function isMailboxConfigured(): boolean {
  return !!(process.env["IMAP_HOST"] && process.env["IMAP_USER"] && process.env["IMAP_PASSWORD"]);
}

function mailboxConfig(): MailboxConfig | null {
  if (!isMailboxConfigured()) return null;
  return {
    host: process.env["IMAP_HOST"]!,
    port: Number(process.env["IMAP_PORT"] ?? 993),
    user: process.env["IMAP_USER"]!,
    password: process.env["IMAP_PASSWORD"]!,
    secure: (process.env["IMAP_SECURE"] ?? "true") !== "false",
    pollIntervalSeconds: Number(process.env["MAIL_CHECK_INTERVAL_SECONDS"] ?? 20),
  };
}

const processedUids = new Set<number>();

export interface NewMailEntry {
  uid: number;
  /** Заголовок To/Для — там может быть код подтверждения пользователя */
  to: string | null;
  subject: string | null;
  from: string | null;
  message: ParsedEmailMessage;
}

/**
 * Поллинг нового письма. Возвращает обработанные письма (raw -> parsed).
 * Каждое письмо читается ровно один раз (dedup по UID).
 */
export async function pollNewMails(maxMails = 5): Promise<NewMailEntry[]> {
  const config = mailboxConfig();
  if (!config) return [];

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  const results: NewMailEntry[] = [];

  try {
    await client.connect();

    // Мета-данные письма для сопоставления с пользователем
    let to = null;
    let from = null;
    let subject = null;

    await client.mailboxOpen("INBOX");

    // Сообщения в обратном порядке (новые первыми)
    for await (const message of client.fetch("1:*", {
      source: true,
      envelope: true,
      uid: true,
    })) {
      if (processedUids.has(message.uid)) continue;
      if (results.length >= maxMails) break;

      try {
        to = message.envelope?.to?.[0]?.address ?? null;
        from = message.envelope?.from?.[0]?.address ?? null;
        subject = message.envelope?.subject ?? null;

        const raw = typeof message.source === "string" ? message.source : Buffer.from(message.source ?? []);
        const entry: NewMailEntry = {
          uid: message.uid,
          to,
          subject,
          from,
          message: await parseForwardedEmail(raw),
        };
        results.push(entry);
        processedUids.add(message.uid);

        // Удаляем обработанное письмо из ящика, чтобы не копилось
        logger.info({ uid: message.uid, subject, delivered: to }, "Mailbox: forwarded email processed");
        await client.messageDelete(message.uid, { uid: true }).catch(() => {});
      } catch (err) {
        logger.warn({ err, uid: message.uid }, "Mailbox: failed to process message");
      }
    }
  } catch (err) {
    logger.error({ err, host: config.host }, "IMAP poll failed");
  } finally {
    await client.logout().catch(() => {});
  }

  return results;
}

/** Поиск кода подтверждения в теме или первой строке тела */
export function extractConfirmationCode(entry: NewMailEntry): string | null {
  const haystack = `${entry.subject ?? ""} ${entry.message.textBody ?? ""}`;
  const match = haystack.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}