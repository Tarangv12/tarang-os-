import * as React from 'react';
import { Eye, FileText, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { useGoals, useNoteMutations, useNotes, useProjects, useTasks } from '@/lib/queries';
import {
  Button, Card, EmptyState, Field, IconButton, Input, PageHeader, SegmentedControl, Select,
  Skeleton, Textarea,
} from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { cn, debounce, formatDate, formatRelativeTime, renderMarkdown, todayStr, truncate } from '@/lib/utils';
import { useUser } from '@/state/auth';
import type { Note } from '@/lib/types';

export default function Notes() {
  const user = useUser();
  const today = todayStr(user.timezone);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Note | null>(null);
  const [reading, setReading] = React.useState<Note | null>(null);

  const { data, isLoading } = useNotes(search ? { search } : {});
  const { update, remove } = useNoteMutations();
  const confirm = useConfirm();
  const toast = useToast();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const applySearch = React.useCallback(debounce((value: string) => setSearch(value), 300), []);
  React.useEffect(() => applySearch(searchInput), [searchInput, applySearch]);

  const notes = data?.notes ?? [];
  const pinned = notes.filter((note) => note.pinned);
  const rest = notes.filter((note) => !note.pinned);

  const deleteNote = async (note: Note) => {
    const ok = await confirm({
      title: 'Delete this note?',
      message: note.title ? `"${note.title}" will be permanently removed.` : 'This note will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    remove.mutate(note.id, { onSuccess: () => toast.success('Note deleted') });
  };

  return (
    <div>
      <PageHeader
        title="Notes"
        description="Journal entries, references and anything that does not belong on a task."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
            New note
          </Button>
        }
      />

      <Card className="mb-4 flex items-center gap-2 p-2">
        <Search className="ml-1.5 h-4 w-4 shrink-0 text-faint" />
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search titles and content…"
          className="h-8 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={search ? 'No notes match that search' : 'No notes yet'}
            description={
              search
                ? 'Try a different word.'
                : 'Notes support Markdown and can be linked to a date, a task, a goal or a project — so context stays with the work.'
            }
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
                Write a note
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {pinned.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 px-1">
                <Pin className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-medium text-muted">Pinned</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              <NoteGrid
                notes={pinned}
                today={today}
                onRead={setReading}
                onEdit={(note) => { setEditing(note); setEditorOpen(true); }}
                onPin={(note) => update.mutate({ id: note.id, pinned: !note.pinned })}
                onDelete={deleteNote}
              />
            </div>
          )}

          {rest.length > 0 && (
            <NoteGrid
              notes={rest}
              today={today}
              onRead={setReading}
              onEdit={(note) => { setEditing(note); setEditorOpen(true); }}
              onPin={(note) => update.mutate({ id: note.id, pinned: !note.pinned })}
              onDelete={deleteNote}
            />
          )}
        </div>
      )}

      <NoteEditor open={editorOpen} onClose={() => setEditorOpen(false)} note={editing} defaultDate={today} />

      <Modal
        open={Boolean(reading)}
        onClose={() => setReading(null)}
        title={reading?.title || 'Note'}
        description={reading?.date ? formatDate(reading.date, 'long') : undefined}
        size="lg"
        footer={
          <Button
            variant="outline"
            icon={<Pencil className="h-4 w-4" />}
            onClick={() => {
              setEditing(reading);
              setReading(null);
              setEditorOpen(true);
            }}
          >
            Edit
          </Button>
        }
      >
        {reading && <div className="prose-tarang" dangerouslySetInnerHTML={{ __html: renderMarkdown(reading.content) }} />}
      </Modal>
    </div>
  );
}

