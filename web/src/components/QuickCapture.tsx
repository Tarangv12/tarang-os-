import * as React from 'react';
import { CalendarClock, Clock, Hash, Repeat, Sparkles, Tag as TagIcon, Timer, Zap } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button, Input } from './ui/primitives';
import { useToast } from './ui/Toast';
import { useParseCapture, useTaskMutations } from '@/lib/queries';
import { formatDate, formatTime, cn } from '@/lib/utils';
import type { ParsedCapture } from '@/lib/queries';

/**
 * Quick Capture — one line in, a fully-formed task out.
 * The chips underneath show exactly what was understood, so nothing is
 * silently guessed on your behalf.
 */

const EXAMPLES = [
  'Gym tomorrow 7 PM high priority #health',
  'Review pitch deck friday 10:00 ~45m @Launch',
  'Standup every weekday 9:30',
  'Call dentist next monday urgent',
];

const CHIP_META: Record<string, { icon: React.ReactNode; label: string }> = {
  date: { icon: <CalendarClock className="h-3 w-3" />, label: 'Date' },
  time: { icon: <Clock className="h-3 w-3" />, label: 'Time' },
  priority: { icon: <Zap className="h-3 w-3" />, label: 'Priority' },
  duration: { icon: <Timer className="h-3 w-3" />, label: 'Duration' },
  tag: { icon: <TagIcon className="h-3 w-3" />, label: 'Tag' },
  project: { icon: <Hash className="h-3 w-3" />, label: 'Project' },
  category: { icon: <Hash className="h-3 w-3" />, label: 'Category' },
  recurrence: { icon: <Repeat className="h-3 w-3" />, label: 'Repeats' },
};

export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = React.useState('');
  const [parsed, setParsed] = React.useState<ParsedCapture | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const parse = useParseCapture();
  const { quickCapture } = useTaskMutations();
  const toast = useToast();

  const placeholder = React.useMemo(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)], []);

  // Debounced parse so the preview keeps up without a request per keystroke.
  React.useEffect(() => {
    if (!open) return;
    const value = text.trim();
    if (value.length < 2) {
      setParsed(null);
      return;
    }
    const timer = setTimeout(() => {
      parse.mutate(value, { onSuccess: (data) => setParsed(data.parsed) });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open]);

  React.useEffect(() => {
    if (!open) {
      setText('');
      setParsed(null);
    }
  }, [open]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    quickCapture.mutate(
      { text: value },
      {
        onSuccess: (data) => {
          toast.success('Task added', `${data.task.title} · ${formatDate(data.task.date, 'short')}`);
          setText('');
          setParsed(null);
          inputRef.current?.focus();
        },
        onError: (error) => toast.error('Could not add task', (error as Error).message),
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick capture"
      description="Write it the way you'd say it — TarangOS fills in the details."
      size="md"
      initialFocus={inputRef}
      footer={
        <>
          <span className="mr-auto hidden text-2xs text-faint sm:block">
            <kbd className="rounded border border-line px-1 py-0.5">Enter</kbd> to add ·{' '}
            <kbd className="rounded border border-line px-1 py-0.5">Esc</kbd> to close
          </span>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={submit} loading={quickCapture.isPending} disabled={!text.trim()}>
            Add task
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="h-12 text-[15px]"
        autoComplete="off"
        spellCheck={false}
      />

      {parsed && text.trim().length >= 2 ? (
        <div className="mt-4 rounded-xl border border-line bg-subtle/50 p-3.5">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <Sparkles className="h-3 w-3" />
            Understood as
          </div>

          <div className="mt-2 text-sm font-medium text-ink">{parsed.title || '—'}</div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {parsed.date && (
              <Chip kind="date" value={formatDate(parsed.date, 'medium')} />
            )}
            {parsed.startTime && <Chip kind="time" value={formatTime(parsed.startTime)} />}
            {parsed.priority && <Chip kind="priority" value={parsed.priority} />}
            {parsed.estimatedMinutes ? <Chip kind="duration" value={`${parsed.estimatedMinutes} min`} /> : null}
            {parsed.recurrence && <Chip kind="recurrence" value={parsed.recurrence.freq} />}
            {parsed.projectHint && <Chip kind="project" value={parsed.projectHint} />}
            {parsed.categoryHint && <Chip kind="category" value={parsed.categoryHint} />}
            {parsed.tags.map((tag) => (
              <Chip key={tag} kind="tag" value={tag} />
            ))}
            {!parsed.date && !parsed.startTime && !parsed.priority && !parsed.tags.length && (
              <span className="text-xs text-faint">No extras detected — it will land on today.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-line p-3.5">
          <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Try writing</div>
          <ul className="mt-2 space-y-1.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  onClick={() => setText(example)}
                  className="text-left text-xs text-muted transition-colors hover:text-accent"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs leading-relaxed text-faint">
            Use <code className="rounded bg-subtle px-1">#tag</code>, <code className="rounded bg-subtle px-1">@project</code>,{' '}
            <code className="rounded bg-subtle px-1">+category</code>, <code className="rounded bg-subtle px-1">~30m</code>,
            and words like “tomorrow”, “every weekday” or “urgent”.
          </p>
        </div>
      )}
    </Modal>
  );
}

function Chip({ kind, value }: { kind: keyof typeof CHIP_META | string; value: string }) {
  const meta = CHIP_META[kind] ?? { icon: null, label: kind };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-accent/20 bg-accent/10 px-2 py-1 text-2xs font-medium text-accent',
      )}
    >
      {meta.icon}
      <span className="text-accent/70">{meta.label}:</span>
      <span className="capitalize">{value}</span>
    </span>
  );
}
