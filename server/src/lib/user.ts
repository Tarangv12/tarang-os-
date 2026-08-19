import type { User } from '@prisma/client';
import { prisma } from './db';
import { config } from '../config';

export type UserSettings = {
  dailyTaskTarget: number;
  dailyFocusTargetMinutes: number;
  workdayStart: string;
  workdayEnd: string;
  weekStartsOn: 0 | 1;
  defaultPriority: 'urgent' | 'high' | 'medium' | 'low';
  defaultView: string;
  pomodoro: { focus: number; shortBreak: number; longBreak: number; longBreakEvery: number };
  notifications: {
    enabled: boolean;
    taskReminders: boolean;
    habitReminders: boolean;
    /** Fixed-time morning briefing listing what is planned for the day. */
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

export const DEFAULT_SETTINGS: UserSettings = {
  dailyTaskTarget: 6,
  dailyFocusTargetMinutes: 120,
  workdayStart: '09:00',
  workdayEnd: '18:00',
  weekStartsOn: 1,
  defaultPriority: 'medium',
  defaultView: 'dashboard',
  pomodoro: { focus: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 },
  notifications: {
    enabled: true,
    taskReminders: true,
    habitReminders: true,
    dailyAgenda: true,
    dailyAgendaTime: '10:00',
    dailyReviewTime: '21:00',
    unfinishedImportantAt: '20:00',
  },
  reduceMotion: false,
  compactMode: false,
  quickCaptureDefaults: { category: null, priority: 'medium' },
  onboardedAt: null,
};

export function parseSettings(raw: string | null | undefined): UserSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...(parsed.pomodoro || {}) },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications || {}) },
      quickCaptureDefaults: {
        ...DEFAULT_SETTINGS.quickCaptureDefaults,
        ...(parsed.quickCaptureDefaults || {}),
      },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** TarangOS is single-tenant: the one and only account. */
export async function getAdmin(): Promise<User | null> {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
}

export async function adminExists(): Promise<boolean> {
  return (await prisma.user.count()) > 0;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    theme: user.theme,
    accent: user.accent,
    timezone: user.timezone,
    totpEnabled: user.totpEnabled,
    hasPin: Boolean(user.pinHash),
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt,
    createdAt: user.createdAt,
    settings: parseSettings(user.settings),
  };
}

const WEAK = new Set([
  'password', 'passw0rd', '12345678', 'qwertyuiop', 'letmein', 'iloveyou',
  'admin1234', 'welcome1', 'changeme', 'tarangos', 'productivity',
]);

export function passwordProblems(password: string, username = ''): string[] {
  const issues: string[] = [];
  if (password.length < config.auth.minPasswordLength) {
    issues.push(`Use at least ${config.auth.minPasswordLength} characters`);
  }
  if (password.length > 200) issues.push('Password is too long');
  if (!/[a-z]/.test(password)) issues.push('Add a lowercase letter');
  if (!/[A-Z]/.test(password)) issues.push('Add an uppercase letter');
  if (!/[0-9]/.test(password)) issues.push('Add a number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('Add a symbol');
  const lower = password.toLowerCase();
  if (WEAK.has(lower)) issues.push('That password is too common');
  if (username && lower.includes(username.toLowerCase())) issues.push('Do not include your username');
  if (/^(.)\1+$/.test(password)) issues.push('Avoid repeating a single character');
  return issues;
}
