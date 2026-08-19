import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { del, get, patch, post } from './api';
import type {
  AnalyticsOverview,
  Category,
  Dashboard,
  DayMetrics,
  DaySummary,
  FocusSession,
  Goal,
  Habit,
  Note,
  Project,
  Review,
  Tag,
  Task,
  User,
} from './types';

/**
 * Query keys. Mutations invalidate by prefix, so anything derived from tasks
 * (dashboard, analytics, calendar, history) refreshes together and the UI never
 * shows a stale count next to a fresh list.
 */
export const keys = {
  dashboard: ['dashboard'] as const,
  tasks: (params?: Record<string, unknown>) => ['tasks', params ?? {}] as const,
  task: (id: string) => ['task', id] as const,
  categories: ['categories'] as const,
  tags: ['tags'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  goals: (params?: Record<string, unknown>) => ['goals', params ?? {}] as const,
  goal: (id: string) => ['goal', id] as const,
  habits: ['habits'] as const,
  habit: (id: string) => ['habit', id] as const,
  focusActive: ['focus', 'active'] as const,
  focusStats: ['focus', 'stats'] as const,
  notes: (params?: Record<string, unknown>) => ['notes', params ?? {}] as const,
  reviews: (params?: Record<string, unknown>) => ['reviews', params ?? {}] as const,
  reviewPrepare: (type: string, date?: string) => ['reviews', 'prepare', type, date ?? 'current'] as const,
  missReasons: ['reviews', 'miss-reasons'] as const,
  analytics: (range: string) => ['analytics', 'overview', range] as const,
  heatmap: (days: number) => ['analytics', 'heatmap', days] as const,
  records: ['analytics', 'records'] as const,
  history: (params: Record<string, unknown>) => ['analytics', 'history', params] as const,
  historyDay: (date: string) => ['analytics', 'history', 'day', date] as const,
  calendar: (from: string, to: string) => ['analytics', 'calendar', from, to] as const,
  eisenhower: ['dashboard', 'eisenhower'] as const,
  settingsStats: ['settings', 'stats'] as const,
  backups: ['backups'] as const,
  sessions: ['auth', 'sessions'] as const,
  activity: ['auth', 'activity'] as const,
};

/** Everything that can change when a task changes. */
const TASK_SCOPES = [['dashboard'], ['tasks'], ['analytics'], ['projects'], ['goals'], ['settings', 'stats']];

export function useInvalidateTasks() {
  const client = useQueryClient();
  return () => TASK_SCOPES.forEach((key) => client.invalidateQueries({ queryKey: key }));
}

function query<T>(key: readonly unknown[], path: string, options?: Partial<UseQueryOptions<T>>) {
  return { queryKey: key, queryFn: ({ signal }: { signal: AbortSignal }) => get<T>(path, signal), ...options };
}

function toSearch(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function useDashboard() {
  return useQuery(query<Dashboard>(keys.dashboard, '/dashboard', { staleTime: 20_000 }));
}

export function useEisenhower() {
  return useQuery(
    query<{ today: string; quadrants: Record<'do' | 'schedule' | 'delegate' | 'eliminate', Task[]> }>(
      keys.eisenhower,
      '/dashboard/eisenhower',
    ),
  );
}

export function usePlanMyDay() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: () =>
      post<{
        plan: { id: string; title: string; order: number; score: number; reasons: string[]; estimatedMinutes: number }[];
        totalEstimatedMinutes: number;
        capacityMinutes: number;
        overCapacity: boolean;
        tasks: Task[];
      }>('/dashboard/plan-my-day'),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskQuery = {
  view?: 'today' | 'upcoming' | 'overdue' | 'completed' | 'all' | 'archived';
  from?: string;
  to?: string;
  date?: string;
  status?: string;
  priority?: string;
  categoryId?: string;
  projectId?: string;
  goalId?: string;
  tag?: string;
  search?: string;
  sort?: 'smart' | 'date' | 'priority' | 'created' | 'title';
  limit?: number;
};

export function useTasks(params: TaskQuery = {}, options?: { enabled?: boolean }) {
  return useQuery(
    query<{ tasks: Task[]; total: number; today: string }>(
      keys.tasks(params),
      `/tasks${toSearch(params)}`,
      { staleTime: 15_000, enabled: options?.enabled ?? true },
    ),
  );
}

export type TaskInput = Partial<{
  title: string;
  description: string;
  notes: string;
  date: string;
  startTime: string | null;
  dueTime: string | null;
  priority: string;
  status: string;
  energy: string;
  estimatedMinutes: number;
  actualMinutes: number;
  reminderMinutesBefore: number | null;
  categoryId: string | null;
  projectId: string | null;
  goalId: string | null;
  pinned: boolean;
  order: number;
  tags: string[];
  subtasks: { title: string; done?: boolean }[];
  recurrence: Task['recurrence'];
}>;

export function useTaskMutations() {
  const invalidate = useInvalidateTasks();
  const client = useQueryClient();
  const done = () => {
    invalidate();
    client.invalidateQueries({ queryKey: ['task'] });
  };

  return {
    create: useMutation({
      mutationFn: (input: TaskInput) => post<{ task: Task }>('/tasks', input),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...input }: TaskInput & { id: string }) => patch<{ task: Task }>(`/tasks/${id}`, input),
      onSuccess: done,
    }),
    complete: useMutation({
      mutationFn: ({ id, actualMinutes }: { id: string; actualMinutes?: number }) =>
        post<{ task: Task }>(`/tasks/${id}/complete`, actualMinutes !== undefined ? { actualMinutes } : {}),
      onSuccess: done,
    }),
    reopen: useMutation({
      mutationFn: (id: string) => post<{ task: Task }>(`/tasks/${id}/reopen`),
      onSuccess: done,
    }),
    postpone: useMutation({
      mutationFn: ({ id, days, to, reason }: { id: string; days?: number; to?: string; reason?: string }) =>
        post<{ task: Task }>(`/tasks/${id}/postpone`, { days, to, reason }),
      onSuccess: done,
    }),
    duplicate: useMutation({
      mutationFn: ({ id, date }: { id: string; date?: string }) => post<{ task: Task }>(`/tasks/${id}/duplicate`, { date }),
      onSuccess: done,
    }),
    archive: useMutation({
      mutationFn: (id: string) => post<{ task: Task }>(`/tasks/${id}/archive`),
      onSuccess: done,
    }),
    unarchive: useMutation({
      mutationFn: (id: string) => post<{ task: Task }>(`/tasks/${id}/unarchive`),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: ({ id, scope }: { id: string; scope?: 'one' | 'series' }) =>
        del<{ ok: boolean; deleted: number }>(`/tasks/${id}${scope === 'series' ? '?scope=series' : ''}`),
      onSuccess: done,
    }),
    setMissReason: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        post<{ task: Task }>(`/tasks/${id}/miss-reason`, { reason }),
      onSuccess: done,
    }),
    addSubtask: useMutation({
      mutationFn: ({ id, title }: { id: string; title: string }) => post<{ task: Task }>(`/tasks/${id}/subtasks`, { title }),
      onSuccess: done,
    }),
    toggleSubtask: useMutation({
      mutationFn: ({ id, subtaskId, done: isDone }: { id: string; subtaskId: string; done: boolean }) =>
        patch<{ task: Task }>(`/tasks/${id}/subtasks/${subtaskId}`, { done: isDone }),
      onSuccess: done,
    }),
    removeSubtask: useMutation({
      mutationFn: ({ id, subtaskId }: { id: string; subtaskId: string }) =>
        del<{ task: Task }>(`/tasks/${id}/subtasks/${subtaskId}`),
      onSuccess: done,
    }),
    reorder: useMutation({
      mutationFn: (items: { id: string; order: number; date?: string }[]) => post('/tasks/reorder', { items }),
      onSuccess: done,
    }),
    bulk: useMutation({
      mutationFn: (input: { ids: string[]; action: string; value?: string | null; days?: number }) =>
        post<{ affected: number }>('/tasks/bulk', input),
      onSuccess: done,
    }),
    quickCapture: useMutation({
      mutationFn: (input: { text: string; date?: string }) => post<{ task: Task; parsed: unknown }>('/tasks/quick', input),
      onSuccess: done,
    }),
  };
}

