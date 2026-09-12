import { describe, it, expect, vi, beforeEach } from "vitest";

import { checkEmail, extractEmail } from "../email-check";

// Мокаем MX-проверку: для известных доменов считаем, что почта принимается
const knownMxDomains = new Set([
  "mail.ru", "gmail.com", "googlemail.com", "yandex.ru", "yandex.com", "ya.ru",
  "outlook.com", "hotmail.com", "proton.me", "icloud.com", "yahoo.com",
  "russian.ru", "some-random-domain-xyz123.com",
]);

vi.mock("../email-mx", () => ({
  checkDomainMx: vi.fn(async (domain: string) => ({
    hasMx: knownMxDomains.has(domain),
    exchanges: knownMxDomains.has(domain)
      ? domain === "mail.ru"
        ? ["emx.mail.ru"]
        : domain === "gmail.com" || domain === "googlemail.com"
          ? ["aspmx.l.google.com"]
          : domain === "ya.ru" || domain === "yandex.ru" || domain === "yandex.com"
            ? ["mx.yandex.net"]
            : ["mx.example.net"]
      : [],
    providerName: null,
  })),
}));

describe("email-check: формат и extractEmail", () => {
  it("extractEmail находит адрес в тексте", () => {
    expect(extractEmail("напиши на support@example.com пожалуйста")).toBe(
      "support@example.com"
    );
  });

  it("extractEmail возвращает адрес целиком", () => {
    expect(extractEmail("user@yandex.ru")).toBe("user@yandex.ru");
  });

  it("extractEmail возвращает null если адреса нет", () => {
    expect(extractEmail("просто текст без адреса")).toBeNull();
  });

  it("extractEmail распознаёт адрес без точки в домене", () => {
    expect(extractEmail("oblprocuratura@mail")).toBe("oblprocuratura@mail");
  });

  it("невалидный email — unknown", async () => {
    const result = await checkEmail("не-адрес");
    expect(result.verdict).toBe("unknown");
  });
});

describe("email-check: вердикты", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("безопасный домен — safe", async () => {
    const result = await checkEmail("user@gmail.com");
    expect(result.verdict).toBe("safe");
  });

  it("yandex.ru — safe", async () => {
    const result = await checkEmail("user@yandex.ru");
    expect(result.verdict).toBe("safe");
  });

  it("ya.ru (Яндекс) — safe, не имитатор", async () => {
    const result = await checkEmail("aquael-service@ya.ru");
    expect(result.verdict).toBe("safe");
  });

  it("доверенный домен — safe через trustedDomains", async () => {
    const result = await checkEmail("user@internal.corp", ["internal.corp"]);
    expect(result.verdict).toBe("safe");
    expect(result.explanation).toMatch(/доверенных/i);
  });

  it("домен-имитатор — danger (опечатка gmail)", async () => {
    const result = await checkEmail("support@gmaiil.com");
    expect(result.verdict).toBe("danger");
  });

  it("домен-имитатор — danger (опечатка yandex)", async () => {
    const result = await checkEmail("help@yaandex.ru");
    expect(result.verdict).toBe("danger");
  });

  it("мошеннический oblprocuratyra@mail.ru — danger", async () => {
    const result = await checkEmail("oblprocuratyra@mail.ru");
    expect(result.verdict).toBe("danger");
    expect(result.explanation).toMatch(/фиктивн|маск|орган|фейк/i);
  });

  it("мошеннический адрес без точки домена (oblprocuratura@mail) — danger", async () => {
    const result = await checkEmail("oblprocuratura@mail");
    expect(result.verdict).toBe("danger");
    expect(result.explanation).toMatch(/фиш|мошен|фейк|фиктивн/i);
  });

  it("подделка под прокуратуру — danger", async () => {
    const result = await checkEmail("prokuratura-msk@yandex1.ru");
    expect(result.verdict).toBe("danger");
  });

  it("IP-адрес вместо домена — danger", async () => {
    const result = await checkEmail("admin@192.168.1.1");
    expect(result.verdict).toBe("danger");
  });

  it("бесплатный домен .tk — danger", async () => {
    const result = await checkEmail("user@free-money.tk");
    expect(result.verdict).toBe("danger");
  });

  it("адрес с доменом без точки — caution", async () => {
    const result = await checkEmail("someuser@internal");
    expect(result.verdict).toBe("caution");
  });

  it("неизвестный домен с реальной MX — unknown + suggestsDeepCheck", async () => {
    const result = await checkEmail("user@some-random-domain-xyz123.com");
    expect(result.verdict).toBe("unknown");
    expect(result.suggestsDeepCheck).toBe(true);
  });
});