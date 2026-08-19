import * as React from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Grid2x2, ListTodo, Plus, Sparkles, Wand2,
} from 'lucide-react';
import { useTasks, usePlanMyDay, useEisenhower, useTaskMutations } from '@/lib/queries';
import { useTaskActions } from '@/hooks/useTaskActions';
import { TaskDragHandle, TaskItem } from '@/components/TaskItem';
import { Button, Card, EmptyState, IconButton, Input, PageHeader, SegmentedControl, Skeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useUser } from '@/state/auth';
import { addDays, cn, formatDate, formatDuration, pluralize, todayStr } from '@/lib/utils';
import type { Task } from '@/lib/types';

type View = 'list' | 'matrix';

export default function Today() {
  const user = useUser();
  const realToday = todayStr(user.timezone);
  const [date, setDate] = React.useState(realToday);
  const [view, setView] = React.useState<View>('list');
  const [quickTitle, setQuickTitle] = React.useState('');

  const { data, isLoading, refetch } = useTasks({ view: 'all', date });
  const { actions, editor, openNew } = useTaskActions({ defaultDate: date });
  const { reorder, create } = useTaskMutations();
  const planMyDay = usePlanMyDay();
  const toast = useToast();

  const [ordered, setOrdered] = React.useState<Task[]>([]);
  React.useEffect(() => {
    if (data?.tasks) setOrdered(data.tasks);
  }, [data?.tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const open = ordered.filter((task) => task.status !== 'completed');
  const completed = ordered.filter((task) => task.status === 'completed');
  const estimated = open.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const isToday = date === realToday;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = open.findIndex((task) => task.id === active.id);
    const newIndex = open.findIndex((task) => task.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(open, oldIndex, newIndex);
    setOrdered([...next, ...completed]);
    reorder.mutate(
      next.map((task, index) => ({ id: task.id, order: index + 1 })),
      { onError: () => { toast.error('Could not save the new order'); void refetch(); } },
    );
  };

  const quickAdd = () => {
    const title = quickTitle.trim();
    if (!title) return;
    create.mutate(
      { title, date, priority: user.settings.defaultPriority },
      {
        onSuccess: () => setQuickTitle(''),
        onError: (err) => toast.error('Could not add', (err as Error).message),
      },
    );
  };

  return (
    <div>
      <PageHeader
        title={isToday ? 'Today' : formatDate(date, 'long')}
        description={
          isLoading
            ? 'Loading…'
            : open.length === 0
              ? completed.length > 0
                ? `All ${pluralize(completed.length, 'task')} done — nicely closed out.`
                : 'Nothing planned for this day yet.'
              : `${pluralize(open.length, 'task')} left · about ${formatDuration(estimated)} of work`
        }
        actions={
          <>
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List', icon: <ListTodo className="h-3.5 w-3.5" /> },
                { value: 'matrix', label: 'Matrix', icon: <Grid2x2 className="h-3.5 w-3.5" /> },
              ]}
            />
            {isToday && (
              <Button
                variant="outline"
                icon={<Wand2 className="h-4 w-4" />}
                loading={planMyDay.isPending}
                onClick={() =>
                  planMyDay.mutate(undefined, {
                    onSuccess: (result) =>
                      toast.success(
                        'Day planned',
                        result.overCapacity ? 'Reordered — but you are over capacity today.' : 'Reordered by urgency and effort.',
                      ),
                  })
                }
              >
                Plan my day
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(date)}>
              New task
            </Button>
          </>
        }
      >
        <div className="mt-3 flex items-center gap-1.5">
          <IconButton label="Previous day" size="sm" variant="outline" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value || realToday)}
            className="h-8 w-auto text-xs"
          />
          <IconButton label="Next day" size="sm" variant="outline" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          {!isToday && (
            <Button size="xs" variant="subtle" onClick={() => setDate(realToday)} icon={<CalendarDays className="h-3.5 w-3.5" />}>
              Back to today
            </Button>
          )}
        </div>
      </PageHeader>

      {view === 'matrix' ? (
        <EisenhowerMatrix actions={actions} today={realToday} />
      ) : (
        <div className="space-y-4">
          {/* inline quick add */}
          <Card className="flex items-center gap-2 p-2">
            <Plus className="ml-1.5 h-4 w-4 shrink-0 text-faint" />
            <input
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') quickAdd();
              }}
              placeholder="Add a task to this day and press Enter…"
              className="h-8 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
            {quickTitle.trim() && (
              <Button size="sm" variant="primary" onClick={quickAdd} loading={create.isPending}>
                Add
              </Button>
            )}
          </Card>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : ordered.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Sparkles className="h-5 w-5" />}
                title={isToday ? 'Nothing planned yet' : 'No tasks on this day'}
                description="Add what matters — or use Quick capture and write it the way you'd say it out loud."
                action={
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(date)}>
                    Add a task
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              {open.length > 0 && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                >
                  <SortableContext items={open.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {open.map((task) => (
                        <SortableTask key={task.id} task={task} today={realToday} actions={actions} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {completed.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="text-xs font-medium text-muted">{pluralize(completed.length, 'completed task')}</span>
                    <div className="h-px flex-1 bg-line" />
                  </div>
                  <div className="space-y-2">
                    {completed.map((task) => (
                      <TaskItem key={task.id} task={task} today={realToday} actions={actions} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {editor}
    </div>
  );
}

function SortableTask({ task, today, actions }: { task: Task; today: string; actions: ReturnType<typeof useTaskActions>['actions'] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'z-10 opacity-80 shadow-pop')}
    >
      <TaskItem
        task={task}
        today={today}
        actions={actions}
        dragHandle={
          <span {...attributes} {...listeners} className="block touch-none">
            <TaskDragHandle />
          </span>
        }
      />
    </div>
  );
}

const QUADRANTS = [
  { key: 'do' as const, title: 'Do now', subtitle: 'Urgent & important', tone: 'border-danger/30 bg-danger/[0.04]', dot: 'bg-danger' },
  { key: 'schedule' as const, title: 'Schedule', subtitle: 'Important, not urgent', tone: 'border-accent/30 bg-accent/[0.04]', dot: 'bg-accent' },
  { key: 'delegate' as const, title: 'Minimise', subtitle: 'Urgent, not important', tone: 'border-warning/30 bg-warning/[0.04]', dot: 'bg-warning' },
  { key: 'eliminate' as const, title: 'Drop or defer', subtitle: 'Neither urgent nor important', tone: 'border-line bg-subtle/40', dot: 'bg-faint' },
];

function EisenhowerMatrix({ actions, today }: { actions: ReturnType<typeof useTaskActions>['actions']; today: string }) {
  const { data, isLoading } = useEisenhower();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-56 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {QUADRANTS.map((quadrant) => {
        const tasks = (data?.quadrants[quadrant.key] ?? []) as unknown as Task[];
        return (
          <Card key={quadrant.key} className={cn('flex min-h-[220px] flex-col', quadrant.tone)}>
            <div className="flex items-center gap-2 border-b border-line/60 px-4 py-3">
              <span className={cn('h-2 w-2 rounded-full', quadrant.dot)} />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink">{quadrant.title}</h3>
                <p className="text-2xs text-muted">{quadrant.subtitle}</p>
              </div>
              <span className="ml-auto rounded-md bg-surface px-1.5 py-0.5 text-2xs font-medium tabular text-muted">
                {tasks.length}
              </span>
            </div>

            <div className="flex-1 space-y-1.5 p-3">
              {tasks.length === 0 ? (
                <p className="py-6 text-center text-xs text-faint">Empty — that is a good sign.</p>
              ) : (
                tasks.slice(0, 12).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => actions.onEdit?.(task)}
                    className="flex w-full items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface/70"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{task.title}</span>
                    <span className="shrink-0 text-2xs text-faint">{formatDate(task.date, 'short')}</span>
                  </button>
                ))
              )}
              {tasks.length > 12 && <p className="pt-1 text-center text-2xs text-faint">+{tasks.length - 12} more</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
