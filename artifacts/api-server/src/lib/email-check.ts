import { checkDomainMx, type MxInfo } from "./email-mx";

export type EmailVerdict = "safe" | "caution" | "danger" | "unknown";

export interface EmailRiskResult {
  verdict: EmailVerdict;
  threatTypes: string[];
  explanation: string;
  normalizedEmail: string;
  /** Результат MX-проверки домена (для отображения пользователю) */
  mx?: MxInfo | null;
  /** Признак, что без анализа полного письма точного вердикта нет */
  suggestsDeepCheck?: boolean;
  /** Требуется ли углублённая AI-проверка отправителя (бренд на бесплатной почте) */
  senderNeedsAiCheck?: boolean;
  /** Для чего вызвана AI-проверка (человекочитаемо) */
  senderAiReason?: string;
}

// ─── Известные безопасные почтовые домены ──────────────────────────────────

const SAFE_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yandex.ru",
  "yandex.com",
  "ya.ru",
  "mail.ru",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "proton.me",
  "protonmail.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "aol.com",
  "gmx.com",
  "zoho.com",
  "inbox.ru",
  "list.ru",
  "bk.ru",
  "rambler.ru",
];

// ─── Популярные домены для детекции имитаторов ────────────────────────────────

const POPULAR_DOMAINS = [
  "gmail",
  "yandex",
  "mail",
  "outlook",
  "hotmail",
  "proton",
  "icloud",
  "yahoo",
  "google",
  "rambler",
  "bk",
  "inbox",
  "ya",
];

// ─── Официальные/государственные домены ──────────────────────────────────────

const OFFICIAL_DOMAIN_MARKERS = [
  ".gov.ru",
  ".gov.",
  ".gob.",
  ".mil",
  ".edu",
  ".ac.ru",
  "gosuslugi.ru",
];

// ─── Словари названий, которые часто подделывают ─────────────────────────────

const OFFICIAL_ORG_WORDS = [
  "prokuratura", "prokuratyra", "procura", "prosecutor", "procuracy",
  "суд", "sud", "ship",
  "nalog", "налоговая", "такс", "tax",
  "fssp", "gibdd", "полиция", "police", "mvd",
  "sber", "сбер", "втб", "tinkoff", "банк", "bank",
  "gosuslugi", "госуслуги", "миграционный", "migration",
];

// ─── Сигналы ─────────────────────────────────────────────────────────────────

interface EmailSignals {
  domain: string;
  local: string;
  // neutral reasons (запускают caution, но не «опасно»)
  suspicious: string[];
  // caution-уровень причины (требуют осторожности, но не threatTypes)
  cautionFacts: string[];
  // «опасно» причины
  danger: string[];
  // факты для ответа пользователю (MX и т.п.)
  facts: string[];
}

function extractEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase().trim();
}

