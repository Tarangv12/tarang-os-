import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, CheckCircle2, Clock, FileText, Flame, NotebookPen, Search, Star,
} from 'lucide-react';
import { useHistory, useHistoryDay } from '@/lib/queries';
import {
  Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Progress as Bar, SegmentedControl,
  Skeleton, StatTile,
} from '@/components/ui/primitives';
import { cn, formatDate, formatDuration, formatTime, percent, pluralize, PRIORITY_META, renderMarkdown, scoreTone, todayStr } from '@/lib/utils';
import { useUser } from '@/state/auth';

type Window = '30' | '90' | '182' | '365';

const WINDOW_LABEL: Record<Window, string> = { '30': '30 days', '90': '3 months', '182': '6 months', '365': '1 year' };

export default function History() {
  const { date } = useParams();
  const navigate = useNavigate();
  const user = useUser();
  const today = todayStr(user.timezone);
  const [window, setWindow] = React.useState<Window>('182');
  const [search, setSearch] = React.useState('');

  const { data, isLoading } = useHistory({ days: Number(window) });

  if (date) return <DayView date={date} today={today} onBack={() => navigate('/history')} />;

  const days = (data?.days ?? []).filter((day) => {
    if (!search.trim()) return true;
    return day.date.includes(search.trim()) || day.mood.includes(search.trim());
  });

  const tracked = days.filter((day) => day.planned > 0 || day.completed > 0);

  return (
    <div>
      <PageHeader
        title="History"
        description={
          data
            ? `${formatDate(data.from, 'medium')} → ${formatDate(data.to, 'medium')} · ${pluralize(tracked.length, 'day')} with activity`
            : 'Loading…'
        }
        actions={
          <SegmentedControl
            value={window}
            onChange={setWindow}
            options={(Object.keys(WINDOW_LABEL) as Window[]).map((value) => ({ value, label: WINDOW_LABEL[value] }))}
          />
        }
      />

      <Card className="mb-4 flex items-center gap-2 p-2">
        <Search className="ml-1.5 h-4 w-4 shrink-0 text-faint" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Jump to a date, e.g. 2026-07"
          className="h-8 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <Input
          type="date"
          max={today}
          onChange={(event) => event.target.value && navigate(`/history/${event.target.value}`)}
          className="h-8 w-auto text-xs"
        />
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : tracked.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="No history yet"
            description="Once you have completed tasks on a few days, every one of them will be openable here — tasks, score, review and notes."
          />
        </Card>
      ) : (
        <div className="space-y-1.5">
          {days.map((day) => {
            const empty = day.planned === 0 && day.completed === 0;
            if (empty) return null;
            const tone = scoreTone(day.score);
            return (
              <button
                key={day.date}
                onClick={() => navigate(`/history/${day.date}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-all hover:border-accent/40 hover:shadow-card sm:px-4"
              >
                <div className="w-24 shrink-0 sm:w-32">
                  <div className={cn('text-xs font-medium', day.date === today ? 'text-accent' : 'text-ink')}>
                    {formatDate(day.date, 'day')}
                  </div>
                  <div className="text-2xs text-faint">{formatDate(day.date, 'short')}</div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2 text-2xs">
                    <span className="text-muted">
                      {day.completed}/{day.planned} tasks
                      {day.missed > 0 && <span className="ml-1.5 text-danger">· {day.missed} missed</span>}
                    </span>
                    <span className="tabular text-muted">{percent(day.completionRate)}</span>
                  </div>
                  <Bar value={day.completionRate} height={5} />
                </div>

                <div className="hidden shrink-0 items-center gap-3 text-2xs text-muted sm:flex">
                  {day.focusMinutes > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(day.focusMinutes)}
                    </span>
                  )}
                  {day.habitsPlanned > 0 && (
                    <span className="flex items-center gap-1">
                      <Flame className="h-3 w-3" />
                      {day.habitsDone}/{day.habitsPlanned}
                    </span>
                  )}
                  {day.noteCount > 0 && (
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {day.noteCount}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {day.mood && <span className="text-base">{day.mood}</span>}
                  {day.hasReview && (
                    <span title="Review written">
                      <NotebookPen className="h-3.5 w-3.5 text-success" />
                    </span>
                  )}
                  <span className={cn('w-9 rounded-md px-1.5 py-0.5 text-center text-2xs font-semibold tabular', tone.bg, tone.text)}>
                    {day.score}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DayView({ date, today, onBack }: { date: string; today: string; onBack: () => void }) {
  const { data, isLoading } = useHistoryDay(date);
  const navigate = useNavigate();

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const { metrics } = data;
  const tone = scoreTone(metrics.score);
  const completed = data.tasks.filter((task) => task.status === 'completed');
  const missed = data.tasks.filter((task) => task.status !== 'completed');

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All history
      </button>

      <PageHeader
        title={formatDate(date, 'long')}
        description={date === today ? 'Today, so far' : `${pluralize(completed.length, 'task')} completed`}
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => navigate(`/history/${addDaysLocal(date, -1)}`)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={date >= today} onClick={() => navigate(`/history/${addDaysLocal(date, 1)}`)}>
              Next
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Score" value={metrics.score} sublabel={tone.label} tone="accent" />
        <StatTile label="Completed" value={`${metrics.completed}/${metrics.planned}`} sublabel={percent(metrics.completionRate)} tone="success" />
        <StatTile label="Focus" value={formatDuration(metrics.focusMinutes)} sublabel={pluralize(metrics.focusSessions, 'session')} tone="info" />
        <StatTile label="Habits" value={`${metrics.habitsDone}/${metrics.habitsPlanned}`} tone="warning" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Tasks" subtitle={`${completed.length} done · ${missed.length} not done`} />
            <div className="p-4 pt-3">
              {data.tasks.length === 0 ? (
                <p className="py-4 text-center text-xs text-faint">Nothing was planned for this day.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.tasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
                      {task.status === 'completed' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', PRIORITY_META[task.priority].dot)} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={cn('text-sm', task.status === 'completed' ? 'text-muted line-through' : 'text-ink')}>
                          {task.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-faint">
                          <span className="capitalize">{task.priority}</span>
                          {task.startTime && <span>{formatTime(task.startTime)}</span>}
                          {task.category && <span>{task.category.name}</span>}
                          {task.actualMinutes > 0 && <span>{formatDuration(task.actualMinutes)} spent</span>}
                          {task.postponedCount > 0 && <span className="text-warning">moved {task.postponedCount}×</span>}
                          {task.missReason && <span className="text-danger">{task.missReason}</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {data.review && (
            <Card>
              <CardHeader
                title="Review"
                subtitle={data.review.mood ? `Mood ${data.review.mood}` : undefined}
                icon={<NotebookPen className="h-4 w-4" />}
                action={
                  data.review.rating > 0 ? (
                    <span className="flex items-center gap-0.5 text-xs text-warning">
                      {Array.from({ length: data.review.rating }).map((_, index) => (
                        <Star key={index} className="h-3.5 w-3.5 fill-warning" />
                      ))}
                    </span>
                  ) : undefined
                }
              />
              <div className="space-y-3 p-4 pt-3">
                {[
                  ['What went well', data.review.wentWell],
                  ['What was missed, and why', data.review.missedWhy],
                  ['Distractions', data.review.distractions],
                  ['Lessons', data.review.lessons],
                  ['Improvements', data.review.improvements],
                  ['One good thing', data.review.gratitude],
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label as string}>
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">{label}</p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{value as string}</p>
                    </div>
                  ))}

                {data.review.missReasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
                    {data.review.missReasons.map((reason) => (
                      <Badge key={reason} tone="warning">{reason.replace(/_/g, ' ')}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {data.notes.length > 0 && (
            <Card>
              <CardHeader title="Notes" subtitle={pluralize(data.notes.length, 'note')} icon={<FileText className="h-4 w-4" />} />
              <div className="space-y-3 p-4 pt-3">
                {data.notes.map((note) => (
                  <div key={note.id} className="rounded-xl border border-line p-3">
                    {note.title && <h4 className="mb-1 text-sm font-medium text-ink">{note.title}</h4>}
                    <div className="prose-tarang" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }} />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Score breakdown" />
            <div className="space-y-2.5 p-4 pt-3">
              {metrics.components.map((component) => (
                <div key={component.key} className={cn(!component.applicable && 'opacity-50')}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted">{component.label}</span>
                    <span className="tabular text-ink">
                      {component.applicable ? `${component.earned.toFixed(1)}/${component.weight}` : 'n/a'}
                    </span>
                  </div>
                  <Bar value={component.applicable ? component.earned / component.weight : 0} height={4} />
                  <p className="mt-1 text-2xs text-faint">{component.detail}</p>
                </div>
              ))}
            </div>
          </Card>

          {data.habits.length > 0 && (
            <Card>
              <CardHeader title="Habits" icon={<Flame className="h-4 w-4" />} />
              <div className="space-y-1.5 p-4 pt-3">
                {data.habits.map((habit) => (
                  <div key={habit.id} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn('h-4 w-4 shrink-0 rounded-md border', habit.done ? 'border-transparent' : 'border-line')}
                      style={habit.done ? { background: habit.color } : undefined}
                    />
                    <span className={cn('min-w-0 truncate', habit.done ? 'text-ink' : 'text-faint')}>{habit.name}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {data.focusSessions.length > 0 && (
            <Card>
              <CardHeader title="Focus sessions" icon={<Clock className="h-4 w-4" />} />
              <div className="space-y-1.5 p-4 pt-3">
                {data.focusSessions.map((session) => (
                  <div key={session.id} className="flex items-center gap-2 text-xs">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', session.completed ? 'bg-success' : 'bg-faint')} />
                    <span className="min-w-0 flex-1 truncate text-muted">{session.task?.title ?? 'Untitled focus'}</span>
                    <span className="shrink-0 tabular text-ink">{formatDuration(session.actualMinutes)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
