/**
 * draft-store.ts
 *
 * In-memory store for pending channel post drafts.
 * One draft per date (keyed by YYYY-MM-DD).
 * Survives bot restarts only within the same process — acceptable for a
 * single-instance VPS deployment where /approve is used within minutes.
 */

export interface Draft {
  /** The formatted post text ready to publish */
  text: string;
  /** ISO date string (YYYY-MM-DD) the draft is for */
  date: string;
  /** Unix timestamp when the draft was created */
  createdAt: number;
}

// Key: YYYY-MM-DD → Draft
const store = new Map<string, Draft>();

/** Store a draft for a given date. Replaces any existing draft for that date. */
export function saveDraft(date: string, text: string): Draft {
  const draft: Draft = { text, date, createdAt: Date.now() };
  store.set(date, draft);
  return draft;
}

/** Get the draft for a given date, or null if none exists. */
export function getDraft(date: string): Draft | null {
  return store.get(date) ?? null;
}

/** Delete the draft for a given date. Returns true if something was deleted. */
export function deleteDraft(date: string): boolean {
  return store.delete(date);
}

/** List all pending drafts, sorted newest first. */
export function listDrafts(): Draft[] {
  return Array.from(store.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Today's date key in Moscow time (UTC+3). */
export function todayKey(): string {
  const now = new Date();
  // Offset to MSK (UTC+3)
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return msk.toISOString().slice(0, 10);
}
