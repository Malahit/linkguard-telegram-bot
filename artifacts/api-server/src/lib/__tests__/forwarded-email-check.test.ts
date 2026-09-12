import { describe, it, expect, vi } from "vitest";

import { parseForwardedEmail } from "../email-message-parser";
import { extractConfirmationCode } from "../mail-inbox";
import { checkForwardedEmail } from "../forwarded-email-check";

// Отключаем AI и внешние network-вызовы в тестах
vi.mock("../ai-recommendation", () => ({
  generateForwardedEmailRecommendation: vi.fn(async () => "AI-разбор (мок)"),
}));

// MX и внешние проверки тоже мокаем
vi.mock("../email-mx", () => ({
  checkDomainMx: vi.fn(async () => ({ hasMx: true, exchanges: ["mx.example.net"], providerName: "Example" })),
}));

vi.mock("../risk-engine", () => ({
  checkUrl: vi.fn(async (url: string) => ({
    verdict: url.includes("danger") ? "danger" : "unknown",
    threatTypes: url.includes("danger") ? ["VT_MALICIOUS"] : [],
    explanation: "мок",
    normalizedUrl: url,
  })),
}));

const FORWARDED_WITH_QUOTE = [
  "Subject: Fwd: Важное письмо",
  "From: user@someorg.ru",
  "To: me@example.com",
  "Date: Mon, 10 Aug 2026 10:00:00 +0000",
  "",
  "---------- Пересланное сообщение ----------",
  "From: Мошенник <notify@phish-bank.com>",
  "Subject: Ваш аккаунт заблокирован",
  "Date: Mon, 10 Aug 2026 09:00:00 +0000",
  "",
  "Срочно перейдите по ссылке и введите пароль: https://bank-verify.danger-site.com/login",
  "Ваш аккаунт будет удалён в течение часа.",
].join("\n");

describe("email-message-parser: пересланное письмо (цитата)", () => {
  it("извлекает отправителя, тему и ссылки из цитаты", async () => {
    const parsed = await parseForwardedEmail(FORWARDED_WITH_QUOTE);
    expect(parsed.textBody).toContain("Мошенник");
    expect(parsed.textBody).toContain("danger-site.com");
    expect(parsed.links.length).toBeGreaterThan(0);
  });
});

describe("forwarded-email-check: агрегация", () => {
  it("письмо с опасной ссылкой — danger", async () => {
    const parsed = await parseForwardedEmail(FORWARDED_WITH_QUOTE);
    const result = await checkForwardedEmail(parsed, false);
    expect(result.verdict).toBe("danger");
  });

  it("письмо с подозрительным вложением — danger/caution", async () => {
    const raw = [
      "Subject: Счёт за договор",
      "From: invoice@some-corp.com",
      "To: me@example.com",
      "Date: Mon, 10 Aug 2026 10:00:00 +0000",
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="BOUNDARY123"',
      "",
      "--BOUNDARY123",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      "Оплатите счёт, во вложении документ.",
      "",
      "--BOUNDARY123",
      "Content-Type: application/vnd.ms-word.document.macroEnabled.12; name=Invoice_2026.docm",
      "Content-Disposition: attachment; filename=Invoice_2026.docm",
      "Content-Transfer-Encoding: base64",
      "",
      "SGVsbG8gV29ybGQ=",
      "",
      "--BOUNDARY123--",
      "",
    ].join("\r\n");
    const parsed = await parseForwardedEmail(raw);
    expect(parsed.attachments.length).toBeGreaterThan(0);
    expect(parsed.attachments.some((a) => a.suspiciousType)).toBe(true);
  });

  it("извлечение кода подтверждения из темы", () => {
    expect(
      extractConfirmationCode({
        uid: 1,
        subject: "Fwd: 483920",
        from: "a@b.ru",
        to: null,
        message: { textBody: "hello", links: [], attachments: [] } as never,
      })
    ).toBe("483920");
  });

  it("извлечение кода подтверждения из первой строки тела", () => {
    expect(
      extractConfirmationCode({
        uid: 1,
        subject: "Fwd: письмо",
        from: "a@b.ru",
        to: null,
        message: { textBody: "451209\nвсё остальное письмо", links: [], attachments: [] } as never,
      })
    ).toBe("451209");
  });
});