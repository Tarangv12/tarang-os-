/** Shared API types — mirrors the server's serializers. */

export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'archived';
export type Energy = 'high' | 'medium' | 'low';

export type RecurrenceRule = {
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  interval: number;
  byWeekday?: number[];
  byMonthDay?: number;
  until?: string | null;
  count?: number | null;
};

export type Tag = { id: string; name: string; color: string; taskCount?: number };
export type Category = { id: string; name: string; color: string; icon: string; order: number; taskCount?: number };

export type Subtask = { id: string; title: string; done: boolean; order: number };

export type Task = {
  id: string;
  title: string;
  description: string;
  notes: string;
  date: string;
  startTime: string | null;
  dueTime: string | null;
  priority: Priority;
  status: TaskStatus;
  energy: Energy;
  estimatedMinutes: number;
  actualMinutes: number;
  reminderAt: string | null;
  reminderMinutesBefore: number | null;
  recurrence: RecurrenceRule | null;
  recurrenceLabel: string | null;
  recurrenceParentId: string | null;
  isRecurring: boolean;
  categoryId: string | null;
  category: { id: string; name: string; color: string; icon: string } | null;
  projectId: string | null;
  project: { id: string; name: string; color: string } | null;
  goalId: string | null;
  goal: { id: string; title: string; color: string } | null;
  completedAt: string | null;
  archivedAt: string | null;
  postponedCount: number;
  originalDate: string | null;
  missReason: string;
  order: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
  subtasks: Subtask[];
  subtaskProgress: number | null;
  subtaskCount: number;
  subtasksDone: number;
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
  date: string;
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

export type DaySummary = {
  date: string;
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

export type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  status: 'active' | 'paused' | 'done';
  startDate: string | null;
  targetDate: string | null;
  archivedAt: string | null;
  order: number;
  taskCount: number;
  completedCount: number;
  progress: number;
};

export type Milestone = { id: string; title: string; done: boolean; targetDate: string | null; order: number };

export type Goal = {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'longterm';
  status: 'active' | 'done' | 'dropped';
  metricType: 'milestones' | 'tasks' | 'numeric';
  targetValue: number;
  currentValue: number;
  unit: string;
  startDate: string | null;
  targetDate: string | null;
  color: string;
  projectId: string | null;
  project: { id: string; name: string; color: string } | null;
  milestones: Milestone[];
  milestoneCount: number;
  milestonesDone: number;
  taskCount: number;
  tasksDone: number;
  progress: number;
  daysLeft: number | null;
  overdue: boolean;
};

export type Habit = {
  id: string;
  name: string;
  description: string;
  cadence: 'daily' | 'weekly';
  targetPerWeek: number;
  targetValue: number;
  unit: string;
  color: string;
  icon: string;
  reminderTime: string | null;
  startDate: string | null;
  archivedAt: string | null;
  order: number;
  doneToday: boolean;
  currentStreak: number;
  bestStreak: number;
  totalDone: number;
  possibleDays: number;
  completionRate: number;
  thisWeek: number;
  weekTarget: number;
  history: { date: string; done: boolean; value: number; note: string }[];
};

export type FocusSession = {
  id: string;
  taskId: string | null;
  task?: { id: string; title: string; priority?: string } | null;
  date: string;
  mode: 'focus' | 'short_break' | 'long_break';
  plannedMinutes: number;
  actualMinutes: number;
  startedAt: string;
  endedAt: string | null;
  completed: boolean;
  interruptions: number;
  note: string;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  date: string | null;
  pinned: boolean;
  color: string;
  taskId: string | null;
  goalId: string | null;
  projectId: string | null;
  task?: { id: string; title: string } | null;
  goal?: { id: string; title: string } | null;
  project?: { id: string; name: string; color: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type Review = {
  id: string;
  type: 'daily' | 'weekly';
  date: string;
  wentWell: string;
  missedWhy: string;
  missReasons: string[];
  distractions: string;
  lessons: string;
  improvements: string;
  gratitude: string;
  rating: number;
  mood: string;
  energy: number;
  snapshot: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};

export type UserSettings = {
  dailyTaskTarget: number;
  dailyFocusTargetMinutes: number;
  workdayStart: string;
  workdayEnd: string;
  weekStartsOn: 0 | 1;
  defaultPriority: Priority;
  defaultView: string;
  pomodoro: { focus: number; shortBreak: number; longBreak: number; longBreakEvery: number };
  notifications: {
    enabled: boolean;
    taskReminders: boolean;
    habitReminders: boolean;
    dailyAgenda: boolean;
    dailyAgendaTime: string | null;
    dailyReviewTime: string | null;
    unfinishedImportantAt: string | null;
  };
  reduceMotion: boolean;
  compactMode: boolean;
  quickCaptureDefaults: { category: string | null; priority: string };
  onboardedAt: string | null;
};

export type User = {
  id: string;
  username: string;
  displayName: string;
  theme: 'system' | 'light' | 'dark';
  accent: string;
  timezone: string;
  totpEnabled: boolean;
  hasPin: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string;
  createdAt: string;
  settings: UserSettings;
};

export type Dashboard = {
  today: string;
  now: string;
  greeting: string;
  user: { displayName: string; timezone: string };
  metrics: DayMetrics;
  tasks: Task[];
  nextUp: Task | null;
  overdue: { id: string; title: string; date: string; priority: Priority; status: TaskStatus; postponedCount: number }[];
  upcoming: { id: string; title: string; date: string; startTime: string | null; dueTime: string | null; priority: Priority }[];
  highPriority: Task[];
  habits: { id: string; name: string; color: string; icon: string; cadence: string; targetPerWeek: number; reminderTime: string | null; doneToday: boolean }[];
  goals: {
    id: string; title: string; type: string; color: string; targetDate: string | null;
    progress: number; milestonesDone: number; milestoneCount: number; taskCount: number;
  }[];
  activeFocus: (FocusSession & { task: { id: string; title: string } | null }) | null;
  todayReview: Review | null;
  streak: { current: number; best: number };
  week: { start: string; planned: number; completed: number; focusMinutes: number; avgScore: number; days: DaySummary[] };
  trend: DaySummary[];
  targets: { dailyTasks: number; dailyFocusMinutes: number };
};

export type AnalyticsOverview = {
  range: { from: string; to: string; days: number; label: string };
  totals: {
    planned: number; completed: number; missed: number; postponed: number;
    focusMinutes: number; focusHours: number; completionRate: number;
    avgTasksPerDay: number; avgTasksPerActiveDay: number; avgFocusPerDay: number;
    avgScore: number; activeDays: number;
  };
  comparison: {
    previous: { from: string; to: string; planned: number; completed: number; completionRate: number; avgScore: number };
    completedDelta: number; completionRateDelta: number; scoreDelta: number;
  };
  daily: DaySummary[];
  weekly: { week: string; planned: number; completed: number; focusMinutes: number; completionRate: number; avgScore: number }[];
  monthly: { month: string; planned: number; completed: number; focusMinutes: number; completionRate: number; avgScore: number }[];
  weekday: {
    rows: { weekday: number; name: string; short: string; planned: number; completed: number; completionRate: number; avgScore: number; days: number }[];
    best: { name: string; completionRate: number } | null;
    weakest: { name: string; completionRate: number } | null;
  };
  streaks: { current: number; best: number };
  byCategory: { key: string | null; name: string; color: string; total: number; completed: number; completionRate: number }[];
  byProject: { key: string | null; name: string; color: string; total: number; completed: number; completionRate: number }[];
  byPriority: { key: string; name: string; total: number; completed: number; completionRate: number }[];
};
