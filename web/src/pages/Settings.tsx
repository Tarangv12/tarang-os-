import * as React from 'react';
import {
  Bell, Check, Database, Download, HardDrive, Key, Laptop, Lock, LogOut, Monitor, Moon, Palette,
  Plus, RotateCcw, Shield, ShieldAlert, ShieldCheck, Smartphone, Sun, Tag as TagIcon, Trash2, Upload, User as UserIcon,
  UploadCloud, X,
} from 'lucide-react';
import {
  useActivity, useBackups, useBlockMutations, useBlocks, useCategories, useDataStats,
  useOrgMutations, useSessions, useTags, useUpdateSettings,
} from '@/lib/queries';
import { api, ApiError, download, setCsrfToken } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, PageHeader, Progress as Bar,
  SegmentedControl, Select, Skeleton, Switch, Textarea,
} from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth, useUser } from '@/state/auth';
import { ACCENTS, useTheme } from '@/state/theme';
import { useReminders } from '@/state/reminders';
import { cn, formatDate, formatDuration, formatRelativeTime, pluralize } from '@/lib/utils';

type Section = 'profile' | 'appearance' | 'productivity' | 'notifications' | 'security' | 'data';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <UserIcon className="h-4 w-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
  { id: 'productivity', label: 'Productivity', icon: <Monitor className="h-4 w-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'data', label: 'Data & backups', icon: <Database className="h-4 w-4" /> },
];

export default function Settings() {
  const [section, setSection] = React.useState<Section>('profile');

  return (
    <div>
      <PageHeader title="Settings" description="Everything about how TarangOS behaves, and how your data is protected." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto no-scrollbar lg:flex-col lg:overflow-visible">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSection(entry.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors',
                section === entry.id ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-subtle hover:text-ink',
              )}
            >
              <span className={section === entry.id ? 'text-accent' : 'text-faint'}>{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {section === 'profile' && <ProfileSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'productivity' && <ProductivitySection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'data' && <DataSection />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileSection() {
  const user = useUser();
  const { refresh } = useAuth();
  const updateSettings = useUpdateSettings();
  const toast = useToast();
  const [displayName, setDisplayName] = React.useState(user.displayName);
  const [timezone, setTimezone] = React.useState(user.timezone);

  const zones = React.useMemo(() => {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    return list?.length ? list : [user.timezone, 'UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];
  }, [user.timezone]);

  const save = () => {
    updateSettings.mutate(
      { displayName, timezone },
      {
        onSuccess: async () => {
          await refresh();
          toast.success('Profile updated');
        },
        onError: (err) => toast.error('Could not save', (err as Error).message),
      },
    );
  };

  return (
    <Card className="card-pad space-y-4">
      <CardHeader title="Profile" subtitle="Only you ever see this." className="px-0 pt-0" />

      <Field label="Username" hint="Fixed after setup — it is the only account on this instance.">
        <Input value={user.username} disabled />
      </Field>

      <Field label="Display name" hint="Used in your dashboard greeting.">
        <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </Field>

      <Field label="Timezone" hint="Determines when your day rolls over and when reminders fire.">
        <Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>{zone}</option>
          ))}
        </Select>
      </Field>

      <div className="flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
        <span>Account created {formatDate(user.createdAt.slice(0, 10), 'medium')}</span>
        <Button
          variant="primary"
          onClick={save}
          loading={updateSettings.isPending}
          disabled={displayName === user.displayName && timezone === user.timezone}
        >
          Save changes
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const user = useUser();
  const { refresh } = useAuth();
  const theme = useTheme();
  const updateSettings = useUpdateSettings();
  const toast = useToast();

  const setMode = (mode: 'system' | 'light' | 'dark') => {
    theme.setMode(mode);
    updateSettings.mutate({ theme: mode }, { onSuccess: () => void refresh() });
  };

  const setAccent = (accent: string) => {
    theme.setAccent(accent);
    updateSettings.mutate({ accent }, { onSuccess: () => void refresh() });
  };

  return (
    <>
      <Card className="card-pad space-y-4">
        <CardHeader title="Theme" subtitle="Saved to your account, so it follows you to your phone." className="px-0 pt-0" />

        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'light' as const, label: 'Light', icon: <Sun className="h-4 w-4" /> },
            { value: 'dark' as const, label: 'Dark', icon: <Moon className="h-4 w-4" /> },
            { value: 'system' as const, label: 'System', icon: <Laptop className="h-4 w-4" /> },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setMode(option.value)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors',
                theme.mode === option.value ? 'border-accent bg-accent/[0.07] text-accent' : 'border-line text-muted hover:bg-subtle',
              )}
            >
              {option.icon}
              <span className="text-xs font-medium">{option.label}</span>
            </button>
          ))}
        </div>

        <Field label="Accent colour">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.id}
                onClick={() => setAccent(accent.id)}
                aria-label={accent.label}
                className={cn(
                  'relative h-10 w-10 rounded-xl border-2 transition-transform hover:scale-105',
                  theme.accent === accent.id ? 'border-ink' : 'border-transparent',
                )}
                style={{ background: accent.swatch }}
              >
                {theme.accent === accent.id && <Check className="absolute inset-0 m-auto h-4 w-4 text-white" />}
              </button>
            ))}
          </div>
        </Field>
      </Card>

      <Card className="card-pad space-y-4">
        <CardHeader title="Motion & density" className="px-0 pt-0" />
        <Switch
          checked={theme.reduceMotion}
          onChange={(value) => {
            theme.setReduceMotion(value);
            updateSettings.mutate({ settings: { reduceMotion: value } });
          }}
          label="Reduce motion"
          description="Turns off animations and transitions across the app."
        />
        <Switch
          checked={theme.compact}
          onChange={(value) => {
            theme.setCompact(value);
            updateSettings.mutate({ settings: { compactMode: value } });
          }}
          label="Compact lists"
          description="Tighter spacing so more fits on screen."
        />
      </Card>

      <CategoriesAndTags />
    </>
  );
}

