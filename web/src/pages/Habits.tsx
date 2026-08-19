import * as React from 'react';
import { Archive, Check, Flame, MoreHorizontal, Pencil, Plus, Trash2, TrendingUp } from 'lucide-react';
import { useHabitMutations, useHabits } from '@/lib/queries';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input, PageHeader, Progress, Select,
  Skeleton, StatTile, Textarea,
} from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { addDays, cn, eachDay, formatDate, formatTime, percent, pluralize, todayStr, weekdayOf } from '@/lib/utils';
import { useUser } from '@/state/auth';
import type { Habit } from '@/lib/types';

const COLORS = ['#10b981', '#6366f1', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function Habits() {
  const user = useUser();
  const today = todayStr(user.timezone);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Habit | null>(null);
  const [detail, setDetail] = React.useState<Habit | null>(null);

  const { data, isLoading } = useHabits(180);
  const { check, remove, update } = useHabitMutations();
  const confirm = useConfirm();
  const toast = useToast();

  const habits = data?.habits ?? [];
  const doneToday = habits.filter((habit) => habit.doneToday).length;
  const bestStreak = habits.reduce((max, habit) => Math.max(max, habit.bestStreak), 0);
  const activeStreaks = habits.filter((habit) => habit.currentStreak > 0).length;

  const deleteHabit = async (habit: Habit) => {
    const ok = await confirm({
      title: `Delete "${habit.name}"?`,
      message: 'The habit and its entire check-in history will be permanently removed. Archiving keeps the history instead.',
      confirmLabel: 'Delete habit',
      danger: true,
    });
    if (!ok) return;
    remove.mutate(habit.id, { onSuccess: () => toast.success('Habit deleted', habit.name) });
  };

  return (
    <div>
      <PageHeader
        title="Habits"
        description="The repetitions that quietly compound over months."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
            New habit
          </Button>
        }
      />

      {habits.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Done today" value={`${doneToday}/${habits.length}`} icon={<Check className="h-3.5 w-3.5" />} tone="success" />
          <StatTile label="Active streaks" value={activeStreaks} sublabel="habits going" icon={<Flame className="h-3.5 w-3.5" />} tone="warning" />
          <StatTile label="Best streak" value={`${bestStreak}d`} sublabel="all time" icon={<TrendingUp className="h-3.5 w-3.5" />} tone="accent" />
          <StatTile
            label="Consistency"
            value={percent(habits.reduce((sum, habit) => sum + habit.completionRate, 0) / Math.max(habits.length, 1))}
            sublabel="last 6 months"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            tone="info"
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : habits.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Flame className="h-5 w-5" />}
            title="No habits yet"
            description="Pick one small thing you want to be true most days. Habits count toward your daily score and drive the consistency component."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
                Create your first habit
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {habits.map((habit) => (
            <Card key={habit.id} className="p-4">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => check.mutate({ id: habit.id })}
                  aria-label={habit.doneToday ? `Undo ${habit.name}` : `Mark ${habit.name} done`}
                  className={cn(
                    'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border-2 transition-all active:scale-95',
                    habit.doneToday ? 'text-white' : 'border-line text-faint hover:border-current',
                  )}
                  style={
                    habit.doneToday
                      ? { background: habit.color, borderColor: habit.color }
                      : { color: habit.color, borderColor: `${habit.color}55` }
                  }
                >
                  <Check className={cn('h-5 w-5 transition-transform', habit.doneToday && 'animate-pop-check')} />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button onClick={() => setDetail(habit)} className="text-left">
                        <h3 className="truncate text-sm font-semibold text-ink">{habit.name}</h3>
                      </button>
                      {habit.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{habit.description}</p>}
                    </div>

                    <Dropdown
                      items={[
                        { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => { setEditing(habit); setEditorOpen(true); } },
                        { label: 'View history', icon: <TrendingUp className="h-4 w-4" />, onSelect: () => setDetail(habit) },
                        {
                          label: habit.archivedAt ? 'Restore' : 'Archive',
                          icon: <Archive className="h-4 w-4" />,
                          onSelect: () => update.mutate({ id: habit.id, archived: !habit.archivedAt }),
                        },
                        { type: 'separator' },
                        { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => void deleteHabit(habit), danger: true },
                      ]}
                      trigger={({ toggle, ref }) => (
                        <IconButton ref={ref} label="Habit actions" size="sm" onClick={toggle}>
                          <MoreHorizontal className="h-4 w-4" />
                        </IconButton>
                      )}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={habit.currentStreak > 0 ? 'warning' : 'neutral'}>
                      <Flame className="h-3 w-3" /> {habit.currentStreak} day streak
                    </Badge>
                    <Badge tone="neutral">best {habit.bestStreak}</Badge>
                    <Badge tone="neutral">{percent(habit.completionRate)} kept</Badge>
                    <Badge tone="neutral">{habit.cadence === 'weekly' ? `${habit.thisWeek}/${habit.targetPerWeek} this week` : `${habit.thisWeek}/7 this week`}</Badge>
                    {habit.reminderTime && <Badge tone="info">{formatTime(habit.reminderTime)}</Badge>}
                  </div>

                  {/* last 8 weeks strip */}
                  <div className="mt-3">
                    <HabitStrip habit={habit} today={today} onToggle={(date) => check.mutate({ id: habit.id, date })} />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <HabitEditor open={editorOpen} onClose={() => setEditorOpen(false)} habit={editing} />
      <HabitDetail habit={detail} today={today} onClose={() => setDetail(null)} onToggle={(id, date) => check.mutate({ id, date })} />
    </div>
  );
}

/** Compact 8-week grid, newest week on the right. */
function HabitStrip({ habit, today, onToggle }: { habit: Habit; today: string; onToggle: (date: string) => void }) {
  const doneDates = React.useMemo(
    () => new Set(habit.history.filter((entry) => entry.done).map((entry) => entry.date)),
    [habit.history],
  );

  const days = React.useMemo(() => {
    const start = addDays(today, -55);
    const offset = (weekdayOf(start) + 6) % 7;
    return eachDay(addDays(start, -offset), today);
  }, [today]);

  return (
    <div className="flex flex-wrap gap-[3px]">
      {days.map((date) => {
        const done = doneDates.has(date);
        const future = date > today;
        return (
          <button
            key={date}
            disabled={future}
            onClick={() => onToggle(date)}
            title={`${formatDate(date, 'medium')} — ${done ? 'done' : 'not done'}`}
            className={cn(
              'h-[11px] w-[11px] rounded-[3px] transition-transform',
              done ? 'hover:scale-125' : 'bg-subtle hover:scale-125',
              future && 'cursor-not-allowed opacity-30',
              date === today && 'ring-1 ring-accent ring-offset-1 ring-offset-surface',
            )}
            style={done ? { background: habit.color } : undefined}
            aria-label={`${date} ${done ? 'done' : 'not done'}`}
          />
        );
      })}
    </div>
  );
}

function HabitDetail({
  habit,
  today,
  onClose,
  onToggle,
}: {
  habit: Habit | null;
  today: string;
  onClose: () => void;
  onToggle: (id: string, date: string) => void;
}) {
  if (!habit) return null;

  const doneDates = new Set(habit.history.filter((entry) => entry.done).map((entry) => entry.date));
  const months: { key: string; days: string[] }[] = [];
  const start = addDays(today, -179);
  for (const date of eachDay(start, today)) {
    const key = date.slice(0, 7);
    const bucket = months.find((month) => month.key === key);
    if (bucket) bucket.days.push(date);
    else months.push({ key, days: [date] });
  }

  return (
    <Modal open={Boolean(habit)} onClose={onClose} title={habit.name} description={habit.description || undefined} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Current streak" value={`${habit.currentStreak}d`} tone="warning" icon={<Flame className="h-3.5 w-3.5" />} />
          <StatTile label="Best streak" value={`${habit.bestStreak}d`} tone="accent" />
          <StatTile label="Total kept" value={habit.totalDone} sublabel={`of ${habit.possibleDays} days`} tone="success" />
          <StatTile label="Rate" value={percent(habit.completionRate)} tone="info" />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Last 6 months</span>
            <span className="text-2xs text-faint">Click a day to toggle it</span>
          </div>
          <div className="space-y-3">
            {months.map((month) => (
              <div key={month.key}>
                <div className="mb-1 text-2xs font-medium text-faint">
                  {new Date(`${month.key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </div>
                <div className="flex flex-wrap gap-[3px]">
                  {month.days.map((date) => {
                    const done = doneDates.has(date);
                    return (
                      <button
                        key={date}
                        onClick={() => onToggle(habit.id, date)}
                        title={formatDate(date, 'medium')}
                        className={cn(
                          'h-[14px] w-[14px] rounded-[3px] transition-transform hover:scale-125',
                          !done && 'bg-subtle',
                          date === today && 'ring-1 ring-accent ring-offset-1 ring-offset-surface',
                        )}
                        style={done ? { background: habit.color } : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted">This week</span>
            <span className="tabular text-ink">{habit.thisWeek}/{habit.weekTarget}</span>
          </div>
          <Progress value={habit.thisWeek / Math.max(habit.weekTarget, 1)} color={habit.color} height={6} />
        </div>
      </div>
    </Modal>
  );
}

function HabitEditor({ open, onClose, habit }: { open: boolean; onClose: () => void; habit: Habit | null }) {
  const { create, update } = useHabitMutations();
  const toast = useToast();
  const [form, setForm] = React.useState({
    name: '', description: '', cadence: 'daily', targetPerWeek: '7', reminderTime: '', color: COLORS[0],
  });
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      name: habit?.name ?? '',
      description: habit?.description ?? '',
      cadence: habit?.cadence ?? 'daily',
      targetPerWeek: String(habit?.targetPerWeek ?? 7),
      reminderTime: habit?.reminderTime ?? '',
      color: habit?.color ?? COLORS[0],
    });
    setError(null);
  }, [open, habit]);

  const submit = () => {
    if (!form.name.trim()) {
      setError('Give the habit a name');
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      cadence: form.cadence,
      targetPerWeek: Number(form.targetPerWeek) || 7,
      reminderTime: form.reminderTime || null,
      color: form.color,
    };
    const onSuccess = () => {
      toast.success(habit ? 'Habit updated' : 'Habit created', payload.name);
      onClose();
    };
    const onError = (err: unknown) => setError((err as Error).message);

    if (habit) update.mutate({ id: habit.id, ...payload }, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={habit ? 'Edit habit' : 'New habit'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || update.isPending}>
            {habit ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <Field label="Name" required>
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Read 20 pages" autoFocus />
        </Field>

        <Field label="Note to self">
          <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} placeholder="Why this matters, or how to make it easy" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cadence">
            <Select value={form.cadence} onChange={(event) => setForm({ ...form, cadence: event.target.value })}>
              <option value="daily">Every day</option>
              <option value="weekly">A few times a week</option>
            </Select>
          </Field>
          {form.cadence === 'weekly' && (
            <Field label="Times per week">
              <Select value={form.targetPerWeek} onChange={(event) => setForm({ ...form, targetPerWeek: event.target.value })}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}×</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Reminder" hint="Needs notifications enabled">
            <Input type="time" value={form.reminderTime} onChange={(event) => setForm({ ...form, reminderTime: event.target.value })} />
          </Field>
        </div>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setForm({ ...form, color })}
                className={cn('h-8 w-8 rounded-lg border-2 transition-transform hover:scale-110', form.color === color ? 'border-ink' : 'border-transparent')}
                style={{ background: color }}
                aria-label={color}
              />
            ))}
          </div>
        </Field>

        <p className="text-2xs leading-relaxed text-faint">
          Daily habits count toward the habits component of your productivity score. Habits created today do not
          retroactively penalise earlier days.
        </p>
      </div>
    </Modal>
  );
}
