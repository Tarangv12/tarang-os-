import { toMinutes, type DateStr } from './dates';

/**
 * Scheduled daily notifications.
 *
 * These are the fixed-time nudges — the 10:00 morning agenda, the evening
 * review reminder, the unfinished-important check — as opposed to per-task
 * reminders which fire relative to a task's own start time.
 *
 * Two rules make them behave sensibly for a laptop app that is not always on:
 *
 *  1. **Once per day.** The date each one last fired is recorded server-side,
 *     so reopening the app or having it open on two devices cannot double-fire.
 *
 *  2. **Catch-up, but bounded.** If TarangOS was closed at 10:00, the agenda
 *     still fires the first time you open it afterwards — but only within a
 *     sensible window. A "here is your morning" notification at 11 PM is noise,
 *     so after the window passes the day is simply skipped.
 */

export type ScheduledKind = 'daily_agenda' | 'daily_review' | 'unfinished_important';

export const SCHEDULED_CATCH_UP_MINUTES: Record<ScheduledKind, number> = {
  // A morning agenda is still useful a few hours late, but not at night.
  daily_agenda: 6 * 60,
  // An end-of-day review nudge should not resurface the next morning.
  daily_review: 3 * 60,
  unfinished_important: 3 * 60,
};

export type NotifyState = Partial<Record<ScheduledKind, DateStr>>;

export function parseNotifyState(raw: string | null | undefined): NotifyState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as NotifyState) : {};
  } catch {
    return {};
  }
}

/**
 * Is a fixed-time notification due right now?
 *
 * `nowHM` and `today` must both already be expressed in the user's timezone so
 * "10:00" means 10:00 where they are, not on the server's clock.
 */
export function isScheduledDue(opts: {
  kind: ScheduledKind;
  time: string | null | undefined;
  enabled: boolean;
  nowHM: string;
  today: DateStr;
  state: NotifyState;
}): boolean {
  const { kind, time, enabled, nowHM, today, state } = opts;
  if (!enabled || !time) return false;
  if (state[kind] === today) return false; // already delivered today

  const due = toMinutes(time);
  const now = toMinutes(nowHM);
  if (now < due) return false; // not yet

  return now - due <= SCHEDULED_CATCH_UP_MINUTES[kind];
}

/** Stable per-day id so the client can de-duplicate and acknowledge it. */
export function scheduledId(kind: ScheduledKind, date: DateStr): string {
  return `${kind}:${date}`;
}

export function parseScheduledId(id: string): { kind: ScheduledKind; date: DateStr } | null {
  const match = /^(daily_agenda|daily_review|unfinished_important):(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match) return null;
  return { kind: match[1] as ScheduledKind, date: match[2] };
}

// ---------------------------------------------------------------------------
// Message composition
// ---------------------------------------------------------------------------

type AgendaTask = {
  title: string;
  priority: string;
  startTime: string | null;
  status: string;
};

/** "5 tasks today · 2 high priority" + what to start on. */
export function composeAgenda(tasks: AgendaTask[], displayName: string) {
  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'archived');
  const important = open.filter((t) => t.priority === 'urgent' || t.priority === 'high');
  const firstName = (displayName || '').trim().split(/\s+/)[0] || 'there';

  if (open.length === 0) {
    return {
      title: `Good morning, ${firstName}`,
      body: 'Nothing is planned for today yet. Two minutes now saves the whole morning.',
    };
  }

  const timed = open
    .filter((t) => t.startTime)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const firstUp =
    timed[0] ?? [...open].sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2))[0];

  const parts = [`${open.length} task${open.length === 1 ? '' : 's'} today`];
  if (important.length) parts.push(`${important.length} high priority`);
  if (firstUp) {
    parts.push(firstUp.startTime ? `first: ${firstUp.title} at ${firstUp.startTime}` : `start with: ${firstUp.title}`);
  }

  return { title: `Good morning, ${firstName}`, body: parts.join(' · ') };
}

export function composeReviewNudge(completed: number, planned: number) {
  if (planned === 0) {
    return { title: 'Close out the day', body: 'Write a line about how today actually went.' };
  }
  return {
    title: 'Close out the day',
    body: `${completed} of ${planned} done. Two minutes of review is what makes the history worth keeping.`,
  };
}

export function composeUnfinished(tasks: { title: string }[]) {
  if (tasks.length === 1) {
    return { title: 'Still open and important', body: tasks[0].title };
  }
  return {
    title: `${tasks.length} important tasks still open`,
    body: tasks.slice(0, 3).map((t) => t.title).join(' · '),
  };
}
