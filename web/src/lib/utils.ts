import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Priority, Task } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Dates — kept as plain YYYY-MM-DD strings, same as the server.
// ---------------------------------------------------------------------------

export function todayStr(timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function nowTime(timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}

function toUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: string, days: number): string {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

export function weekdayOf(date: string): number {
  return toUTC(date).getUTCDay();
}

export function startOfWeek(date: string, weekStartsOn: 0 | 1 = 1): string {
  const dow = weekdayOf(date);
  const back = weekStartsOn === 1 ? (dow + 6) % 7 : dow;
  return addDays(date, -back);
}

export function endOfWeek(date: string, weekStartsOn: 0 | 1 = 1): string {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function eachDay(from: string, to: string, cap = 1200): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to && out.length < cap) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(date: string, style: 'short' | 'medium' | 'long' | 'day' = 'medium'): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const dow = weekdayOf(date);
  switch (style) {
    case 'short':
      return `${d} ${MONTHS_SHORT[m - 1]}`;
    case 'long':
      return `${DAYS_LONG[dow]}, ${d} ${MONTHS_LONG[m - 1]} ${y}`;
    case 'day':
      return `${DAYS_SHORT[dow]} ${d}`;
    default:
      return `${DAYS_SHORT[dow]}, ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
}

export function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "Today", "Tomorrow", "3 days ago", or a date. */
export function relativeDay(date: string, today: string): string {
  const delta = diffDays(date, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta <= 6) return DAYS_LONG[weekdayOf(date)];
  if (delta < -1 && delta >= -6) return `${Math.abs(delta)} days ago`;
  return formatDate(date, 'short');
}

export function formatTime(time: string | null | undefined, hour12 = true): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (!hour12) return time;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDuration(minutes: number, style: 'short' | 'long' = 'short'): string {
  if (!minutes || minutes < 1) return style === 'long' ? '0 minutes' : '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (style === 'long') {
    const parts: string[] = [];
    if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
    if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
    return parts.join(' ');
  }
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const delta = Date.now() - Date.parse(iso);
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------

export const PRIORITY_META: Record<Priority, { label: string; dot: string; text: string; chip: string; rank: number }> = {
  urgent: {
    label: 'Urgent',
    dot: 'bg-danger',
    text: 'text-danger',
    chip: 'bg-danger/10 text-danger border-danger/20',
    rank: 0,
  },
  high: {
    label: 'High',
    dot: 'bg-warning',
    text: 'text-warning',
    chip: 'bg-warning/10 text-warning border-warning/20',
    rank: 1,
  },
  medium: {
    label: 'Medium',
    dot: 'bg-info',
    text: 'text-info',
    chip: 'bg-info/10 text-info border-info/20',
    rank: 2,
  },
  low: {
    label: 'Low',
    dot: 'bg-faint',
    text: 'text-muted',
    chip: 'bg-subtle text-muted border-line',
    rank: 3,
  },
};

export const ENERGY_LABEL: Record<string, string> = { high: 'High energy', medium: 'Medium energy', low: 'Low energy' };

export function isOverdue(task: Task, today: string): boolean {
  return task.status !== 'completed' && task.status !== 'archived' && task.date < today;
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'completed';
    const bDone = b.status === 'completed';
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.order !== b.order) return a.order - b.order;
    const rank = PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
    if (rank !== 0) return rank;
    return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
  });
}

export function scoreTone(score: number): { label: string; text: string; bg: string; ring: string } {
  if (score >= 85) return { label: 'Excellent', text: 'text-success', bg: 'bg-success/10', ring: 'rgb(var(--success))' };
  if (score >= 65) return { label: 'Good', text: 'text-accent', bg: 'bg-accent/10', ring: 'rgb(var(--accent))' };
  if (score >= 40) return { label: 'Mixed', text: 'text-warning', bg: 'bg-warning/10', ring: 'rgb(var(--warning))' };
  if (score > 0) return { label: 'Low', text: 'text-danger', bg: 'bg-danger/10', ring: 'rgb(var(--danger))' };
  return { label: 'No data', text: 'text-muted', bg: 'bg-subtle', ring: 'rgb(var(--faint))' };
}

/** Deterministic pleasant colour from any string (used for tags/avatars). */
export function colorFor(seed: string): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

/** Minimal, injection-safe Markdown → HTML for notes and reviews. */
export function renderMarkdown(source: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const lines = escape(source).split('\n');
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let inCode = false;

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };

  const inline = (text: string) =>
    text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith('```')) {
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${line}\n`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) {
      if (inList !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = 'ul';
      }
      const checked = /\[[xX]\]/.test(line);
      const text = line.replace(/^[-*]\s+\[[ xX]\]\s+/, '');
      out.push(
        `<li>${checked ? '<span aria-hidden="true">☑</span> <del>' : '<span aria-hidden="true">☐</span> '}${inline(text)}${checked ? '</del>' : ''}</li>`,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      if (inList !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = 'ul';
      }
      out.push(`<li>${inline(line.replace(/^[-*+]\s+/, ''))}</li>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      if (inList !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${inline(line.replace(/^\d+[.)]\s+/, ''))}</li>`);
      continue;
    }

    // The source was HTML-escaped first, so a quote marker arrives as "&gt;".
    if (/^(&gt;|>)\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^(&gt;|>)\s?/, ''))}</blockquote>`);
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      closeList();
      out.push('<hr />');
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 300) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
