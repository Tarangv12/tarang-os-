import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ChevronRight, Clock, Flame, Focus,
  Info, ListTodo, NotebookPen, Plus, Sparkles, Target, TrendingDown, TrendingUp, Wand2, Zap,
} from 'lucide-react';
import { useDashboard, useHabitMutations, usePlanMyDay } from '@/lib/queries';
import { useTaskActions } from '@/hooks/useTaskActions';
import { TaskItem } from '@/components/TaskItem';
import { Button, Card, CardHeader, EmptyState, IconButton, Progress, ProgressRing, Skeleton, StatTile, Tooltip } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { CompletionTrend } from '@/components/charts';
import { cn, formatDate, formatDuration, formatTime, percent, pluralize, relativeDay, scoreTone } from '@/lib/utils';

export default function Dashboard() {
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const { actions, editor, openNew } = useTaskActions({ defaultDate: data?.today });
  const planMyDay = usePlanMyDay();
  const habits = useHabitMutations();
  const toast = useToast();
  const navigate = useNavigate();
  const [scoreOpen, setScoreOpen] = React.useState(false);
  const [planOpen, setPlanOpen] = React.useState(false);

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !data) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Could not load your dashboard"
        description={(error as Error)?.message ?? 'Check that the TarangOS server is running.'}
        action={<Button variant="outline" onClick={() => void refetch()}>Try again</Button>}
      />
    );
  }

  const { metrics, today } = data;
  const tone = scoreTone(metrics.score);
  const open = data.tasks.filter((task) => task.status !== 'completed');
  const completed = data.tasks.filter((task) => task.status === 'completed');
  const habitsDone = data.habits.filter((habit) => habit.doneToday).length;
  const focusTarget = data.targets.dailyFocusMinutes;

  const runPlan = () => {
    planMyDay.mutate(undefined, {
      onSuccess: () => {
        setPlanOpen(true);
        toast.success('Day planned', 'Tasks reordered by urgency, deadline and effort.');
      },
      onError: (err) => toast.error('Could not plan the day', (err as Error).message),
    });
  };

  return (
    <div className="space-y-5">
      {/* ---------- greeting ---------- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
            {data.greeting}, {data.user.displayName.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {formatDate(today, 'long')}
            {data.streak.current > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-warning">
                <Flame className="h-3.5 w-3.5" />
                {data.streak.current}-day streak
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon={<Wand2 className="h-4 w-4" />} onClick={runPlan} loading={planMyDay.isPending}>
            Plan my day
          </Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(today)}>
            New task
          </Button>
        </div>
      </div>

      {/* ---------- hero: score + counts ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card className="card-pad">
          <div className="flex items-center gap-5">
            <ProgressRing value={metrics.score / 100} size={116} stroke={11} color={tone.ring}>
              <span className="text-[28px] font-semibold tabular leading-none text-ink">{metrics.score}</span>
              <span className="mt-0.5 text-2xs font-medium text-muted">score</span>
            </ProgressRing>

            <div className="min-w-0 flex-1">
              <div className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium', tone.bg, tone.text)}>
                <Sparkles className="h-3 w-3" />
                {tone.label}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {metrics.planned === 0
                  ? 'Nothing planned yet. Add a task to start the day.'
                  : `${metrics.completed} of ${metrics.planned} tasks done — ${percent(metrics.completionRate)} complete.`}
              </p>
              <button
                onClick={() => setScoreOpen(true)}
                className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:underline"
              >
                <Info className="h-3.5 w-3.5" />
                Why this score?
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2.5 border-t border-line pt-4">
            <MiniMeter
              label="Tasks"
              value={metrics.completed}
              target={Math.max(metrics.planned, data.targets.dailyTasks)}
              suffix={`/ ${Math.max(metrics.planned, data.targets.dailyTasks)}`}
            />
            <MiniMeter
              label="Focus"
              value={metrics.focusMinutes}
              target={focusTarget}
              suffix={`/ ${formatDuration(focusTarget)}`}
              format={formatDuration}
              color="rgb(var(--success))"
            />
            {metrics.habitsPlanned > 0 && (
              <MiniMeter
                label="Habits"
                value={habitsDone}
                target={metrics.habitsPlanned}
                suffix={`/ ${metrics.habitsPlanned}`}
                color="rgb(var(--warning))"
              />
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Remaining"
            value={metrics.remaining}
            sublabel={metrics.remaining === 0 ? 'All clear' : pluralize(metrics.remaining, 'task') + ' left'}
            icon={<ListTodo className="h-3.5 w-3.5" />}
            tone="accent"
            onClick={() => navigate('/today')}
          />
          <StatTile
            label="Completed"
            value={metrics.completed}
            sublabel={`${percent(metrics.completionRate)} of today`}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            tone="success"
          />
          <StatTile
            label="Overdue"
            value={data.overdue.length}
            sublabel={data.overdue.length ? 'Needs a decision' : 'Nothing overdue'}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            tone={data.overdue.length ? 'danger' : 'info'}
            onClick={() => navigate('/tasks?view=overdue')}
          />
          <StatTile
            label="Focus time"
            value={formatDuration(metrics.focusMinutes)}
            sublabel={pluralize(metrics.focusSessions, 'session')}
            icon={<Focus className="h-3.5 w-3.5" />}
            tone="info"
            onClick={() => navigate('/focus')}
          />
          <StatTile
            label="This week"
            value={data.week.completed}
            sublabel={`avg score ${data.week.avgScore}`}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            tone="accent"
            className="col-span-2 sm:col-span-1"
            onClick={() => navigate('/progress')}
          />
          <StatTile
            label="Streak"
            value={data.streak.current}
            sublabel={`best ${data.streak.best} days`}
            icon={<Flame className="h-3.5 w-3.5" />}
            tone="warning"
            className="col-span-2 sm:col-span-1"
          />
          <StatTile
            label="High priority"
            value={data.highPriority.length}
            sublabel={data.highPriority.length ? 'Do these first' : 'None pending'}
            icon={<Zap className="h-3.5 w-3.5" />}
            tone={data.highPriority.length ? 'warning' : 'success'}
            className="col-span-2 sm:col-span-1"
          />
          <StatTile
            label="Planned effort"
            value={formatDuration(metrics.estimatedMinutes)}
            sublabel={metrics.estimatedMinutes > focusTarget * 1.5 ? 'Over capacity' : 'Within capacity'}
            icon={<Clock className="h-3.5 w-3.5" />}
            tone={metrics.estimatedMinutes > focusTarget * 1.5 ? 'danger' : 'info'}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </div>

      {/* ---------- overdue alert ---------- */}
      {data.overdue.length > 0 && (
        <Card className="border-danger/25 bg-danger/[0.04]">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {pluralize(data.overdue.length, 'task')} rolled past {data.overdue.length === 1 ? 'its' : 'their'} day
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  Oldest: {data.overdue[0].title} · {relativeDay(data.overdue[0].date, today)}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/tasks?view=overdue')} iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
              Review them
            </Button>
          </div>
        </Card>
      )}

      {/* ---------- main grid ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* today's tasks */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today"
            subtitle={open.length ? `${pluralize(open.length, 'task')} remaining` : 'Everything is done'}
            icon={<ListTodo className="h-4 w-4" />}
            action={
              <Link to="/today" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                Open <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <div className="space-y-2 p-4 pt-3 sm:p-5 sm:pt-3">
            {data.tasks.length === 0 ? (
              <EmptyState
                compact
                icon={<Sparkles className="h-5 w-5" />}
                title="A clean slate"
                description="Add the two or three things that would make today count."
                action={<Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(today)}>Add a task</Button>}
              />
            ) : (
              <>
                {open.slice(0, 6).map((task) => (
                  <TaskItem key={task.id} task={task} today={today} actions={actions} compact />
                ))}
                {open.length > 6 && (
                  <Link to="/today" className="block rounded-xl border border-dashed border-line px-3 py-2.5 text-center text-xs text-muted transition-colors hover:border-accent/40 hover:text-accent">
                    +{open.length - 6} more today
                  </Link>
                )}
                {completed.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer list-none rounded-lg px-1 py-2 text-xs font-medium text-muted transition-colors hover:text-ink">
                      <ChevronRight className="mr-1 inline h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                      {pluralize(completed.length, 'completed task')}
                    </summary>
                    <div className="mt-2 space-y-2">
                      {completed.map((task) => (
                        <TaskItem key={task.id} task={task} today={today} actions={actions} compact />
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        </Card>

        {/* right rail */}
        <div className="space-y-4">
          {/* next up */}
          {data.nextUp && (
            <Card className="border-accent/25 bg-accent/[0.04]">
              <div className="p-4">
                <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-accent">
                  <Zap className="h-3 w-3" /> Next up
                </div>
                <p className="mt-1.5 text-sm font-medium leading-snug text-ink">{data.nextUp.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-muted">
                  {data.nextUp.startTime && <span>{formatTime(data.nextUp.startTime)}</span>}
                  {data.nextUp.estimatedMinutes > 0 && <span>{formatDuration(data.nextUp.estimatedMinutes)}</span>}
                  <span className="capitalize">{data.nextUp.priority}</span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  fullWidth
                  icon={<Focus className="h-3.5 w-3.5" />}
                  onClick={() => actions.onFocus?.(data.nextUp!)}
                >
                  Start focusing
                </Button>
              </div>
            </Card>
          )}

          {/* habits */}
          <Card>
            <CardHeader
              title="Habits"
              subtitle={data.habits.length ? `${habitsDone} of ${data.habits.length} done` : undefined}
              icon={<Flame className="h-4 w-4" />}
              action={
                <Link to="/habits" className="text-xs font-medium text-accent hover:underline">
                  All
                </Link>
              }
            />
            <div className="p-4 pt-3">
              {data.habits.length === 0 ? (
                <EmptyState
                  compact
                  title="No habits yet"
                  description="Small daily repetitions are what move the score over months."
                  action={<Button size="sm" variant="outline" onClick={() => navigate('/habits')}>Create one</Button>}
                />
              ) : (
                <div className="space-y-1.5">
                  {data.habits.slice(0, 6).map((habit) => (
                    <button
                      key={habit.id}
                      onClick={() => habits.check.mutate({ id: habit.id })}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all',
                        habit.doneToday
                          ? 'border-success/30 bg-success/[0.07]'
                          : 'border-line hover:border-accent/30 hover:bg-subtle',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
                          habit.doneToday ? 'border-success bg-success text-white' : 'border-line',
                        )}
                        style={!habit.doneToday ? { borderColor: `${habit.color}66` } : undefined}
                      >
                        {habit.doneToday && <CheckCircle2 className="h-3 w-3" />}
                      </span>
                      <span className={cn('min-w-0 flex-1 truncate text-sm', habit.doneToday ? 'text-muted line-through' : 'text-ink')}>
                        {habit.name}
                      </span>
                      {habit.reminderTime && <span className="shrink-0 text-2xs text-faint">{formatTime(habit.reminderTime)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* upcoming */}
          <Card>
            <CardHeader
              title="Upcoming deadlines"
              subtitle="Next 7 days"
              icon={<CalendarClock className="h-4 w-4" />}
              action={
                <Link to="/calendar" className="text-xs font-medium text-accent hover:underline">
                  Calendar
                </Link>
              }
            />
            <div className="p-4 pt-3">
              {data.upcoming.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
                  Nothing scheduled this week.
                </p>
              ) : (
                <ul className="space-y-1">
                  {data.upcoming.slice(0, 6).map((task) => (
                    <li key={task.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          task.priority === 'urgent' ? 'bg-danger' : task.priority === 'high' ? 'bg-warning' : 'bg-info',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.title}</span>
                      <span className="shrink-0 text-2xs text-muted">{relativeDay(task.date, today)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ---------- goals + trend + review ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Last 30 days" subtitle="Planned vs completed" icon={<TrendingUp className="h-4 w-4" />} />
          <div className="p-2 pt-2 sm:p-3">
            <CompletionTrend data={data.trend} height={210} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Active goals"
              icon={<Target className="h-4 w-4" />}
              action={
                <Link to="/goals" className="text-xs font-medium text-accent hover:underline">
                  All
                </Link>
              }
            />
            <div className="space-y-3 p-4 pt-3">
              {data.goals.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
                  No active goals yet.
                </p>
              ) : (
                data.goals.slice(0, 4).map((goal) => (
                  <Link key={goal.id} to="/goals" className="block">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium text-ink">{goal.title}</span>
                      <span className="shrink-0 text-2xs tabular text-muted">{Math.round(goal.progress * 100)}%</span>
                    </div>
                    <Progress value={goal.progress} color={goal.color} height={6} />
                    {goal.targetDate && (
                      <p className="mt-1 text-2xs text-faint">Target {formatDate(goal.targetDate, 'short')}</p>
                    )}
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card className={cn(data.todayReview ? 'border-success/25 bg-success/[0.04]' : 'border-accent/25 bg-accent/[0.04]')}>
            <div className="p-4">
              <div className="flex items-center gap-2">
                <NotebookPen className={cn('h-4 w-4', data.todayReview ? 'text-success' : 'text-accent')} />
                <span className="text-sm font-medium text-ink">
                  {data.todayReview ? "Today's review is written" : 'End-of-day review'}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                {data.todayReview
                  ? `You rated today ${data.todayReview.rating}/5. Revisit it any time.`
                  : 'Five honest lines about what worked and what did not is what makes the history worth keeping.'}
              </p>
              <Button
                variant={data.todayReview ? 'outline' : 'primary'}
                size="sm"
                className="mt-3"
                fullWidth
                onClick={() => navigate('/reviews')}
              >
                {data.todayReview ? 'Open review' : 'Write it now'}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* ---------- score explainer ---------- */}
      <Modal
        open={scoreOpen}
        onClose={() => setScoreOpen(false)}
        title={`Productivity score: ${metrics.score}/100`}
        description="Every component is measured from what actually happened today."
        size="md"
      >
        <div className="space-y-3">
          {metrics.components.map((component) => {
            const share = component.applicable ? component.earned / component.weight : 0;
            return (
              <div key={component.key} className={cn('rounded-xl border p-3', component.applicable ? 'border-line' : 'border-dashed border-line opacity-60')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{component.label}</span>
                  <span className="shrink-0 text-xs tabular text-muted">
                    {component.applicable ? `${component.earned.toFixed(1)} / ${component.weight}` : 'not counted'}
                  </span>
                </div>
                <Progress
                  value={share}
                  height={5}
                  className="mt-2"
                  color={share >= 0.85 ? 'rgb(var(--success))' : share >= 0.5 ? 'rgb(var(--accent))' : 'rgb(var(--warning))'}
                />
                <p className="mt-1.5 text-xs text-muted">{component.detail}</p>
              </div>
            );
          })}

          {metrics.positives.length > 0 && (
            <div className="rounded-xl border border-success/25 bg-success/[0.06] p-3">
              <p className="mb-1.5 text-xs font-semibold text-success">What raised it</p>
              <ul className="space-y-1">
                {metrics.positives.map((item) => (
                  <li key={item} className="text-xs text-muted">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {metrics.negatives.length > 0 && (
            <div className="rounded-xl border border-warning/25 bg-warning/[0.06] p-3">
              <p className="mb-1.5 text-xs font-semibold text-warning">What held it back</p>
              <ul className="space-y-1">
                {metrics.negatives.map((item) => (
                  <li key={item} className="text-xs text-muted">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-2xs leading-relaxed text-faint">
            Components that do not apply to a day — no tasks planned, no habits set up — are excluded and the rest is
            rescaled, so a genuine rest day never reads as a failure.
          </p>
        </div>
      </Modal>

      {/* ---------- plan my day result ---------- */}
      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Your day, ordered"
        description="Sorted by priority, deadline, how often it has slipped, and effort."
        size="md"
        footer={<Button variant="primary" onClick={() => { setPlanOpen(false); navigate('/today'); }}>Open Today</Button>}
      >
        {planMyDay.data && (
          <div className="space-y-2">
            <div
              className={cn(
                'rounded-xl border p-3 text-xs',
                planMyDay.data.overCapacity ? 'border-warning/30 bg-warning/[0.07] text-warning' : 'border-line text-muted',
              )}
            >
              {formatDuration(planMyDay.data.totalEstimatedMinutes)} of estimated work against a{' '}
              {formatDuration(planMyDay.data.capacityMinutes)} focus target.
              {planMyDay.data.overCapacity && ' Consider moving the bottom items to another day.'}
            </div>

            {planMyDay.data.plan.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-2xs font-semibold text-accent">
                  {item.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{item.title}</p>
                  <p className="mt-0.5 text-2xs capitalize text-muted">{item.reasons.join(' · ')}</p>
                </div>
                {item.estimatedMinutes > 0 && (
                  <span className="shrink-0 text-2xs text-faint">{formatDuration(item.estimatedMinutes)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {editor}
    </div>
  );
}

function MiniMeter({
  label,
  value,
  target,
  suffix,
  color,
  format,
}: {
  label: string;
  value: number;
  target: number;
  suffix: string;
  color?: string;
  format?: (value: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular text-ink">
          <span className="font-medium">{format ? format(value) : value}</span>{' '}
          <span className="text-faint">{suffix}</span>
        </span>
      </div>
      <Progress value={target > 0 ? value / target : 0} height={5} color={color} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-40" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Skeleton className="h-64 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