function NoteGrid({
  notes,
  today,
  onRead,
  onEdit,
  onPin,
  onDelete,
}: {
  notes: Note[];
  today: string;
  onRead: (note: Note) => void;
  onEdit: (note: Note) => void;
  onPin: (note: Note) => void;
  onDelete: (note: Note) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {notes.map((note) => (
        <Card key={note.id} className="group flex flex-col p-4 transition-all hover:shadow-pop">
          <div className="flex items-start justify-between gap-2">
            <button onClick={() => onRead(note)} className="min-w-0 flex-1 text-left">
              <h3 className="truncate text-sm font-semibold text-ink">
                {note.pinned && <Pin className="mr-1 inline h-3 w-3 -translate-y-px text-accent" />}
                {note.title || 'Untitled note'}
              </h3>
            </button>
            <Dropdown
              items={[
                { label: 'Read', icon: <Eye className="h-4 w-4" />, onSelect: () => onRead(note) },
                { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => onEdit(note) },
                {
                  label: note.pinned ? 'Unpin' : 'Pin',
                  icon: note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
                  onSelect: () => onPin(note),
                },
                { type: 'separator' },
                { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => onDelete(note), danger: true },
              ]}
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label="Note actions" size="sm" onClick={toggle}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              )}
            />
          </div>

          <button onClick={() => onRead(note)} className="mt-2 min-h-[62px] flex-1 text-left">
            <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-muted">
              {truncate(note.content.replace(/[#*`>_-]/g, ''), 220) || 'Empty note'}
            </p>
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5 text-2xs text-faint">
            {note.date && (
              <span className={cn(note.date === today && 'text-accent')}>{formatDate(note.date, 'short')}</span>
            )}
            {note.task && <span className="truncate rounded bg-subtle px-1.5 py-0.5">task: {truncate(note.task.title, 18)}</span>}
            {note.goal && <span className="truncate rounded bg-subtle px-1.5 py-0.5">goal: {truncate(note.goal.title, 18)}</span>}
            {note.project && (
              <span className="truncate rounded px-1.5 py-0.5" style={{ color: note.project.color, background: `${note.project.color}18` }}>
                {truncate(note.project.name, 18)}
              </span>
            )}
            <span className="ml-auto shrink-0">{formatRelativeTime(note.updatedAt)}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function NoteEditor({
  open,
  onClose,
  note,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  note: Note | null;
  defaultDate: string;
}) {
  const { create, update } = useNoteMutations();
  const { data: projectData } = useProjects();
  const { data: goalData } = useGoals({ status: 'active' });
  const { data: taskData } = useTasks({ view: 'all', limit: 100 });
  const toast = useToast();

  const [form, setForm] = React.useState({ title: '', content: '', date: '', taskId: '', goalId: '', projectId: '', pinned: false });
  const [tab, setTab] = React.useState<'write' | 'preview'>('write');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      title: note?.title ?? '',
      content: note?.content ?? '',
      date: note?.date ?? defaultDate,
      taskId: note?.taskId ?? '',
      goalId: note?.goalId ?? '',
      projectId: note?.projectId ?? '',
      pinned: note?.pinned ?? false,
    });
    setTab('write');
    setError(null);
  }, [open, note, defaultDate]);

  const submit = () => {
    if (!form.title.trim() && !form.content.trim()) {
      setError('A note needs a title or some content');
      return;
    }
    const payload = {
      title: form.title.trim(),
      content: form.content,
      date: form.date || null,
      taskId: form.taskId || null,
      goalId: form.goalId || null,
      projectId: form.projectId || null,
      pinned: form.pinned,
    };
    const onSuccess = () => {
      toast.success(note ? 'Note updated' : 'Note saved');
      onClose();
    };
    const onError = (err: unknown) => setError((err as Error).message);

    if (note) update.mutate({ id: note.id, ...payload }, { onSuccess, onError });
    else create.mutate(payload, { onSuccess, onError });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={note ? 'Edit note' : 'New note'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || update.isPending}>
            {note ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <Field label="Title">
          <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Optional title" autoFocus />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Content</span>
            <SegmentedControl
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'write', label: 'Write' },
                { value: 'preview', label: 'Preview' },
              ]}
            />
          </div>

          {tab === 'write' ? (
            <Textarea
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              rows={12}
              className="font-mono text-[13px]"
              placeholder={'# Heading\n\nMarkdown works: **bold**, *italic*, `code`, - lists, > quotes, and - [ ] checkboxes.'}
            />
          ) : (
            <div className="min-h-[280px] rounded-xl border border-line bg-subtle/40 p-4">
              {form.content.trim() ? (
                <div className="prose-tarang" dangerouslySetInnerHTML={{ __html: renderMarkdown(form.content) }} />
              ) : (
                <p className="text-sm text-faint">Nothing to preview yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date" hint="Makes it a journal entry for that day">
            <Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </Field>
          <Field label="Link to project">
            <Select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
              <option value="">None</option>
              {projectData?.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Link to goal">
            <Select value={form.goalId} onChange={(event) => setForm({ ...form, goalId: event.target.value })}>
              <option value="">None</option>
              {goalData?.goals.map((goal) => (
                <option key={goal.id} value={goal.id}>{goal.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Link to task">
            <Select value={form.taskId} onChange={(event) => setForm({ ...form, taskId: event.target.value })}>
              <option value="">None</option>
              {taskData?.tasks.slice(0, 100).map((task) => (
                <option key={task.id} value={task.id}>{truncate(task.title, 50)}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
