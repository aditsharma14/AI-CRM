// Contact list, detail modal and form.
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

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.union([z.literal(''), z.string().trim().email()]).optional(),
  phone: z.string().trim().optional(),
  title: z.string().trim().optional(),
  companyId: z.string().optional(),
})

export default function ContactsPage() {
  const [search, setSearch] = useState('')
  const q = useDebounce(search)
  const { page, limit, setPage } = usePaginationState()
  const [editing, setEditing] = useState(null)
  const confirmDelete = useDisclosure()
  const { user, can } = useSession()
  const readOnly = Boolean(editing?._id) && !canModifyRecord(user, editing)

  const contacts = useCrudQuery('contacts')
  const { data, isLoading, isError } = contacts.useList({ page, limit, q: q || undefined })
  const createContact = contacts.useCreate()
  const updateContact = contacts.useUpdate()
  const removeContact = contacts.useRemove()

  const companies = useCrudQuery('companies')
  const { data: companyOptions } = companies.useList({ limit: 100, sort: 'name' })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(contactSchema) })

  const openCreate = () => {
    reset({ name: '', email: '', phone: '', title: '', companyId: '' })
    setEditing({})
  }
  const openEdit = (contact) => {
    reset({ ...contact, companyId: contact.companyId?._id ?? '' })
    setEditing(contact)
  }
  const close = () => setEditing(null)

  const onSubmit = async (values) => {
    const payload = { ...values, email: values.email || undefined, companyId: values.companyId || undefined }
    if (editing?._id) await updateContact.mutateAsync({ id: editing._id, ...payload })
    else await createContact.mutateAsync(payload)
    close()
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'title', header: 'Title' },
    { key: 'company', header: 'Company', render: (row) => row.companyId?.name ?? '—' },
  ]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl font-semibold">Contacts</h1>
        <Button onClick={openCreate}>New contact</Button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search contacts…"
        className={`${inputClasses(false)} mb-4 max-w-xs`}
      />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        isLoading={isLoading}
        isError={isError}
        emptyTitle="No contacts yet"
        emptyDescription="Add a contact to start tracking relationships."
        onRowClick={openEdit}
        meta={data?.meta}
        onPageChange={setPage}
      />

      <Modal
        isOpen={Boolean(editing)}
        onClose={close}
        title={editing?._id ? 'Edit contact' : 'New contact'}
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
              form="contact-form"
              disabled={isSubmitting || readOnly}
              title={readOnly ? 'Only the owner can edit this contact' : undefined}
            >
              {editing?._id ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form id="contact-form" onSubmit={handleSubmit(onSubmit)}>
          <FormField label="Name" error={errors.name}>
            <input className={inputClasses(errors.name)} {...register('name')} />
          </FormField>
          <FormField label="Email" error={errors.email}>
            <input className={inputClasses(errors.email)} {...register('email')} />
          </FormField>
          <FormField label="Phone">
            <input className={inputClasses(false)} {...register('phone')} />
          </FormField>
          <FormField label="Title">
            <input className={inputClasses(false)} {...register('title')} />
          </FormField>
          <FormField label="Company">
            <select className={inputClasses(false)} {...register('companyId')}>
              <option value="">No company</option>
              {companyOptions?.data.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
        </form>

        {editing?._id && (
          <div className="mt-6 border-t border-border pt-4 dark:border-border-dark">
            <h3 className="mb-2 text-sm font-semibold">Notes</h3>
            <NotesPanel entityType="contact" entityId={editing._id} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={confirmDelete.close}
        onConfirm={() => {
          removeContact.mutate(editing._id)
          close()
        }}
        title="Delete this contact?"
        description={`This will permanently remove "${editing?.name}".`}
        confirmLabel="Delete"
      />
    </div>
  )
}
