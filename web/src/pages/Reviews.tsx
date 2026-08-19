import * as React from 'react';
import {
  CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, NotebookPen, Save, Star, XCircle,
} from 'lucide-react';
import { useReviewPrepare, useReviews, useSaveReview, type DailyPrepare, type WeeklyPrepare } from '@/lib/queries';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, PageHeader, Progress as Bar,
  SegmentedControl, Skeleton, StatTile, Textarea,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { addDays, cn, formatDate, formatDuration, percent, pluralize, startOfWeek, todayStr } from '@/lib/utils';
import { useUser } from '@/state/auth';

const REASON_LABEL: Record<string, string> = {
  ran_out_of_time: 'Ran out of time',
  low_energy: 'Low energy',
  interrupted: 'Interrupted',
  unclear_next_step: 'Unclear next step',
  task_too_big: 'Task was too big',
  waiting_on_someone: 'Waiting on someone',
  changed_priorities: 'Priorities changed',
  procrastinated: 'Procrastinated',
  unwell: 'Unwell',
  overplanned: 'Overplanned the day',
};

const MOODS = ['😖', '😕', '😐', '🙂', '😄'];

type FormState = {
  wentWell: string;
  missedWhy: string;
  missReasons: string[];
  distractions: string;
  lessons: string;
  improvements: string;
  gratitude: string;
  rating: number;
  energy: number;
  mood: string;
};

const EMPTY_FORM: FormState = {
  wentWell: '', missedWhy: '', missReasons: [], distractions: '',
  lessons: '', improvements: '', gratitude: '', rating: 0, energy: 0, mood: '',
};

