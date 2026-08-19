import * as React from 'react';
import {
  AlarmClock, Archive, CalendarClock, Check, ChevronRight, Copy, Focus, GripVertical, MoreHorizontal,
  Pencil, Pin, PinOff, Repeat, RotateCcw, Timer, Trash2, Undo2,
} from 'lucide-react';
import type { Task } from '@/lib/types';
import { cn, formatDuration, formatTime, isOverdue, PRIORITY_META, relativeDay } from '@/lib/utils';
import { Checkbox, IconButton } from './ui/primitives';
import { Dropdown } from './ui/Dropdown';

export type TaskActions = {
  onToggle: (task: Task) => void;
  onEdit?: (task: Task) => void;
  onPostpone?: (task: Task, days: number) => void;
  onDuplicate?: (task: Task) => void;
  onArchive?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onPin?: (task: Task) => void;
  onFocus?: (task: Task) => void;
  onToggleSubtask?: (task: Task, subtaskId: string, done: boolean) => void;
};

export function TaskItem({
  task,
  today,
  actions,
  dragHandle,
  selected,
  onSelect,
  showDate,
  compact,
  className,
}: {
  task: Task;
  today: string;
  actions: TaskActions;
  dragHandle?: React.ReactNode;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  showDate?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const done = task.status === 'completed';
  const overdue = isOverdue(task, today);
  const priority = PRIORITY_META[task.priority];
  const hasDetail = task.description || task.subtasks.length > 0 || task.notes;

  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-surface transition-all duration-150',
        selected ? 'border-accent/50 bg-accent/[0.04]' : 'border-line hover:border-line/80 hover:shadow-card',
        done && 'opacity-60',
        className,
      )}
    >
      <div className={cn('flex items-start gap-2.5', compact ? 'p-2.5' : 'p-3')}>
        {dragHandle && (
          <div className="mt-0.5 hidden shrink-0 cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing sm:block">
            {dragHandle}
          </div>
        )}

        {onSelect && (
          <div className="mt-0.5 shrink-0">
            <Checkbox checked={Boolean(selected)} onChange={(checked) => onSelect(task.id, checked)} />
          </div>
        )}

        <div className="mt-0.5 shrink-0">
          <Checkbox checked={done} onChange={() => actions.onToggle(task)} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              onClick={() => (hasDetail ? setExpanded((prev) => !prev) : actions.onEdit?.(task))}
              className="min-w-0 flex-1 text-left"
            >
              <span
                className={cn(
                  'block text-sm font-medium leading-snug',
                  done ? 'text-faint line-through' : 'text-ink',
                )}
              >
                {task.pinned && <Pin className="mr-1 inline h-3 w-3 -translate-y-px text-accent" />}
                {task.title}
              </span>
            </button>

            {hasDetail && (
              <button
                onClick={() => setExpanded((prev) => !prev)}
                aria-label={expanded ? 'Collapse' : 'Expand'}
                className="mt-0.5 shrink-0 text-faint transition-transform hover:text-muted"
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')} />
              </button>
            )}
          </div>

          {/* meta row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs">
            <span className={cn('inline-flex items-center gap-1 font-medium', priority.text)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', priority.dot)} />
              {priority.label}
            </span>

            {showDate && (
              <span className={cn('inline-flex items-center gap-1', overdue ? 'font-medium text-danger' : 'text-muted')}>
                <CalendarClock className="h-3 w-3" />
                {relativeDay(task.date, today)}
              </span>
            )}

            {task.startTime && (
              <span className="inline-flex items-center gap-1 text-muted">
                <AlarmClock className="h-3 w-3" />
                {formatTime(task.startTime)}
                {task.dueTime && ` – ${formatTime(task.dueTime)}`}
              </span>
            )}

            {!task.startTime && task.dueTime && (
              <span className="inline-flex items-center gap-1 text-muted">
                <AlarmClock className="h-3 w-3" />
                due {formatTime(task.dueTime)}
              </span>
            )}

            {task.estimatedMinutes > 0 && (
              <span className="inline-flex items-center gap-1 text-muted">
                <Timer className="h-3 w-3" />
                {formatDuration(task.estimatedMinutes)}
                {task.actualMinutes > 0 && ` / ${formatDuration(task.actualMinutes)}`}
              </span>
            )}

            {task.category && (
              <span className="inline-flex items-center gap-1 text-muted">
                <span className="h-2 w-2 rounded-sm" style={{ background: task.category.color }} />
                {task.category.name}
              </span>
            )}

            {task.project && (
              <span className="inline-flex items-center gap-1 rounded px-1 text-muted" style={{ color: task.project.color }}>
                {task.project.name}
              </span>
            )}

            {task.subtaskCount > 0 && (
              <span className={cn('inline-flex items-center gap-1', task.subtasksDone === task.subtaskCount ? 'text-success' : 'text-muted')}>
                <Check className="h-3 w-3" />
                {task.subtasksDone}/{task.subtaskCount}
              </span>
            )}

            {task.isRecurring && (
              <span className="inline-flex items-center gap-1 text-muted" title={task.recurrenceLabel ?? 'Repeats'}>
                <Repeat className="h-3 w-3" />
                {task.recurrenceLabel ?? 'Repeats'}
              </span>
            )}

            {task.postponedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-warning" title={`Moved ${task.postponedCount} times`}>
                <Undo2 className="h-3 w-3" />
                {task.postponedCount}×
              </span>
            )}

            {task.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded px-1 py-px font-medium"
                style={{ color: tag.color, background: `${tag.color}18` }}
              >
                #{tag.name}
              </span>
            ))}
          </div>

          {expanded && hasDetail && (
            <div className="mt-2.5 space-y-2.5 border-t border-line pt-2.5">
              {task.description && <p className="text-xs leading-relaxed text-muted">{task.description}</p>}

              {task.subtasks.length > 0 && (
                <ul className="space-y-1.5">
                  {task.subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <Checkbox
                        checked={subtask.done}
                        onChange={(checked) => actions.onToggleSubtask?.(task, subtask.id, checked)}
                        label={
                          <span className={cn('text-xs', subtask.done ? 'text-faint line-through' : 'text-muted')}>
                            {subtask.title}
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}

              {task.notes && (
                <div className="rounded-lg bg-subtle/60 p-2 text-xs leading-relaxed text-muted">{task.notes}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {actions.onFocus && !done && (
            <IconButton
              label="Start focus session"
              size="sm"
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              onClick={() => actions.onFocus?.(task)}
            >
              <Focus className="h-3.5 w-3.5" />
            </IconButton>
          )}

          <Dropdown
            items={[
              ...(actions.onEdit ? [{ label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => actions.onEdit!(task) }] : []),
              ...(actions.onPin
                ? [{
                    label: task.pinned ? 'Unpin' : 'Pin to top',
                    icon: task.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
                    onSelect: () => actions.onPin!(task),
                  }]
                : []),
              ...(actions.onFocus && !done
                ? [{ label: 'Focus on this', icon: <Focus className="h-4 w-4" />, onSelect: () => actions.onFocus!(task) }]
                : []),
              ...(actions.onPostpone && !done
                ? ([
                    { type: 'separator' as const },
                    { type: 'label' as const, label: 'Postpone' },
                    { label: 'To tomorrow', icon: <CalendarClock className="h-4 w-4" />, onSelect: () => actions.onPostpone!(task, 1) },
                    { label: 'By 3 days', icon: <CalendarClock className="h-4 w-4" />, onSelect: () => actions.onPostpone!(task, 3) },
                    { label: 'By a week', icon: <CalendarClock className="h-4 w-4" />, onSelect: () => actions.onPostpone!(task, 7) },
                  ])
                : []),
              { type: 'separator' as const },
              ...(actions.onDuplicate
                ? [{ label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onSelect: () => actions.onDuplicate!(task) }]
                : []),
              ...(actions.onArchive
                ? [{
                    label: task.archivedAt ? 'Restore' : 'Archive',
                    icon: task.archivedAt ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />,
                    onSelect: () => actions.onArchive!(task),
                  }]
                : []),
              ...(actions.onDelete
                ? [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => actions.onDelete!(task), danger: true }]
                : []),
            ]}
            trigger={({ toggle, ref }) => (
              <IconButton
                ref={ref}
                label="Task actions"
                size="sm"
                onClick={toggle}
                className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            )}
          />
        </div>
      </div>

      {task.subtaskCount > 0 && !expanded && task.subtasksDone < task.subtaskCount && (
        <div className="h-0.5 overflow-hidden rounded-b-xl bg-subtle">
          <div
            className="h-full bg-accent/50 transition-[width] duration-500"
            style={{ width: `${(task.subtasksDone / task.subtaskCount) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function TaskDragHandle() {
  return <GripVertical className="h-4 w-4" />;
}
