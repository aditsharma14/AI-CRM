// Deal table, deal form and stage moves. The Kanban board is planned for S2.7.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { DataTable } from '../../components/DataTable.jsx'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { ConfirmDialog, Modal } from '../../components/Modal.jsx'
import { Badge, Button } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useCrudQuery, useDisclosure, useMutationError, usePaginationState, usePipelineStages } from '../../hooks.js'
import { canModifyRecord } from '../../lib/constants.js'
import { formatCurrency } from '../../lib/utils.js'
import NotesPanel from '../notes/NotesPanel.jsx'

const dealSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  value: z.coerce.number().min(0, 'Value must be positive'),
  stageKey: z.string().min(1),
})

const STAGE_VARIANT = { won: 'success', lost: 'danger' }

/**
 * Moving a deal to a new stage has to go through PATCH /deals/:id/move-stage,
 * not the generic PATCH /deals/:id — that's the endpoint that knows "moving
 * to won/lost also sets status + closedAt and logs/notifies" (see
 * dealsService.moveStage on the backend). The plain update endpoint would
 * silently skip all of that.
 */
function useMoveStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, stageKey }) => (await api.patch(`/deals/${id}/move-stage`, { stageKey })).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deals'] }),
  })
}

export default function PipelinePage() {
  const { page, limit, setPage } = usePaginationState()
  const [editing, setEditing] = useState(null)
  const confirmDelete = useDisclosure()
  const { user, can } = useSession()
  // Members can open anyone's deal but only change (or move) their own.
  const readOnly = Boolean(editing?._id) && !canModifyRecord(user, editing)

  const deals = useCrudQuery('deals')
  const { data, isLoading, isError } = deals.useList({ page, limit, sort: '-createdAt' })
  const createDeal = deals.useCreate()
  const updateDeal = deals.useUpdate()
  const removeDeal = deals.useRemove()
  const moveStage = useMoveStage()
  const { stages, labelFor } = usePipelineStages()
  // Save and move fail inside the open dialog; delete closes it first, so
  // its error shows on the page instead.
  const dialogError = useMutationError(createDeal, updateDeal, moveStage)
  const deleteError = useMutationError(removeDeal)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(dealSchema) })

  const openCreate = () => {
    dialogError.reset()
    deleteError.reset()
    reset({ title: '', value: 0, stageKey: stages[0]?.key ?? '' })
    setEditing({})
  }
  const openEdit = (deal) => {
    dialogError.reset()
    deleteError.reset()
    reset(deal)
    setEditing(deal)
  }
  const close = () => setEditing(null)

  const onSubmit = async (values) => {
    const { stageKey, ...rest } = values

    try {
      if (editing?._id) {
        // Stage changes and everything-else changes are two different
        // endpoints on the backend — send each field set where it belongs.
        if (stageKey !== editing.stageKey) {
          await moveStage.mutateAsync({ id: editing._id, stageKey })
          // The move is saved even if the PATCH below fails; a retry must
          // only resend the PATCH, not move (and log, and notify) again.
          setEditing((prev) => ({ ...prev, stageKey }))
        }
        await updateDeal.mutateAsync({ id: editing._id, ...rest })
      } else {
        await createDeal.mutateAsync(values)
      }
      close()
    } catch {
      // Shown via dialogError; the dialog keeps what the user typed. If the
      // move succeeded and the PATCH failed, useMoveStage's onSuccess has
      // already refetched the list, so the table shows the real stage.
    }
  }

  const columns = [
    { key: 'title', header: 'Deal' },
    { key: 'value', header: 'Value', render: (row) => formatCurrency(row.value, row.currency) },
    {
      key: 'stageKey',
      header: 'Stage',
      render: (row) => <Badge variant={STAGE_VARIANT[row.stageKey]}>{labelFor(row.stageKey)}</Badge>,
    },
    { key: 'company', header: 'Company', render: (row) => row.companyId?.name ?? '—' },
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl font-semibold">Pipeline</h1>
        <Button onClick={openCreate}>New deal</Button>
      </div>

      {!editing && <ErrorAlert message={deleteError.message} />}

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        emptyTitle="No deals yet"
        emptyDescription="Convert a lead or create a deal directly to start the pipeline."
        onRowClick={openEdit}
        meta={data?.meta}
        onPageChange={setPage}
      />

      <Modal
        isOpen={Boolean(editing)}
        onClose={close}
        title={editing?._id ? 'Edit deal' : 'New deal'}
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
            <Button
              type="submit"
              form="deal-form"
              disabled={isSubmitting || readOnly}
              title={readOnly ? 'Only the owner can edit this deal' : undefined}
            >
              {editing?._id ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <ErrorAlert message={dialogError.message} />
        <form id="deal-form" onSubmit={handleSubmit(onSubmit)}>
          <FormField label="Title" htmlFor="deal-title" error={errors.title}>
            <input id="deal-title" className={inputClasses(errors.title)} {...register('title')} />
          </FormField>
          <FormField label="Value" htmlFor="deal-value" error={errors.value}>
            <input
              id="deal-value"
              type="number"
              step="0.01"
              className={inputClasses(errors.value)}
              {...register('value')}
            />
          </FormField>
          <FormField label="Stage" htmlFor="deal-stage">
            <select
              // Remount once the stages arrive, so RHF re-applies the deal's stage
              // instead of the browser defaulting to the first option.
              key={stages.length}
              id="deal-stage"
              className={inputClasses(false)}
              {...register('stageKey')}
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </FormField>
        </form>

        {editing?._id && (
          <div className="mt-6 border-t border-border pt-4 dark:border-border-dark">
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <NotesPanel entityType="deal" entityId={editing._id} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={confirmDelete.close}
        onConfirm={() => {
          removeDeal.mutate(editing._id)
          close()
        }}
        title="Delete this deal?"
        description={`This will permanently remove "${editing?.title}".`}
        confirmLabel="Delete"
      />
    </div>
  )
}