export type ParsedCapture = {
  title: string;
  date: string | null;
  startTime: string | null;
  priority: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  projectHint: string | null;
  categoryHint: string | null;
  recurrence: Task['recurrence'];
  matched: { kind: string; text: string; value: string }[];
};

export function useParseCapture() {
  return useMutation({
    mutationFn: (text: string) => post<{ parsed: ParsedCapture }>('/tasks/parse', { text }),
  });
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery(query<{ categories: Category[] }>(keys.categories, '/org/categories', { staleTime: 300_000 }));
}

export function useTags() {
  return useQuery(query<{ tags: Tag[] }>(keys.tags, '/org/tags', { staleTime: 300_000 }));
}

export function useOrgMutations() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: keys.categories });
    client.invalidateQueries({ queryKey: keys.tags });
    client.invalidateQueries({ queryKey: keys.projects });
    client.invalidateQueries({ queryKey: ['dashboard'] });
    client.invalidateQueries({ queryKey: ['tasks'] });
  };

  return {
    createCategory: useMutation({
      mutationFn: (input: { name: string; color?: string; icon?: string }) => post('/org/categories', input),
      onSuccess: refresh,
    }),
    updateCategory: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; color?: string; icon?: string }) =>
        patch(`/org/categories/${id}`, input),
      onSuccess: refresh,
    }),
    deleteCategory: useMutation({ mutationFn: (id: string) => del(`/org/categories/${id}`), onSuccess: refresh }),
    updateTag: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; color?: string }) => patch(`/org/tags/${id}`, input),
      onSuccess: refresh,
    }),
    deleteTag: useMutation({ mutationFn: (id: string) => del(`/org/tags/${id}`), onSuccess: refresh }),
    createProject: useMutation({
      mutationFn: (input: Record<string, unknown>) => post<{ project: Project }>('/org/projects', input),
      onSuccess: refresh,
    }),
    updateProject: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) => patch(`/org/projects/${id}`, input),
      onSuccess: refresh,
    }),
    deleteProject: useMutation({
      mutationFn: ({ id, deleteTasks }: { id: string; deleteTasks?: boolean }) =>
        del(`/org/projects/${id}${deleteTasks ? '?deleteTasks=true' : ''}`),
      onSuccess: refresh,
    }),
  };
}

