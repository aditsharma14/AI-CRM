// Company list, detail modal and form.
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { DataTable } from '../../components/DataTable.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { ConfirmDialog, Modal } from '../../components/Modal.jsx'
import { Button } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useCrudQuery, useDebounce, useDisclosure, usePaginationState } from '../../hooks.js'
import { canModifyRecord } from '../../lib/constants.js'
import NotesPanel from '../notes/NotesPanel.jsx'

const SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+']

const companySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  domain: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  size: z.enum(SIZES).optional().or(z.literal('')),
})

export default function CompaniesPage() {
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const { page, limit, setPage } = usePaginationState()
  const [editing, setEditing] = useState(null)
  const confirmDelete = useDisclosure()
  const { user, can } = useSession()
  const readOnly = Boolean(editing?._id) && !canModifyRecord(user, editing)

  const companies = useCrudQuery('companies')
  const { data, isLoading, isError } = companies.useList({ page, limit, q: q || undefined })
  const createCompany = companies.useCreate()
  const updateCompany = companies.useUpdate()
  const removeCompany = companies.useRemove()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(companySchema) })

  const openCreate = () => {
    reset({ name: '', domain: '', industry: '', size: '' })
    setEditing({})
  }
  const openEdit = (company) => {
    reset(company)
    setEditing(company)
  }
  const close = () => setEditing(null)

  const onSubmit = async (values) => {
    const payload = { ...values, size: values.size || undefined }
    if (editing?._id) await updateCompany.mutateAsync({ id: editing._id, ...payload })
    else await createCompany.mutateAsync(payload)
    close()
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'domain', header: 'Domain' },
    { key: 'industry', header: 'Industry' },
    { key: 'size', header: 'Size' },
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl font-semibold">Companies</h1>
        <Button onClick={openCreate}>New company</Button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search companies…"
        className={`${inputClasses(false)} mb-4 max-w-xs`}
      />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        emptyTitle="No companies yet"
        emptyDescription="Add a company to link contacts, leads, and deals to it."
        onRowClick={openEdit}
        meta={data?.meta}
        onPageChange={setPage}
      />

      <Modal
        isOpen={Boolean(editing)}
        onClose={close}
        title={editing?._id ? 'Edit company' : 'New company'}
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
              form="company-form"
              disabled={isSubmitting || readOnly}
              title={readOnly ? 'Only the owner can edit this company' : undefined}
            >
              {editing?._id ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form id="company-form" onSubmit={handleSubmit(onSubmit)}>
          <FormField label="Name" error={errors.name}>
            <input className={inputClasses(errors.name)} {...register('name')} />
          </FormField>
          <FormField label="Domain">
            <input className={inputClasses(false)} {...register('domain')} />
          </FormField>
          <FormField label="Industry">
            <input className={inputClasses(false)} {...register('industry')} />
          </FormField>
          <FormField label="Size">
            <select className={inputClasses(false)} {...register('size')}>
              <option value="">Unspecified</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} employees
                </option>
              ))}
            </select>
          </FormField>
        </form>

        {editing?._id && (
          <div className="mt-6 border-t border-border pt-4 dark:border-border-dark">
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <NotesPanel entityType="company" entityId={editing._id} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={confirmDelete.close}
        onConfirm={() => {
          removeCompany.mutate(editing._id)
          close()
        }}
        title="Delete this company?"
        description={`This will permanently remove "${editing?.name}".`}
        confirmLabel="Delete"
      />
    </div>
  )
}
