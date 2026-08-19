import type { Task } from '@prisma/client';
import { prisma } from './db';
import { addDays, type DateStr, diffDays, eachDay, startOfWeek, weekdayOf } from './dates';
import type { UserSettings } from './user';

/**
 * The scoring engine.
 *
 * A score is only trustworthy if it can explain itself, so every component
 * returns what it measured, what it was worth, and why it moved. Components
 * that do not apply to a given day (no tasks planned, no habits yet) are
 * excluded and the remainder is rescaled — a rest day never reads as a failure
 * for something you never committed to.
 */

export const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export type ScoreComponent = {
  key: string;
  label: string;
  earned: number;
  weight: number;
  ratio: number | null;
  applicable: boolean;
  detail: string;
};

export type DayMetrics = {
  date: DateStr;
  planned: number;
  completed: number;
  remaining: number;
  missed: number;
  overdue: number;
  postponed: number;
  archived: number;
  highPriorityPlanned: number;
  highPriorityCompleted: number;
  completionRate: number;
  weightedCompletionRate: number;
  focusMinutes: number;
  focusSessions: number;
  habitsPlanned: number;
  habitsDone: number;
  estimatedMinutes: number;
  actualMinutes: number;
  score: number;
  components: ScoreComponent[];
  positives: string[];
  negatives: string[];
};

type DayInputs = {
  tasks: Task[];
  focusMinutes: number;
  focusSessions: number;
  habitsPlanned: number;
  habitsDone: number;
  streak: number;
  settings: UserSettings;
  isPast: boolean;
};

