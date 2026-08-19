import * as React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, PolarAngleAxis,
  PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn, formatDate, formatDuration } from '@/lib/utils';

/**
 * Chart wrappers. Every chart reads its colours from the theme tokens so light
 * and dark mode both stay legible, and all of them share one tooltip style.
 */

export const CHART_COLORS = {
  accent: 'rgb(var(--accent))',
  success: 'rgb(var(--success))',
  warning: 'rgb(var(--warning))',
  danger: 'rgb(var(--danger))',
  info: 'rgb(var(--info))',
  muted: 'rgb(var(--muted))',
  line: 'rgb(var(--line))',
  faint: 'rgb(var(--faint))',
};

export const CATEGORICAL = [
  'rgb(var(--accent))',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
];

const axisProps = {
  stroke: CHART_COLORS.faint,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  label?: string;
  formatter?: (value: number, key: string) => string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-elevated px-3 py-2 shadow-pop">
      <div className="mb-1 text-2xs font-semibold text-muted">
        {labelFormatter ? labelFormatter(String(label)) : label}
      </div>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted">{entry.name}</span>
          <span className="ml-auto font-medium tabular text-ink">
            {formatter ? formatter(entry.value ?? 0, String(entry.dataKey)) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChartFrame({
  height = 220,
  children,
  className,
}: {
  height?: number;
  children: React.ReactElement;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CompletionTrend({
  data,
  height = 240,
  showFocus,
}: {
  data: { date: string; completed: number; planned: number; focusMinutes?: number; score?: number }[];
  height?: number;
  showFocus?: boolean;
}) {
  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_COLORS.line} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          {...axisProps}
          tickFormatter={(value: string) => formatDate(value, 'short')}
          minTickGap={24}
        />
        <YAxis {...axisProps} allowDecimals={false} width={34} />
        <Tooltip content={<ChartTooltip labelFormatter={(l) => formatDate(l, 'medium')} />} />
        <Area
          type="monotone"
          dataKey="planned"
          name="Planned"
          stroke={CHART_COLORS.faint}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="transparent"
        />
        <Area
          type="monotone"
          dataKey="completed"
          name="Completed"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          fill="url(#gradCompleted)"
        />
        {showFocus && (
          <Line type="monotone" dataKey="focusMinutes" name="Focus (min)" stroke={CHART_COLORS.success} strokeWidth={1.6} dot={false} />
        )}
      </AreaChart>
    </ChartFrame>
  );
}

export function ScoreTrend({ data, height = 200 }: { data: { date: string; score: number }[]; height?: number }) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.line} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={(v: string) => formatDate(v, 'short')} minTickGap={26} />
        <YAxis {...axisProps} domain={[0, 100]} width={30} />
        <Tooltip content={<ChartTooltip labelFormatter={(l) => formatDate(l, 'medium')} />} />
        <Line
          type="monotone"
          dataKey="score"
          name="Score"
          stroke={CHART_COLORS.accent}
          strokeWidth={2.2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartFrame>
  );
}

export function FocusBars({ data, height = 200 }: { data: { date: string; minutes: number }[]; height?: number }) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.line} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={(v: string) => formatDate(v, 'short')} minTickGap={22} />
        <YAxis {...axisProps} width={34} />
        <Tooltip
          content={<ChartTooltip labelFormatter={(l) => formatDate(l, 'medium')} formatter={(v) => formatDuration(v)} />}
        />
        <Bar dataKey="minutes" name="Focus" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ChartFrame>
  );
}

export function WeekdayBars({
  data,
  height = 220,
}: {
  data: { short: string; completionRate: number; completed: number; avgScore: number }[];
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.line} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="short" {...axisProps} />
        <YAxis {...axisProps} width={38} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, 1]} />
        <Tooltip content={<ChartTooltip formatter={(v, key) => (key === 'completionRate' ? `${Math.round(v * 100)}%` : String(v))} />} />
        <Bar dataKey="completionRate" name="Completion" radius={[6, 6, 0, 0]} maxBarSize={40}>
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={
                entry.completionRate >= 0.8
                  ? CHART_COLORS.success
                  : entry.completionRate >= 0.5
                    ? CHART_COLORS.accent
                    : entry.completionRate > 0
                      ? CHART_COLORS.warning
                      : CHART_COLORS.line
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

export function CategoryBars({
  data,
  height = 240,
}: {
  data: { name: string; color: string; total: number; completed: number; completionRate: number }[];
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.line} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...axisProps} width={92} />
        <Tooltip content={<ChartTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }}
          iconType="circle"
          iconSize={7}
        />
        <Bar dataKey="completed" name="Completed" stackId="a" radius={[0, 0, 0, 0]} maxBarSize={22}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Bar>
        <Bar dataKey="total" name="Planned" stackId="b" fill={CHART_COLORS.line} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ChartFrame>
  );
}

