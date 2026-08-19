/**
 * Calendar helpers.
 *
 * Every "day" in TarangOS is a plain `YYYY-MM-DD` string, never a timestamp.
 * That removes the entire class of off-by-one-day bugs caused by timezones and
 * DST, and makes 6+ months of history trivially comparable and sortable.
 */

export type DateStr = string; // YYYY-MM-DD

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(value: unknown): value is DateStr {
  return typeof value === 'string' && DATE_RE.test(value);
}

/** Today in the given IANA timezone. */
export function todayStr(timezone = 'UTC', now: Date = new Date()): DateStr {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Current HH:MM in the given timezone. */
export function nowTimeStr(timezone = 'UTC', now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

function toUTC(date: DateStr): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(dt: Date): DateStr {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: DateStr, days: number): DateStr {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUTC(dt);
}

export function addMonths(date: DateStr, months: number): DateStr {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUTC(target);
}

export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: DateStr): number {
  return toUTC(date).getUTCDay();
}

/** ISO week start (Monday). */
export function startOfWeek(date: DateStr): DateStr {
  const dow = weekdayOf(date);
  const back = (dow + 6) % 7;
  return addDays(date, -back);
}

export function endOfWeek(date: DateStr): DateStr {
  return addDays(startOfWeek(date), 6);
}

export function startOfMonth(date: DateStr): DateStr {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: DateStr): DateStr {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function monthKey(date: DateStr): string {
  return date.slice(0, 7);
}

/** Inclusive list of dates from `from` to `to`, capped for safety. */
export function eachDay(from: DateStr, to: DateStr, cap = 1200): DateStr[] {
  const out: DateStr[] = [];
  let cursor = from;
  while (cursor <= to && out.length < cap) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Minutes between two HH:MM strings; negative if `b` is earlier. */
export function minutesBetween(a: string, b: string): number {
  return toMinutes(b) - toMinutes(a);
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(total: number): string {
  const h = Math.floor(((total % 1440) + 1440) % 1440 / 60);
  const m = Math.round(((total % 1440) + 1440) % 1440 % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Combines a date + HH:MM into an absolute instant in the given timezone. */
export function instantFor(date: DateStr, time: string, timezone = 'UTC'): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  const offset = timezoneOffsetMinutes(timezone, naive);
  return new Date(naive.getTime() - offset * 60_000);
}

/** Offset of `timezone` from UTC in minutes at the given instant (east = +). */
export function timezoneOffsetMinutes(timezone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const asUTC = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return Math.round((asUTC - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}
