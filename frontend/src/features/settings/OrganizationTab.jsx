// Settings → Organization: the org's name (owner only).
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button, Loader } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'

const orgSchema = z.object({ name: z.string().trim().min(2, 'Organization name is required') })

export default function OrganizationTab() {
  const { can } = useSession()
  const queryClient = useQueryClient()
  const { data: org, isLoading } = useQuery({
    queryKey: ['org'],
    queryFn: async () => (await api.get('/org')).data.data,
  })
  const canManage = can('org', 'manage')

  const form = useForm({ resolver: zodResolver(orgSchema), values: { name: org?.name ?? '' } })
  const updateOrg = useMutation({
    mutationFn: (values) => api.patch('/org', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org'] }),
  })

  if (isLoading) return <Loader className="h-6 w-6" />

  return (
    <div className="max-w-md">
      <form onSubmit={form.handleSubmit((v) => updateOrg.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Organization name</h2>
        <FormField label="Name" error={form.formState.errors.name}>
          <input
            disabled={!canManage}
            className={inputClasses(form.formState.errors.name)}
            {...form.register('name')}
          />
        </FormField>
        {canManage ? (
          <Button type="submit" disabled={updateOrg.isPending}>
            Save
          </Button>
        ) : (
          <p className="text-sm text-muted dark:text-muted-dark">Only the org owner can rename the organization.</p>
        )}
      </form>
    </div>
  )
}
