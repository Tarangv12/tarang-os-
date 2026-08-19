import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BarChart3, Layers, PieChart, Repeat, Zap } from 'lucide-react';
import { useAnalytics, useMissReasons } from '@/lib/queries';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress as Bar, SegmentedControl, Skeleton } from '@/components/ui/primitives';
import { CategoryBars, Heatmap, PriorityRadar } from '@/components/charts';
import { useHeatmap } from '@/lib/queries';
import { cn, formatDate, percent, pluralize, PRIORITY_META } from '@/lib/utils';

type Range = '7' | '30' | '90' | '180' | '365';

const RANGE_LABEL: Record<Range, string> = {
  '7': 'Week', '30': 'Month', '90': '3 months', '180': '6 months', '365': 'Year',
};

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

export default function Analytics() {
  const [range, setRange] = React.useState<Range>('90');
  const { data, isLoading } = useAnalytics(range);
  const { data: heatmap } = useHeatmap(182);
  const { data: reasons } = useMissReasons(180);
  const navigate = useNavigate();

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-52" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const categories = data.byCategory.filter((row) => row.total > 0);
  const projects = data.byProject.filter((row) => row.total > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        description="Where your effort actually goes, and what keeps getting in the way."
        actions={
          <SegmentedControl
            value={range}
            onChange={setRange}
            options={(Object.keys(RANGE_LABEL) as Range[]).map((value) => ({ value, label: RANGE_LABEL[value] }))}
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* by category */}
        <Card>
          <CardHeader
            title="Category performance"
            subtitle={
              categories.length ? `${pluralize(categories.length, 'category', 'categories')} in this range` : 'No categorised tasks yet'
            }
            icon={<PieChart className="h-4 w-4" />}
          />
          <div className="p-2 sm:p-3">
            {categories.length === 0 ? (
              <EmptyState compact title="Nothing to compare" description="Assign categories to tasks and this chart fills in." />
            ) : (
              <>
                <CategoryBars data={categories.slice(0, 8)} height={Math.max(180, categories.slice(0, 8).length * 34)} />
                <div className="mt-2 space-y-2 px-2 pb-2">
                  {categories.slice(0, 8).map((row) => (
                    <div key={row.name}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
                          <span className="truncate text-muted">{row.name}</span>
                        </span>
                        <span className="shrink-0 tabular text-ink">
                          {row.completed}/{row.total} · {percent(row.completionRate)}
                        </span>
                      </div>
                      <Bar value={row.completionRate} color={row.color} height={4} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        {/* by priority */}
        <Card>
          <CardHeader title="Completion by priority" subtitle="Are the important things actually getting done?" icon={<Zap className="h-4 w-4" />} />
          <div className="p-2 sm:p-3">
            <PriorityRadar data={data.byPriority} height={230} />
            <div className="mt-1 space-y-2 px-2 pb-2">
              {data.byPriority.map((row) => (
                <div key={row.key} className="flex items-center gap-2.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_META[row.key as 'high'].dot)} />
                  <span className="w-16 shrink-0 text-xs capitalize text-muted">{row.name}</span>
                  <div className="flex-1">
                    <Bar value={row.completionRate} height={5} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs tabular text-ink">
                    {row.completed}/{row.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* projects */}
      {projects.length > 0 && (
        <Card>
          <CardHeader title="Project throughput" subtitle={`${pluralize(projects.length, 'project')} with activity`} icon={<Layers className="h-4 w-4" />} />
          <div className="grid gap-3 p-4 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((row) => (
              <div key={row.key} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span className="min-w-0 truncate text-xs font-medium text-ink">{row.name}</span>
                  <span className="ml-auto shrink-0 text-2xs tabular text-muted">{percent(row.completionRate)}</span>
                </div>
                <Bar value={row.completionRate} color={row.color} height={5} />
                <p className="mt-1.5 text-2xs text-faint">{row.completed} of {row.total} tasks completed</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* heatmap */}
      <Card>
        <CardHeader title="Six-month heatmap" subtitle="Every tracked day since you started" />
        <div className="p-4 pt-3">
          {heatmap ? <Heatmap days={heatmap.days} onSelect={(date) => navigate(`/history/${date}`)} /> : <Skeleton className="h-28" />}
        </div>
      </Card>

      {/* why things slip */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Why tasks get missed"
            subtitle={reasons ? `From ${pluralize(reasons.totalReviews, 'review')} over 6 months` : undefined}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <div className="p-4 pt-3">
            {!reasons ? (
              <Skeleton className="h-40" />
            ) : reasons.reasons.length === 0 ? (
              <EmptyState
                compact
                title="No patterns yet"
                description="Record a few end-of-day reviews and the recurring reasons will surface here."
              />
            ) : (
              <ul className="space-y-2.5">
                {reasons.reasons.slice(0, 8).map((row, index) => (
                  <li key={row.reason}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-subtle text-2xs font-semibold tabular text-muted">
                          {index + 1}
                        </span>
                        <span className="truncate text-ink">
                          {REASON_LABEL[row.reason] ?? row.reason.replace(/_/g, ' ')}
                        </span>
                      </span>
                      <span className="shrink-0 tabular text-muted">
                        {row.count}× · {percent(row.share)}
                      </span>
                    </div>
                    <Bar
                      value={row.share}
                      height={4}
                      color={index === 0 ? 'rgb(var(--danger))' : index < 3 ? 'rgb(var(--warning))' : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Most postponed tasks" subtitle="These may be too big, or badly timed" icon={<Repeat className="h-4 w-4" />} />
          <div className="p-4 pt-3">
            {!reasons ? (
              <Skeleton className="h-40" />
            ) : reasons.mostPostponed.length === 0 ? (
              <EmptyState compact title="Nothing keeps slipping" description="Not a single task has been moved more than once. That is unusually good." />
            ) : (
              <ul className="space-y-2">
                {reasons.mostPostponed.map((task) => (
                  <li key={task.id} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_META[task.priority as 'high'].dot)} />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{task.title}</span>
                    <span className="shrink-0 text-2xs text-faint">{formatDate(task.date, 'short')}</span>
                    <Badge tone={task.postponedCount >= 5 ? 'danger' : 'warning'}>{task.postponedCount}×</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* weekday detail table */}
      <Card>
        <CardHeader title="Weekday breakdown" icon={<BarChart3 className="h-4 w-4" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2 font-medium">Day</th>
                <th className="px-3 py-2 text-right font-medium">Planned</th>
                <th className="px-3 py-2 text-right font-medium">Completed</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Avg score</th>
                <th className="px-4 py-2 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {data.weekday.rows.map((row) => {
                const best = data.weekday.best?.name === row.name;
                const weakest = data.weekday.weakest?.name === row.name;
                return (
                  <tr key={row.name} className={cn('border-b border-line/60 last:border-0', best && 'bg-success/[0.05]', weakest && 'bg-warning/[0.05]')}>
                    <td className="px-4 py-2 text-ink">
                      {row.name}
                      {best && <Badge tone="success" className="ml-2">strongest</Badge>}
                      {weakest && <Badge tone="warning" className="ml-2">weakest</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted">{row.planned}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{row.completed}</td>
                    <td className="px-3 py-2 text-right tabular text-muted">{percent(row.completionRate)}</td>
                    <td className="px-3 py-2 text-right tabular text-muted">{row.avgScore}</td>
                    <td className="px-4 py-2 text-right tabular text-faint">{row.days}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
