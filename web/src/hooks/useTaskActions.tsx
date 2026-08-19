import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task } from '@/lib/types';
import { useFocusMutations, useTaskMutations } from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Modal';
import { TaskEditor } from '@/components/TaskEditor';
import type { TaskActions } from '@/components/TaskItem';
import { formatDate } from '@/lib/utils';
import { useUser } from '@/state/auth';

/**
 * One place for "what happens when you act on a task", so every screen behaves
 * identically — including the undo affordance on destructive-feeling actions.
 */
export function useTaskActions(options: { defaultDate?: string; defaultProjectId?: string; defaultGoalId?: string } = {}) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const user = useUser();
  const mutations = useTaskMutations();
  const focus = useFocusMutations();

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [editorDate, setEditorDate] = React.useState<string | undefined>(options.defaultDate);

  const openNew = React.useCallback(
    (date?: string) => {
      setEditing(null);
      setEditorDate(date ?? options.defaultDate);
      setEditorOpen(true);
    },
    [options.defaultDate],
  );

  const openEdit = React.useCallback((task: Task) => {
    setEditing(task);
    setEditorOpen(true);
  }, []);

  const actions = React.useMemo<TaskActions>(
    () => ({
      onToggle: (task) => {
        if (task.status === 'completed') {
          mutations.reopen.mutate(task.id, {
            onError: (error) => toast.error('Could not reopen', (error as Error).message),
          });
        } else {
          mutations.complete.mutate(
            { id: task.id },
            {
              onSuccess: () =>
                toast.success('Done', task.title, {
                  label: 'Undo',
                  onClick: () => mutations.reopen.mutate(task.id),
                }),
              onError: (error) => toast.error('Could not complete', (error as Error).message),
            },
          );
        }
      },

      onEdit: openEdit,

      onPostpone: (task, days) => {
        const previousDate = task.date;
        mutations.postpone.mutate(
          { id: task.id, days },
          {
            onSuccess: (data) =>
              toast.info('Moved', `${task.title} → ${formatDate(data.task.date, 'short')}`, {
                label: 'Undo',
                onClick: () => mutations.postpone.mutate({ id: task.id, to: previousDate }),
              }),
            onError: (error) => toast.error('Could not postpone', (error as Error).message),
          },
        );
      },

      onDuplicate: (task) => {
        mutations.duplicate.mutate(
          { id: task.id },
          {
            onSuccess: () => toast.success('Duplicated', task.title),
            onError: (error) => toast.error('Could not duplicate', (error as Error).message),
          },
        );
      },

      onArchive: (task) => {
        if (task.archivedAt) {
          mutations.unarchive.mutate(task.id, { onSuccess: () => toast.success('Restored', task.title) });
        } else {
          mutations.archive.mutate(task.id, {
            onSuccess: () =>
              toast.info('Archived', task.title, {
                label: 'Undo',
                onClick: () => mutations.unarchive.mutate(task.id),
              }),
          });
        }
      },

      onDelete: async (task) => {
        const isSeries = Boolean(task.recurrence || task.recurrenceParentId);
        const ok = await confirm({
          title: 'Delete this task?',
          message: isSeries
            ? 'This task repeats. Deleting removes only this occurrence — use the series option in Tasks to remove them all. This cannot be undone.'
            : `"${task.title}" will be permanently removed. This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        mutations.remove.mutate(
          { id: task.id },
          {
            onSuccess: () => toast.success('Deleted', task.title),
            onError: (error) => toast.error('Could not delete', (error as Error).message),
          },
        );
      },

      onPin: (task) => {
        mutations.update.mutate({ id: task.id, pinned: !task.pinned });
      },

      onFocus: (task) => {
        focus.start.mutate(
          { taskId: task.id, plannedMinutes: user.settings.pomodoro.focus },
          {
            onSuccess: () => navigate('/focus'),
            onError: (error) => toast.error('Could not start focus', (error as Error).message),
          },
        );
      },

      onToggleSubtask: (task, subtaskId, done) => {
        mutations.toggleSubtask.mutate({ id: task.id, subtaskId, done });
      },
    }),
    [mutations, focus, toast, confirm, navigate, openEdit, user.settings.pomodoro.focus],
  );

  const editor = (
    <TaskEditor
      open={editorOpen}
      onClose={() => setEditorOpen(false)}
      task={editing}
      defaultDate={editorDate}
      defaultProjectId={options.defaultProjectId}
      defaultGoalId={options.defaultGoalId}
    />
  );

  return { actions, editor, openNew, openEdit, mutations };
}
