/**
 * In-memory rate limiter for the Telegram bot.
 * Resets counters at midnight UTC every day.
 * No external dependencies needed.
 */

const DAILY_LIMIT = 10;

interface UserCounter {
  count: number;
  dateKey: string; // "YYYY-MM-DD" UTC
}

const counters = new Map<number, UserCounter>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // "2026-05-02"
}

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/** Посмотреть текущий счётчик без увеличения */
export function peekRateLimit(userId: number): RateLimitResult {
  const key = todayKey();
  const entry = counters.get(userId);
  const used = (!entry || entry.dateKey !== key) ? 0 : entry.count;
  return {
    allowed: used < DAILY_LIMIT,
    used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - used),
  };
}

export function checkRateLimit(userId: number): RateLimitResult {
  const key = todayKey();
  const entry = counters.get(userId);

  // Новый день или первый раз — сбрасываем счётчик
  if (!entry || entry.dateKey !== key) {
    counters.set(userId, { count: 0, dateKey: key });
  }

  const current = counters.get(userId)!;
  const allowed = current.count < DAILY_LIMIT;

  if (allowed) {
    current.count += 1;
  }

  return {
    allowed,
    used: current.count,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - current.count),
  };
}

/** Сколько секунд до следующего сброса (полночь UTC) */
export function secondsUntilReset(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

/** Читаемое время до сброса: "через 4 ч 32 мин" */
export function timeUntilResetText(): string {
  const secs = secondsUntilReset();
  const h = Math.floor(secs / 3600);
  const m = Math.ceil((secs % 3600) / 60);
  if (h > 0) return `через ${h} ч ${m} мин`;
  return `через ${m} мин`;
}
