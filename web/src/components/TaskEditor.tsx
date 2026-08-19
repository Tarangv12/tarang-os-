import * as React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button, Field, IconButton, Input, Select, Switch, Textarea, Checkbox } from './ui/primitives';
import { useToast } from './ui/Toast';
import { useCategories, useGoals, useProjects, useTaskMutations } from '@/lib/queries';
import type { RecurrenceRule, Task } from '@/lib/types';
import { addDays, cn, todayStr } from '@/lib/utils';

/** Full create/edit form. Every field here maps to a real column the app uses. */

type FormState = {
  title: string;
  description: string;
  notes: string;
  date: string;
  startTime: string;
  dueTime: string;
  priority: string;
  energy: string;
  estimatedMinutes: string;
  categoryId: string;
  projectId: string;
  goalId: string;
  reminderMinutesBefore: string;
  pinned: boolean;
  tags: string;
  subtasks: { id?: string; title: string; done: boolean }[];
  repeats: boolean;
  recurrence: RecurrenceRule;
};

const EMPTY_RECURRENCE: RecurrenceRule = { freq: 'daily', interval: 1, byWeekday: [], until: null };

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toForm(task: Task | null, defaults: { date: string; priority: string }): FormState {
  if (!task) {
    return {
      title: '',
      description: '',
      notes: '',
      date: defaults.date,
      startTime: '',
      dueTime: '',
      priority: defaults.priority,
      energy: 'medium',
      estimatedMinutes: '',
      categoryId: '',
      projectId: '',
      goalId: '',
      reminderMinutesBefore: '',
      pinned: false,
      tags: '',
      subtasks: [],
      repeats: false,
      recurrence: { ...EMPTY_RECURRENCE },
    };
  }
  return {
    title: task.title,
    description: task.description,
    notes: task.notes,
    date: task.date,
    startTime: task.startTime ?? '',
    dueTime: task.dueTime ?? '',
    priority: task.priority,
    energy: task.energy,
    estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : '',
    categoryId: task.categoryId ?? '',
    projectId: task.projectId ?? '',
    goalId: task.goalId ?? '',
    reminderMinutesBefore: task.reminderMinutesBefore !== null ? String(task.reminderMinutesBefore) : '',
    pinned: task.pinned,
    tags: task.tags.map((tag) => tag.name).join(', '),
    subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done })),
    repeats: Boolean(task.recurrence),
    recurrence: task.recurrence ?? { ...EMPTY_RECURRENCE },
  };
}

