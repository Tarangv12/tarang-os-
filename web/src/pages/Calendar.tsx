import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useCalendar } from '@/lib/queries';
import { useTaskActions } from '@/hooks/useTaskActions';
import { TaskItem } from '@/components/TaskItem';
import { Button, Card, EmptyState, IconButton, PageHeader, SegmentedControl, Skeleton } from '@/components/ui/primitives';
import {
  addDays, addMonths, cn, eachDay, endOfMonth, endOfWeek, formatDate, formatDuration, formatTime,
  PRIORITY_META, startOfMonth, startOfWeek, todayStr, weekdayOf,
} from '@/lib/utils';
import { useUser } from '@/state/auth';

type Mode = 'month' | 'week' | 'day';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Calendar() {
  const user = useUser();
  const today = todayStr(user.timezone);
  const [mode, setMode] = React.useState<Mode>('month');
  const [anchor, setAnchor] = React.useState(today);
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);

  const range = React.useMemo(() => {
    if (mode === 'day') return { from: anchor, to: anchor };
    if (mode === 'week') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    // Month view pads to full weeks so the grid is always rectangular.
    return { from: startOfWeek(startOfMonth(anchor)), to: endOfWeek(endOfMonth(anchor)) };
  }, [mode, anchor]);

  const { data, isLoading } = useCalendar(range.from, range.to);
  const { actions, editor, openNew } = useTaskActions({ defaultDate: selectedDate ?? anchor });

  const dayMap = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>['days'][number]>();
    data?.days.forEach((day) => map.set(day.date, day));
    return map;
  }, [data]);

  const move = (direction: -1 | 1) => {
    if (mode === 'month') setAnchor(addMonths(anchor, direction));
    else if (mode === 'week') setAnchor(addDays(anchor, direction * 7));
    else setAnchor(addDays(anchor, direction));
  };

  const title =
    mode === 'month'
      ? new Date(`${anchor}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : mode === 'week'
        ? `${formatDate(startOfWeek(anchor), 'short')} – ${formatDate(endOfWeek(anchor), 'medium')}`
        : formatDate(anchor, 'long');

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Every planned day, at a glance."
        actions={
          <>
            <SegmentedControl
              value={mode}
              onChange={(next) => setMode(next)}
              options={[
                { value: 'month', label: 'Month' },
                { value: 'week', label: 'Week' },
                { value: 'day', label: 'Day' },
              ]}
            />
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(selectedDate ?? anchor)}>
              New task
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <IconButton label="Previous" variant="outline" size="sm" onClick={() => move(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <IconButton label="Next" variant="outline" size="sm" onClick={() => move(1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <Button
          size="xs"
          variant="subtle"
          className="ml-auto"
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          onClick={() => {
            setAnchor(today);
            setSelectedDate(today);
          }}
        >
          Today
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-[540px] rounded-2xl" />
      ) : mode === 'month' ? (
        <MonthGrid
          days={eachDay(range.from, range.to)}
          dayMap={dayMap}
          today={today}
          anchorMonth={anchor.slice(0, 7)}
          selected={selectedDate}
          onSelect={setSelectedDate}
        />
      ) : mode === 'week' ? (
        <WeekGrid days={eachDay(range.from, range.to)} dayMap={dayMap} today={today} onSelect={setSelectedDate} />
      ) : (
        <DayAgenda date={anchor} day={dayMap.get(anchor)} today={today} onAdd={() => openNew(anchor)} />
      )}

      {/* day detail */}
      {selectedDate && mode !== 'day' && (
        <Card className="mt-4">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">{formatDate(selectedDate, 'long')}</h3>
              <p className="text-2xs text-muted">
                {dayMap.get(selectedDate)?.completed ?? 0} of {dayMap.get(selectedDate)?.planned ?? 0} done
                {(dayMap.get(selectedDate)?.planned ?? 0) > 0 && ` · score ${dayMap.get(selectedDate)?.score ?? 0}`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="xs" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openNew(selectedDate)}>
                Add
              </Button>
              <IconButton label="Close" size="sm" onClick={() => setSelectedDate(null)}>
                <ChevronRight className="h-4 w-4 rotate-90" />
              </IconButton>
            </div>
          </div>

          <div className="space-y-2 p-4">
            {(dayMap.get(selectedDate)?.tasks.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-xs text-faint">Nothing scheduled on this day.</p>
            ) : (
              dayMap.get(selectedDate)!.tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_META[task.priority].dot)} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      task.status === 'completed' ? 'text-faint line-through' : 'text-ink',
                    )}
                  >
                    {task.title}
                  </span>
                  {task.startTime && <span className="shrink-0 text-2xs text-muted">{formatTime(task.startTime)}</span>}
                  {task.estimatedMinutes > 0 && (
                    <span className="shrink-0 text-2xs text-faint">{formatDuration(task.estimatedMinutes)}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {editor}
    </div>
  );
}

function MonthGrid({
  days,
  dayMap,
  today,
  anchorMonth,
  selected,
  onSelect,
}: {
  days: string[];
  dayMap: Map<string, { date: string; planned: number; completed: number; score: number; tasks: { id: string; title: string; priority: string; status: string }[] }>;
  today: string;
  anchorMonth: string;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-subtle/40">
        {DAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-2xs font-semibold uppercase tracking-wide text-muted">
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label[0]}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date, index) => {
          const day = dayMap.get(date);
          const inMonth = date.slice(0, 7) === anchorMonth;
          const isToday = date === today;
          const tasks = day?.tasks ?? [];
          const done = tasks.filter((t) => t.status === 'completed').length;

          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              className={cn(
                'group relative min-h-[86px] border-b border-r border-line p-1.5 text-left transition-colors sm:min-h-[110px] sm:p-2',
                index % 7 === 6 && 'border-r-0',
                !inMonth && 'bg-subtle/30',
                selected === date && 'bg-accent/[0.07] ring-1 ring-inset ring-accent/40',
                'hover:bg-subtle/60',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-2xs font-medium tabular',
                    isToday ? 'bg-accent text-accent-ink' : inMonth ? 'text-ink' : 'text-faint',
                  )}
                >
                  {Number(date.slice(8))}
                </span>
                {tasks.length > 0 && (
                  <span
                    className={cn(
                      'text-2xs tabular',
                      done === tasks.length ? 'text-success' : done > 0 ? 'text-accent' : 'text-faint',
                    )}
                  >
                    {done}/{tasks.length}
                  </span>
                )}
              </div>

              <div className="space-y-0.5">
                {tasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="flex items-center gap-1">
                    <span className={cn('h-1 w-1 shrink-0 rounded-full', PRIORITY_META[task.priority as 'high'].dot)} />
                    <span
                      className={cn(
                        'truncate text-[10px] leading-tight',
                        task.status === 'completed' ? 'text-faint line-through' : 'text-muted',
                      )}
                    >
                      {task.title}
                    </span>
                  </div>
                ))}
                {tasks.length > 3 && <div className="text-[10px] text-faint">+{tasks.length - 3} more</div>}
              </div>

              {day && day.planned > 0 && (
                <div className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${(day.completed / Math.max(day.planned, 1)) * 100}%` }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WeekGrid({
  days,
  dayMap,
  today,
  onSelect,
}: {
  days: string[];
  dayMap: Map<string, { date: string; planned: number; completed: number; score: number; tasks: { id: string; title: string; priority: string; status: string; startTime: string | null }[] }>;
  today: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {days.map((date) => {
        const day = dayMap.get(date);
        const tasks = day?.tasks ?? [];
        return (
          <Card key={date} className={cn('flex min-h-[180px] flex-col', date === today && 'border-accent/40')}>
            <button
              onClick={() => onSelect(date)}
              className="flex items-center justify-between border-b border-line px-3 py-2.5 text-left"
            >
              <div>
                <div className={cn('text-xs font-semibold', date === today ? 'text-accent' : 'text-ink')}>
                  {DAY_LABELS[(weekdayOf(date) + 6) % 7]}
                </div>
                <div className="text-2xs text-muted">{formatDate(date, 'short')}</div>
              </div>
              {tasks.length > 0 && (
                <span className="text-2xs tabular text-muted">
                  {tasks.filter((t) => t.status === 'completed').length}/{tasks.length}
                </span>
              )}
            </button>

            <div className="flex-1 space-y-1 p-2">
              {tasks.length === 0 ? (
                <p className="py-6 text-center text-2xs text-faint">Free</p>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-1.5 rounded-lg px-1.5 py-1 hover:bg-subtle">
                    <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_META[task.priority as 'high'].dot)} />
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate text-xs', task.status === 'completed' ? 'text-faint line-through' : 'text-ink')}>
                        {task.title}
                      </div>
                      {task.startTime && <div className="text-[10px] text-faint">{formatTime(task.startTime)}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function DayAgenda({
  date,
  day,
  today,
  onAdd,
}: {
  date: string;
  day?: { tasks: { id: string; title: string; priority: string; status: string; startTime: string | null; dueTime: string | null; estimatedMinutes: number }[]; planned: number; completed: number; score: number };
  today: string;
  onAdd: () => void;
}) {
  const tasks = day?.tasks ?? [];
  const timed = tasks.filter((task) => task.startTime).sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  const untimed = tasks.filter((task) => !task.startTime);

  if (!tasks.length) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="Nothing scheduled"
          description={`${formatDate(date, 'long')} is completely open.`}
          action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>Add a task</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {timed.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-xs font-semibold text-ink">Scheduled</div>
          <div className="divide-y divide-line">
            {timed.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-16 shrink-0 text-right">
                  <div className="text-xs font-medium tabular text-ink">{formatTime(task.startTime)}</div>
                  {task.dueTime && <div className="text-2xs text-faint">to {formatTime(task.dueTime)}</div>}
                </div>
                <span className={cn('h-8 w-1 shrink-0 rounded-full', PRIORITY_META[task.priority as 'high'].dot)} />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-sm', task.status === 'completed' ? 'text-faint line-through' : 'text-ink')}>
                    {task.title}
                  </div>
                  {task.estimatedMinutes > 0 && (
                    <div className="text-2xs text-faint">{formatDuration(task.estimatedMinutes)} estimated</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {untimed.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-xs font-semibold text-ink">Anytime</div>
          <div className="divide-y divide-line">
            {untimed.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_META[task.priority as 'high'].dot)} />
                <span className={cn('min-w-0 flex-1 truncate text-sm', task.status === 'completed' ? 'text-faint line-through' : 'text-ink')}>
                  {task.title}
                </span>
                {task.estimatedMinutes > 0 && (
                  <span className="shrink-0 text-2xs text-faint">{formatDuration(task.estimatedMinutes)}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