export function scoreDay(date: DateStr, input: DayInputs): DayMetrics {
  const { tasks, settings } = input;
  const live = tasks.filter((t) => t.status !== 'archived');
  const completed = live.filter((t) => t.status === 'completed');
  const remaining = live.filter((t) => t.status !== 'completed');
  const highPriority = live.filter((t) => t.priority === 'urgent' || t.priority === 'high');
  const highDone = highPriority.filter((t) => t.status === 'completed');
  const postponed = tasks.reduce((sum, t) => {
    try {
      return sum + (JSON.parse(t.postponeHistory || '[]') as string[]).filter((d) => d === date).length;
    } catch {
      return sum;
    }
  }, 0);

  const weightedPlanned = live.reduce((s, t) => s + (PRIORITY_WEIGHT[t.priority] ?? 2), 0);
  const weightedDone = completed.reduce((s, t) => s + (PRIORITY_WEIGHT[t.priority] ?? 2), 0);

  const completionRate = live.length ? completed.length / live.length : 0;
  const weightedCompletionRate = weightedPlanned ? weightedDone / weightedPlanned : 0;
  const missed = input.isPast ? remaining.length : 0;

  const components: ScoreComponent[] = [];

  // 1. Weighted task completion — the backbone of the score.
  components.push({
    key: 'completion',
    label: 'Task completion',
    weight: 30,
    ratio: live.length ? weightedCompletionRate : null,
    applicable: live.length > 0,
    earned: live.length ? 30 * weightedCompletionRate : 0,
    detail: live.length
      ? `${completed.length} of ${live.length} tasks done (priority-weighted ${Math.round(weightedCompletionRate * 100)}%)`
      : 'No tasks were planned for this day',
  });

  // 2. Did the important work actually get done?
  components.push({
    key: 'priority',
    label: 'Important work',
    weight: 20,
    ratio: highPriority.length ? highDone.length / highPriority.length : null,
    applicable: highPriority.length > 0,
    earned: highPriority.length ? 20 * (highDone.length / highPriority.length) : 0,
    detail: highPriority.length
      ? `${highDone.length} of ${highPriority.length} high-priority tasks finished`
      : 'No high-priority tasks planned',
  });

  // 3. Reliability — missed and repeatedly-postponed work costs you here.
  const punctualityPenalty = live.length
    ? Math.min(1, (missed + postponed * 0.5) / Math.max(live.length, 1))
    : 0;
  components.push({
    key: 'reliability',
    label: 'Reliability',
    weight: 12,
    ratio: live.length ? 1 - punctualityPenalty : null,
    applicable: live.length > 0,
    earned: live.length ? 12 * (1 - punctualityPenalty) : 0,
    detail: live.length
      ? `${missed} missed, ${postponed} postponed`
      : 'Nothing scheduled to keep',
  });

  // 4. Habits.
  const habitRatio = input.habitsPlanned
    ? Math.min(1, input.habitsDone / input.habitsPlanned)
    : null;
  components.push({
    key: 'habits',
    label: 'Habits',
    weight: 15,
    ratio: habitRatio,
    applicable: input.habitsPlanned > 0,
    earned: habitRatio === null ? 0 : 15 * habitRatio,
    detail: input.habitsPlanned
      ? `${input.habitsDone} of ${input.habitsPlanned} habits kept`
      : 'No daily habits set up yet',
  });

  // 5. Focus time against your own target.
  const focusTarget = Math.max(15, settings.dailyFocusTargetMinutes || 120);
  const focusRatio = Math.min(1, input.focusMinutes / focusTarget);
  components.push({
    key: 'focus',
    label: 'Focus time',
    weight: 15,
    ratio: focusRatio,
    applicable: true,
    earned: 15 * focusRatio,
    detail: `${input.focusMinutes} min focused of a ${focusTarget} min target`,
  });

  // 6. Consistency — rewards showing up repeatedly, saturating at two weeks.
  const streakRatio = Math.min(1, input.streak / 14);
  components.push({
    key: 'consistency',
    label: 'Consistency',
    weight: 8,
    ratio: streakRatio,
    applicable: true,
    earned: 8 * streakRatio,
    detail: input.streak > 0 ? `${input.streak}-day streak` : 'Streak broken — start a new one',
  });

  const applicable = components.filter((c) => c.applicable);
  const availableWeight = applicable.reduce((s, c) => s + c.weight, 0);
  const earnedWeight = applicable.reduce((s, c) => s + c.earned, 0);
  const score = availableWeight > 0 ? Math.round((earnedWeight / availableWeight) * 100) : 0;

  const positives: string[] = [];
  const negatives: string[] = [];

  for (const c of applicable) {
    if (c.ratio === null) continue;
    if (c.ratio >= 0.85) positives.push(`${c.label}: ${c.detail}`);
    else if (c.ratio < 0.5) negatives.push(`${c.label}: ${c.detail}`);
  }
  if (highDone.length && highPriority.length === highDone.length) {
    positives.unshift('Every important task was completed');
  }
  if (missed > 0) negatives.unshift(`${missed} task${missed === 1 ? '' : 's'} rolled past their day`);
  if (postponed >= 3) negatives.push('Several tasks were postponed — they may be too big or badly timed');
  if (input.focusMinutes === 0 && live.length > 0) negatives.push('No focus sessions were tracked');

  return {
    date,
    planned: live.length,
    completed: completed.length,
    remaining: remaining.length,
    missed,
    overdue: missed,
    postponed,
    archived: tasks.length - live.length,
    highPriorityPlanned: highPriority.length,
    highPriorityCompleted: highDone.length,
    completionRate,
    weightedCompletionRate,
    focusMinutes: input.focusMinutes,
    focusSessions: input.focusSessions,
    habitsPlanned: input.habitsPlanned,
    habitsDone: input.habitsDone,
    estimatedMinutes: live.reduce((s, t) => s + (t.estimatedMinutes || 0), 0),
    actualMinutes: live.reduce((s, t) => s + (t.actualMinutes || 0), 0),
    score,
    components,
    positives,
    negatives,
  };
}

// ---------------------------------------------------------------------------
// Range aggregation
// ---------------------------------------------------------------------------

export type RangeBundle = {
  tasksByDate: Map<DateStr, Task[]>;
  focusByDate: Map<DateStr, { minutes: number; sessions: number }>;
  habitDoneByDate: Map<DateStr, number>;
  dailyHabitCount: number;
  habitStartByDate: Map<DateStr, number>;
};