export function TaskEditor({
  open,
  onClose,
  task,
  defaultDate,
  defaultProjectId,
  defaultGoalId,
}: {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  defaultDate?: string;
  defaultProjectId?: string;
  defaultGoalId?: string;
}) {
  const toast = useToast();
  const { create, update } = useTaskMutations();
  const { data: categoryData } = useCategories();
  const { data: projectData } = useProjects();
  const { data: goalData } = useGoals({ status: 'active' });

  const [form, setForm] = React.useState<FormState>(() =>
    toForm(task, { date: defaultDate ?? todayStr(), priority: 'medium' }),
  );
  const [error, setError] = React.useState<string | null>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const next = toForm(task, { date: defaultDate ?? todayStr(), priority: 'medium' });
    if (!task) {
      if (defaultProjectId) next.projectId = defaultProjectId;
      if (defaultGoalId) next.goalId = defaultGoalId;
    }
    setForm(next);
    setError(null);
  }, [open, task, defaultDate, defaultProjectId, defaultGoalId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const busy = create.isPending || update.isPending;

  const submit = () => {
    if (!form.title.trim()) {
      setError('Give the task a title');
      titleRef.current?.focus();
      return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      notes: form.notes,
      date: form.date,
      startTime: form.startTime || null,
      dueTime: form.dueTime || null,
      priority: form.priority,
      energy: form.energy,
      estimatedMinutes: Number(form.estimatedMinutes) || 0,
      categoryId: form.categoryId || null,
      projectId: form.projectId || null,
      goalId: form.goalId || null,
      reminderMinutesBefore: form.reminderMinutesBefore === '' ? null : Number(form.reminderMinutesBefore),
      pinned: form.pinned,
      tags: form.tags
        .split(/[,\s]+/)
        .map((tag) => tag.replace(/^#/, '').trim())
        .filter(Boolean),
      subtasks: form.subtasks.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), done: s.done })),
      recurrence: form.repeats
        ? {
            ...form.recurrence,
            interval: Math.max(1, Number(form.recurrence.interval) || 1),
            byWeekday: form.recurrence.freq === 'weekly' ? form.recurrence.byWeekday ?? [] : undefined,
          }
        : null,
    };

    const onSuccess = () => {
      toast.success(task ? 'Task updated' : 'Task created', payload.title);
      onClose();
    };
    const onError = (err: unknown) => setError((err as Error).message);

    if (task) update.mutate({ id: task.id, ...payload }, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  };

  const toggleWeekday = (day: number) => {
    const current = form.recurrence.byWeekday ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    set('recurrence', { ...form.recurrence, byWeekday: next });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      size="lg"
      initialFocus={titleRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error}</div>
        )}

        <Field label="Title" required>
          <Input
            ref={titleRef}
            value={form.title}
            onChange={(event) => set('title', event.target.value)}
            placeholder="What needs to happen?"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
            }}
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder="Any detail that helps you start faster"
            rows={2}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={(event) => set('date', event.target.value)} />
          </Field>
          <Field label="Start time">
            <Input type="time" value={form.startTime} onChange={(event) => set('startTime', event.target.value)} />
          </Field>
          <Field label="Due time">
            <Input type="time" value={form.dueTime} onChange={(event) => set('dueTime', event.target.value)} />
          </Field>
          <Field label="Estimate (min)">
            <Input
              type="number"
              min={0}
              max={1440}
              value={form.estimatedMinutes}
              onChange={(event) => set('estimatedMinutes', event.target.value)}
              placeholder="30"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'Today', date: todayStr() },
            { label: 'Tomorrow', date: addDays(todayStr(), 1) },
            { label: 'In 3 days', date: addDays(todayStr(), 3) },
            { label: 'Next week', date: addDays(todayStr(), 7) },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => set('date', option.date)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-2xs font-medium transition-colors',
                form.date === option.date
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-line text-muted hover:bg-subtle',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Priority">
            <Select value={form.priority} onChange={(event) => set('priority', event.target.value)}>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Energy needed">
            <Select value={form.energy} onChange={(event) => set('energy', event.target.value)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Remind me">
            <Select
              value={form.reminderMinutesBefore}
              onChange={(event) => set('reminderMinutesBefore', event.target.value)}
            >
              <option value="">No reminder</option>
              <option value="0">At start time</option>
              <option value="5">5 min before</option>
              <option value="10">10 min before</option>
              <option value="30">30 min before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Category">
            <Select value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>
              <option value="">None</option>
              {categoryData?.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={form.projectId} onChange={(event) => set('projectId', event.target.value)}>
              <option value="">None</option>
              {projectData?.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Goal">
            <Select value={form.goalId} onChange={(event) => set('goalId', event.target.value)}>
              <option value="">None</option>
              {goalData?.goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Tags" hint="Comma separated, e.g. health, deep-work">
          <Input value={form.tags} onChange={(event) => set('tags', event.target.value)} placeholder="health, admin" />
        </Field>

        {/* --- subtasks --- */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Subtasks</span>
            <Button
              size="xs"
              variant="ghost"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => set('subtasks', [...form.subtasks, { title: '', done: false }])}
            >
              Add
            </Button>
          </div>
          {form.subtasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-xs text-faint">
              Break a big task into steps so it is easier to start.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {form.subtasks.map((subtask, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Checkbox
                    checked={subtask.done}
                    onChange={(checked) => {
                      const next = [...form.subtasks];
                      next[index] = { ...next[index], done: checked };
                      set('subtasks', next);
                    }}
                  />
                  <Input
                    value={subtask.title}
                    onChange={(event) => {
                      const next = [...form.subtasks];
                      next[index] = { ...next[index], title: event.target.value };
                      set('subtasks', next);
                    }}
                    placeholder={`Step ${index + 1}`}
                    className="h-9 flex-1"
                  />
                  <IconButton
                    label="Remove step"
                    size="sm"
                    onClick={() => set('subtasks', form.subtasks.filter((_, i) => i !== index))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- recurrence --- */}
        <div className="rounded-xl border border-line p-3">
          <Switch
            checked={form.repeats}
            onChange={(checked) => set('repeats', checked)}
            label="Repeat this task"
            description="Future occurrences are created automatically, and each one can be edited on its own."
          />

          {form.repeats && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Frequency">
                  <Select
                    value={form.recurrence.freq}
                    onChange={(event) =>
                      set('recurrence', { ...form.recurrence, freq: event.target.value as RecurrenceRule['freq'] })
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekdays">Every weekday</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </Select>
                </Field>
                {form.recurrence.freq !== 'weekdays' && (
                  <Field label="Every">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={form.recurrence.interval}
                      onChange={(event) =>
                        set('recurrence', { ...form.recurrence, interval: Number(event.target.value) || 1 })
                      }
                    />
                  </Field>
                )}
              </div>

              {form.recurrence.freq === 'weekly' && (
                <Field label="On these days">
                  <div className="flex gap-1.5">
                    {WEEKDAY_LABELS.map((label, day) => {
                      const active = (form.recurrence.byWeekday ?? []).includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleWeekday(day)}
                          className={cn(
                            'h-8 w-8 rounded-lg border text-xs font-medium transition-colors',
                            active ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted hover:bg-subtle',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}

              <Field label="Repeat until" hint="Leave empty to repeat indefinitely">
                <Input
                  type="date"
                  value={form.recurrence.until ?? ''}
                  onChange={(event) => set('recurrence', { ...form.recurrence, until: event.target.value || null })}
                />
              </Field>
            </div>
          )}
        </div>

        <Field label="Notes">
          <Textarea
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Scratch space — links, context, anything"
            rows={3}
          />
        </Field>

        <Switch checked={form.pinned} onChange={(checked) => set('pinned', checked)} label="Pin to the top of the day" />
      </div>
    </Modal>
  );
}
