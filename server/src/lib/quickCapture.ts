import { addDays, type DateStr, weekdayOf } from './dates';
import type { RecurrenceRule } from './recurrence';

/**
 * Quick Capture parser.
 *
 * Turns a single line like "Gym tomorrow 7 PM high priority #health ~45m"
 * into structured task fields. Everything it consumes is reported back in
 * `matched` so the UI can show exactly what it understood — no silent guessing.
 */

export type ParsedCapture = {
  title: string;
  date: DateStr | null;
  startTime: string | null;
  dueTime: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low' | null;
  estimatedMinutes: number | null;
  tags: string[];
  projectHint: string | null;
  categoryHint: string | null;
  recurrence: RecurrenceRule | null;
  matched: { kind: string; text: string; value: string }[];
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const TIME_WORDS: Record<string, string> = {
  morning: '09:00',
  noon: '12:00',
  midday: '12:00',
  afternoon: '14:00',
  evening: '18:00',
  tonight: '20:00',
  night: '20:00',
  midnight: '00:00',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseQuickCapture(input: string, today: DateStr): ParsedCapture {
  const result: ParsedCapture = {
    title: '',
    date: null,
    startTime: null,
    dueTime: null,
    priority: null,
    estimatedMinutes: null,
    tags: [],
    projectHint: null,
    categoryHint: null,
    recurrence: null,
    matched: [],
  };

  let text = ` ${input.trim()} `;

  const consume = (regex: RegExp, kind: string, apply: (m: RegExpMatchArray) => string | null) => {
    const match = text.match(regex);
    if (!match) return false;
    const value = apply(match);
    if (value === null) return false;
    result.matched.push({ kind, text: match[0].trim(), value });
    text = text.replace(match[0], ' ');
    return true;
  };

  // --- tags: #tag ---------------------------------------------------------
  let tagMatch: RegExpMatchArray | null;
  const tagRe = /(^|\s)#([\p{L}\p{N}_-]{1,30})/u;
  // eslint-disable-next-line no-cond-assign
  while ((tagMatch = text.match(tagRe))) {
    result.tags.push(tagMatch[2].toLowerCase());
    result.matched.push({ kind: 'tag', text: `#${tagMatch[2]}`, value: tagMatch[2].toLowerCase() });
    text = text.replace(tagMatch[0], ' ');
  }

  // --- project: @project / category: +category ----------------------------
  consume(/(^|\s)@([\p{L}\p{N}_ -]{1,40}?)(?=\s|$)/u, 'project', (m) => {
    result.projectHint = m[2].trim();
    return result.projectHint;
  });
  consume(/(^|\s)\+([\p{L}\p{N}_-]{1,30})/u, 'category', (m) => {
    result.categoryHint = m[2].trim();
    return result.categoryHint;
  });

  // --- recurrence ---------------------------------------------------------
  consume(/\b(every\s+weekday|weekdays)\b/i, 'recurrence', () => {
    result.recurrence = { freq: 'weekdays', interval: 1 };
    return 'Every weekday';
  });
  if (!result.recurrence) {
    consume(/\bevery\s+(\d+)?\s*(day|week|month|year)s?\b/i, 'recurrence', (m) => {
      const interval = Number(m[1] || 1);
      const unit = m[2].toLowerCase();
      const freq = unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : unit === 'month' ? 'monthly' : 'yearly';
      result.recurrence = { freq: freq as RecurrenceRule['freq'], interval };
      return `Every ${interval > 1 ? `${interval} ` : ''}${unit}`;
    });
  }
  if (!result.recurrence) {
    consume(/\b(daily|weekly|monthly|yearly)\b/i, 'recurrence', (m) => {
      const map: Record<string, RecurrenceRule['freq']> = {
        daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly',
      };
      result.recurrence = { freq: map[m[1].toLowerCase()], interval: 1 };
      return m[1];
    });
  }
  if (!result.recurrence) {
    consume(
      /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i,
      'recurrence',
      (m) => {
        const dow = WEEKDAYS[m[1].toLowerCase()];
        result.recurrence = { freq: 'weekly', interval: 1, byWeekday: [dow] };
        return `Every ${m[1]}`;
      },
    );
  }

  // --- priority -----------------------------------------------------------
  consume(/\b(urgent|asap|critical|p1)\b|!{3}/i, 'priority', () => {
    result.priority = 'urgent';
    return 'urgent';
  });
  if (!result.priority) {
    consume(/\bhigh\s*(priority)?\b|\bp2\b|!{2}/i, 'priority', () => {
      result.priority = 'high';
      return 'high';
    });
  }
  if (!result.priority) {
    consume(/\blow\s*(priority)?\b|\bp4\b/i, 'priority', () => {
      result.priority = 'low';
      return 'low';
    });
  }
  if (!result.priority) {
    consume(/\bmedium\s*(priority)?\b|\bp3\b/i, 'priority', () => {
      result.priority = 'medium';
      return 'medium';
    });
  }

  // --- duration: ~45m, for 1h 30m, 90 mins --------------------------------
  consume(/(?:~|\bfor\s+)?\b(\d+)\s*(?:h|hr|hrs|hours?)\s*(\d+)?\s*(?:m|min|mins|minutes?)?\b/i, 'duration', (m) => {
    const mins = Number(m[1]) * 60 + Number(m[2] || 0);
    if (mins <= 0 || mins > 24 * 60) return null;
    result.estimatedMinutes = mins;
    return `${mins} min`;
  });
  if (result.estimatedMinutes === null) {
    consume(/(?:~|\bfor\s+)\s*(\d{1,3})\s*(?:m|min|mins|minutes?)\b/i, 'duration', (m) => {
      const mins = Number(m[1]);
      if (mins <= 0 || mins > 24 * 60) return null;
      result.estimatedMinutes = mins;
      return `${mins} min`;
    });
  }

  // --- explicit date: 2026-08-19 | 19/08 | 19-08-2026 ---------------------
  consume(/\b(\d{4})-(\d{2})-(\d{2})\b/, 'date', (m) => {
    result.date = `${m[1]}-${m[2]}-${m[3]}`;
    return result.date;
  });
  if (!result.date) {
    consume(/\b(\d{1,2})[/](\d{1,2})(?:[/](\d{2,4}))?\b/, 'date', (m) => {
      const day = Number(m[1]);
      const month = Number(m[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      if (year < 100) year += 2000;
      result.date = `${year}-${pad(month)}-${pad(day)}`;
      return result.date;
    });
  }
  if (!result.date) {
    consume(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b|\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
      'date',
      (m) => {
        const day = Number(m[1] || m[4]);
        const monthName = (m[2] || m[3] || '').toLowerCase();
        const month = MONTHS[monthName];
        if (!month || !day) return null;
        const year = Number(today.slice(0, 4));
        let candidate = `${year}-${pad(month)}-${pad(day)}`;
        if (candidate < today) candidate = `${year + 1}-${pad(month)}-${pad(day)}`;
        result.date = candidate;
        return candidate;
      },
    );
  }

  // --- relative dates -----------------------------------------------------
  if (!result.date) {
    consume(/\b(today|tonight)\b/i, 'date', () => {
      result.date = today;
      return today;
    });
  }
  if (!result.date) {
    consume(/\b(tomorrow|tmr|tmrw)\b/i, 'date', () => {
      result.date = addDays(today, 1);
      return result.date;
    });
  }
  if (!result.date) {
    consume(/\bday after tomorrow\b/i, 'date', () => {
      result.date = addDays(today, 2);
      return result.date;
    });
  }
  if (!result.date) {
    consume(/\bin\s+(\d{1,3})\s+(day|week|month)s?\b/i, 'date', (m) => {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      const days = unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
      result.date = addDays(today, days);
      return result.date;
    });
  }
  if (!result.date) {
    consume(
      /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i,
      'date',
      (m) => {
        const target = WEEKDAYS[m[2].toLowerCase()];
        const current = weekdayOf(today);
        let delta = (target - current + 7) % 7;
        if (delta === 0) delta = 7;
        if (m[1]) delta = delta <= 7 ? delta + (delta === 7 ? 0 : 7) : delta;
        result.date = addDays(today, delta);
        return result.date;
      },
    );
  }
  if (!result.date) {
    consume(/\bnext\s+(week|month)\b/i, 'date', (m) => {
      result.date = addDays(today, m[1].toLowerCase() === 'week' ? 7 : 30);
      return result.date;
    });
  }

  // --- time ---------------------------------------------------------------
  consume(/\b(?:at\s+)?(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i, 'time', (m) => {
    let hour = Number(m[1]);
    const minute = Number(m[2]);
    const suffix = m[3]?.toLowerCase();
    if (minute > 59) return null;
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    if (hour > 23) return null;
    result.startTime = `${pad(hour)}:${pad(minute)}`;
    return result.startTime;
  });
  if (!result.startTime) {
    consume(/\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i, 'time', (m) => {
      let hour = Number(m[1]);
      const suffix = m[2].toLowerCase();
      if (hour > 12) return null;
      if (suffix === 'pm' && hour < 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
      result.startTime = `${pad(hour)}:00`;
      return result.startTime;
    });
  }
  if (!result.startTime) {
    consume(/\b(morning|noon|midday|afternoon|evening|tonight|night|midnight)\b/i, 'time', (m) => {
      result.startTime = TIME_WORDS[m[1].toLowerCase()];
      return result.startTime;
    });
  }

  // Leftover text is the title.
  result.title = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,\-–—]+|[\s,\-–—]+$/g, '')
    .trim();

  if (!result.title) result.title = input.trim();
  if (result.recurrence && !result.date) result.date = today;

  return result;
}