export function useProjects(includeArchived = false) {
  return useQuery(
    query<{ projects: Project[] }>(
      [...keys.projects, includeArchived],
      `/org/projects${includeArchived ? '?includeArchived=true' : ''}`,
      { staleTime: 60_000 },
    ),
  );
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export function useGoals(params: { status?: string; type?: string; projectId?: string } = {}) {
  return useQuery(query<{ goals: Goal[] }>(keys.goals(params), `/goals${toSearch(params)}`, { staleTime: 60_000 }));
}

export function useGoal(id: string | null) {
  return useQuery(
    query<{ goal: Goal; tasks: Task[] }>(keys.goal(id ?? ''), `/goals/${id}`, { enabled: Boolean(id) }),
  );
}

export function useGoalMutations() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['goals'] });
    client.invalidateQueries({ queryKey: ['goal'] });
    client.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return {
    create: useMutation({ mutationFn: (input: Record<string, unknown>) => post<{ goal: Goal }>('/goals', input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) => patch<{ goal: Goal }>(`/goals/${id}`, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => del(`/goals/${id}`), onSuccess: refresh }),
    addMilestone: useMutation({
      mutationFn: ({ goalId, title, targetDate }: { goalId: string; title: string; targetDate?: string | null }) =>
        post(`/goals/${goalId}/milestones`, { title, targetDate }),
      onSuccess: refresh,
    }),
    updateMilestone: useMutation({
      mutationFn: ({ goalId, id, ...input }: { goalId: string; id: string } & Record<string, unknown>) =>
        patch(`/goals/${goalId}/milestones/${id}`, input),
      onSuccess: refresh,
    }),
    removeMilestone: useMutation({
      mutationFn: ({ goalId, id }: { goalId: string; id: string }) => del(`/goals/${goalId}/milestones/${id}`),
      onSuccess: refresh,
    }),
  };
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export function useHabits(days = 180) {
  return useQuery(
    query<{ habits: Habit[]; today: string; from: string }>([...keys.habits, days], `/habits?days=${days}`, {
      staleTime: 30_000,
    }),
  );
}

export function useHabitMutations() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: keys.habits });
    client.invalidateQueries({ queryKey: ['dashboard'] });
    client.invalidateQueries({ queryKey: ['analytics'] });
  };

  return {
    create: useMutation({ mutationFn: (input: Record<string, unknown>) => post('/habits', input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) => patch(`/habits/${id}`, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => del(`/habits/${id}`), onSuccess: refresh }),
    check: useMutation({
      mutationFn: ({ id, date, done }: { id: string; date?: string; done?: boolean }) =>
        post<{ done: boolean; date: string }>(`/habits/${id}/check`, { date, done }),
      onSuccess: refresh,
    }),
  };
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

export type FocusStats = {
  today: { minutes: number; sessions: number };
  week: { minutes: number; sessions: number };
  month: { minutes: number; sessions: number };
  trend: { date: string; minutes: number; sessions: number }[];
  topTasks: { taskId: string; title: string; minutes: number }[];
  recent: FocusSession[];
};

export function useFocusStats() {
  return useQuery(query<FocusStats>(keys.focusStats, '/focus/stats', { staleTime: 20_000 }));
}

export function useActiveFocus() {
  return useQuery(
    query<{ session: (FocusSession & { task: { id: string; title: string } | null }) | null }>(
      keys.focusActive,
      '/focus/active',
      { staleTime: 5_000 },
    ),
  );
}

export function useFocusMutations() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['focus'] });
    client.invalidateQueries({ queryKey: ['dashboard'] });
    client.invalidateQueries({ queryKey: ['tasks'] });
    client.invalidateQueries({ queryKey: ['analytics'] });
  };

  return {
    start: useMutation({
      mutationFn: (input: { taskId?: string | null; plannedMinutes: number; mode?: string }) =>
        post<{ session: FocusSession }>('/focus/start', input),
      onSuccess: refresh,
    }),
    finish: useMutation({
      mutationFn: ({ id, ...input }: { id: string; actualMinutes?: number; completed?: boolean; interruptions?: number }) =>
        post<{ session: FocusSession }>(`/focus/${id}/finish`, input),
      onSuccess: refresh,
    }),
    cancel: useMutation({ mutationFn: (id: string) => post(`/focus/${id}/cancel`), onSuccess: refresh }),
  };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function useNotes(params: { search?: string; date?: string; taskId?: string; goalId?: string; projectId?: string } = {}) {
  return useQuery(query<{ notes: Note[] }>(keys.notes(params), `/notes${toSearch(params)}`, { staleTime: 30_000 }));
}

