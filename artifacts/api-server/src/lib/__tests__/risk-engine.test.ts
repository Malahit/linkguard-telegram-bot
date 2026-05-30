import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем внешние зависимости, чтобы тесты работали без API-ключей
vi.mock("../virustotal", () => ({
  checkVirusTotal: vi.fn().mockResolvedValue(null),
}));

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Отключаем Google Web Risk (нет ключа в тестах)
global.fetch = vi.fn().mockResolvedValue({
  ok: false,
  status: 403,
  json: async () => ({}),
}) as unknown as typeof fetch;

import { checkUrl } from "../risk-engine";

describe("risk-engine: эвристики", () => {
  beforeEach(() => vi.clearAllMocks());

  it("известный домен — safe", async () => {
    const result = await checkUrl("https://google.com");
    expect(result.verdict).toBe("safe");
  });

  it("известный домен — vk.com safe", async () => {
    const result = await checkUrl("https://vk.com/feed");
    expect(result.verdict).toBe("safe");
  });

  it("неизвестный домен — unknown", async () => {
    const result = await checkUrl("https://some-random-site-xyz123.com");
    expect(result.verdict).toBe("unknown");
  });

  it("сокращённая ссылка — caution", async () => {
    const result = await checkUrl("https://bit.ly/abc123");
    expect(result.verdict).toBe("caution");
    expect(result.explanation).toMatch(/сокращ/i);
  });

  it("домен с IP-адресом — caution", async () => {
    const result = await checkUrl("http://192.168.1.1/login");
    expect(result.verdict).toBe("caution");
  });

  it("бесплатный домен .tk — caution", async () => {
    const result = await checkUrl("https://free-money.tk");
    expect(result.verdict).toBe("caution");
  });

  it("ключевое слово login — caution", async () => {
    const result = await checkUrl("https://totally-legit-login.com");
    expect(result.verdict).toBe("caution");
  });

  it("доверенный домен — safe через trustedDomains", async () => {
    const result = await checkUrl("https://internal.corp", ["internal.corp"]);
    expect(result.verdict).toBe("safe");
    expect(result.explanation).toMatch(/доверенных/i);
  });
});

describe("risk-engine: VirusTotal вердикт", () => {
  beforeEach(() => vi.clearAllMocks());

  it("VT malicious >= 3 — danger", async () => {
    const { checkVirusTotal } = await import("../virustotal");
    vi.mocked(checkVirusTotal).mockResolvedValueOnce({
      stats: { malicious: 5, suspicious: 0, harmless: 60, undetected: 10 },
      permalink: "https://www.virustotal.com/gui/url/abc",
    });
    const result = await checkUrl("https://evil-phishing-site.com");
    expect(result.verdict).toBe("danger");
    expect(result.vtPermalink).toBe("https://www.virustotal.com/gui/url/abc");
  });

  it("VT malicious = 1 — caution", async () => {
    const { checkVirusTotal } = await import("../virustotal");
    vi.mocked(checkVirusTotal).mockResolvedValueOnce({
      stats: { malicious: 1, suspicious: 0, harmless: 70, undetected: 5 },
      permalink: "https://www.virustotal.com/gui/url/def",
    });
    const result = await checkUrl("https://slightly-sus.com");
    expect(result.verdict).toBe("caution");
  });

  it("VT clean — unknown для неизвестного домена", async () => {
    const { checkVirusTotal } = await import("../virustotal");
    vi.mocked(checkVirusTotal).mockResolvedValueOnce({
      stats: { malicious: 0, suspicious: 0, harmless: 80, undetected: 5 },
      permalink: "https://www.virustotal.com/gui/url/ghi",
    });
    const result = await checkUrl("https://brand-new-unknown-site.io");
    expect(result.verdict).toBe("unknown");
  });
});
