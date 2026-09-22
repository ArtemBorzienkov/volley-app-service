/** Withdrawing yourself closes this long before the first ball. */
export const CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * When the tournament starts, as an absolute instant.
 *
 * `date` is a calendar day stored as UTC midnight and `startTime` is a wall-clock "HH:MM" with no
 * zone of its own, so the two are combined in UTC: it is the only reading the browser can reproduce
 * exactly, and the alternative — each side using its own local zone — would have them disagree.
 * Without a startTime the day's own midnight stands in.
 *
 * Returns null for a date that cannot be read, so callers decide what an unusable value means rather
 * than silently getting an instant in 1970.
 */
export function eventStartInstant(date: Date | string, startTime: string | null | undefined): number | null {
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return null;

  const minutes = parseStartTime(startTime);

  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + minutes * 60_000;
}

/** Minutes past midnight, or 0 for anything that is not a real "HH:MM". */
function parseStartTime(startTime: string | null | undefined): number {
  if (!startTime) return 0;

  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) return 0;

  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return 0;

  return hours * 60 + mins;
}
