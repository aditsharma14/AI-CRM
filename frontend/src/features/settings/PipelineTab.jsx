// Settings → Pipeline & Templates: stage labels and email templates.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { ConfirmDialog } from '../../components/Modal.jsx'
import { Button, EmptyState, Loader } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useDisclosure } from '../../hooks.js'

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  subject: z.string().trim().min(1, 'Subject is required'),
  body: z.string().trim().min(1, 'Body is required'),
})

export default function PipelineTab() {
  const { can } = useSession()
  const queryClient = useQueryClient()
  const canConfigure = can('pipeline', 'configure')

  const { data: stages, isLoading } = useQuery({
    queryKey: ['org', 'pipeline-stages'],
    queryFn: async () => (await api.get('/org/pipeline-stages')).data.data,
  })
  const [draftStages, setDraftStages] = useState(null)
  const activeStages = draftStages ?? stages ?? []

  const saveStages = useMutation({
    mutationFn: (payload) => api.patch('/org/pipeline-stages', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', 'pipeline-stages'] })
      setDraftStages(null)
    },
  })

  const { data: templates } = useQuery({
    queryKey: ['org', 'email-templates'],
    queryFn: async () => (await api.get('/org/email-templates')).data.data,
  })
  const templateForm = useForm({ resolver: zodResolver(templateSchema) })
  const createTemplate = useMutation({
    mutationFn: (values) => api.post('/org/email-templates', values),
    onSuccess: () => {
      templateForm.reset({ name: '', subject: '', body: '' })
      queryClient.invalidateQueries({ queryKey: ['org', 'email-templates'] })
    },
  })
  const [templateToDelete, setTemplateToDelete] = useState(null)
  const confirmDeleteTemplate = useDisclosure()
  const deleteTemplate = useMutation({
    mutationFn: (id) => api.delete(`/org/email-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', 'email-templates'] }),
  })

  if (isLoading) return <Loader className="h-6 w-6" />

  const renameStage = (key, label) => {
    setDraftStages(activeStages.map((s) => (s.key === key ? { ...s, label } : s)))
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Pipeline stages</h2>
        <p className="mb-3 text-sm text-muted dark:text-muted-dark">
          These labels show up everywhere a deal's stage is displayed. The <code>won</code>/<code>lost</code> stages are
          what trigger a deal closing — only their labels can be changed.
        </p>
        <div className="flex flex-col gap-2">
          {activeStages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((stage) => (
              <div key={stage.key} className="flex items-center gap-2">
                <input
                  disabled={!canConfigure}
                  value={stage.label}
                  onChange={(e) => renameStage(stage.key, e.target.value)}
                  className={`${inputClasses(false)} max-w-xs`}
                />
                <span className="font-mono text-xs text-muted dark:text-muted-dark">{stage.key}</span>
              </div>
            ))}
        </div>
        {canConfigure && draftStages && (
          <Button className="mt-3" disabled={saveStages.isPending} onClick={() => saveStages.mutate(draftStages)}>
            Save stage names
          </Button>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Email templates</h2>
        {canConfigure && (
          <form
            onSubmit={templateForm.handleSubmit((v) => createTemplate.mutate(v))}
            className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 dark:border-border-dark dark:bg-card-dark"
          >
            <FormField label="Name" error={templateForm.formState.errors.name}>
              <input className={inputClasses(templateForm.formState.errors.name)} {...templateForm.register('name')} />
            </FormField>
            <FormField label="Subject" error={templateForm.formState.errors.subject}>
              <input
                className={inputClasses(templateForm.formState.errors.subject)}
                {...templateForm.register('subject')}
              />
            </FormField>
            <FormField label="Body" error={templateForm.formState.errors.body}>
              <textarea
                rows={3}
                className={inputClasses(templateForm.formState.errors.body)}
                {...templateForm.register('body')}
              />
            </FormField>
            <Button type="submit" disabled={createTemplate.isPending} className="self-start">
              Add template
            </Button>
          </form>
        )}
        {templates?.length ? (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li
                key={t._id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm dark:border-border-dark"
              >
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted dark:text-muted-dark">{t.subject}</p>
                </div>
                {canConfigure && (
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateToDelete(t)
                      confirmDeleteTemplate.open()
                    }}
                    className="text-muted hover:text-danger dark:text-muted-dark"
                    aria-label={`Delete template ${t.name}`}
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No email templates yet"
            description="Templates you create for AI email generation will show up here."
          />
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDeleteTemplate.isOpen}
        onClose={confirmDeleteTemplate.close}
        onConfirm={() => deleteTemplate.mutate(templateToDelete._id)}
        title="Delete this template?"
        description={`"${templateToDelete?.name}" will be permanently removed.`}
        confirmLabel="Delete"
      />
    </div>
  )
}
