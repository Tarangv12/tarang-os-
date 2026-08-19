import * as React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CornerDownLeft, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { cn, formatDate, PRIORITY_META } from '@/lib/utils';
import { get } from '@/lib/api';
import type { Task } from '@/lib/types';
import { ALL_NAV } from './AppShell';

/** ⌘K palette: jump to a section or find any task by text. */

type Row =
  | { kind: 'nav'; id: string; label: string; icon: React.ReactNode; to: string }
  | { kind: 'task'; id: string; task: Task }
  | { kind: 'action'; id: string; label: string; icon: React.ReactNode; run: () => void };

export function CommandPalette({
  open,
  onClose,
  onQuickCapture,
}: {
  open: boolean;
  onClose: () => void;
  onQuickCapture: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const navigate = useNavigate();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setTasks([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await get<{ tasks: Task[] }>(
          `/tasks?view=all&search=${encodeURIComponent(term)}&limit=8`,
          controller.signal,
        );
        setTasks(data.tasks);
      } catch {
        /* aborted or offline */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const rows = React.useMemo<Row[]>(() => {
    const term = query.trim().toLowerCase();
    const navRows: Row[] = ALL_NAV.filter((entry) => !term || entry.label.toLowerCase().includes(term)).map((entry) => ({
      kind: 'nav',
      id: `nav:${entry.to}`,
      label: entry.label,
      icon: entry.icon,
      to: entry.to,
    }));

    const actionRows: Row[] = [
      {
        kind: 'action',
        id: 'action:capture',
        label: term ? `Capture “${query.trim()}”` : 'Quick capture a task',
        icon: <Plus className="h-[18px] w-[18px]" />,
        run: () => {
          onClose();
          onQuickCapture();
        },
      },
    ];

    const taskRows: Row[] = tasks.map((task) => ({ kind: 'task', id: `task:${task.id}`, task }));

    return term ? [...taskRows, ...navRows, ...actionRows] : [...navRows, ...actionRows];
  }, [query, tasks, onClose, onQuickCapture]);

  React.useEffect(() => setActive(0), [rows.length]);

  const run = React.useCallback(
    (row: Row) => {
      if (row.kind === 'nav') {
        navigate(row.to);
        onClose();
      } else if (row.kind === 'task') {
        navigate(`/tasks?focus=${row.task.id}`);
        onClose();
      } else {
        row.run();
      }
    },
    [navigate, onClose],
  );

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((prev) => (prev + 1) % Math.max(rows.length, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((prev) => (prev - 1 + rows.length) % Math.max(rows.length, 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const row = rows[active];
        if (row) run(row);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, rows, active, run, onClose]);

  React.useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex max-h-[70vh] w-full max-w-xl animate-scale-in flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks or jump to a section…"
            className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-faint" />}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted">No matches for “{query}”</div>
          ) : (
            rows.map((row, index) => (
              <button
                key={row.id}
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(row)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  index === active ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-subtle',
                )}
              >
                {row.kind === 'task' ? (
                  <>
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_META[row.task.priority].dot)} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-sm',
                          row.task.status === 'completed' ? 'text-faint line-through' : 'text-ink',
                        )}
                      >
                        {row.task.title}
                      </span>
                      <span className="block truncate text-2xs text-faint">
                        {formatDate(row.task.date, 'short')}
                        {row.task.project ? ` · ${row.task.project.name}` : ''}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="shrink-0 text-faint">{row.kind === 'nav' ? row.icon : row.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                    {row.kind === 'nav' && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-faint" />}
                    {row.kind === 'action' && <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  </>
                )}
                {index === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" />}
              </button>
            ))
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-2xs text-faint sm:flex">
          <span>
            <kbd className="rounded border border-line px-1">↑</kbd> <kbd className="rounded border border-line px-1">↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border border-line px-1">↵</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="rounded border border-line px-1">g</kbd> then a letter jumps
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