/** One pass over the database for a whole date range — keeps 6-month views fast. */
export async function loadRange(userId: string, from: DateStr, to: DateStr): Promise<RangeBundle> {
  const [tasks, focus, habits, habitEntries] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: { gte: from, lte: to } } }),
    prisma.focusSession.findMany({
      where: { userId, date: { gte: from, lte: to }, mode: 'focus' },
      select: { date: true, actualMinutes: true, completed: true },
    }),
    prisma.habit.findMany({ where: { userId }, select: { id: true, cadence: true, startDate: true, archivedAt: true, createdAt: true } }),
    prisma.habitEntry.findMany({
      where: { habit: { userId }, date: { gte: from, lte: to }, done: true },
      select: { date: true },
    }),
  ]);

  const tasksByDate = new Map<DateStr, Task[]>();
  for (const t of tasks) {
    const list = tasksByDate.get(t.date);
    if (list) list.push(t);
    else tasksByDate.set(t.date, [t]);
  }

  const focusByDate = new Map<DateStr, { minutes: number; sessions: number }>();
  for (const f of focus) {
    const cur = focusByDate.get(f.date) || { minutes: 0, sessions: 0 };
    cur.minutes += f.actualMinutes || 0;
    if (f.completed) cur.sessions += 1;
    focusByDate.set(f.date, cur);
  }

  const habitDoneByDate = new Map<DateStr, number>();
  for (const e of habitEntries) {
    habitDoneByDate.set(e.date, (habitDoneByDate.get(e.date) || 0) + 1);
  }

  // How many daily habits existed on each date (habits added later must not
  // retroactively penalise older days).
  const habitStartByDate = new Map<DateStr, number>();
  const dailyHabits = habits.filter((h) => h.cadence === 'daily');
  for (const day of eachDay(from, to)) {
    const active = dailyHabits.filter((h) => {
      const start = h.startDate || h.createdAt.toISOString().slice(0, 10);
      if (start > day) return false;
      if (h.archivedAt && h.archivedAt.toISOString().slice(0, 10) < day) return false;
      return true;
    }).length;
    habitStartByDate.set(day, active);
  }

  return {
    tasksByDate,
    focusByDate,
    habitDoneByDate,
    dailyHabitCount: dailyHabits.length,
    habitStartByDate,
  };
}

export type DaySummary = {
  date: DateStr;
  planned: number;
  completed: number;
  missed: number;
  postponed: number;
  focusMinutes: number;
  habitsDone: number;
  habitsPlanned: number;
  completionRate: number;
  score: number;
  productive: boolean;
};

export function summarizeRange(
  bundle: RangeBundle,
  from: DateStr,
  to: DateStr,
  today: DateStr,
  settings: UserSettings,
): DaySummary[] {
  const days = eachDay(from, to);
  const out: DaySummary[] = [];
  let streak = 0;

  for (const date of days) {
    const tasks = bundle.tasksByDate.get(date) || [];
    const focus = bundle.focusByDate.get(date) || { minutes: 0, sessions: 0 };
    const habitsPlanned = bundle.habitStartByDate.get(date) || 0;
    const habitsDone = bundle.habitDoneByDate.get(date) || 0;
    const isPast = date < today;

    const metrics = scoreDay(date, {
      tasks,
      focusMinutes: focus.minutes,
      focusSessions: focus.sessions,
      habitsPlanned,
      habitsDone,
      streak,
      settings,
      isPast,
    });

    const productive =
      metrics.completed >= 1 && (metrics.planned === 0 || metrics.completionRate >= 0.5);
    if (date <= today) streak = productive ? streak + 1 : 0;

    out.push({
      date,
      planned: metrics.planned,
      completed: metrics.completed,
      missed: metrics.missed,
      postponed: metrics.postponed,
      focusMinutes: metrics.focusMinutes,
      habitsDone: metrics.habitsDone,
      habitsPlanned: metrics.habitsPlanned,
      completionRate: metrics.completionRate,
      score: metrics.score,
      productive,
    });
  }

  return out;
}

