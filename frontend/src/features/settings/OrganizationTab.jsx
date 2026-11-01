// Settings → Organization: the org's name and currency (owner only).
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button, Loader } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useMutationError } from '../../hooks.js'
import { CURRENCIES } from '../../lib/constants.js'

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Organization name is required'),
  currency: z.enum(CURRENCIES),
})

export default function OrganizationTab() {
  const { can, org: sessionOrg, updateLocalUser } = useSession()
  const queryClient = useQueryClient()
  const { data: org, isLoading } = useQuery({
    queryKey: ['org'],
    queryFn: async () => (await api.get('/org')).data.data,
  })
  const canManage = can('org', 'manage')

  const form = useForm({
    resolver: zodResolver(orgSchema),
    values: { name: org?.name ?? '', currency: org?.currency ?? 'USD' },
  })
  const updateOrg = useMutation({
    mutationFn: async (values) => (await api.patch('/org', values)).data.data,
    onSuccess: (saved) => {
      // The Dashboard formats money from the session's org, so it shouldn't wait for the next sign-in.
      updateLocalUser({ org: { ...sessionOrg, name: saved.name, currency: saved.currency } })
      return queryClient.invalidateQueries({ queryKey: ['org'] })
    },
  })
  const saveError = useMutationError(updateOrg)

  if (isLoading) return <Loader className="h-6 w-6" />

  return (
    <div className="max-w-md">
      <form onSubmit={form.handleSubmit((v) => updateOrg.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Organization</h2>
        <FormField label="Name" error={form.formState.errors.name}>
          <input
            disabled={!canManage}
            className={inputClasses(form.formState.errors.name)}
            {...form.register('name')}
          />
        </FormField>
        <FormField label="Currency" error={form.formState.errors.currency}>
          <select disabled={!canManage} className={inputClasses()} {...form.register('currency')}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </FormField>
        <p className="mb-4 text-xs text-muted dark:text-muted-dark">
          Dashboard totals are shown in this currency, and new deals use it unless they name another.
        </p>
        <ErrorAlert message={saveError.message} />
        {canManage ? (
          <Button type="submit" disabled={updateOrg.isPending}>
            Save
          </Button>
        ) : (
          <p className="text-sm text-muted dark:text-muted-dark">Only the org owner can change these settings.</p>
        )}
      </form>
    </div>
  )
}
