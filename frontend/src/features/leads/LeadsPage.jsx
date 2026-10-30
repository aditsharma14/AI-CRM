// Lead list, filters, detail drawer, form, convert-to-deal.
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCrudQuery, useDebounce, useDisclosure, useMutationError, usePaginationState } from '../../hooks.js'
import { api } from '../../api/client.js'
import { DataTable } from '../../components/DataTable.jsx'
import { Modal, ConfirmDialog } from '../../components/Modal.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button, Badge } from '../../components/ui.jsx'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import NotesPanel from '../notes/NotesPanel.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { LEAD_STATUSES, canModifyRecord } from '../../lib/constants.js'
import { formatDate } from '../../lib/utils.js'

const leadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.union([z.literal(''), z.string().trim().email()]).optional(),
  phone: z.string().trim().optional(),
  source: z.string().trim().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
})

const STATUS_VARIANT = { new: 'default', contacted: 'warning', qualified: 'success', unqualified: 'danger', converted: 'success' }

function useConvertLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id) => (await api.post(`/leads/${id}/convert`)).data.data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['deals'] })
    },
  })
}

export default function LeadsPage() {
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const { page, limit, setPage } = usePaginationState()
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState(null) // null = closed, {} = new, {...} = editing
  const confirmDelete = useDisclosure()
  const { user, can } = useSession()
  // Members can open anyone's lead but only change their own.
  const readOnly = Boolean(editing?._id) && !canModifyRecord(user, editing)

  const leads = useCrudQuery('leads')
  const { data, isLoading, isError } = leads.useList({ page, limit, q: q || undefined, status: statusFilter || undefined })
  const createLead = leads.useCreate()
  const updateLead = leads.useUpdate()
  const removeLead = leads.useRemove()
  const convertLead = useConvertLead()
  // Save and convert fail inside the open dialog; delete closes it first, so
  // its error shows on the page instead.
  const dialogError = useMutationError(createLead, updateLead, convertLead)
  const deleteError = useMutationError(removeLead)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(leadSchema) })

  const openCreate = () => {
    dialogError.reset()
    deleteError.reset()
    reset({ name: '', email: '', phone: '', source: '' })
    setEditing({})
  }
  const openEdit = (lead) => {
    dialogError.reset()
    deleteError.reset()
    reset(lead)
    setEditing(lead)
  }
  const close = () => setEditing(null)

  const onSubmit = async (values) => {
    const payload = { ...values, email: values.email || undefined }
    try {
      if (editing?._id) await updateLead.mutateAsync({ id: editing._id, ...payload })
      else await createLead.mutateAsync(payload)
      close()
    } catch {
      // Shown via dialogError; the dialog stays open with what the user typed.
    }
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'status', header: 'Status', render: (row) => <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge> },
    { key: 'score', header: 'Score' },
    { key: 'createdAt', header: 'Created', render: (row) => formatDate(row.createdAt) },
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl font-semibold">Leads</h1>
        <Button onClick={openCreate}>New lead</Button>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads…"
          className={`${inputClasses(false)} max-w-xs`}
        />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClasses(false)} max-w-[160px]`}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {!editing && <ErrorAlert message={deleteError.message} />}

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        emptyTitle="No leads yet"
        emptyDescription="Create your first lead to start filling the pipeline."
        onRowClick={openEdit}
        meta={data?.meta}
        onPageChange={setPage}
      />

      <Modal
        isOpen={Boolean(editing)}
        onClose={close}
        title={editing?._id ? 'Edit lead' : 'New lead'}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            {editing?._id && editing.status !== 'converted' && !readOnly && (
              <Button
                variant="secondary"
                disabled={convertLead.isPending}
                onClick={() => convertLead.mutate(editing._id, { onSuccess: close })}
              >
                Convert to deal
              </Button>
            )}
            {editing?._id && can('crm', 'delete') && (
              <Button variant="danger" onClick={confirmDelete.open}>
                Delete
              </Button>
            )}
            <Button type="submit" form="lead-form" disabled={isSubmitting || readOnly} title={readOnly ? 'Only the owner can edit this lead' : undefined}>
              {editing?._id ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <ErrorAlert message={dialogError.message} />
        <form id="lead-form" onSubmit={handleSubmit(onSubmit)}>
          <FormField label="Name" htmlFor="lead-name" error={errors.name}>
            <input id="lead-name" className={inputClasses(errors.name)} {...register('name')} />
          </FormField>
          <FormField label="Email" htmlFor="lead-email" error={errors.email}>
            <input id="lead-email" className={inputClasses(errors.email)} {...register('email')} />
          </FormField>
          <FormField label="Phone" htmlFor="lead-phone">
            <input id="lead-phone" className={inputClasses(false)} {...register('phone')} />
          </FormField>
          <FormField label="Source" htmlFor="lead-source">
            <input id="lead-source" className={inputClasses(false)} {...register('source')} />
          </FormField>
          {editing?._id && (
            <FormField label="Status" htmlFor="lead-status">
              <select id="lead-status" className={inputClasses(false)} {...register('status')}>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </form>

        {editing?._id && (
          <div className="mt-6 border-t border-border pt-4 dark:border-border-dark">
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <NotesPanel entityType="lead" entityId={editing._id} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={confirmDelete.close}
        onConfirm={() => {
          removeLead.mutate(editing._id)
          close()
        }}
        title="Delete this lead?"
        description={`This will permanently remove "${editing?.name}".`}
        confirmLabel="Delete"
      />
    </div>
  )
}
