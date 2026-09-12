import { resolveMx } from "node:dns/promises";
import { domainToASCII } from "node:url";

export interface MxInfo {
  /** Есть ли MX-записи (домен реально принимает почту) */
  hasMx: boolean;
  /** Список MX-серверов (нижний регистр) */
  exchanges: string[];
  /** Человекочитаемое имя провайдера, если распознан */
  providerName: string | null;
}

const MX_PROVIDERS: [RegExp, string][] = [
  [/\.google|googlemail|google\.com/i, "Google"],
  [/\.yandex|yandex\.net/i, "Yandex"],
  [/\.mail\.ru|\.vk\.com/i, "Mail.ru (VK)"],
  [/\.outlook|office365|protection\.outlook|\.microsoft/i, "Microsoft"],
  [/\.yahoo/i, "Yahoo"],
  [/\.proton/i, "Proton"],
  [/\.icloud|\.me\.com|\.apple/i, "Apple iCloud"],
  [/\.rambler/i, "Rambler"],
];

function detectProvider(exchanges: string[]): string | null {
  for (const exchange of exchanges) {
    for (const [re, name] of MX_PROVIDERS) {
      if (re.test(exchange)) return name;
    }
  }
  return null;
}

/**
 * Проверка MX-записи домена — существует ли домен и принимает ли почту.
 * Ошибки DNS трактуем как "MX нет" (не бросаем исключений).
 */
export async function checkDomainMx(domain: string): Promise<MxInfo> {
  const ascii = domainToASCII(domain);
  if (!ascii) return { hasMx: false, exchanges: [], providerName: null };

  try {
    const records = await resolveMx(ascii);
    const exchanges = records.map((r) => r.exchange.toLowerCase());
    return {
      hasMx: exchanges.length > 0,
      exchanges,
      providerName: detectProvider(exchanges),
    };
  } catch {
    return { hasMx: false, exchanges: [], providerName: null };
  }
}