export function useNoteMutations() {
  const client = useQueryClient();
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['notes'] });
    client.invalidateQueries({ queryKey: ['analytics'] });
  };

  return {
    create: useMutation({ mutationFn: (input: Record<string, unknown>) => post<{ note: Note }>('/notes', input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) => patch<{ note: Note }>(`/notes/${id}`, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => del(`/notes/${id}`), onSuccess: refresh }),
  };
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type DailyPrepare = {
  type: 'daily';
  date: string;
  metrics: DayMetrics;
  completed: { id: string; title: string; priority: string }[];
  missed: { id: string; title: string; priority: string; postponedCount: number; missReason: string }[];
  interruptions: number;
  reasonOptions: string[];
  existing: Review | null;
};

export type WeeklyPrepare = {
  type: 'weekly';
  date: string;
  weekStart: string;
  weekEnd: string;
  days: DaySummary[];
  metrics: {
    planned: number; completed: number; missed: number; postponed: number;
    focusMinutes: number; completionRate: number; avgScore: number;
    streaks: { current: number; best: number };
    weekday: AnalyticsOverview['weekday'];
  };
  completedTasks: { id: string; title: string; date: string }[];
  missedTasks: { id: string; title: string; date: string; postponedCount: number }[];
  reasonOptions: string[];
  existing: Review | null;
};

export function useReviewPrepare(type: 'daily' | 'weekly', date?: string) {
  return useQuery(
    query<DailyPrepare | WeeklyPrepare>(
      keys.reviewPrepare(type, date),
      `/reviews/prepare${toSearch({ type, date })}`,
      { staleTime: 10_000 },
    ),
  );
}

export function useReviews(params: { type?: 'daily' | 'weekly'; from?: string; to?: string; limit?: number } = {}) {
  return useQuery(query<{ reviews: Review[] }>(keys.reviews(params), `/reviews${toSearch(params)}`, { staleTime: 30_000 }));
}

export function useMissReasons(days = 180) {
  return useQuery(
    query<{
      from: string;
      to: string;
      reasons: { reason: string; count: number; share: number }[];
      totalReviews: number;
      mostPostponed: { id: string; title: string; postponedCount: number; date: string; priority: string }[];
    }>([...keys.missReasons, days], `/reviews/insights/miss-reasons?days=${days}`, { staleTime: 60_000 }),
  );
}

export function useSaveReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => post<{ review: Review }>('/reviews', input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['reviews'] });
      client.invalidateQueries({ queryKey: ['dashboard'] });
      client.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Analytics & history
// ---------------------------------------------------------------------------

export function useAnalytics(range: '7' | '30' | '90' | '180' | '365') {
  return useQuery(query<AnalyticsOverview>(keys.analytics(range), `/analytics/overview?range=${range}`, { staleTime: 60_000 }));
}