function extractLocalPart(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(0, at).toLowerCase().trim();
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isSuspiciousTLD(domain: string): boolean {
  return /\.(tk|ml|ga|cf|gq)$/i.test(domain);
}

function isFreeHost(s: string): boolean {
  return /^(mailinator|guerrillamail|temp-mail|10minutemail|yopmail|sharklasers|getnada|maildrop)\./i.test(s);
}

function isOfficialDomain(domain: string): boolean {
  return OFFICIAL_DOMAIN_MARKERS.some((m) => domain.includes(m));
}

function isKnownSafeDomain(domain: string): boolean {
  return SAFE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Сходство строки с популярным доменом по опечаткам (эвристика) */
function looksLikeImpersonation(domain: string): boolean {
  const core = domain.replace(/\.(com|ru|net|org|info|io|su|site)$/i, "").toLowerCase();
  if (SAFE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  if (isOfficialDomain(domain)) return false;

  return POPULAR_DOMAINS.some((d) => {
    if (core === d) return true;
    if (core.length < d.length - 1 || core.length > d.length + 2) return false;

    // Расстояние Левенштейна <= 2 — похоже на имитацию
    let dist = levenshteinDistance(core, d);
    return dist <= 2;
  });
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

/** Ловим опечатки в названии официальных органов внутри local-части */
function findOrphanNameTypos(local: string): string | null {
  const cleaned = local.toLowerCase().replace(/[^a-zа-яё0-9]/g, "");
  if (!cleaned) return null;

  for (const word of OFFICIAL_ORG_WORDS) {
    if (cleaned === word) return word;
    // Тёплое сходство по подстроке: ищем слово в любом месте local-части
    for (let i = 0; i + word.length - 1 < cleaned.length; i++) {
      const slice = cleaned.slice(i, i + word.length);
      if (levenshteinDistance(slice, word) <= 1) return word;
    }
  }
  // Если local заметно длиннее слова — проверяем похожесть целиком vs словарь
  for (const word of OFFICIAL_ORG_WORDS) {
    if (cleaned.length === word.length && levenshteinDistance(cleaned, word) <= 1) return word;
  }
  return null;
}

// ─── Определение домена для MX-проверки ────────────────────────────────────

function mtaDomainForMx(normalizedEmail: string): string | null {
  const domain = extractEmailDomain(normalizedEmail);
  if (!domain || isIpAddress(domain)) return null;
  // Домен без точки — внутренний/локальный, внешний MX-запрос к нему не имеет смысла
  if (!domain.includes(".")) return null;
  return domain;
}

// ─── Детекция «похоже на компанию/сервис на бесплатной почте» ──────────────────

const SERVICE_BASE_WORDS = [
  "service", "services", "support", "help", "info", "noreply", "no-reply",
  "notify", "notification", "news", "mailing", "billing", "sales", "team",
  "office", "secure", "verify", "verification", "confirm", "account",
];

/**
 * Если local-часть адреса выглядит как служебный адрес компании/сервиса
 * (а не как обычное личное имя), а домен — бесплатная почта, это подозрение:
 * настоящие компании обычно пишут со своих доменов.
 */
function looksLikeCompanyAddress(domain: string, local: string): boolean {
  // Бесплатные почтовики и не официальные домены
  const isFreeMail = isKnownSafeDomain(domain);
  if (!isFreeMail || isOfficialDomain(domain)) return false;

  const clean = local.toLowerCase().replace(/[^a-zа-яё0-9-]/g, "");

  // Служебное слово целиком или префикс/суффикс через дефис
  for (const w of SERVICE_BASE_WORDS) {
    const parts = clean.split("-").filter(Boolean);
    if (parts.length >= 2 && parts.includes(w)) return true;
    if (parts.length === 1 && parts[0] === w) return true;
  }

  // Одно из типичных «info/support/office» в начале
  if (/^(info|support|sales|office|team|noreply|no-reply|notify|service|secure|verify|account)[.-]/.test(clean)) {
    return true;
  }
  return false;
}

// ─── Главная проверка ───────────────────────────────────────────────────────

/** Проверка почтового адреса на подозрительность */
export async function checkEmail(
  email: string,
  trustedDomains: string[] = []
): Promise<EmailRiskResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const sig: EmailSignals = {
    domain: extractEmailDomain(normalizedEmail),
    local: extractLocalPart(normalizedEmail),
    suspicious: [],
    cautionFacts: [],
    danger: [],
    facts: [],
  };

  if (!normalizedEmail.includes("@") || !isValidEmailFormat(normalizedEmail)) {
    return {
      verdict: "unknown",
      threatTypes: [],
      explanation:
        "Это не похоже на настоящий email-адрес. Проверь, что адрес написан правильно — например, имя@домен.ru.",
      normalizedEmail: email.trim(),
    };
  }

  const domain = extractEmailDomain(normalizedEmail);
  const local = extractLocalPart(normalizedEmail);

  // Свой список доверенных доменов
  const isTrusted = trustedDomains.some(
    (td) => domain === td.toLowerCase() || domain.endsWith(`.${td.toLowerCase()}`)
  );
  if (isTrusted) {
    return {
      verdict: "safe",
      threatTypes: [],
      explanation: "Домен этого email-адреса в твоём списке доверенных.",
      normalizedEmail,
    };
  }

  // Гос/официальный домен — сразу уважительная проверка
  if (isOfficialDomain(domain)) {
    sig.facts.push("домен официального/государственного ведомства");
  }

  // Базовые структурные признаки
  if (!domain.includes(".") && !isIpAddress(domain)) {
    sig.cautionFacts.push("домен без точки похож на поддельный");
  }

  if (isIpAddress(domain)) {
    sig.danger.push("домен — IP-адрес вместо нормального названия");
  }

  if (isSuspiciousTLD(domain)) {
    sig.danger.push("бесплатный домен (например .tk), который часто используют мошенники");
  }

  if (isFreeHost(domain)) {
    sig.danger.push("одноразовая почта для анонимных регистраций");
  }

  // Имитация известного сервиса
  if (looksLikeImpersonation(domain)) {
    sig.danger.push("домен похож на известный сервис с ошибкой — типичный приём фишинга");
  }

  // Кириллица в email
  if (/[а-яё]/i.test(normalizedEmail) || /[\u0400-\u04FF]/.test(domain)) {
    sig.cautionFacts.push("в адресе кириллица — домен мог быть переписан похожими буквами");
  }

  // Подозрительные слова в local-части
  if (/security|secure|verify|confirm|account|update|support|bank|paypal|steam|telegram|sber|vtb|tinkoff/i.test(local)) {
    sig.cautionFacts.push("в адресе слова из типовых фишинговых писем");
  }

  // Опечатки в названии официальных органов
  const orgTypo = findOrphanNameTypos(local);
  if (orgTypo) {
    // Маскировка под орган/организацию с не-официального домена — сильный признак
    // (прокуратура/налоговая/банк не пишут с mail.ru, gmail.com и т.п.)
    if (!isOfficialDomain(domain)) {
      sig.danger.push(
        `адрес маскируется под орган «${orgTypo}», но отправлен не с официального домена ведомства`
      );
    } else {
      sig.facts.push(
        `адрес содержит название органа «${orgTypo}» и домен официальный`
      );
    }
  }

  // MX-фактчек
  let mx: MxInfo | null = null;
  const mtaDomain = mtaDomainForMx(normalizedEmail);
  if (mtaDomain) {
    mx = await checkDomainMx(mtaDomain);
  }
  if (mx) {
    if (mx.hasMx) {
      sig.facts.push(
        mx.providerName
          ? `домен существует, почта принимается через ${mx.providerName}`
          : "домен существует и принимает почту"
      );
    } else {
      sig.danger.push("домен не принимает почту — скорее всего, адрес выдуман");
    }
  }

  // Danger: у нас есть явные угрозы
  if (sig.danger.length > 0) {
    return {
      verdict: "danger",
      threatTypes: ["EMAIL_FAILED"],
      explanation: `Адрес похож на фейковый: ${sig.danger.join(", ")}. Не отвечай на письма с него.`,
      normalizedEmail,
      mx,
      suggestsDeepCheck: true,
    };
  }

  // Caution: подозрительные признаки без подтверждения безопасности
  const cautionAll = [...sig.cautionFacts, ...sig.suspicious].filter((v, i, a) => a.indexOf(v) === i);
  if (cautionAll.length > 0) {
    return {
      verdict: "caution",
      threatTypes: ["EMAIL_CAUTION"],
      explanation: `Будь осторожен: ${cautionAll.join(", ")}. Для точного вердикта проверь само письмо.`,
      normalizedEmail,
      mx,
      suggestsDeepCheck: true,
    };
  }

  // Официальный домен — safe
  if (isOfficialDomain(domain)) {
    return {
      verdict: "safe",
      threatTypes: [],
      explanation: "Домен официального ведомства — письма с него стоит читать, но не по подозрительным ссылкам.",
      normalizedEmail,
      mx,
    };
  }

  // Известная безопасная почта, но адрес похож на компанию/сервис
  // (например aquael-service@ya.ru) — настоящие компании пишут со своих доменов.
  // Требуется углублённая AI-проверка, что это официальный контакт.
  if (isKnownSafeDomain(domain) && looksLikeCompanyAddress(domain, local)) {
    return {
      verdict: "caution",
      threatTypes: ["EMAIL_BRAND_ON_FREEMAIL"],
      explanation:
        `Домен надёжный (${domain}), но адрес похож на служебный адрес компании — ` +
        `а компании обычно пишут со своих сайтов, а не с бесплатной почты. Проверяю, настоящий ли это контакт.`,
      normalizedEmail,
      mx,
      senderNeedsAiCheck: true,
      senderAiReason: "адрес похож на официальный контакт компании, но на бесплатной почте",
    };
  }

  // Известная безопасная почта
  if (isKnownSafeDomain(domain)) {
    return {
      verdict: "safe",
      threatTypes: [],
      explanation: "Домен этого адреса — известная и надёжная почтовая служба.",
      normalizedEmail,
      mx,
    };
  }

  // Неизвестный домен с реальной MX — не можем сказать ничего надёжного
  if (mx && mx.hasMx) {
    return {
      verdict: "unknown",
      threatTypes: [],
      explanation:
        `Домен существует и принимает почту, но мы не знаем эту организацию. ` +
        `Открывай письмо только если ты точно ждёшь его. Для точного вердикта проверь само письмо.`,
      normalizedEmail,
      mx,
      suggestsDeepCheck: true,
    };
  }

  // Полностью неизвестный домен без подтверждения MX
  return {
    verdict: "unknown",
    threatTypes: [],
    explanation:
      "Мы не знаем этот домен почты. Для точного вердикта проверь само письмо целиком.",
    normalizedEmail,
    mx,
    suggestsDeepCheck: true,
  };
}

/** Валидация формата email-адреса (простая, без RFC 2822) */
function isValidEmailFormat(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1);
  if (domain.length < 3 || domain.startsWith(".") || domain.endsWith(".")) return false;
  if (/\s/.test(email)) return false;
  if (email.includes("..")) return false;
  return true;
}

/** Выделение email-адреса из произвольного текста */
export function extractEmail(text: string): string | null {
  const trimmed = text.trim();
  // Полное совпадение: имя@домен (точка в домене не обязательна —
  // мошенники часто используют адреса вида procuratura@mail)
  if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+/);
  return match ? match[0] : null;
}