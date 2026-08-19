import { addDays, addMonths, type DateStr, weekdayOf } from './dates';

/**
 * Recurrence is stored as a small JSON object on the first task of a series.
 * Every future occurrence is a real, editable Task row generated ahead of time,
 * so history stays honest: a skipped Tuesday shows up as a missed task rather
 * than silently disappearing.
 */
export type RecurrenceRule = {
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  interval: number;
  /** 0 = Sunday … 6 = Saturday. Used by `weekly` and `custom`. */
  byWeekday?: number[];
  /** Day of month for `monthly`. Defaults to the seed date's day. */
  byMonthDay?: number;
  until?: DateStr | null;
  count?: number | null;
};

export const DEFAULT_RULE: RecurrenceRule = { freq: 'daily', interval: 1 };

export function parseRule(raw: string | null | undefined): RecurrenceRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RecurrenceRule>;
    if (!parsed || typeof parsed !== 'object' || !parsed.freq) return null;
    const freq = parsed.freq;
    if (!['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'].includes(freq)) return null;
    return {
      freq: freq as RecurrenceRule['freq'],
      interval: Math.min(Math.max(Number(parsed.interval) || 1, 1), 365),
      byWeekday: Array.isArray(parsed.byWeekday)
        ? parsed.byWeekday.map(Number).filter((d) => d >= 0 && d <= 6)
        : undefined,
      byMonthDay: parsed.byMonthDay ? Number(parsed.byMonthDay) : undefined,
      until: parsed.until ?? null,
      count: parsed.count ?? null,
    };
  } catch {
    return null;
  }
}

export function serializeRule(rule: RecurrenceRule | null): string | null {
  return rule ? JSON.stringify(rule) : null;
}

/** The next date strictly after `from` that satisfies the rule. */
export function nextDate(rule: RecurrenceRule, from: DateStr): DateStr | null {
  const interval = Math.max(1, rule.interval || 1);

  switch (rule.freq) {
    case 'daily':
      return capped(addDays(from, interval), rule);

    case 'weekdays': {
      let cursor = addDays(from, 1);
      for (let i = 0; i < 10; i++) {
        const dow = weekdayOf(cursor);
        if (dow !== 0 && dow !== 6) return capped(cursor, rule);
        cursor = addDays(cursor, 1);
      }
      return null;
    }

    case 'weekly': {
      const days = (rule.byWeekday && rule.byWeekday.length ? rule.byWeekday : [weekdayOf(from)])
        .slice()
        .sort((a, b) => a - b);
      // Look ahead across the current week, then jump `interval` weeks.
      for (let offset = 1; offset <= 7; offset++) {
        const cursor = addDays(from, offset);
        if (days.includes(weekdayOf(cursor))) {
          // Respect multi-week intervals by skipping ahead when we wrap.
          if (interval > 1 && weekdayOf(cursor) <= weekdayOf(from) && offset >= 7 - weekdayOf(from)) {
            return capped(addDays(cursor, (interval - 1) * 7), rule);
          }
          return capped(cursor, rule);
        }
      }
      return capped(addDays(from, 7 * interval), rule);
    }

    case 'monthly': {
      const target = addMonths(from, interval);
      if (rule.byMonthDay) {
        const [y, m] = target.split('-').map(Number);
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const day = Math.min(rule.byMonthDay, lastDay);
        return capped(`${target.slice(0, 7)}-${String(day).padStart(2, '0')}`, rule);
      }
      return capped(target, rule);
    }

    case 'yearly':
      return capped(addMonths(from, 12 * interval), rule);

    case 'custom': {
      const days = rule.byWeekday && rule.byWeekday.length ? rule.byWeekday : null;
      if (!days) return capped(addDays(from, interval), rule);
      for (let offset = 1; offset <= 14; offset++) {
        const cursor = addDays(from, offset);
        if (days.includes(weekdayOf(cursor))) return capped(cursor, rule);
      }
      return null;
    }

    default:
      return null;
  }
}

function capped(date: DateStr, rule: RecurrenceRule): DateStr | null {
  if (rule.until && date > rule.until) return null;
  return date;
}

/** Human-readable summary for the UI. */
export function describeRule(rule: RecurrenceRule): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const every = rule.interval > 1 ? `every ${rule.interval} ` : 'every ';
  let base: string;
  switch (rule.freq) {
    case 'daily':
      base = rule.interval > 1 ? `${every}days` : 'Every day';
      break;
    case 'weekdays':
      base = 'Every weekday';
      break;
    case 'weekly':
      base = rule.byWeekday?.length
        ? `Every ${rule.byWeekday.map((d) => names[d]).join(', ')}`
        : `${every}week`;
      break;
    case 'monthly':
      base = rule.byMonthDay ? `${every}month on day ${rule.byMonthDay}` : `${every}month`;
      break;
    case 'yearly':
      base = `${every}year`;
      break;
    default:
      base = rule.byWeekday?.length
        ? `Every ${rule.byWeekday.map((d) => names[d]).join(', ')}`
        : `${every}${rule.interval} days`;
  }
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  return rule.until ? `${cap}, until ${rule.until}` : cap;
}