export function useHeatmap(days = 182) {
  return useQuery(
    query<{
      from: string;
      to: string;
      days: { date: string; score: number; completed: number; planned: number; focusMinutes: number; level: number }[];
    }>(keys.heatmap(days), `/analytics/heatmap?days=${days}`, { staleTime: 60_000 }),
  );
}

export function useRecords() {
  return useQuery(
    query<{
      streaks: { current: number; best: number };
      bestDay: DaySummary | null;
      bestScoreDay: DaySummary | null;
      bestFocusDay: DaySummary | null;
      bestWeek: { week: string; completed: number } | null;
      bestMonth: { month: string; completed: number } | null;
      lifetime: { tasksCompleted: number; focusMinutes: number; focusHours: number; habitCheckIns: number; daysTracked: number };
    }>(keys.records, '/analytics/records', { staleTime: 120_000 }),
  );
}

export type HistoryDay = DaySummary & { hasReview: boolean; rating: number; mood: string; noteCount: number };

export function useHistory(params: { from?: string; to?: string; days?: number }) {
  return useQuery(
    query<{ from: string; to: string; days: HistoryDay[] }>(keys.history(params), `/analytics/history${toSearch(params)}`, {
      staleTime: 60_000,
    }),
  );
}

export function useHistoryDay(date: string | null) {
  return useQuery(
    query<{
      date: string;
      metrics: DayMetrics;
      tasks: Task[];
      review: Review | null;
      notes: Note[];
      focusSessions: FocusSession[];
      habits: { id: string; name: string; color: string; cadence: string; done: boolean }[];
    }>(keys.historyDay(date ?? ''), `/analytics/history/${date}`, { enabled: Boolean(date) }),
  );
}

export type CalendarDay = {
  date: string;
  planned: number;
  completed: number;
  score: number;
  tasks: (Pick<Task, 'id' | 'title' | 'date' | 'startTime' | 'dueTime' | 'priority' | 'status' | 'estimatedMinutes'> & {
    category: { id: string; name: string; color: string } | null;
    project: { id: string; name: string; color: string } | null;
  })[];
};

export function useCalendar(from: string, to: string) {
  return useQuery(
    query<{ from: string; to: string; today: string; days: CalendarDay[] }>(
      keys.calendar(from, to),
      `/analytics/calendar?from=${from}&to=${to}`,
      { staleTime: 30_000 },
    ),
  );
}

// ---------------------------------------------------------------------------
// Settings, backups, security
// ---------------------------------------------------------------------------

export function useDataStats() {
  return useQuery(
    query<{
      tasks: number; completedTasks: number; projects: number; goals: number; habits: number;
      habitEntries: number; focusSessions: number; focusMinutes: number; reviews: number; notes: number;
      historyFrom: string | null; historyDays: number;
    }>(keys.settingsStats, '/settings/stats', { staleTime: 60_000 }),
  );
}

export function useBackups() {
  return useQuery(
    query<{
      backups: { filename: string; size: number; createdAt: string; kind: string }[];
      directory: string;
      autoDaily: boolean;
      keep: number;
    }>(keys.backups, '/backup', { staleTime: 30_000 }),
  );
}

export function useSessions() {
  return useQuery(
    query<{
      sessions: {
        id: string; current: boolean; ip: string; userAgent: string; label: string;
        createdAt: string; lastSeenAt: string; expiresAt: string; locked: boolean;
      }[];
    }>(keys.sessions, '/auth/sessions', { staleTime: 20_000 }),
  );
}

export type BlockedSource = {
  ip: string;
  reason: string;
  detail: string;
  strikes: number;
  hits: number;
  userAgent: string;
  blockedAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

export function useBlocks() {
  return useQuery(
    query<{ blocks: BlockedSource[] }>(['auth', 'blocks'], '/auth/blocks', { staleTime: 15_000 }),
  );
}

export function useBlockMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['auth', 'blocks'] });
  return {
    release: useMutation({ mutationFn: (ip: string) => del(`/auth/blocks/${encodeURIComponent(ip)}`), onSuccess: refresh }),
    releaseAll: useMutation({ mutationFn: () => post<{ removed: number }>('/auth/blocks/clear'), onSuccess: refresh }),
  };
}

export function useActivity(limit = 60) {
  return useQuery(
    query<{ activity: { id: string; action: string; detail: string; ip: string; ok: boolean; at: string }[] }>(
      [...keys.activity, limit],
      `/auth/activity?limit=${limit}`,
      { staleTime: 20_000 },
    ),
  );
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => patch<{ user: User }>('/settings', input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['dashboard'] });
      client.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
