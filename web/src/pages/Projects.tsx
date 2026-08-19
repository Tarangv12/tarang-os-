import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowLeft, CheckCircle2, Layers, MoreHorizontal, Pencil, Plus, Trash2,
} from 'lucide-react';
import { useOrgMutations, useProjects, useTasks } from '@/lib/queries';
import { useTaskActions } from '@/hooks/useTaskActions';
import { TaskItem } from '@/components/TaskItem';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input, PageHeader, Progress, Select,
  Skeleton, Textarea,
} from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { cn, formatDate, percent, pluralize, todayStr } from '@/lib/utils';
import { useUser } from '@/state/auth';
import type { Project } from '@/lib/types';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function Projects() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const user = useUser();
  const today = todayStr(user.timezone);

  const [showArchived, setShowArchived] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Project | null>(null);

  const { data, isLoading } = useProjects(showArchived);
  const { deleteProject, updateProject } = useOrgMutations();
  const confirm = useConfirm();
  const toast = useToast();

  const active = data?.projects ?? [];
  const selected = projectId ? active.find((project) => project.id === projectId) : null;

  if (projectId && selected) {
    return <ProjectDetail project={selected} today={today} onBack={() => navigate('/projects')} onEdit={() => { setEditing(selected); setEditorOpen(true); }} editorSlot={
      <ProjectEditor open={editorOpen} onClose={() => setEditorOpen(false)} project={editing} />
    } />;
  }

  const remove = async (project: Project) => {
    const ok = await confirm({
      title: `Delete "${project.name}"?`,
      message: `The project will be removed. Its ${pluralize(project.taskCount, 'task')} will be kept and simply un-linked.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    deleteProject.mutate({ id: project.id }, { onSuccess: () => toast.success('Project deleted', project.name) });
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Containers for work that spans many days."
        actions={
          <>
            <Button variant="outline" onClick={() => setShowArchived((prev) => !prev)}>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
              New project
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="No projects yet"
            description="Group related tasks into a project to watch a bigger thing move, not just individual to-dos."
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>
                Create a project
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((project) => (
            <Card
              key={project.id}
              className={cn('group flex flex-col p-4 transition-all hover:shadow-pop', project.archivedAt && 'opacity-60')}
            >
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => navigate(`/projects/${project.id}`)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.color }} />
                    <h3 className="truncate text-sm font-semibold text-ink">{project.name}</h3>
                  </div>
                  {project.description && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{project.description}</p>
                  )}
                </button>

                <Dropdown
                  items={[
                    { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onSelect: () => { setEditing(project); setEditorOpen(true); } },
                    {
                      label: project.archivedAt ? 'Restore' : 'Archive',
                      icon: <Archive className="h-4 w-4" />,
                      onSelect: () =>
                        updateProject.mutate({ id: project.id, archived: !project.archivedAt }),
                    },
                    { type: 'separator' },
                    { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => void remove(project), danger: true },
                  ]}
                  trigger={({ toggle, ref }) => (
                    <IconButton ref={ref} label="Project actions" size="sm" onClick={toggle}>
                      <MoreHorizontal className="h-4 w-4" />
                    </IconButton>
                  )}
                />
              </div>

              <div className="mt-auto pt-4">
                <div className="mb-1.5 flex items-center justify-between text-2xs">
                  <span className="text-muted">
                    {project.completedCount}/{project.taskCount} tasks
                  </span>
                  <span className="font-medium tabular text-ink">{percent(project.progress)}</span>
                </div>
                <Progress value={project.progress} color={project.color} height={6} />

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge tone={project.status === 'done' ? 'success' : project.status === 'paused' ? 'warning' : 'accent'}>
                    {project.status}
                  </Badge>
                  {project.targetDate && (
                    <Badge tone={project.targetDate < today && project.status !== 'done' ? 'danger' : 'neutral'}>
                      due {formatDate(project.targetDate, 'short')}
                    </Badge>
                  )}
                  {project.archivedAt && <Badge tone="neutral">archived</Badge>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProjectEditor open={editorOpen} onClose={() => setEditorOpen(false)} project={editing} />
    </div>
  );
}

function ProjectDetail({
  project,
  today,
  onBack,
  onEdit,
  editorSlot,
}: {
  project: Project;
  today: string;
  onBack: () => void;
  onEdit: () => void;
  editorSlot: React.ReactNode;
}) {
  const { data, isLoading } = useTasks({ projectId: project.id, view: 'all', limit: 400 });
  const { actions, editor, openNew } = useTaskActions({ defaultDate: today, defaultProjectId: project.id });

  const tasks = data?.tasks ?? [];
  const open = tasks.filter((task) => task.status !== 'completed');
  const done = tasks.filter((task) => task.status === 'completed');

  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All projects
      </button>

      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full" style={{ background: project.color }} />
            {project.name}
          </span>
        }
        description={project.description || `${project.completedCount} of ${project.taskCount} tasks complete`}
        actions={
          <>
            <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(today)}>
              Add task
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-muted">Progress</span>
          <span className="font-medium tabular text-ink">{percent(project.progress)}</span>
        </div>
        <Progress value={project.progress} color={project.color} height={8} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          <span>{pluralize(open.length, 'task')} remaining</span>
          <span>{pluralize(done.length, 'task')} done</span>
          {project.startDate && <span>Started {formatDate(project.startDate, 'short')}</span>}
          {project.targetDate && <span>Target {formatDate(project.targetDate, 'short')}</span>}
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="No tasks in this project"
            description="Add the first concrete step."
            action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew(today)}>Add a task</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {open.length > 0 && (
            <div className="space-y-2">
              {open.map((task) => (
                <TaskItem key={task.id} task={task} today={today} actions={actions} showDate />
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 px-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="text-xs font-medium text-muted">{pluralize(done.length, 'completed task')}</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              <div className="space-y-2">
                {done.map((task) => (
                  <TaskItem key={task.id} task={task} today={today} actions={actions} showDate />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editor}
      {editorSlot}
    </div>
  );
}

function ProjectEditor({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project | null }) {
  const { createProject, updateProject } = useOrgMutations();
  const toast = useToast();
  const [form, setForm] = React.useState({
    name: '', description: '', color: COLORS[0], status: 'active', startDate: '', targetDate: '',
  });
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      name: project?.name ?? '',
      description: project?.description ?? '',
      color: project?.color ?? COLORS[0],
      status: project?.status ?? 'active',
      startDate: project?.startDate ?? '',
      targetDate: project?.targetDate ?? '',
    });
    setError(null);
  }, [open, project]);

  const submit = () => {
    if (!form.name.trim()) {
      setError('Give the project a name');
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      color: form.color,
      status: form.status,
      startDate: form.startDate || null,
      targetDate: form.targetDate || null,
    };
    const onSuccess = () => {
      toast.success(project ? 'Project updated' : 'Project created', payload.name);
      onClose();
    };
    const onError = (err: unknown) => setError((err as Error).message);

    if (project) updateProject.mutate({ id: project.id, ...payload }, { onSuccess, onError });
    else createProject.mutate(payload, { onSuccess, onError });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={createProject.isPending || updateProject.isPending}>
            {project ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <Field label="Name" required>
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. TarangOS launch" autoFocus />
        </Field>

        <Field label="Description">
          <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} placeholder="What does done look like?" />
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setForm({ ...form, color })}
                className={cn(
                  'h-8 w-8 rounded-lg border-2 transition-transform hover:scale-110',
                  form.color === color ? 'border-ink' : 'border-transparent',
                )}
                style={{ background: color }}
                aria-label={color}
              />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </Select>
          </Field>
          <Field label="Start">
            <Input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
          </Field>
          <Field label="Target">
            <Input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
