// Settings → Profile: your name and password.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useMutationError } from '../../hooks.js'

const profileSchema = z.object({ name: z.string().trim().min(1, 'Name is required') })
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })

export default function ProfileTab() {
  const { user, updateLocalUser } = useSession()
  const [savedName, setSavedName] = useState(false)
  const [savedPassword, setSavedPassword] = useState(false)

  const profileForm = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? '' } })
  const updateProfile = useMutation({
    mutationFn: async (values) => (await api.patch('/org/me', values)).data.data,
    onMutate: () => setSavedName(false),
    onSuccess: (updatedUser) => {
      updateLocalUser({ name: updatedUser.name })
      setSavedName(true)
    },
  })

  const passwordForm = useForm({ resolver: zodResolver(passwordSchema) })
  const changePassword = useMutation({
    mutationFn: (values) => api.patch('/org/me/password', values),
    onMutate: () => setSavedPassword(false),
    onSuccess: () => {
      passwordForm.reset()
      setSavedPassword(true)
    },
  })

  const nameError = useMutationError(updateProfile)
  // A 400 on one of the password fields shows under that field; anything else goes in the alert.
  const passwordError = useMutationError(changePassword).forFields([
    'currentPassword',
    'newPassword',
    'confirmPassword',
  ])
  const passwordFieldError = (field) => passwordForm.formState.errors[field] ?? passwordError.fieldErrors[field]

  return (
    <div className="flex max-w-md flex-col gap-8">
      <form onSubmit={profileForm.handleSubmit((v) => updateProfile.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Your name</h2>
        <FormField label="Name" error={profileForm.formState.errors.name}>
          <input className={inputClasses(profileForm.formState.errors.name)} {...profileForm.register('name')} />
        </FormField>
        <ErrorAlert message={nameError.message} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={updateProfile.isPending}>
            Save name
          </Button>
          {savedName && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>

      <form onSubmit={passwordForm.handleSubmit((v) => changePassword.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Change password</h2>
        <FormField label="Current password" error={passwordFieldError('currentPassword')}>
          <input
            type="password"
            className={inputClasses(passwordFieldError('currentPassword'))}
            {...passwordForm.register('currentPassword')}
          />
        </FormField>
        <FormField label="New password" error={passwordFieldError('newPassword')} hint="At least 8 characters.">
          <input
            type="password"
            className={inputClasses(passwordFieldError('newPassword'))}
            {...passwordForm.register('newPassword')}
          />
        </FormField>
        <FormField label="Confirm new password" error={passwordFieldError('confirmPassword')}>
          <input
            type="password"
            className={inputClasses(passwordFieldError('confirmPassword'))}
            {...passwordForm.register('confirmPassword')}
          />
        </FormField>
        <ErrorAlert message={passwordError.message} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={changePassword.isPending}>
            Change password
          </Button>
          {savedPassword && (
            <span className="text-sm text-success">Password changed. You'll stay signed in on this device.</span>
          )}
        </div>
      </form>
    </div>
  )
}
