import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive, CheckCircle2, Filter, Inbox, ListFilter, Plus, RotateCcw, Search, Tag as TagIcon,
  Trash2, X,
} from 'lucide-react';
import { useCategories, useProjects, useTags, useTaskMutations, useTasks, type TaskQuery } from '@/lib/queries';
import { useTaskActions } from '@/hooks/useTaskActions';
import { TaskItem } from '@/components/TaskItem';
import {
  Badge, Button, Card, Checkbox, EmptyState, IconButton, Input, PageHeader, Select, Skeleton,
} from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Modal';
import { cn, debounce, formatDate, pluralize, relativeDay, todayStr } from '@/lib/utils';
import { useUser } from '@/state/auth';
import type { Task } from '@/lib/types';

const VIEWS: { value: NonNullable<TaskQuery['view']>; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export default function Tasks() {
  const user = useUser();
  const today = todayStr(user.timezone);
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = React.useState<NonNullable<TaskQuery['view']>>(
    (searchParams.get('view') as NonNullable<TaskQuery['view']>) || 'all',
  );
  const [search, setSearch] = React.useState('');
  const [searchInput, setSearchInput] = React.useState('');
  const [priority, setPriority] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [tag, setTag] = React.useState('');
  const [sort, setSort] = React.useState<NonNullable<TaskQuery['sort']>>('smart');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = React.useState(false);

  const focusId = searchParams.get('focus');

  const params: TaskQuery = {
    view,
    search: search || undefined,
    priority: priority || undefined,
    categoryId: categoryId || undefined,
    projectId: projectId || undefined,
    tag: tag || undefined,
    sort,
    limit: 500,
  };

  const { data, isLoading, refetch } = useTasks(params);
  const { data: categoryData } = useCategories();
  const { data: projectData } = useProjects();
  const { data: tagData } = useTags();
  const { actions, editor, openNew, openEdit } = useTaskActions({ defaultDate: today });
  const { bulk } = useTaskMutations();
  const toast = useToast();
  const confirm = useConfirm();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const applySearch = React.useCallback(debounce((value: string) => setSearch(value), 320), []);
  React.useEffect(() => applySearch(searchInput), [searchInput, applySearch]);

  React.useEffect(() => {
    setSearchParams(view === 'all' ? {} : { view }, { replace: true });
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Deep link from the command palette: open that task's editor once.
  const openedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!focusId || !data?.tasks || openedRef.current === focusId) return;
    const task = data.tasks.find((item) => item.id === focusId);
    if (task) {
      openedRef.current = focusId;
      openEdit(task);
      setSearchParams({}, { replace: true });
    }
  }, [focusId, data?.tasks, openEdit, setSearchParams]);

  const tasks = data?.tasks ?? [];
  const activeFilters = [priority, categoryId, projectId, tag].filter(Boolean).length;

  const grouped = React.useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = map.get(task.date);
      if (list) list.push(task);
      else map.set(task.date, [task]);
    }
    return Array.from(map.entries()).sort((a, b) =>
      view === 'completed' || view === 'archived' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]),
    );
  }, [tasks, view]);

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runBulk = async (action: string, options: { value?: string; days?: number; confirmMessage?: string; danger?: boolean } = {}) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (options.confirmMessage) {
      const ok = await confirm({
        title: 'Are you sure?',
        message: options.confirmMessage,
        confirmLabel: 'Yes, continue',
        danger: options.danger,
      });
      if (!ok) return;
    }
    bulk.mutate(
      { ids, action, value: options.value, days: options.days },
      {
        onSuccess: (result) => {
          toast.success(`${result.affected} ${result.affected === 1 ? 'task' : 'tasks'} updated`);
          setSelected(new Set());
        },
        onError: (err) => toast.error('Bulk action failed', (err as Error).message),
      },
    );
  };

  const clearFilters = () => {
    setPriority('');
    setCategoryId('');
    setProjectId('');
    setTag('');
    setSearchInput('');
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={
          isLoading ? 'Loading…' : `${pluralize(data?.total ?? 0, 'task')} in this view`
        }
        actions={
          <>
            <Button
              variant={activeFilters ? 'subtle' : 'outline'}
              icon={<Filter className="h-4 w-4" />}
              onClick={() => setShowFilters((prev) => !prev)}
            >
              Filters{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(today)}>
              New task
            </Button>
          </>
        }
      />

      {/* view tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto no-scrollbar">
        {VIEWS.map((entry) => (
          <button
            key={entry.value}
            onClick={() => setView(entry.value)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
              view === entry.value ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-subtle hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* search + filters */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 p-2">
          <Search className="ml-1.5 h-4 w-4 shrink-0 text-faint" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search titles, descriptions and notes…"
            className="h-8 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
          {searchInput && (
            <IconButton label="Clear search" size="sm" onClick={() => setSearchInput('')}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <Select value={sort} onChange={(event) => setSort(event.target.value as NonNullable<TaskQuery['sort']>)} className="h-8 w-auto text-xs">
            <option value="smart">Smart order</option>
            <option value="date">By date</option>
            <option value="priority">By priority</option>
            <option value="created">Newest first</option>
            <option value="title">A–Z</option>
          </Select>
        </div>

        {showFilters && (
          <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-9 text-xs">
              <option value="">Any priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-9 text-xs">
              <option value="">Any category</option>
              {categoryData?.categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-9 text-xs">
              <option value="">Any project</option>
              {projectData?.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </Select>
            <Select value={tag} onChange={(event) => setTag(event.target.value)} className="h-9 text-xs">
              <option value="">Any tag</option>
              {tagData?.tags.map((item) => (
                <option key={item.id} value={item.name}>#{item.name}</option>
              ))}
            </Select>

            {activeFilters > 0 && (
              <div className="sm:col-span-2 lg:col-span-4">
                <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={clearFilters}>
                  Clear all filters
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* bulk bar */}
      {selected.size > 0 && (
        <Card className="mb-4 border-accent/30 bg-accent/[0.05]">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <span className="mr-1 text-sm font-medium text-ink">{pluralize(selected.size, 'task')} selected</span>
            <Button size="xs" variant="outline" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => runBulk('complete')}>
              Complete
            </Button>
            <Button size="xs" variant="outline" onClick={() => runBulk('postpone', { days: 1 })}>
              Postpone 1 day
            </Button>
            <Button size="xs" variant="outline" onClick={() => runBulk('postpone', { days: 7 })}>
              Postpone 1 week
            </Button>
            <Select
              className="h-7 w-auto text-xs"
              value=""
              onChange={(event) => event.target.value && runBulk('priority', { value: event.target.value })}
            >
              <option value="">Set priority…</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
            <Button size="xs" variant="outline" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => runBulk('archive')}>
              Archive
            </Button>
            <Button
              size="xs"
              variant="danger"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() =>
                runBulk('delete', {
                  confirmMessage: `${pluralize(selected.size, 'task')} will be permanently deleted. This cannot be undone.`,
                  danger: true,
                })
              }
            >
              Delete
            </Button>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        </Card>
      )}

      {/* list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title={search || activeFilters ? 'Nothing matches those filters' : `No ${view} tasks`}
            description={
              search || activeFilters
                ? 'Try widening the search or clearing a filter.'
                : view === 'overdue'
                  ? 'Nothing has slipped past its day. That is the ideal state for this view.'
                  : 'Tasks you create will show up here.'
            }
            action={
              search || activeFilters ? (
                <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
              ) : (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(today)}>
                  New task
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, group]) => (
            <div key={date}>
              <div className="mb-2 flex items-center gap-2.5 px-1">
                <Checkbox
                  checked={group.every((task) => selected.has(task.id))}
                  onChange={(checked) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      group.forEach((task) => (checked ? next.add(task.id) : next.delete(task.id)));
                      return next;
                    })
                  }
                />
                <span className={cn('text-xs font-semibold', date < today && view !== 'completed' ? 'text-danger' : 'text-ink')}>
                  {relativeDay(date, today)}
                </span>
                <span className="text-2xs text-faint">{formatDate(date, 'medium')}</span>
                <Badge tone="neutral">{group.length}</Badge>
                <div className="h-px flex-1 bg-line" />
              </div>

              <div className="space-y-2">
                {group.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    today={today}
                    actions={actions}
                    selected={selected.has(task.id)}
                    onSelect={toggleSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editor}
    </div>
  );
}
