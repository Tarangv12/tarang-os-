import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Award, CalendarCheck, CheckCircle2, Flame, Minus, Target, Timer, TrendingDown, TrendingUp,
} from 'lucide-react';
import { useAnalytics, useHeatmap, useRecords } from '@/lib/queries';
import { Badge, Card, CardHeader, PageHeader, Progress as Bar, ProgressRing, SegmentedControl, Skeleton, StatTile } from '@/components/ui/primitives';
import { CompletionTrend, Heatmap, ScoreTrend, WeekdayBars } from '@/components/charts';
import { cn, formatDate, formatDuration, formatMonth, percent, pluralize, scoreTone } from '@/lib/utils';

type Range = '7' | '30' | '90' | '180' | '365';

const RANGE_LABEL: Record<Range, string> = {
  '7': 'Week',
  '30': 'Month',
  '90': '3 months',
  '180': '6 months',
  '365': 'Year',
};

export default function ProgressPage() {
  const [range, setRange] = React.useState<Range>('30');
  const { data, isLoading } = useAnalytics(range);
  const { data: heatmap } = useHeatmap(182);
  const { data: records } = useRecords();
  const navigate = useNavigate();

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const { totals, comparison } = data;
  const tone = scoreTone(totals.avgScore);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Progress"
        description={`${formatDate(data.range.from, 'medium')} → ${formatDate(data.range.to, 'medium')} · ${pluralize(data.range.days, 'day')}`}
        actions={
          <SegmentedControl
            value={range}
            onChange={setRange}
            options={(Object.keys(RANGE_LABEL) as Range[]).map((value) => ({ value, label: RANGE_LABEL[value] }))}
          />
        }
      />

      {/* headline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        <Card className="card-pad">
          <div className="flex items-center gap-5">
            <ProgressRing value={totals.avgScore / 100} size={108} stroke={10} color={tone.ring}>
              <span className="text-2xl font-semibold tabular text-ink">{totals.avgScore}</span>
              <span className="text-2xs text-muted">avg score</span>
            </ProgressRing>
            <div className="min-w-0">
              <div className={cn('inline-flex rounded-lg px-2 py-1 text-xs font-medium', tone.bg, tone.text)}>{tone.label}</div>
              <Delta value={comparison.scoreDelta} suffix=" pts" label="vs previous period" className="mt-2" />
            </div>
          </div>

          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted">Completion rate</span>
                <span className="font-medium tabular text-ink">{percent(totals.completionRate)}</span>
              </div>
              <Bar value={totals.completionRate} height={6} />
            </div>
            <Delta value={comparison.completionRateDelta * 100} suffix="%" label="change in completion rate" decimals={1} />
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Completed" value={totals.completed} sublabel={`of ${totals.planned} planned`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} tone="success" />
          <StatTile label="Missed" value={totals.missed} sublabel="rolled past their day" icon={<TrendingDown className="h-3.5 w-3.5" />} tone={totals.missed ? 'danger' : 'info'} />
          <StatTile label="Postponed" value={totals.postponed} sublabel="times moved" icon={<CalendarCheck className="h-3.5 w-3.5" />} tone="warning" />
          <StatTile label="Focus" value={`${totals.focusHours}h`} sublabel={`${formatDuration(Math.round(totals.avgFocusPerDay))}/day`} icon={<Timer className="h-3.5 w-3.5" />} tone="accent" />
          <StatTile label="Per day" value={totals.avgTasksPerDay.toFixed(1)} sublabel="tasks completed" tone="accent" />
          <StatTile label="Per active day" value={totals.avgTasksPerActiveDay.toFixed(1)} sublabel={`${totals.activeDays} active days`} tone="info" />
          <StatTile label="Current streak" value={`${data.streaks.current}d`} sublabel={`best ${data.streaks.best}d`} icon={<Flame className="h-3.5 w-3.5" />} tone="warning" />
          <StatTile label="vs previous" value={comparison.completedDelta >= 0 ? `+${comparison.completedDelta}` : comparison.completedDelta} sublabel="tasks completed" tone={comparison.completedDelta >= 0 ? 'success' : 'danger'} />
        </div>
      </div>

      {/* trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Planned vs completed" subtitle={RANGE_LABEL[range]} icon={<TrendingUp className="h-4 w-4" />} />
          <div className="p-2 sm:p-3">
            <CompletionTrend data={data.daily} height={230} showFocus />
          </div>
        </Card>

        <Card>
          <CardHeader title="Daily score" subtitle="How consistent the days were" />
          <div className="p-2 sm:p-3">
            <ScoreTrend data={data.daily} height={230} />
          </div>
        </Card>
      </div>

      {/* heatmap */}
      <Card>
        <CardHeader
          title="Consistency heatmap"
          subtitle="Last 6 months — darker means a stronger day"
          action={<span className="text-2xs text-faint">Click a day to open it</span>}
        />
        <div className="p-4 pt-3">
          {heatmap ? (
            <Heatmap days={heatmap.days} onSelect={(date) => navigate(`/history/${date}`)} />
          ) : (
            <Skeleton className="h-28" />
          )}
        </div>
      </Card>

      {/* weekday + rollups */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Performance by weekday"
            subtitle={
              data.weekday.best && data.weekday.weakest
                ? `Strongest on ${data.weekday.best.name}, weakest on ${data.weekday.weakest.name}`
                : 'Not enough data yet'
            }
          />
          <div className="p-2 sm:p-3">
            <WeekdayBars data={data.weekday.rows} height={220} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Personal records" icon={<Award className="h-4 w-4" />} />
          <div className="space-y-2.5 p-4 pt-3">
            {records ? (
              <>
                <RecordRow label="Best day" value={records.bestDay ? `${records.bestDay.completed} tasks` : '—'} sub={records.bestDay ? formatDate(records.bestDay.date, 'medium') : undefined} />
                <RecordRow label="Highest score" value={records.bestScoreDay ? `${records.bestScoreDay.score}/100` : '—'} sub={records.bestScoreDay ? formatDate(records.bestScoreDay.date, 'medium') : undefined} />
                <RecordRow label="Deepest focus day" value={records.bestFocusDay ? formatDuration(records.bestFocusDay.focusMinutes) : '—'} sub={records.bestFocusDay ? formatDate(records.bestFocusDay.date, 'medium') : undefined} />
                <RecordRow label="Best week" value={records.bestWeek ? `${records.bestWeek.completed} tasks` : '—'} sub={records.bestWeek ? `week of ${formatDate(records.bestWeek.week, 'short')}` : undefined} />
                <RecordRow label="Best month" value={records.bestMonth ? `${records.bestMonth.completed} tasks` : '—'} sub={records.bestMonth ? formatMonth(records.bestMonth.month) : undefined} />
                <RecordRow label="Longest streak" value={`${records.streaks.best} days`} />

                <div className="mt-3 border-t border-line pt-3">
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-faint">All time</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-lg font-semibold tabular text-ink">{records.lifetime.tasksCompleted}</div>
                      <div className="text-2xs text-muted">tasks completed</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold tabular text-ink">{records.lifetime.focusHours}h</div>
                      <div className="text-2xs text-muted">focused</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold tabular text-ink">{records.lifetime.habitCheckIns}</div>
                      <div className="text-2xs text-muted">habit check-ins</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold tabular text-ink">{records.lifetime.daysTracked}</div>
                      <div className="text-2xs text-muted">active days</div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <Skeleton className="h-52" />
            )}
          </div>
        </Card>
      </div>

      {/* weekly / monthly tables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="By week" />
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-2 font-medium">Week of</th>
                  <th className="px-2 py-2 text-right font-medium">Done</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                  <th className="px-2 py-2 text-right font-medium">Focus</th>
                  <th className="px-4 py-2 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {[...data.weekly].reverse().map((week) => (
                  <tr key={week.week} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 text-muted">{formatDate(week.week, 'short')}</td>
                    <td className="px-2 py-2 text-right tabular text-ink">{week.completed}/{week.planned}</td>
                    <td className="px-2 py-2 text-right tabular text-muted">{percent(week.completionRate)}</td>
                    <td className="px-2 py-2 text-right tabular text-muted">{formatDuration(week.focusMinutes)}</td>
                    <td className="px-4 py-2 text-right">
                      <Badge tone={week.avgScore >= 70 ? 'success' : week.avgScore >= 45 ? 'accent' : 'warning'}>{week.avgScore}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="By month" />
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-2 font-medium">Month</th>
                  <th className="px-2 py-2 text-right font-medium">Done</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                  <th className="px-2 py-2 text-right font-medium">Focus</th>
                  <th className="px-4 py-2 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {[...data.monthly].reverse().map((month) => (
                  <tr key={month.month} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 text-muted">{formatMonth(month.month)}</td>
                    <td className="px-2 py-2 text-right tabular text-ink">{month.completed}/{month.planned}</td>
                    <td className="px-2 py-2 text-right tabular text-muted">{percent(month.completionRate)}</td>
                    <td className="px-2 py-2 text-right tabular text-muted">{formatDuration(month.focusMinutes)}</td>
                    <td className="px-4 py-2 text-right">
                      <Badge tone={month.avgScore >= 70 ? 'success' : month.avgScore >= 45 ? 'accent' : 'warning'}>{month.avgScore}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Delta({
  value,
  suffix = '',
  label,
  className,
  decimals = 0,
}: {
  value: number;
  suffix?: string;
  label: string;
  className?: string;
  decimals?: number;
}) {
  const positive = value > 0.05;
  const negative = value < -0.05;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : Minus;
  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium',
          positive ? 'bg-success/10 text-success' : negative ? 'bg-danger/10 text-danger' : 'bg-subtle text-muted',
        )}
      >
        <Icon className="h-3 w-3" />
        {value > 0 ? '+' : ''}
        {value.toFixed(decimals)}
        {suffix}
      </span>
      <span className="text-faint">{label}</span>
    </div>
  );
}

function RecordRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        {sub && <div className="text-2xs text-faint">{sub}</div>}
      </div>
      <div className="shrink-0 text-sm font-semibold tabular text-ink">{value}</div>
    </div>
  );
}