export default function Reviews() {
  const user = useUser();
  const today = todayStr(user.timezone);
  const [type, setType] = React.useState<'daily' | 'weekly'>('daily');
  const [date, setDate] = React.useState(today);

  const targetDate = type === 'weekly' ? startOfWeek(date, user.settings.weekStartsOn) : date;
  const { data, isLoading } = useReviewPrepare(type, targetDate);
  const { data: history } = useReviews({ type, limit: 60 });
  const save = useSaveReview();
  const toast = useToast();

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const existing = data?.existing;
    setForm(
      existing
        ? {
            wentWell: existing.wentWell,
            missedWhy: existing.missedWhy,
            missReasons: existing.missReasons ?? [],
            distractions: existing.distractions,
            lessons: existing.lessons,
            improvements: existing.improvements,
            gratitude: existing.gratitude,
            rating: existing.rating,
            energy: existing.energy,
            mood: existing.mood,
          }
        : EMPTY_FORM,
    );
    setDirty(false);
  }, [data?.existing, targetDate, type]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const toggleReason = (reason: string) => {
    set('missReasons', form.missReasons.includes(reason) ? form.missReasons.filter((r) => r !== reason) : [...form.missReasons, reason]);
  };

  const submit = () => {
    save.mutate(
      { type, date: targetDate, ...form },
      {
        onSuccess: () => {
          toast.success('Review saved', formatDate(targetDate, 'medium'));
          setDirty(false);
        },
        onError: (err) => toast.error('Could not save', (err as Error).message),
      },
    );
  };

  const step = (direction: -1 | 1) => setDate(addDays(date, type === 'weekly' ? direction * 7 : direction));

  const daily = data?.type === 'daily' ? (data as DailyPrepare) : null;
  const weekly = data?.type === 'weekly' ? (data as WeeklyPrepare) : null;

  return (
    <div>
      <PageHeader
        title="Reviews"
        description="A short, honest record of what happened — this is what makes the history worth keeping."
        actions={
          <>
            <SegmentedControl
              value={type}
              onChange={(next) => setType(next)}
              options={[
                { value: 'daily', label: 'Daily', icon: <NotebookPen className="h-3.5 w-3.5" /> },
                { value: 'weekly', label: 'Weekly', icon: <CalendarRange className="h-3.5 w-3.5" /> },
              ]}
            />
            <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={submit} loading={save.isPending} disabled={!dirty && Boolean(data?.existing)}>
              {data?.existing ? 'Update review' : 'Save review'}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <IconButton label="Previous" variant="outline" size="sm" onClick={() => step(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <IconButton label="Next" variant="outline" size="sm" onClick={() => step(1)} disabled={date >= today}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
        <h2 className="text-sm font-semibold text-ink">
          {type === 'weekly'
            ? `Week of ${formatDate(targetDate, 'medium')}`
            : targetDate === today
              ? `Today · ${formatDate(targetDate, 'medium')}`
              : formatDate(targetDate, 'long')}
        </h2>
        {data?.existing && <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> saved</Badge>}
        {date !== today && (
          <Button size="xs" variant="subtle" className="ml-auto" onClick={() => setDate(today)}>
            Back to today
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ---------- the form ---------- */}
          <div className="space-y-4">
            <Card className="card-pad space-y-4">
              <Field label="What went well?" hint="Even on a rough day, name one thing.">
                <Textarea
                  value={form.wentWell}
                  onChange={(event) => set('wentWell', event.target.value)}
                  rows={3}
                  placeholder="Shipped the API layer; kept the morning free of meetings…"
                />
              </Field>

              <Field label="What did not get done, and why?">
                <Textarea
                  value={form.missedWhy}
                  onChange={(event) => set('missedWhy', event.target.value)}
                  rows={3}
                  placeholder="Be specific — the pattern is what matters, not the excuse."
                />
              </Field>

              <Field label="Reasons" hint="Tag the causes so Analytics can find the recurring one.">
                <div className="flex flex-wrap gap-1.5">
                  {(data?.reasonOptions ?? Object.keys(REASON_LABEL)).map((reason) => {
                    const active = form.missReasons.includes(reason);
                    return (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => toggleReason(reason)}
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                          active ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-subtle',
                        )}
                      >
                        {REASON_LABEL[reason] ?? reason.replace(/_/g, ' ')}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Distractions" hint="What pulled you away?">
                <Input value={form.distractions} onChange={(event) => set('distractions', event.target.value)} placeholder="Phone, unplanned calls, context switching…" />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="What did you learn?">
                  <Textarea value={form.lessons} onChange={(event) => set('lessons', event.target.value)} rows={3} />
                </Field>
                <Field label="What will you change tomorrow?">
                  <Textarea value={form.improvements} onChange={(event) => set('improvements', event.target.value)} rows={3} />
                </Field>
              </div>

              <Field label="One good thing" hint="Optional — worth writing anyway.">
                <Input value={form.gratitude} onChange={(event) => set('gratitude', event.target.value)} />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Rate the day">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set('rating', value)}
                        aria-label={`${value} of 5`}
                        className="p-0.5 transition-transform hover:scale-110"
                      >
                        <Star className={cn('h-6 w-6', value <= form.rating ? 'fill-warning text-warning' : 'text-line')} />
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Energy">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => set('energy', value)}
                        className={cn(
                          'h-8 w-8 rounded-lg border text-xs font-medium transition-colors',
                          value <= form.energy ? 'border-accent bg-accent/10 text-accent' : 'border-line text-faint hover:bg-subtle',
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Mood">
                  <div className="flex gap-1">
                    {MOODS.map((mood) => (
                      <button
                        key={mood}
                        type="button"
                        onClick={() => set('mood', form.mood === mood ? '' : mood)}
                        className={cn(
                          'h-8 w-8 rounded-lg border text-base transition-colors',
                          form.mood === mood ? 'border-accent bg-accent/10' : 'border-line hover:bg-subtle',
                        )}
                      >
                        {mood}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
                {dirty && <span className="mr-auto text-2xs text-warning">Unsaved changes</span>}
                <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={submit} loading={save.isPending}>
                  {data?.existing ? 'Update review' : 'Save review'}
                </Button>
              </div>
            </Card>
          </div>

          {/* ---------- what actually happened ---------- */}
          <div className="space-y-4">
            {daily && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Score" value={daily.metrics.score} sublabel="out of 100" tone="accent" />
                  <StatTile label="Completed" value={`${daily.metrics.completed}/${daily.metrics.planned}`} sublabel={percent(daily.metrics.completionRate)} tone="success" />
                  <StatTile label="Focus" value={formatDuration(daily.metrics.focusMinutes)} sublabel={pluralize(daily.metrics.focusSessions, 'session')} tone="info" />
                  <StatTile label="Habits" value={`${daily.metrics.habitsDone}/${daily.metrics.habitsPlanned}`} tone="warning" />
                </div>

                <Card>
                  <CardHeader title="Done today" subtitle={pluralize(daily.completed.length, 'task')} icon={<CheckCircle2 className="h-4 w-4" />} />
                  <div className="p-4 pt-3">
                    {daily.completed.length === 0 ? (
                      <p className="py-3 text-center text-xs text-faint">Nothing was completed on this day.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {daily.completed.map((task) => (
                          <li key={task.id} className="flex items-center gap-2 text-xs">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                            <span className="min-w-0 truncate text-muted line-through">{task.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Left undone" subtitle={pluralize(daily.missed.length, 'task')} icon={<XCircle className="h-4 w-4" />} />
                  <div className="p-4 pt-3">
                    {daily.missed.length === 0 ? (
                      <p className="py-3 text-center text-xs text-success">Everything planned got done.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {daily.missed.map((task) => (
                          <li key={task.id} className="flex items-center gap-2 text-xs">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                            <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
                            {task.postponedCount > 0 && <Badge tone="warning">{task.postponedCount}×</Badge>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                {(daily.metrics.positives.length > 0 || daily.metrics.negatives.length > 0) && (
                  <Card className="card-pad space-y-3">
                    {daily.metrics.positives.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-success">Raised the score</p>
                        <ul className="space-y-1">
                          {daily.metrics.positives.map((item) => (
                            <li key={item} className="text-xs text-muted">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {daily.metrics.negatives.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-warning">Held it back</p>
                        <ul className="space-y-1">
                          {daily.metrics.negatives.map((item) => (
                            <li key={item} className="text-xs text-muted">• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </Card>
                )}
              </>
            )}

            {weekly && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Avg score" value={weekly.metrics.avgScore} tone="accent" />
                  <StatTile label="Completed" value={`${weekly.metrics.completed}/${weekly.metrics.planned}`} sublabel={percent(weekly.metrics.completionRate)} tone="success" />
                  <StatTile label="Focus" value={formatDuration(weekly.metrics.focusMinutes)} tone="info" />
                  <StatTile label="Missed" value={weekly.metrics.missed} sublabel={`${weekly.metrics.postponed} postponed`} tone="danger" />
                </div>

                <Card>
                  <CardHeader title="Day by day" subtitle={`${formatDate(weekly.weekStart, 'short')} – ${formatDate(weekly.weekEnd, 'short')}`} />
                  <div className="space-y-2 p-4 pt-3">
                    {weekly.days.map((day) => (
                      <div key={day.date}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted">{formatDate(day.date, 'day')}</span>
                          <span className="tabular text-ink">
                            {day.completed}/{day.planned} · {day.score}
                          </span>
                        </div>
                        <Bar value={day.planned ? day.completed / day.planned : 0} height={5} />
                      </div>
                    ))}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Carried into next week" subtitle={pluralize(weekly.missedTasks.length, 'task')} />
                  <div className="p-4 pt-3">
                    {weekly.missedTasks.length === 0 ? (
                      <p className="py-3 text-center text-xs text-success">Clean week — nothing left hanging.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {weekly.missedTasks.slice(0, 12).map((task) => (
                          <li key={task.id} className="flex items-center gap-2 text-xs">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                            <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
                            <span className="shrink-0 text-2xs text-faint">{formatDate(task.date, 'short')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              </>
            )}

            {/* past reviews */}
            <Card>
              <CardHeader title="Past reviews" subtitle={pluralize(history?.reviews.length ?? 0, 'entry', 'entries')} />
              <div className="max-h-72 overflow-y-auto p-4 pt-3">
                {!history?.reviews.length ? (
                  <EmptyState compact title="No reviews yet" description="They will collect here as you write them." />
                ) : (
                  <ul className="space-y-1">
                    {history.reviews.map((review) => (
                      <li key={review.id}>
                        <button
                          onClick={() => setDate(review.date)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-subtle',
                            review.date === targetDate && 'bg-accent/10',
                          )}
                        >
                          <span className="text-base">{review.mood || '📝'}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-ink">{formatDate(review.date, 'medium')}</span>
                            {review.wentWell && <span className="block truncate text-2xs text-faint">{review.wentWell}</span>}
                          </span>
                          {review.rating > 0 && (
                            <span className="flex shrink-0 items-center gap-0.5 text-2xs text-warning">
                              <Star className="h-3 w-3 fill-warning" />
                              {review.rating}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
