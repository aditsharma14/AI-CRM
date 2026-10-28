// List/board view over Activity resources of type=task.
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Circle, CheckCircle2 } from 'lucide-react'
import { useCrudQuery, useDisclosure, usePaginationState } from '../../hooks.js'
import { api } from '../../api/client.js'
import { DataTable } from '../../components/DataTable.jsx'
import { Modal, ConfirmDialog } from '../../components/Modal.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button, Badge } from '../../components/ui.jsx'
import { formatDate, cn } from '../../lib/utils.js'
import { useSession } from '../../context/SessionContext.jsx'
import { canModifyRecord } from '../../lib/constants.js'

const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

const PRIORITY_VARIANT = { low: 'default', medium: 'warning', high: 'danger' }

function useToggleTaskStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => (await api.patch(`/activities/${id}/toggle-status`)).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activities'] }),
  })
}

export default function TasksPage() {
  const { page, limit, setPage } = usePaginationState()
  const [editing, setEditing] = useState(null)
  const confirmDelete = useDisclosure()
  const { user, can } = useSession()
  // Tasks belong to their assignee: members can only change their own.
  const canChange = (task) => canModifyRecord(user, task, 'assigneeId')
  const readOnly = Boolean(editing?._id) && !canChange(editing)

  const activities = useCrudQuery('activities')
  const { data, isLoading, isError } = activities.useList({ type: 'task', page, limit })
  const createTask = activities.useCreate()
  const updateTask = activities.useUpdate()
  const removeTask = activities.useRemove()
  const toggleStatus = useToggleTaskStatus()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(taskSchema) })

  const openCreate = () => {
    reset({ title: '', description: '', dueDate: '', priority: 'medium' })
    setEditing({})
  }
  const openEdit = (task) => {
    reset({ ...task, dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '' })
    setEditing(task)
  }
  const close = () => setEditing(null)

  const onSubmit = async (values) => {
    const payload = { ...values, type: 'task' }
    if (editing?._id) await updateTask.mutateAsync({ id: editing._id, ...payload })
    else await createTask.mutateAsync(payload)
    close()
  }

  const columns = [
    {
      key: 'status',
      header: '',
      render: (row) => (
        <button
          type="button"
          disabled={!canChange(row)}
          onClick={(e) => {
            e.stopPropagation()
            toggleStatus.mutate(row._id)
          }}
          aria-label={row.status === 'done' ? 'Mark as open' : 'Mark as done'}
          className="text-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted dark:text-muted-dark"
        >
          {row.status === 'done' ? <CheckCircle2 size={18} strokeWidth={1.75} className="text-success" /> : <Circle size={18} strokeWidth={1.75} />}
        </button>
      ),
    },
    {
      key: 'title',
      header: 'Task',
      render: (row) => <span className={cn(row.status === 'done' && 'text-muted line-through dark:text-muted-dark')}>{row.title}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => (row.priority ? <Badge variant={PRIORITY_VARIANT[row.priority]}>{row.priority}</Badge> : '—'),
    },
    { key: 'dueDate', header: 'Due', render: (row) => (row.dueDate ? formatDate(row.dueDate) : '—') },
    { key: 'assignee', header: 'Assignee', render: (row) => row.assigneeId?.name ?? 'You' },
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl font-semibold">Tasks</h1>
        <Button onClick={openCreate}>New task</Button>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        emptyTitle="No tasks yet"
        emptyDescription="Create a task to keep track of follow-ups."
        onRowClick={openEdit}
        meta={data?.meta}
        onPageChange={setPage}
      />

      <Modal
        isOpen={Boolean(editing)}
        onClose={close}
        title={editing?._id ? 'Edit task' : 'New task'}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            {editing?._id && can('crm', 'delete') && (
              <Button variant="danger" onClick={confirmDelete.open}>
                Delete
              </Button>
            )}
            <Button type="submit" form="task-form" disabled={isSubmitting || readOnly} title={readOnly ? 'Only the assignee can edit this task' : undefined}>
              {editing?._id ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form id="task-form" onSubmit={handleSubmit(onSubmit)}>
          <FormField label="Title" error={errors.title}>
            <input className={inputClasses(errors.title)} {...register('title')} />
          </FormField>
          <FormField label="Description">
            <textarea rows={3} className={inputClasses(false)} {...register('description')} />
          </FormField>
          <FormField label="Due date">
            <input type="date" className={inputClasses(false)} {...register('dueDate')} />
          </FormField>
          <FormField label="Priority">
            <select className={inputClasses(false)} {...register('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={confirmDelete.close}
        onConfirm={() => {
          removeTask.mutate(editing._id)
          close()
        }}
        title="Delete this task?"
        description={`This will permanently remove "${editing?.title}".`}
        confirmLabel="Delete"
      />
    </div>
  )
}
