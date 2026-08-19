import * as React from 'react';
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { useGoalMutations, useGoals, useProjects } from '@/lib/queries';
import {
  Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, PageHeader, Progress,
  ProgressRing, SegmentedControl, Select, Skeleton, Textarea,
} from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { cn, formatDate, percent, pluralize } from '@/lib/utils';
import type { Goal } from '@/lib/types';

const COLORS = ['#8b5cf6', '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

const TYPE_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  longterm: 'Long term',
};

export default function Goals() {
  const [status, setStatus] = React.useState<'active' | 'done' | 'all'>('active');
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Goal | null>(null);

  const { data, isLoading } = useGoals(status === 'all' ? {} : { status });
  const { update, remove, updateMilestone, addMilestone, removeMilestone } = useGoalMutations();
  const confirm = useConfirm();
  const toast = useToast();

  const goals = data?.goals ?? [];

  const deleteGoal = async (goal: Goal) => {
    const ok = await confirm({
      title: `Delete "${goal.title}"?`,
      message: 'The goal and its milestones will be removed. Linked tasks are kept.',
      confirmLabel: 'Delete goal',
      danger: true,
    });
    if (!ok) return;
    remove.mutate(goal.id, { onSuccess: () => toast.success('Goal deleted', goal.title) });
  };

  return (
    <div>
      <PageHeader
        title="Goals"
        description="The outcomes your daily tasks are supposed to add up to."
        actions={
          <>
            <SegmentedControl
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'done', label: 'Achieved' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
              New goal
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title={status === 'done' ? 'No achieved goals yet' : 'No goals set'}
            description="A goal with milestones turns a vague intention into something you can actually track week to week."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
                Set a goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {goals.map((goal) => (
            <Card key={goal.id} className="flex flex-col p-4">
              <div className="flex items-start gap-4">
                <ProgressRing value={goal.progress} size={72} stroke={7} color={goal.color}>
                  <span className="text-sm font-semibold tabular text-ink">{Math.round(goal.progress * 100)}%</span>
                </ProgressRing>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={cn('text-sm font-semibold text-ink', goal.status === 'done' && 'line-through opacity-70')}>
                      {goal.title}
                    </h3>
                    <Dropdown
                      items={[
                        { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => { setEditing(goal); setEditorOpen(true); } },
                        {
                          label: goal.status === 'done' ? 'Mark as active' : 'Mark as achieved',
                          icon: <CheckCircle2 className="h-4 w-4" />,
                          onSelect: () => update.mutate({ id: goal.id, status: goal.status === 'done' ? 'active' : 'done' }),
                        },
                        { type: 'separator' },
                        { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => void deleteGoal(goal), danger: true },
                      ]}
                      trigger={({ toggle, ref }) => (
                        <IconButton ref={ref} label="Goal actions" size="sm" onClick={toggle}>
                          <MoreHorizontal className="h-4 w-4" />
                        </IconButton>
                      )}
                    />
                  </div>

                  {goal.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{goal.description}</p>}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{TYPE_LABEL[goal.type] ?? goal.type}</Badge>
                    {goal.project && <Badge dot={goal.project.color}>{goal.project.name}</Badge>}
                    {goal.status === 'done' ? (
                      <Badge tone="success">achieved</Badge>
                    ) : goal.daysLeft !== null ? (
                      <Badge tone={goal.overdue ? 'danger' : goal.daysLeft <= 7 ? 'warning' : 'neutral'}>
                        {goal.overdue ? `${Math.abs(goal.daysLeft)} days over` : `${goal.daysLeft} days left`}
                      </Badge>
                    ) : null}
                    {goal.taskCount > 0 && (
                      <Badge tone="neutral">{goal.tasksDone}/{goal.taskCount} tasks</Badge>
                    )}
                  </div>
                </div>
              </div>

              {goal.metricType === 'numeric' && goal.targetValue > 0 && (
                <div className="mt-3 rounded-xl border border-line p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted">Progress</span>
                    <span className="tabular text-ink">
                      {goal.currentValue} / {goal.targetValue} {goal.unit}
                    </span>
                  </div>
                  <Progress value={goal.progress} color={goal.color} height={6} />
                  <div className="mt-2 flex gap-1.5">
                    {[1, 5, 10].map((step) => (
                      <Button
                        key={step}
                        size="xs"
                        variant="outline"
                        onClick={() => update.mutate({ id: goal.id, currentValue: Math.min(goal.targetValue, goal.currentValue + step) })}
                      >
                        +{step}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* milestones */}
              <div className="mt-3 flex-1">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-faint">
                    Milestones {goal.milestoneCount > 0 && `(${goal.milestonesDone}/${goal.milestoneCount})`}
                  </span>
                  <MilestoneAdder goalId={goal.id} onAdd={(title) => addMilestone.mutate({ goalId: goal.id, title })} />
                </div>

                {goal.milestones.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-2.5 py-2 text-2xs text-faint">
                    Break the goal into checkpoints so progress is visible before the finish line.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {goal.milestones.map((milestone) => (
                      <li key={milestone.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-subtle">
                        <Checkbox
                          checked={milestone.done}
                          onChange={(checked) => updateMilestone.mutate({ goalId: goal.id, id: milestone.id, done: checked })}
                          label={
                            <span className={cn('text-xs', milestone.done ? 'text-faint line-through' : 'text-ink')}>
                              {milestone.title}
                            </span>
                          }
                        />
                        {milestone.targetDate && (
                          <span className="ml-auto shrink-0 text-2xs text-faint">{formatDate(milestone.targetDate, 'short')}</span>
                        )}
                        <IconButton
                          label="Remove milestone"
                          size="sm"
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => removeMilestone.mutate({ goalId: goal.id, id: milestone.id })}
                        >
                          <X className="h-3 w-3" />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <GoalEditor open={editorOpen} onClose={() => setEditorOpen(false)} goal={editing} />
    </div>
  );
}

function MilestoneAdder({ goalId, onAdd }: { goalId: string; onAdd: (title: string) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState('');

  if (!adding) {
    return (
      <button onClick={() => setAdding(true)} className="text-2xs font-medium text-accent transition-colors hover:underline">
        + Add
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && title.trim()) {
            onAdd(title.trim());
            setTitle('');
            setAdding(false);
          }
          if (event.key === 'Escape') setAdding(false);
        }}
        onBlur={() => {
          if (title.trim()) onAdd(title.trim());
          setTitle('');
          setAdding(false);
        }}
        placeholder="Milestone…"
        className="h-6 w-36 rounded border border-line bg-surface px-1.5 text-2xs text-ink outline-none focus:border-accent"
      />
    </span>
  );
}

function GoalEditor({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Goal | null }) {
  const { create, update } = useGoalMutations();
  const { data: projectData } = useProjects();
  const toast = useToast();
  const [form, setForm] = React.useState({
    title: '', description: '', type: 'monthly', metricType: 'milestones',
    targetValue: '', currentValue: '', unit: '', startDate: '', targetDate: '',
    projectId: '', color: COLORS[0],
  });
  const [milestones, setMilestones] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      title: goal?.title ?? '',
      description: goal?.description ?? '',
      type: goal?.type ?? 'monthly',
      metricType: goal?.metricType ?? 'milestones',
      targetValue: goal?.targetValue ? String(goal.targetValue) : '',
      currentValue: goal?.currentValue ? String(goal.currentValue) : '',
      unit: goal?.unit ?? '',
      startDate: goal?.startDate ?? '',
      targetDate: goal?.targetDate ?? '',
      projectId: goal?.projectId ?? '',
      color: goal?.color ?? COLORS[0],
    });
    setMilestones([]);
    setError(null);
  }, [open, goal]);

  const submit = () => {
    if (!form.title.trim()) {
      setError('Give the goal a title');
      return;
    }
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim(),
      type: form.type,
      metricType: form.metricType,
      targetValue: Number(form.targetValue) || 0,
      currentValue: Number(form.currentValue) || 0,
      unit: form.unit.trim(),
      startDate: form.startDate || null,
      targetDate: form.targetDate || null,
      projectId: form.projectId || null,
      color: form.color,
    };
    if (!goal && milestones.filter(Boolean).length) {
      payload.milestones = milestones.filter((title) => title.trim()).map((title) => ({ title: title.trim() }));
    }

    const onSuccess = () => {
      toast.success(goal ? 'Goal updated' : 'Goal created', form.title);
      onClose();
    };
    const onError = (err: unknown) => setError((err as Error).message);

    if (goal) update.mutate({ id: goal.id, ...payload }, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={goal ? 'Edit goal' : 'New goal'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || update.isPending}>
            {goal ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <Field label="Title" required>
          <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Ship TarangOS v1" autoFocus />
        </Field>

        <Field label="Why it matters">
          <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Horizon">
            <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Measured by">
            <Select value={form.metricType} onChange={(event) => setForm({ ...form, metricType: event.target.value })}>
              <option value="milestones">Milestones</option>
              <option value="tasks">Linked tasks</option>
              <option value="numeric">A number</option>
            </Select>
          </Field>
        </div>

        {form.metricType === 'numeric' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Current">
              <Input type="number" value={form.currentValue} onChange={(event) => setForm({ ...form, currentValue: event.target.value })} />
            </Field>
            <Field label="Target">
              <Input type="number" value={form.targetValue} onChange={(event) => setForm({ ...form, targetValue: event.target.value })} />
            </Field>
            <Field label="Unit">
              <Input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="pages" />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
          </Field>
          <Field label="Target date">
            <Input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} />
          </Field>
        </div>

        <Field label="Link to project">
          <Select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
            <option value="">None</option>
            {projectData?.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </Select>
        </Field>

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

        {!goal && (
          <Field label="Starting milestones" hint="You can add more later.">
            <div className="space-y-1.5">
              {[...milestones, ''].map((value, index) => (
                <Input
                  key={index}
                  value={value}
                  placeholder={`Milestone ${index + 1}`}
                  onChange={(event) => {
                    const next = [...milestones];
                    next[index] = event.target.value;
                    setMilestones(next.filter((_, i) => i <= index || next[i] !== ''));
                  }}
                  className="h-9"
                />
              ))}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
