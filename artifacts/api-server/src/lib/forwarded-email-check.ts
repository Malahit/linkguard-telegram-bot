import { logger } from "./logger";
import { checkEmail } from "./email-check";
import { checkUrl } from "./risk-engine";
import type { ParsedEmailMessage } from "./email-message";
import { generateForwardedEmailRecommendation } from "./ai-recommendation";

export type EmailVerdict = "safe" | "caution" | "danger" | "unknown";

const MAX_LINKS_CHECKED = 5;

export interface ForwardedEmailResult {
  verdict: EmailVerdict;
  threatTypes: string[];
  explanation: string;
  senderInfo: string | null;
  senderVerdict: EmailVerdict;
  linkResults: { url: string; verdict: EmailVerdict }[];
  suspiciousAttachments: { filename: string | null; reason: string }[];
  aiText: string | null;
}

function bodyHeuristics(text: string): string[] {
  const lower = text.toLowerCase();
  const signals: string[] = [];

  const urgency = /срочно|немедленно|прямо сейчас|в течение (часа|суток)|urgent|immediately/i;
  const money = /пароль|password|деньги|перевод|карта|счёт|заблокирован|выигрыш|приз|бонус|награда|оплати|перейди/i;
  const threat = /вы должны|мы подадим|суд|угол|квитанци|штраф|police|судебн/i;
  const click = /перейди по ссылке|нажмите (здесь|на)|enter link|click here|open the link/i;
  const wrongSender = /уважаемый пользователь|дорогой клиент|наш дорогой/i;

  if (urgency.test(lower)) signals.push("текст давит на срочность — типичный приём фишинга");
  if (money.test(lower)) signals.push("в тексте просьбы про пароли, деньги или блокировки");
  if (threat.test(lower)) signals.push("в письме говорится об угрозах, штрафах или суде");
  if (click.test(lower)) signals.push("письмо просит перейти по ссылке");
  if (wrongSender.test(lower)) signals.push("обращение обезличенное — «уважаемый пользователь», а не поимённо");

  return signals;
}

function enhanceWithAiSuse(
  result: ForwardedEmailResult,
  _raw: ParsedEmailMessage,
  aiText: string | null
): ForwardedEmailResult {
  return { ...result, aiText };
}

export async function checkForwardedEmail(
  raw: ParsedEmailMessage,
  aiEnabled = true
): Promise<ForwardedEmailResult> {
  const senderInfo: string | null = raw.fromAddress;

  // 1. Проверка отправителя
  const senderRisk = raw.fromAddress ? await checkEmail(raw.fromAddress) : null;
  const effectiveSenderVerdict: EmailVerdict = senderRisk ? senderRisk.verdict : "unknown";

  // 2. Ссылки (макс 5)
  const linkResults: { url: string; verdict: EmailVerdict }[] = [];
  for (const url of raw.links.slice(0, MAX_LINKS_CHECKED)) {
    const r = await checkUrl(url);
    linkResults.push({ url, verdict: r.verdict });
  }

  // 3. Текст
  const bodySignals = bodyHeuristics(raw.textBody);

  // 4. Вложения
  const suspiciousAttachments: { filename: string | null; reason: string }[] =
    raw.attachments
      .filter((a) => a.suspiciousType)
      .map((a) => ({ filename: a.filename, reason: a.typeReason ?? "подозрительный тип файла" }));

  // Сборка вердикта: worst-of
  const threatTypes: string[] = [];
  let verdict: EmailVerdict = "safe";

  if (senderRisk) {
    threatTypes.push(...senderRisk.threatTypes);
  }
  for (const lr of linkResults) {
    if (lr.verdict === "danger") {
      threatTypes.push("DANGER_LINK");
      verdict = "danger";
    }
  }

  if (effectiveSenderVerdict === "danger") {
    threatTypes.push("DANGER_SENDER");
    verdict = "danger";
  }

  if (bodySignals.length > 0) {
    threatTypes.push("PHISHING_TEXT");
  }

  if (suspiciousAttachments.length > 0) {
    threatTypes.push("SUSPICIOUS_ATTACHMENT");
  }

if (threatTypes.includes("DANGER_LINK") || threatTypes.includes("DANGER_SENDER")) {
    verdict = "danger";
  } else if (threatTypes.length > 0 || bodySignals.length > 0 || suspiciousAttachments.length > 0) {
    // нет явных danger-ссылок/отправителя, но есть флаги — осторожно
    verdict = "caution";
  } else if (effectiveSenderVerdict === "unknown") {
    verdict = "caution";
  }

  // AI-разбор
  let aiText: string | null = null;
  if (aiEnabled) {
    try {
      aiText = await generateForwardedEmailRecommendation(raw, verdict, threatTypes, bodySignals);
    } catch (err) {
      logger.warn({ err }, "AI forwarded-email recommendation failed");
    }
  }

  const explanationParts: string[] = [];
  if (senderRisk) explanationParts.push(`Отправитель: ${senderRisk.explanation}`);
  if (bodySignals.length > 0) explanationParts.push(`Текст письма: ${bodySignals.join("; ")}.`);
  if (suspiciousAttachments.length > 0) {
    explanationParts.push(
      `Вложения: ${suspiciousAttachments.map((a) => `${a.filename ?? "без имени"} (${a.reason})`).join(", ")}.`
    );
  }
  if (linkResults.length > 0) {
    const bad = linkResults.filter((l) => l.verdict !== "safe");
    if (bad.length > 0) {
      explanationParts.push(`Ссылки: ${bad.map((b) => b.url).join(", ")} — подозрительные.`);
    }
  }

  const explanation =
    explanationParts.length > 0
      ? explanationParts.join("\n")
      : "В письме не нашлось явных признаков угрозы.";

  return enhanceWithAiSuse(
    {
      verdict,
      threatTypes,
      explanation,
      senderInfo,
      senderVerdict: effectiveSenderVerdict as EmailVerdict,
      linkResults,
      suspiciousAttachments,
      aiText,
    },
    raw,
    aiText
  );
}