/** Current and best streak of productive days, ending at `today`. */
export function computeStreaks(summaries: DaySummary[], today: DateStr) {
  let current = 0;
  let best = 0;
  let run = 0;

  for (const day of summaries) {
    if (day.date > today) continue;
    if (day.productive) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }

  // Walk backwards from today (an unfinished today should not break the streak).
  for (let i = summaries.length - 1; i >= 0; i--) {
    const day = summaries[i];
    if (day.date > today) continue;
    if (day.date === today && !day.productive) continue;
    if (day.productive) current += 1;
    else break;
  }

  return { current, best };
}

/** Streak of a single habit, in days, ending at `today`. */
export function habitStreak(dates: Set<DateStr>, today: DateStr): { current: number; best: number } {
  if (!dates.size) return { current: 0, best: 0 };
  const sorted = Array.from(dates).sort();
  let best = 0;
  let run = 0;
  let prev: DateStr | null = null;
  for (const d of sorted) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }

  let current = 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  while (dates.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

/** Best and weakest weekday by average completion rate. */
export function weekdayPerformance(summaries: DaySummary[]) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const buckets = names.map((name, index) => ({
    index,
    name,
    planned: 0,
    completed: 0,
    days: 0,
    scoreTotal: 0,
  }));

  for (const day of summaries) {
    if (day.planned === 0 && day.completed === 0) continue;
    const b = buckets[weekdayOf(day.date)];
    b.planned += day.planned;
    b.completed += day.completed;
    b.scoreTotal += day.score;
    b.days += 1;
  }

  const rows = buckets.map((b) => ({
    weekday: b.index,
    name: b.name,
    short: b.name.slice(0, 3),
    planned: b.planned,
    completed: b.completed,
    completionRate: b.planned ? b.completed / b.planned : 0,
    avgScore: b.days ? Math.round(b.scoreTotal / b.days) : 0,
    days: b.days,
  }));

  const rated = rows.filter((r) => r.days >= 1 && r.planned > 0);
  const sorted = [...rated].sort((a, b) => b.completionRate - a.completionRate);
  return { rows, best: sorted[0] ?? null, weakest: sorted[sorted.length - 1] ?? null };
}

export function weeklyBuckets(summaries: DaySummary[]) {
  const map = new Map<DateStr, { week: DateStr; planned: number; completed: number; focusMinutes: number; scoreTotal: number; days: number }>();
  for (const day of summaries) {
    const week = startOfWeek(day.date);
    const cur = map.get(week) || { week, planned: 0, completed: 0, focusMinutes: 0, scoreTotal: 0, days: 0 };
    cur.planned += day.planned;
    cur.completed += day.completed;
    cur.focusMinutes += day.focusMinutes;
    cur.scoreTotal += day.score;
    cur.days += 1;
    map.set(week, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({
      week: w.week,
      planned: w.planned,
      completed: w.completed,
      focusMinutes: w.focusMinutes,
      completionRate: w.planned ? w.completed / w.planned : 0,
      avgScore: w.days ? Math.round(w.scoreTotal / w.days) : 0,
    }));
}

export function monthlyBuckets(summaries: DaySummary[]) {
  const map = new Map<string, { month: string; planned: number; completed: number; focusMinutes: number; scoreTotal: number; days: number }>();
  for (const day of summaries) {
    const month = day.date.slice(0, 7);
    const cur = map.get(month) || { month, planned: 0, completed: 0, focusMinutes: 0, scoreTotal: 0, days: 0 };
    cur.planned += day.planned;
    cur.completed += day.completed;
    cur.focusMinutes += day.focusMinutes;
    cur.scoreTotal += day.score;
    cur.days += 1;
    map.set(month, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      planned: m.planned,
      completed: m.completed,
      focusMinutes: m.focusMinutes,
      completionRate: m.planned ? m.completed / m.planned : 0,
      avgScore: m.days ? Math.round(m.scoreTotal / m.days) : 0,
    }));
}
