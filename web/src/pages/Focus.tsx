import * as React from 'react';
import { Coffee, Focus as FocusIcon, Pause, Play, RotateCcw, Square, Timer, TrendingUp, Zap } from 'lucide-react';
import { useActiveFocus, useFocusMutations, useFocusStats, useTasks } from '@/lib/queries';
import {
  Button, Card, CardHeader, EmptyState, PageHeader, ProgressRing, SegmentedControl, Select,
  Skeleton, StatTile,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { FocusBars } from '@/components/charts';
import { cn, formatDuration, formatRelativeTime, pluralize, todayStr } from '@/lib/utils';
import { useUser } from '@/state/auth';

type Mode = 'focus' | 'short_break' | 'long_break';

const MODE_META: Record<Mode, { label: string; icon: React.ReactNode; color: string }> = {
  focus: { label: 'Focus', icon: <FocusIcon className="h-3.5 w-3.5" />, color: 'rgb(var(--accent))' },
  short_break: { label: 'Short break', icon: <Coffee className="h-3.5 w-3.5" />, color: 'rgb(var(--success))' },
  long_break: { label: 'Long break', icon: <Coffee className="h-3.5 w-3.5" />, color: 'rgb(var(--info))' },
};

export default function FocusPage() {
  const user = useUser();
  const today = todayStr(user.timezone);
  const pomodoro = user.settings.pomodoro;

  const { data: activeData, isLoading: activeLoading } = useActiveFocus();
  const { data: stats, isLoading: statsLoading } = useFocusStats();
  const { data: taskData } = useTasks({ view: 'today' });
  const { start, finish, cancel } = useFocusMutations();
  const toast = useToast();

  const [mode, setMode] = React.useState<Mode>('focus');
  const [minutes, setMinutes] = React.useState(pomodoro.focus);
  const [taskId, setTaskId] = React.useState('');
  const [elapsed, setElapsed] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [completedRounds, setCompletedRounds] = React.useState(0);

  const session = activeData?.session ?? null;
  const openTasks = (taskData?.tasks ?? []).filter((task) => task.status !== 'completed');

  // Elapsed time is derived from the server's start timestamp, so closing the
  // tab or locking the phone never loses the session.
  React.useEffect(() => {
    if (!session) {
      setElapsed(0);
      return;
    }
    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000));
      setElapsed(seconds);
    };
    tick();
    if (paused) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session, paused]);

  const plannedSeconds = (session?.plannedMinutes ?? minutes) * 60;
  const remaining = Math.max(0, plannedSeconds - elapsed);
  const progress = plannedSeconds > 0 ? Math.min(1, elapsed / plannedSeconds) : 0;
  const finished = session !== null && remaining === 0;

  const notifiedRef = React.useRef(false);
  React.useEffect(() => {
    if (!finished || notifiedRef.current) return;
    notifiedRef.current = true;
    toast.success('Session complete', 'Log it and take a break.');
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Focus session complete', { body: 'Nice work — time for a break.', icon: '/icons/icon-192.png' });
      } catch {
        /* ignore */
      }
    }
  }, [finished, toast]);

  React.useEffect(() => {
    if (!session) notifiedRef.current = false;
  }, [session]);

  const startSession = () => {
    start.mutate(
      { taskId: taskId || null, plannedMinutes: minutes, mode },
      {
        onSuccess: () => {
          setPaused(false);
          setElapsed(0);
        },
        onError: (err) => toast.error('Could not start', (err as Error).message),
      },
    );
  };

  const finishSession = (completed: boolean) => {
    if (!session) return;
    finish.mutate(
      { id: session.id, actualMinutes: Math.round(elapsed / 60), completed },
      {
        onSuccess: () => {
          if (completed && session.mode === 'focus') {
            const rounds = completedRounds + 1;
            setCompletedRounds(rounds);
            const nextMode: Mode = rounds % pomodoro.longBreakEvery === 0 ? 'long_break' : 'short_break';
            setMode(nextMode);
            setMinutes(nextMode === 'long_break' ? pomodoro.longBreak : pomodoro.shortBreak);
            toast.success(`${formatDuration(Math.round(elapsed / 60))} logged`, 'Break queued up next.');
          } else if (completed) {
            setMode('focus');
            setMinutes(pomodoro.focus);
          }
        },
        onError: (err) => toast.error('Could not save the session', (err as Error).message),
      },
    );
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const focusTarget = user.settings.dailyFocusTargetMinutes;

  return (
    <div>
      <PageHeader title="Focus" description="Distraction-free work, measured honestly." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---------- timer ---------- */}
        <Card className="flex flex-col items-center p-6 sm:p-8">
          {!session && (
            <SegmentedControl
              value={mode}
              onChange={(next) => {
                setMode(next);
                setMinutes(next === 'focus' ? pomodoro.focus : next === 'short_break' ? pomodoro.shortBreak : pomodoro.longBreak);
              }}
              options={(Object.keys(MODE_META) as Mode[]).map((key) => ({
                value: key,
                label: MODE_META[key].label,
                icon: MODE_META[key].icon,
              }))}
              className="mb-6"
            />
          )}

          <ProgressRing
            value={session ? progress : 0}
            size={244}
            stroke={12}
            color={MODE_META[(session?.mode as Mode) ?? mode].color}
          >
            <span className={cn('font-mono text-5xl font-semibold tabular tracking-tight', finished ? 'text-success' : 'text-ink')}>
              {session ? `${mm}:${ss}` : `${String(minutes).padStart(2, '0')}:00`}
            </span>
            <span className="mt-1.5 text-xs font-medium text-muted">
              {session
                ? finished
                  ? 'Time is up'
                  : paused
                    ? 'Paused'
                    : MODE_META[(session.mode as Mode) ?? 'focus'].label
                : 'Ready'}
            </span>
            {session?.task && <span className="mt-1 max-w-[180px] truncate text-2xs text-faint">{session.task.title}</span>}
          </ProgressRing>

          {activeLoading ? (
            <Skeleton className="mt-6 h-10 w-48" />
          ) : session ? (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              {!finished && (
                <Button
                  variant="outline"
                  size="lg"
                  icon={paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  onClick={() => setPaused((prev) => !prev)}
                >
                  {paused ? 'Resume' : 'Pause'}
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                icon={<Square className="h-4 w-4" />}
                loading={finish.isPending}
                onClick={() => finishSession(true)}
              >
                {finished ? 'Log session' : 'Finish early'}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() =>
                  cancel.mutate(session.id, { onSuccess: () => toast.info('Session discarded', 'Nothing was logged.') })
                }
              >
                Discard
              </Button>
            </div>
          ) : (
            <div className="mt-7 w-full max-w-sm space-y-3">
              <div className="flex justify-center gap-1.5">
                {[15, 25, 45, 50, 90].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setMinutes(preset)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      minutes === preset ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:bg-subtle',
                    )}
                  >
                    {preset}m
                  </button>
                ))}
              </div>

              {mode === 'focus' && (
                <Select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
                  <option value="">Focus without a specific task</option>
                  {openTasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.title}</option>
                  ))}
                </Select>
              )}

              <Button variant="primary" size="lg" fullWidth icon={<Play className="h-4 w-4" />} onClick={startSession} loading={start.isPending}>
                Start {MODE_META[mode].label.toLowerCase()}
              </Button>

              {completedRounds > 0 && (
                <p className="text-center text-2xs text-faint">
                  {completedRounds} {completedRounds === 1 ? 'round' : 'rounds'} completed this sitting · long break every{' '}
                  {pomodoro.longBreakEvery}
                </p>
              )}
            </div>
          )}
        </Card>

        {/* ---------- stats ---------- */}
        <div className="space-y-4">
          {statsLoading ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  label="Today"
                  value={formatDuration(stats?.today.minutes ?? 0)}
                  sublabel={`target ${formatDuration(focusTarget)}`}
                  icon={<Timer className="h-3.5 w-3.5" />}
                  tone={(stats?.today.minutes ?? 0) >= focusTarget ? 'success' : 'accent'}
                />
                <StatTile
                  label="Sessions"
                  value={stats?.today.sessions ?? 0}
                  sublabel="completed today"
                  icon={<Zap className="h-3.5 w-3.5" />}
                  tone="info"
                />
                <StatTile label="This week" value={formatDuration(stats?.week.minutes ?? 0)} sublabel={pluralize(stats?.week.sessions ?? 0, 'session')} tone="accent" />
                <StatTile label="30 days" value={formatDuration(stats?.month.minutes ?? 0)} sublabel={pluralize(stats?.month.sessions ?? 0, 'session')} tone="success" />
              </div>

              <Card>
                <CardHeader title="Focus over 30 days" icon={<TrendingUp className="h-4 w-4" />} />
                <div className="p-2 pt-1">
                  <FocusBars data={stats?.trend ?? []} height={170} />
                </div>
              </Card>

              <Card>
                <CardHeader title="Where the time went" subtitle="Last 30 days" />
                <div className="p-4 pt-3">
                  {(stats?.topTasks.length ?? 0) === 0 ? (
                    <p className="py-4 text-center text-xs text-faint">
                      Link a task when you start a session and it will show up here.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {stats!.topTasks.map((task) => {
                        const max = stats!.topTasks[0].minutes || 1;
                        return (
                          <li key={task.taskId}>
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-ink">{task.title}</span>
                              <span className="shrink-0 tabular text-muted">{formatDuration(task.minutes)}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${(task.minutes / max) * 100}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Recent sessions" />
                <div className="p-4 pt-3">
                  {(stats?.recent.length ?? 0) === 0 ? (
                    <EmptyState compact title="No sessions yet" description="Your first focus block will appear here." />
                  ) : (
                    <ul className="space-y-1.5">
                      {stats!.recent.slice(0, 8).map((item) => (
                        <li key={item.id} className="flex items-center gap-2 text-xs">
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', item.completed ? 'bg-success' : 'bg-faint')} />
                          <span className="min-w-0 flex-1 truncate text-muted">{item.task?.title ?? 'Untitled focus'}</span>
                          <span className="shrink-0 tabular text-ink">{formatDuration(item.actualMinutes)}</span>
                          <span className="shrink-0 text-2xs text-faint">{formatRelativeTime(item.startedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
