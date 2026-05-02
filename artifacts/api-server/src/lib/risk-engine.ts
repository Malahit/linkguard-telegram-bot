import { logger } from "./logger";

export type Verdict = "safe" | "caution" | "danger" | "unknown";

export interface RiskResult {
  verdict: Verdict;
  threatTypes: string[];
  explanation: string;
  normalizedUrl: string;
}

const THREAT_TYPE_LABELS: Record<string, string> = {
  MALWARE: "вредоносное ПО",
  SOCIAL_ENGINEERING: "фишинг",
  UNWANTED_SOFTWARE: "нежелательное ПО",
  POTENTIALLY_HARMFUL_APPLICATION: "потенциально опасное приложение",
};

function normalizeUrl(raw: string): string {
  try {
    const trimmed = raw.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    url.hash = "";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function heuristicAnalysis(normalizedUrl: string): { suspicious: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const domain = extractDomain(normalizedUrl);

  const suspiciousPatterns = [
    { re: /\d{3,}\.\d{3,}\.\d{3,}\.\d{3,}/, reason: "IP-адрес вместо домена" },
    { re: /login|signin|secure|verify|account|update|confirm|bank|paypal|steam|telegram/i, reason: "подозрительное ключевое слово" },
    { re: /bit\.ly|tinyurl|t\.co|goo\.gl|short\.io|ow\.ly|tiny\.cc|is\.gd/i, reason: "сокращённая ссылка" },
    { re: /\.tk$|\.ml$|\.ga$|\.cf$|\.gq$/i, reason: "бесплатный домен высокого риска" },
    { re: /punycode|xn--/i, reason: "возможный homograph-attack" },
  ];

  for (const { re, reason } of suspiciousPatterns) {
    if (re.test(normalizedUrl) || re.test(domain)) {
      reasons.push(reason);
    }
  }

  const suspiciousSubdomainDepth = domain.split(".").length > 4;
  if (suspiciousSubdomainDepth) {
    reasons.push("слишком много уровней домена");
  }

  return { suspicious: reasons.length > 0, reasons };
}

const SAFE_DOMAINS = [
  "google.com", "youtube.com", "vk.com", "telegram.org", "t.me",
  "yandex.ru", "mail.ru", "ok.ru", "wikipedia.org", "github.com",
  "apple.com", "microsoft.com", "instagram.com", "twitter.com", "x.com",
  "reddit.com", "stackoverflow.com", "netflix.com", "spotify.com",
];

function isKnownSafeDomain(normalizedUrl: string): boolean {
  const domain = extractDomain(normalizedUrl);
  return SAFE_DOMAINS.some((safe) => domain === safe || domain.endsWith(`.${safe}`));
}

async function checkGoogleWebRisk(url: string): Promise<{ threatTypes: string[] }> {
  const apiKey = process.env["GOOGLE_SAFE_BROWSING_API_KEY"];
  if (!apiKey) {
    logger.warn("GOOGLE_SAFE_BROWSING_API_KEY not set — skipping Google Web Risk check");
    return { threatTypes: [] };
  }

  try {
    const resp = await fetch(
      `https://webrisk.googleapis.com/v1/uris:search?key=${apiKey}&uri=${encodeURIComponent(url)}&threatTypes=MALWARE&threatTypes=SOCIAL_ENGINEERING&threatTypes=UNWANTED_SOFTWARE`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Google Web Risk API error");
      return { threatTypes: [] };
    }
    const data = await resp.json() as { threat?: { threatTypes: string[] } };
    return { threatTypes: data.threat?.threatTypes ?? [] };
  } catch (err) {
    logger.warn({ err }, "Google Web Risk request failed");
    return { threatTypes: [] };
  }
}

export async function checkUrl(
  rawUrl: string,
  trustedDomains: string[] = []
): Promise<RiskResult> {
  const normalizedUrl = normalizeUrl(rawUrl);
  const domain = extractDomain(normalizedUrl);

  if (trustedDomains.some((td) => domain === td || domain.endsWith(`.${td}`))) {
    return {
      verdict: "safe",
      threatTypes: [],
      explanation: "Этот домен в твоём списке доверенных сайтов.",
      normalizedUrl,
    };
  }

  const [webRiskResult, heuristics] = await Promise.all([
    checkGoogleWebRisk(normalizedUrl),
    Promise.resolve(heuristicAnalysis(normalizedUrl)),
  ]);

  const threatTypes = webRiskResult.threatTypes;

  if (threatTypes.length > 0) {
    const labels = threatTypes.map((t) => THREAT_TYPE_LABELS[t] ?? t).join(", ");
    return {
      verdict: "danger",
      threatTypes,
      explanation: `Лучше не открывай — этот сайт помечен как опасный (${labels}).`,
      normalizedUrl,
    };
  }

  if (heuristics.suspicious) {
    const reasons = heuristics.reasons.join(", ");
    return {
      verdict: "caution",
      threatTypes: [],
      explanation: `Будь осторожен — сайт кажется подозрительным (${reasons}).`,
      normalizedUrl,
    };
  }

  if (isKnownSafeDomain(normalizedUrl)) {
    return {
      verdict: "safe",
      threatTypes: [],
      explanation: "Этот сайт выглядит безопасным.",
      normalizedUrl,
    };
  }

  return {
    verdict: "unknown",
    threatTypes: [],
    explanation: "Мы не знаем этот сайт. Открывай только если доверяешь отправителю.",
    normalizedUrl,
  };
}