function CategoriesAndTags() {
  const { data: categoryData } = useCategories();
  const { data: tagData } = useTags();
  const { createCategory, updateCategory, deleteCategory, deleteTag } = useOrgMutations();
  const confirm = useConfirm();
  const toast = useToast();
  const [newCategory, setNewCategory] = React.useState('');

  const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

  return (
    <>
      <Card className="card-pad space-y-3">
        <CardHeader title="Categories" subtitle="Used to group tasks and drive category analytics." className="px-0 pt-0" />

        <div className="flex gap-2">
          <Input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newCategory.trim()) {
                createCategory.mutate(
                  { name: newCategory.trim(), color: COLORS[(categoryData?.categories.length ?? 0) % COLORS.length] },
                  { onSuccess: () => setNewCategory('') },
                );
              }
            }}
            placeholder="Add a category…"
            className="flex-1"
          />
          <Button
            variant="outline"
            icon={<Plus className="h-4 w-4" />}
            disabled={!newCategory.trim()}
            onClick={() =>
              createCategory.mutate(
                { name: newCategory.trim(), color: COLORS[(categoryData?.categories.length ?? 0) % COLORS.length] },
                { onSuccess: () => setNewCategory('') },
              )
            }
          >
            Add
          </Button>
        </div>

        {(categoryData?.categories.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-xs text-faint">
            No categories yet. They make the Analytics screen far more useful.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {categoryData!.categories.map((category) => (
              <li key={category.id} className="group flex items-center gap-2.5 rounded-xl border border-line px-3 py-2">
                <input
                  type="color"
                  value={category.color}
                  onChange={(event) => updateCategory.mutate({ id: category.id, color: event.target.value })}
                  className="h-6 w-6 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
                  aria-label={`Colour for ${category.name}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{category.name}</span>
                <span className="shrink-0 text-2xs text-faint">{pluralize(category.taskCount ?? 0, 'task')}</span>
                <IconButton
                  label={`Delete ${category.name}`}
                  size="sm"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete "${category.name}"?`,
                      message: 'Tasks in this category are kept — they simply become uncategorised.',
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (ok) deleteCategory.mutate(category.id, { onSuccess: () => toast.success('Category deleted') });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="card-pad space-y-3">
        <CardHeader title="Tags" subtitle="Created automatically when you use #tag in Quick capture." icon={<TagIcon className="h-4 w-4" />} className="px-0 pt-0" />
        {(tagData?.tags.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-3 text-xs text-faint">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tagData!.tags.map((tag) => (
              <span
                key={tag.id}
                className="group inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium"
                style={{ color: tag.color, background: `${tag.color}18` }}
              >
                #{tag.name}
                <span className="text-2xs opacity-60">{tag.taskCount}</span>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete #${tag.name}?`,
                      message: 'The tag is removed from every task. The tasks themselves are untouched.',
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (ok) deleteTag.mutate(tag.id);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Delete tag ${tag.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Productivity
// ---------------------------------------------------------------------------

function ProductivitySection() {
  const user = useUser();
  const { refresh } = useAuth();
  const updateSettings = useUpdateSettings();
  const toast = useToast();
  const [form, setForm] = React.useState(user.settings);

  const save = () => {
    updateSettings.mutate(
      { settings: form },
      {
        onSuccess: async () => {
          await refresh();
          toast.success('Preferences saved');
        },
        onError: (err) => toast.error('Could not save', (err as Error).message),
      },
    );
  };

  return (
    <>
      <Card className="card-pad space-y-4">
        <CardHeader title="Daily targets" subtitle="These feed directly into your productivity score." className="px-0 pt-0" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tasks per day" hint="Your baseline expectation.">
            <Input
              type="number"
              min={1}
              max={50}
              value={form.dailyTaskTarget}
              onChange={(event) => setForm({ ...form, dailyTaskTarget: Number(event.target.value) || 1 })}
            />
          </Field>
          <Field label="Focus minutes per day" hint="The focus component is measured against this.">
            <Input
              type="number"
              min={15}
              max={960}
              step={15}
              value={form.dailyFocusTargetMinutes}
              onChange={(event) => setForm({ ...form, dailyFocusTargetMinutes: Number(event.target.value) || 15 })}
            />
          </Field>
          <Field label="Workday starts">
            <Input type="time" value={form.workdayStart} onChange={(event) => setForm({ ...form, workdayStart: event.target.value })} />
          </Field>
          <Field label="Workday ends">
            <Input type="time" value={form.workdayEnd} onChange={(event) => setForm({ ...form, workdayEnd: event.target.value })} />
          </Field>
          <Field label="Week starts on">
            <Select
              value={String(form.weekStartsOn)}
              onChange={(event) => setForm({ ...form, weekStartsOn: Number(event.target.value) as 0 | 1 })}
            >
              <option value="1">Monday</option>
              <option value="0">Sunday</option>
            </Select>
          </Field>
          <Field label="Default priority for new tasks">
            <Select
              value={form.defaultPriority}
              onChange={(event) => setForm({ ...form, defaultPriority: event.target.value as typeof form.defaultPriority })}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="card-pad space-y-4">
        <CardHeader title="Focus timer" subtitle="Pomodoro defaults." className="px-0 pt-0" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Focus (min)">
            <Input type="number" min={5} max={180} value={form.pomodoro.focus} onChange={(event) => setForm({ ...form, pomodoro: { ...form.pomodoro, focus: Number(event.target.value) || 25 } })} />
          </Field>
          <Field label="Short break">
            <Input type="number" min={1} max={60} value={form.pomodoro.shortBreak} onChange={(event) => setForm({ ...form, pomodoro: { ...form.pomodoro, shortBreak: Number(event.target.value) || 5 } })} />
          </Field>
          <Field label="Long break">
            <Input type="number" min={5} max={120} value={form.pomodoro.longBreak} onChange={(event) => setForm({ ...form, pomodoro: { ...form.pomodoro, longBreak: Number(event.target.value) || 15 } })} />
          </Field>
          <Field label="Long break every">
            <Input type="number" min={2} max={12} value={form.pomodoro.longBreakEvery} onChange={(event) => setForm({ ...form, pomodoro: { ...form.pomodoro, longBreakEvery: Number(event.target.value) || 4 } })} />
          </Field>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <Button variant="primary" onClick={save} loading={updateSettings.isPending}>
            Save preferences
          </Button>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function NotificationsSection() {
  const user = useUser();
  const { refresh } = useAuth();
  const reminders = useReminders();
  const updateSettings = useUpdateSettings();
  const toast = useToast();
  const [form, setForm] = React.useState(user.settings.notifications);
  const [testing, setTesting] = React.useState(false);

  const save = (next: typeof form) => {
    setForm(next);
    updateSettings.mutate({ settings: { notifications: next } }, { onSuccess: () => void refresh() });
  };

  return (
    <>
      <Card className="card-pad space-y-4">
        <CardHeader
          title="Browser notifications"
          subtitle="Raised locally by this device. Nothing is sent to a push service."
          className="px-0 pt-0"
        />

        {!reminders.supported ? (
          <div className="rounded-xl border border-warning/25 bg-warning/[0.07] p-3 text-xs text-warning">
            This browser does not support notifications. Everything else still works.
          </div>
        ) : reminders.permission !== 'granted' ? (
          <div className="flex flex-col gap-3 rounded-xl border border-accent/25 bg-accent/[0.05] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted">
              {reminders.permission === 'denied'
                ? 'Notifications are blocked for this site. Re-enable them in your browser settings, then reload.'
                : 'Allow notifications so task and habit reminders can reach you.'}
            </div>
            {reminders.permission !== 'denied' && (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const result = await reminders.request();
                  if (result === 'granted') toast.success('Notifications enabled');
                  else toast.warning('Permission not granted');
                }}
              >
                Enable
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] p-3 text-xs text-success">
            <Check className="h-4 w-4" /> Notifications are allowed on this device.
          </div>
        )}

        <Switch
          checked={form.enabled}
          onChange={(value) => save({ ...form, enabled: value })}
          label="Enable reminders"
          description="Master switch for everything below."
        />
        <Switch
          checked={form.taskReminders}
          onChange={(value) => save({ ...form, taskReminders: value })}
          label="Task reminders"
          description="Fires at the lead time you set on each task."
          disabled={!form.enabled}
        />
        <Switch
          checked={form.habitReminders}
          onChange={(value) => save({ ...form, habitReminders: value })}
          label="Habit reminders"
          description="At each habit's reminder time, if it is not done yet."
          disabled={!form.enabled}
        />

      </Card>

      {/* ---------- fixed-time daily nudges ---------- */}
      <Card className="card-pad space-y-4">
        <CardHeader
          title="Daily schedule"
          subtitle="Fixed times each day. Each one fires once, and only for you."
          className="px-0 pt-0"
        />

        <div className="rounded-xl border border-accent/25 bg-accent/[0.05] p-3.5">
          <Switch
            checked={form.dailyAgenda}
            onChange={(value) => save({ ...form, dailyAgenda: value })}
            label="Morning agenda"
            description="One notification listing what is planned today, how many are high priority, and what to start with."
            disabled={!form.enabled}
          />
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-accent/20 pt-3">
            <Field label="Send at" className="w-32">
              <Input
                type="time"
                value={form.dailyAgendaTime ?? '10:00'}
                onChange={(event) => save({ ...form, dailyAgendaTime: event.target.value || null })}
                disabled={!form.enabled || !form.dailyAgenda}
              />
            </Field>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {['08:00', '09:00', '10:00', '18:00'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={!form.enabled || !form.dailyAgenda}
                  onClick={() => save({ ...form, dailyAgendaTime: preset })}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-2xs font-medium transition-colors disabled:opacity-50',
                    form.dailyAgendaTime === preset
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-line text-muted hover:bg-subtle',
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Unfinished important work"
            hint="Evening check on high-priority items still open. Empty turns it off."
          >
            <Input
              type="time"
              value={form.unfinishedImportantAt ?? ''}
              onChange={(event) => save({ ...form, unfinishedImportantAt: event.target.value || null })}
              disabled={!form.enabled}
            />
          </Field>
          <Field label="Daily review nudge" hint="Skipped automatically if the review is already written.">
            <Input
              type="time"
              value={form.dailyReviewTime ?? ''}
              onChange={(event) => save({ ...form, dailyReviewTime: event.target.value || null })}
              disabled={!form.enabled}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            variant="outline"
            size="sm"
            icon={<Bell className="h-4 w-4" />}
            loading={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const result = await reminders.sendTest();
                if (result === 'sent') toast.success('Sent', 'That is what your morning notification will look like.');
                else if (result === 'denied') toast.warning('Permission needed', 'Allow notifications above, then try again.');
                else toast.error('Not supported', 'This browser cannot show notifications.');
              } catch (err) {
                toast.error('Could not send', (err as Error).message);
              } finally {
                setTesting(false);
              }
            }}
          >
            Send a test notification
          </Button>
          <span className="text-2xs text-faint">Uses your real agenda for today.</span>
        </div>

        <div className="rounded-xl border border-line bg-subtle/40 p-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">When these can reach you</p>
          <ul className="mt-1.5 space-y-1 text-2xs leading-relaxed text-muted">
            <li>
              <strong className="text-ink">Phone —</strong> install TarangOS to your home screen and it can notify you
              even when the app is not in the foreground, as long as your phone can reach the server.
            </li>
            <li>
              <strong className="text-ink">Laptop —</strong> keep TarangOS open in a tab, or installed as an app.
            </li>
            <li>
              If the app was closed at the scheduled time, the notification still arrives the next time you open it —
              within 6 hours for the morning agenda, so you never get a “good morning” at midnight.
            </li>
            <li>There is no push server by design: your task titles never leave your own machine.</li>
          </ul>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

function SecuritySection() {
  const user = useUser();
  const { refresh, logout } = useAuth();
  const { data: sessionData } = useSessions();
  const { data: activityData } = useActivity(40);
  const { data: blockData } = useBlocks();
  const { release, releaseAll } = useBlockMutations();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [pinOpen, setPinOpen] = React.useState(false);
  const [totpOpen, setTotpOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const revokeOthers = async () => {
    const ok = await confirm({
      title: 'Sign out other devices?',
      message: 'Every other signed-in device will need to log in again. This device stays signed in.',
      confirmLabel: 'Sign them out',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST' });
      toast.success(`${pluralize(result.revoked, 'device')} signed out`);
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    } catch (err) {
      toast.error('Could not sign out other devices', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="card-pad space-y-4">
        <CardHeader title="Sign-in" className="px-0 pt-0" />

        <SecurityRow
          icon={<Key className="h-4 w-4" />}
          title="Password"
          description={`Last changed ${formatRelativeTime(user.passwordChangedAt)}`}
          action={<Button size="sm" variant="outline" onClick={() => setPasswordOpen(true)}>Change</Button>}
        />

        <SecurityRow
          icon={<Lock className="h-4 w-4" />}
          title="Quick PIN"
          description={user.hasPin ? 'Set — used to unlock after inactivity.' : 'Not set. Unlocking needs your full password.'}
          badge={user.hasPin ? <Badge tone="success">on</Badge> : undefined}
          action={<Button size="sm" variant="outline" onClick={() => setPinOpen(true)}>{user.hasPin ? 'Change or remove' : 'Set a PIN'}</Button>}
        />

        <SecurityRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Two-factor authentication"
          description={user.totpEnabled ? 'Required at every sign-in.' : 'Add a second factor from your authenticator app.'}
          badge={user.totpEnabled ? <Badge tone="success">enabled</Badge> : <Badge tone="warning">off</Badge>}
          action={<Button size="sm" variant={user.totpEnabled ? 'outline' : 'primary'} onClick={() => setTotpOpen(true)}>{user.totpEnabled ? 'Manage' : 'Enable'}</Button>}
        />
      </Card>

      <Card>
        <CardHeader
          title="Signed-in devices"
          subtitle={pluralize(sessionData?.sessions.length ?? 0, 'active session')}
          action={
            (sessionData?.sessions.length ?? 0) > 1 ? (
              <Button size="xs" variant="outline" onClick={revokeOthers} loading={busy}>
                Sign out others
              </Button>
            ) : undefined
          }
        />
        <div className="space-y-2 p-4 pt-3">
          {!sessionData ? (
            <Skeleton className="h-20" />
          ) : (
            sessionData.sessions.map((session) => (
              <div key={session.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted">
                  {/mobile|android|iphone|ipad/i.test(session.userAgent) ? <Smartphone className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-ink">{describeAgent(session.userAgent)}</span>
                    {session.current && <Badge tone="accent">this device</Badge>}
                    {session.locked && <Badge tone="warning">locked</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-2xs text-faint">
                    {session.ip || 'local'} · active {formatRelativeTime(session.lastSeenAt)}
                  </div>
                </div>
                {!session.current && (
                  <IconButton
                    label="Revoke"
                    size="sm"
                    onClick={async () => {
                      await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
                      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
                      toast.success('Device signed out');
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Blocked sources"
          subtitle="Devices temporarily shut out for abusive traffic. Blocks expire on their own."
          icon={<ShieldAlert className="h-4 w-4" />}
          action={
            (blockData?.blocks.length ?? 0) > 0 ? (
              <Button
                size="xs"
                variant="outline"
                loading={releaseAll.isPending}
                onClick={() =>
                  releaseAll.mutate(undefined, {
                    onSuccess: (r) => toast.success(`${pluralize(r.removed, 'block')} released`),
                  })
                }
              >
                Release all
              </Button>
            ) : undefined
          }
        />
        <div className="p-4 pt-3">
          {!blockData ? (
            <Skeleton className="h-16" />
          ) : blockData.blocks.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/[0.06] p-3 text-xs text-success">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Nothing is blocked right now.
            </div>
          ) : (
            <ul className="space-y-2">
              {blockData.blocks.map((block) => (
                <li key={block.ip} className="flex items-center gap-3 rounded-xl border border-danger/25 bg-danger/[0.04] p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                    <ShieldAlert className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-ink">{block.ip}</span>
                      <Badge tone="danger">{block.reason.replace(/_/g, ' ')}</Badge>
                      {block.strikes > 1 && <Badge tone="warning">strike {block.strikes}</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-2xs text-muted">
                      {pluralize(block.hits, 'attempt')} · released {formatRelativeTime(block.expiresAt).replace(' ago', '')} from now
                      {block.detail ? ` · ${block.detail}` : ''}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      release.mutate(block.ip, { onSuccess: () => toast.success('Released', block.ip) })
                    }
                  >
                    Release
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-2xs leading-relaxed text-faint">
            Repeated failed sign-ins, vulnerability scans and sustained rate-limit breaking all count toward a block,
            which escalates from 15 minutes up to 24 hours for repeat offenders and survives a restart. Requests from
            this machine itself are never blocked, so you cannot lock yourself out.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Security activity" subtitle="Sign-ins, lock events and data operations." />
        <div className="max-h-80 overflow-y-auto p-4 pt-3">
          {!activityData ? (
            <Skeleton className="h-32" />
          ) : activityData.activity.length === 0 ? (
            <EmptyState compact title="No activity recorded yet" />
          ) : (
            <ul className="space-y-1">
              {activityData.activity.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-xs">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', entry.ok ? 'bg-success' : 'bg-danger')} />
                  <span className="min-w-0 flex-1 truncate text-ink">{describeAction(entry.action)}</span>
                  {entry.detail && <span className="hidden shrink-0 truncate text-2xs text-faint sm:block">{entry.detail}</span>}
                  <span className="shrink-0 text-2xs text-faint">{formatRelativeTime(entry.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="card-pad">
        <CardHeader title="If you forget your password" className="px-0 pt-0" />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          There is deliberately no reset email and no recovery link — those would be the weakest point in a private,
          single-user system. Recovery happens on the machine that holds the database:
        </p>
        <pre className="mt-2.5 overflow-x-auto rounded-lg bg-subtle p-3 text-2xs text-ink">
{`npm run reset-admin -- --password "a new strong password"
npm run reset-admin -- --disable-2fa --clear-pin --clear-lockout`}
        </pre>
      </Card>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} hasPin={user.hasPin} />
      <TotpModal open={totpOpen} onClose={() => setTotpOpen(false)} enabled={user.totpEnabled} />
    </>
  );
}

function SecurityRow({
  icon,
  title,
  description,
  action,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{title}</span>
          {badge}
        </div>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirmValue, setConfirmValue] = React.useState('');
  const [signOutOthers, setSignOutOthers] = React.useState(true);
  const [error, setError] = React.useState<ApiError | Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirmValue('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (next !== confirmValue) {
      setError(new Error('The new passwords do not match'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ csrfToken: string }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next, signOutOthers },
        quiet: true,
      });
      setCsrfToken(result.csrfToken);
      await refresh();
      toast.success('Password changed');
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!current || !next}>
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
            <p>{error.message}</p>
            {error instanceof ApiError && error.problems.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
                {error.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Field label="Current password">
          <Input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="New password" hint="At least 12 characters with upper, lower, number and symbol.">
          <Input type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" error={confirmValue && next !== confirmValue ? 'Passwords do not match' : undefined}>
          <Input type="password" value={confirmValue} onChange={(event) => setConfirmValue(event.target.value)} autoComplete="new-password" />
        </Field>
        <Switch checked={signOutOthers} onChange={setSignOutOthers} label="Sign out other devices" />
      </div>
    </Modal>
  );
}

function PinModal({ open, onClose, hasPin }: { open: boolean; onClose: () => void; hasPin: boolean }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPassword('');
      setPin('');
      setError(null);
    }
  }, [open]);

  const submit = async (removePin: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/pin', { method: 'POST', body: { password, pin: removePin ? null : pin }, quiet: true });
      await refresh();
      toast.success(removePin ? 'PIN removed' : 'PIN set');
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hasPin ? 'Change quick PIN' : 'Set a quick PIN'}
      description="A short code to unlock after the inactivity lock. It never replaces your password at sign-in."
      size="sm"
      footer={
        <>
          {hasPin && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => submit(true)} disabled={!password || busy}>
              Remove PIN
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => submit(false)} loading={busy} disabled={!password || pin.length < 4}>
            Save PIN
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error.message}</div>}
        <Field label="Your password">
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="New PIN" hint="4–12 digits. Avoid repeated digits.">
          <Input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
        </Field>
      </div>
    </Modal>
  );
}

function TotpModal({ open, onClose, enabled }: { open: boolean; onClose: () => void; enabled: boolean }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [step, setStep] = React.useState<'password' | 'scan' | 'codes' | 'disable'>('password');
  const [password, setPassword] = React.useState('');
  const [secret, setSecret] = React.useState('');
  const [otpauth, setOtpauth] = React.useState('');
  const [code, setCode] = React.useState('');
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setStep(enabled ? 'disable' : 'password');
      setPassword('');
      setCode('');
      setSecret('');
      setRecoveryCodes([]);
      setError(null);
    }
  }, [open, enabled]);

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup', {
        method: 'POST',
        body: { password },
        quiet: true,
      });
      setSecret(result.secret);
      setOtpauth(result.otpauthUrl);
      setStep('scan');
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: { code }, quiet: true });
      setRecoveryCodes(result.recoveryCodes);
      setStep('codes');
      await refresh();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { password, code }, quiet: true });
      await refresh();
      toast.success('Two-factor authentication disabled');
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={enabled ? 'Two-factor authentication' : 'Enable two-factor authentication'}
      size="md"
      closeOnBackdrop={step !== 'codes'}
      footer={
        step === 'password' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={startSetup} loading={busy} disabled={!password}>Continue</Button>
          </>
        ) : step === 'scan' ? (
          <>
            <Button variant="ghost" onClick={() => setStep('password')}>Back</Button>
            <Button variant="primary" onClick={enable} loading={busy} disabled={code.length !== 6}>Verify and enable</Button>
          </>
        ) : step === 'codes' ? (
          <Button variant="primary" onClick={onClose}>I have saved them</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="danger" onClick={disable} loading={busy} disabled={!password || code.length !== 6}>Disable 2FA</Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error.message}</div>}

        {step === 'password' && (
          <>
            <p className="text-sm leading-relaxed text-muted">
              You will scan a code with an authenticator app (Google Authenticator, Aegis, 1Password, Bitwarden…). After
              this, sign-in needs your password <em>and</em> a rotating 6-digit code.
            </p>
            <Field label="Confirm your password">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus autoComplete="current-password" />
            </Field>
          </>
        )}

        {step === 'scan' && (
          <>
            <p className="text-sm text-muted">Add this secret to your authenticator app:</p>
            <div className="rounded-xl border border-line bg-subtle/50 p-4 text-center">
              <code className="select-all break-all font-mono text-sm tracking-wider text-ink">{secret}</code>
              <div className="mt-3 flex justify-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(secret);
                    toast.success('Secret copied');
                  }}
                >
                  Copy secret
                </Button>
                <a href={otpauth} className="inline-flex h-7 items-center rounded-lg border border-line px-2.5 text-xs font-medium text-muted transition-colors hover:bg-subtle">
                  Open in app
                </a>
              </div>
            </div>
            <Field label="Enter the current 6-digit code">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoFocus
                className="text-center font-mono text-lg tracking-[0.5em]"
                placeholder="000000"
              />
            </Field>
          </>
        )}

        {step === 'codes' && (
          <>
            <div className="rounded-xl border border-warning/30 bg-warning/[0.08] p-3 text-xs text-warning">
              Save these recovery codes somewhere safe. Each works once, and they are the only way in if you lose your
              authenticator. They will not be shown again.
            </div>
            <div className="grid grid-cols-2 gap-2">
              {recoveryCodes.map((recoveryCode) => (
                <code key={recoveryCode} className="select-all rounded-lg border border-line bg-subtle/50 px-3 py-2 text-center font-mono text-sm text-ink">
                  {recoveryCode}
                </code>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              icon={<Download className="h-4 w-4" />}
              onClick={() => {
                const blob = new Blob([`TarangOS recovery codes\n\n${recoveryCodes.join('\n')}\n`], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'tarangos-recovery-codes.txt';
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download as a text file
            </Button>
          </>
        )}

        {step === 'disable' && (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Turning 2FA off means your password alone protects the account. You will need your password and a current
              code to confirm.
            </p>
            <Field label="Password">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus autoComplete="current-password" />
            </Field>
            <Field label="Current authenticator code">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                className="text-center font-mono text-lg tracking-[0.5em]"
                placeholder="000000"
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Data & backups
// ---------------------------------------------------------------------------

function DataSection() {
  const { data: stats } = useDataStats();
  const { data: backupData } = useBackups();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const createBackup = async () => {
    setBusy('create');
    try {
      const result = await api<{ filename: string; size: number }>('/backup', { method: 'POST' });
      toast.success('Backup created', `${result.filename} · ${(result.size / 1024).toFixed(1)} KB`);
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error('Backup failed', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card className="card-pad">
        <CardHeader title="What you have stored" subtitle="Everything lives in a single SQLite file on this machine." className="px-0 pt-0" />
        {!stats ? (
          <Skeleton className="mt-3 h-24" />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <DataStat label="Tasks" value={stats.tasks} sub={`${stats.completedTasks} completed`} />
              <DataStat label="Projects" value={stats.projects} sub={`${stats.goals} goals`} />
              <DataStat label="Habits" value={stats.habits} sub={`${stats.habitEntries} check-ins`} />
              <DataStat label="Focus" value={formatDuration(stats.focusMinutes)} sub={`${stats.focusSessions} sessions`} />
              <DataStat label="Reviews" value={stats.reviews} />
              <DataStat label="Notes" value={stats.notes} />
              <DataStat label="History" value={`${stats.historyDays}d`} sub={stats.historyFrom ? `from ${formatDate(stats.historyFrom, 'short')}` : 'no data yet'} />
              <DataStat
                label="6-month goal"
                value={`${Math.min(100, Math.round((stats.historyDays / 182) * 100))}%`}
                sub="of the 6-month target"
              />
            </div>
            <Bar value={Math.min(1, stats.historyDays / 182)} height={5} className="mt-3" />
          </>
        )}
      </Card>

      <Card className="card-pad space-y-3">
        <CardHeader title="Export" subtitle="Take your data anywhere — no lock-in." className="px-0 pt-0" />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            icon={<Download className="h-4 w-4" />}
            onClick={() => download('/backup/export.json', 'tarangos-export.json')}
          >
            Full export (JSON)
          </Button>
          <Button
            variant="outline"
            icon={<Download className="h-4 w-4" />}
            onClick={() => download('/backup/export.csv', 'tarangos-tasks.csv')}
          >
            Tasks (CSV)
          </Button>
          <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
            Import
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Backups"
          subtitle={
            backupData
              ? `${backupData.autoDaily ? 'Automatic daily backups are on. ' : ''}Keeping the newest ${backupData.keep} of each kind.`
              : undefined
          }
          icon={<HardDrive className="h-4 w-4" />}
          action={
            <div className="flex gap-1.5">
              <Button size="xs" variant="outline" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => setRestoreOpen(true)}>
                Restore
              </Button>
              <Button size="xs" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={createBackup} loading={busy === 'create'}>
                Back up now
              </Button>
            </div>
          }
        />
        <div className="p-4 pt-3">
          {backupData?.directory && (
            <p className="mb-3 truncate rounded-lg bg-subtle px-3 py-2 font-mono text-2xs text-muted">{backupData.directory}</p>
          )}

          {!backupData ? (
            <Skeleton className="h-24" />
          ) : backupData.backups.length === 0 ? (
            <EmptyState compact title="No backups yet" description="Create one now, or wait for the automatic daily backup." />
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {backupData.backups.map((backup) => (
                <li key={backup.filename} className="group flex items-center gap-2.5 rounded-xl border border-line px-3 py-2">
                  <Badge tone={backup.kind === 'auto' ? 'neutral' : 'accent'}>{backup.kind}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-2xs text-ink">{backup.filename}</div>
                    <div className="text-2xs text-faint">
                      {(backup.size / 1024).toFixed(1)} KB · {formatRelativeTime(backup.createdAt)}
                    </div>
                  </div>
                  <IconButton label="Download" size="sm" onClick={() => download(`/backup/download/${backup.filename}`, backup.filename)}>
                    <Download className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="Delete"
                    size="sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this backup file?',
                        message: backup.filename,
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (!ok) return;
                      await api(`/backup/${backup.filename}`, { method: 'DELETE' });
                      queryClient.invalidateQueries({ queryKey: ['backups'] });
                      toast.success('Backup deleted');
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <RestoreModal open={restoreOpen} onClose={() => setRestoreOpen(false)} backups={backupData?.backups ?? []} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function DataStat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-2xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular text-ink">{value}</div>
      {sub && <div className="text-2xs text-faint">{sub}</div>}
    </div>
  );
}

function RestoreModal({
  open,
  onClose,
  backups,
}: {
  open: boolean;
  onClose: () => void;
  backups: { filename: string; createdAt: string; kind: string }[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filename, setFilename] = React.useState('');
  const [uploaded, setUploaded] = React.useState<unknown>(null);
  const [uploadName, setUploadName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [mode, setMode] = React.useState<'merge' | 'replace'>('merge');
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFilename(backups[0]?.filename ?? '');
      setUploaded(null);
      setUploadName('');
      setPassword('');
      setMode('merge');
      setError(null);
    }
  }, [open, backups]);

  const onFile = async (file: File) => {
    try {
      const text = await file.text();
      setUploaded(JSON.parse(text));
      setUploadName(file.name);
      setFilename('');
    } catch {
      setError(new Error('That file is not valid JSON'));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ restored: Record<string, number>; safetyBackup: string }>('/backup/restore', {
        method: 'POST',
        body: { password, mode, ...(uploaded ? { payload: uploaded } : { filename }) },
        quiet: true,
      });
      const total = Object.values(result.restored).reduce((sum, count) => sum + count, 0);
      toast.success(`${total} records restored`, `A safety backup was saved first: ${result.safetyBackup}`);
      queryClient.clear();
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Restore from a backup"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={!password || (!filename && !uploaded)}>
            Restore
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error.message}</div>}

        <Field label="Backup source">
          {backups.length > 0 && (
            <Select value={filename} onChange={(event) => { setFilename(event.target.value); setUploaded(null); setUploadName(''); }}>
              <option value="">Choose a saved backup…</option>
              {backups.map((backup) => (
                <option key={backup.filename} value={backup.filename}>
                  {backup.filename} ({backup.kind})
                </option>
              ))}
            </Select>
          )}
          <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-3 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent">
            <Upload className="h-4 w-4" />
            {uploadName || '…or upload a .json export from another machine'}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])}
            />
          </label>
        </Field>

        <Field label="How should it be applied?">
          <div className="space-y-2">
            <button
              onClick={() => setMode('merge')}
              className={cn('w-full rounded-xl border p-3 text-left transition-colors', mode === 'merge' ? 'border-accent bg-accent/[0.06]' : 'border-line hover:bg-subtle')}
            >
              <div className="text-sm font-medium text-ink">Merge</div>
              <div className="mt-0.5 text-xs text-muted">Adds records from the backup and keeps everything you have now.</div>
            </button>
            <button
              onClick={() => setMode('replace')}
              className={cn('w-full rounded-xl border p-3 text-left transition-colors', mode === 'replace' ? 'border-danger bg-danger/[0.06]' : 'border-line hover:bg-subtle')}
            >
              <div className="text-sm font-medium text-ink">Replace everything</div>
              <div className="mt-0.5 text-xs text-muted">
                Wipes current tasks, habits, notes and reviews first. A safety backup is taken automatically before this runs.
              </div>
            </button>
          </div>
        </Field>

        <Field label="Confirm with your password" hint="Restoring rewrites your data, so it needs authentication.">
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </Field>
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = React.useState('');
  const [error, setError] = React.useState<Error | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  React.useEffect(() => {
    if (open) {
      setCsv('');
      setError(null);
      setResult(null);
    }
  }, [open]);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ created: number; skipped: number; errors: string[] }>('/backup/import/csv', {
        method: 'POST',
        body: { csv, dryRun },
        quiet: true,
      });
      setResult(response);
      if (!dryRun) {
        toast.success(`${response.created} tasks imported`);
        queryClient.clear();
      }
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import tasks from CSV"
      description="The only required column is title. date, priority, status, category, project, tags, description and notes are all recognised."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={() => run(true)} loading={busy} disabled={!csv.trim()}>Preview</Button>
          <Button variant="primary" onClick={() => run(false)} loading={busy} disabled={!csv.trim()}>Import</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error.message}</div>}

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-3 text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent">
          <Upload className="h-4 w-4" />
          Choose a .csv file
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setCsv(await file.text());
            }}
          />
        </label>

        <Field label="…or paste CSV directly">
          <Textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            rows={7}
            className="font-mono text-2xs"
            placeholder={'title,date,priority\n"Write the report",2026-08-20,high'}
          />
        </Field>

        {result && (
          <div className="rounded-xl border border-line bg-subtle/50 p-3 text-xs">
            <p className="font-medium text-ink">
              {result.created} rows ready · {result.skipped} skipped
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-danger">
                {result.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function describeAgent(userAgent: string): string {
  if (!userAgent) return 'Unknown device';
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/chrome|crios/i.test(userAgent)) return 'Chrome';
  if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return userAgent.slice(0, 40);
}

function describeAction(action: string): string {
  const map: Record<string, string> = {
    'auth.login': 'Signed in',
    'auth.login.failed': 'Failed sign-in attempt',
    'auth.login.locked': 'Sign-in blocked (account locked)',
    'auth.logout': 'Signed out',
    'auth.lock': 'Session locked',
    'auth.unlock': 'Session unlocked',
    'auth.unlock.failed': 'Failed unlock attempt',
    'auth.password.changed': 'Password changed',
    'auth.password.failed': 'Wrong password entered',
    'auth.pin.set': 'Quick PIN set',
    'auth.pin.removed': 'Quick PIN removed',
    'auth.2fa.setup_started': 'Started 2FA setup',
    'auth.2fa.enabled': 'Two-factor authentication enabled',
    'auth.2fa.disabled': 'Two-factor authentication disabled',
    'auth.2fa.recovery_regenerated': 'Recovery codes regenerated',
    'auth.recovery_code.used': 'Recovery code used',
    'auth.session.revoked': 'Device signed out',
    'auth.sessions.revoked_all': 'All other devices signed out',
    'auth.bootstrap': 'Account created',
    'auth.cli_recovery': 'Credentials recovered from the command line',
    'backup.created': 'Backup created',
    'backup.downloaded': 'Backup downloaded',
    'backup.deleted': 'Backup deleted',
    'backup.restored': 'Data restored from backup',
    'backup.restore.denied': 'Restore refused (wrong password)',
    'data.exported': 'Data exported',
    'data.imported': 'Data imported',
    'task.bulk_delete': 'Tasks bulk-deleted',
    'task.delete_series': 'Recurring series deleted',
  };
  return map[action] ?? action;
}