export function PriorityRadar({
  data,
  height = 240,
}: {
  data: { name: string; completionRate: number }[];
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <RadarChart data={data.map((d) => ({ ...d, value: Math.round(d.completionRate * 100) }))} outerRadius="72%">
        <PolarGrid stroke={CHART_COLORS.line} />
        <PolarAngleAxis
          dataKey="name"
          tick={{ fill: CHART_COLORS.muted, fontSize: 11 }}
          tickFormatter={(value: string) => value.charAt(0).toUpperCase() + value.slice(1)}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={{ fill: CHART_COLORS.faint, fontSize: 10 }} axisLine={false} />
        <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} />
        <Radar
          name="Completion"
          dataKey="value"
          stroke={CHART_COLORS.accent}
          fill={CHART_COLORS.accent}
          fillOpacity={0.28}
          strokeWidth={2}
        />
      </RadarChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Calendar heatmap (GitHub-style, theme-aware)
// ---------------------------------------------------------------------------

export function Heatmap({
  days,
  onSelect,
  className,
}: {
  days: { date: string; level: number; completed: number; planned: number; score: number; focusMinutes: number }[];
  onSelect?: (date: string) => void;
  className?: string;
}) {
  // Pad the front so every column is a full Sun–Sat week.
  const padded = React.useMemo(() => {
    if (!days.length) return [];
    const first = days[0];
    const [y, m, d] = first.date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return [...Array.from({ length: dow }, () => null), ...days];
  }, [days]);

  const levelClass = [
    'bg-subtle',
    'bg-accent/25',
    'bg-accent/45',
    'bg-accent/70',
    'bg-accent',
  ];

  const monthLabels = React.useMemo(() => {
    const labels: { index: number; label: string }[] = [];
    let lastMonth = '';
    padded.forEach((day, index) => {
      if (!day) return;
      const month = day.date.slice(0, 7);
      if (month !== lastMonth && index % 7 <= 3) {
        labels.push({ index: Math.floor(index / 7), label: formatDate(day.date, 'short').split(' ')[1] });
        lastMonth = month;
      }
    });
    return labels;
  }, [padded]);

  return (
    <div className={cn('overflow-x-auto no-scrollbar', className)}>
      <div className="inline-block min-w-full">
        <div className="mb-1 flex gap-[3px] pl-7 text-2xs text-faint">
          {Array.from({ length: Math.ceil(padded.length / 7) }).map((_, week) => {
            const label = monthLabels.find((m) => m.index === week);
            return (
              <span key={week} className="w-[13px] shrink-0 text-center">
                {label ? label.label : ''}
              </span>
            );
          })}
        </div>

        <div className="flex gap-[3px]">
          <div className="flex w-6 shrink-0 flex-col gap-[3px] pr-1 text-2xs text-faint">
            {['', 'M', '', 'W', '', 'F', ''].map((label, index) => (
              <span key={index} className="flex h-[13px] items-center justify-end leading-none">
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {padded.map((day, index) =>
              day === null ? (
                <span key={`pad-${index}`} className="h-[13px] w-[13px]" />
              ) : (
                <button
                  key={day.date}
                  onClick={() => onSelect?.(day.date)}
                  title={`${formatDate(day.date, 'medium')} — ${day.completed}/${day.planned} tasks, score ${day.score}`}
                  className={cn(
                    'h-[13px] w-[13px] rounded-[3px] transition-transform hover:scale-125 hover:ring-1 hover:ring-accent',
                    levelClass[day.level] ?? 'bg-subtle',
                  )}
                  aria-label={`${day.date}: ${day.completed} tasks completed`}
                />
              ),
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5 pl-7 text-2xs text-faint">
          <span>Less</span>
          {levelClass.map((cls, index) => (
            <span key={index} className={cn('h-[11px] w-[11px] rounded-[3px]', cls)} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
