// Login, RegisterOrg, AcceptInvite, ForgotPassword and ResetPassword forms.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Toast } from '../../components/Toast.jsx'
import { Button } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useAppConfig, useMutationError } from '../../hooks.js'
import { PASSWORD_HINT, passwordRule } from '../../lib/password.js'
import { apiErrorMessage } from '../../lib/utils.js'

const linkClasses = 'text-primary dark:text-primary-dark'

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
})

export function LoginPage() {
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { emailEnabled } = useAppConfig()
  const [serverError, setServerError] = useState(null)
  // A page that sends the user here (e.g. after a password reset) can pass a one-time notice in router state.
  const [notice, setNotice] = useState(() => location.state?.notice ?? null)
  const dismissNotice = useCallback(() => setNotice(null), [])
  useEffect(() => {
    // Drop it from history, so a reload or Back doesn't show it again.
    if (location.state?.notice)
      navigate(location.pathname, { replace: true, state: { ...location.state, notice: null } })
  }, [location, navigate])
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (values) => {
    setServerError(null)
    try {
      await login(values)
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
    } catch (err) {
      setServerError(apiErrorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <ErrorAlert message={serverError} />
      <FormField label="Email" htmlFor="email" error={errors.email}>
        <input id="email" type="email" className={inputClasses(errors.email)} {...register('email')} />
      </FormField>
      <FormField label="Password" htmlFor="password" error={errors.password}>
        <input id="password" type="password" className={inputClasses(errors.password)} {...register('password')} />
      </FormField>
      {/* Without email (S2.6) a reset link can't reach anyone, so don't offer one. */}
      {emailEnabled && (
        <p className="-mt-2 mb-4 text-right text-sm">
          <Link to="/forgot-password" className={linkClasses}>
            Forgot password?
          </Link>
        </p>
      )}
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <Toast message={notice} onDismiss={dismissNotice} />
      <p className="mt-4 text-center text-sm text-muted dark:text-muted-dark">
        New organization?{' '}
        <Link to="/register" className="text-primary dark:text-primary-dark">
          Create one
        </Link>
      </p>
    </form>
  )
}

const registerSchema = z.object({
  orgName: z.string().trim().min(2, 'Organization name is required'),
  name: z.string().trim().min(1, 'Your name is required'),
  email: z.string().trim().email(),
  password: passwordRule,
})

export function RegisterOrgPage() {
  const { registerOrg } = useSession()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(registerSchema) })

  const onSubmit = async (values) => {
    setServerError(null)
    try {
      await registerOrg(values)
      navigate('/', { replace: true })
    } catch (err) {
      setServerError(apiErrorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <ErrorAlert message={serverError} />
      <FormField label="Organization name" htmlFor="orgName" error={errors.orgName}>
        <input id="orgName" className={inputClasses(errors.orgName)} {...register('orgName')} />
      </FormField>
      <FormField label="Your name" htmlFor="name" error={errors.name}>
        <input id="name" className={inputClasses(errors.name)} {...register('name')} />
      </FormField>
      <FormField label="Email" htmlFor="email" error={errors.email}>
        <input id="email" type="email" className={inputClasses(errors.email)} {...register('email')} />
      </FormField>
      <FormField label="Password" htmlFor="password" error={errors.password} hint={PASSWORD_HINT}>
        <input id="password" type="password" className={inputClasses(errors.password)} {...register('password')} />
      </FormField>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Creating…' : 'Create organization'}
      </Button>
      <p className="mt-4 text-center text-sm text-muted dark:text-muted-dark">
        Already have an account?{' '}
        <Link to="/login" className="text-primary dark:text-primary-dark">
          Sign in
        </Link>
      </p>
    </form>
  )
}

const acceptInviteSchema = z.object({
  name: z.string().trim().min(1, 'Your name is required'),
  password: passwordRule,
})

export function AcceptInvitePage() {
  const { acceptInvite } = useSession()
  const navigate = useNavigate()
  const { token } = useParams()
  const [serverError, setServerError] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(acceptInviteSchema) })

  const onSubmit = async (values) => {
    setServerError(null)
    try {
      await acceptInvite({ ...values, token })
      navigate('/', { replace: true })
    } catch (err) {
      setServerError(apiErrorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <ErrorAlert message={serverError} />
      <FormField label="Your name" htmlFor="name" error={errors.name}>
        <input id="name" className={inputClasses(errors.name)} {...register('name')} />
      </FormField>
      <FormField label="Choose a password" htmlFor="password" error={errors.password} hint={PASSWORD_HINT}>
        <input id="password" type="password" className={inputClasses(errors.password)} {...register('password')} />
      </FormField>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Joining…' : 'Accept invite'}
      </Button>
    </form>
  )
}

const forgotSchema = z.object({ email: z.string().trim().email() })

export function ForgotPasswordPage() {
  const { emailEnabled, isLoading } = useAppConfig()
  const send = useMutation({ mutationFn: (values) => api.post('/auth/forgot-password', values) })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(forgotSchema) })

  if (isLoading) return null
  if (!emailEnabled) {
    return (
      <div className="text-center text-sm">
        <h1 className="mb-2 font-serif text-lg font-semibold">Password reset isn’t available yet</h1>
        <p className="mb-4 text-muted dark:text-muted-dark">
          This deployment can&apos;t send email, so there&apos;s no way to get you a reset link. Ask your
          organization&apos;s owner for help.
        </p>
        <Link to="/login" className={linkClasses}>
          Back to sign in
        </Link>
      </div>
    )
  }

  if (send.isSuccess) {
    // The API answers the same whether or not the email has an account, and so does this.
    return (
      <div role="status" className="text-center text-sm">
        <p className="mb-4">
          If an account exists for {send.variables.email}, we&apos;ve sent it a link to reset the password. The link
          works once and expires in 15 minutes.
        </p>
        <Link to="/login" className={linkClasses}>
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit((values) => send.mutate(values))}>
      <h1 className="mb-4 font-serif text-lg font-semibold">Reset your password</h1>
      <ErrorAlert error={send.error} />
      <FormField label="Email" htmlFor="email" error={errors.email}>
        <input id="email" type="email" className={inputClasses(errors.email)} {...register('email')} />
      </FormField>
      <Button type="submit" disabled={send.isPending} className="w-full">
        {send.isPending ? 'Sending…' : 'Send reset link'}
      </Button>
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className={linkClasses}>
          Back to sign in
        </Link>
      </p>
    </form>
  )
}

const resetSchema = z
  .object({ password: passwordRule, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })

/** The missing-token and expired-token states: both end at a fresh email. */
function ResetLinkProblem({ title, children }) {
  return (
    <div className="text-center">
      <h1 className="mb-2 font-serif text-lg font-semibold">{title}</h1>
      <p className="mb-4 text-sm text-muted dark:text-muted-dark">{children}</p>
      <Link to="/forgot-password" className={linkClasses}>
        Request a new link
      </Link>
    </div>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Read once, then taken out of the address bar below; the form keeps it in state.
  const [token] = useState(() => searchParams.get('token'))
  useEffect(() => {
    // A token left in the URL lives on in history, synced tabs, screenshots and the Referer of any link followed
    // from here. replaceState removes it without a navigation (no re-render, no new history entry).
    if (new URLSearchParams(window.location.search).has('token')) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
  }, [])

  const [showPasswords, setShowPasswords] = useState(false)
  const reset = useMutation({
    mutationFn: (password) => api.post('/auth/reset-password', { token, password }),
    onSuccess: () =>
      navigate('/login', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } }),
  })
  const resetError = useMutationError(reset)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(resetSchema) })

  if (!token) {
    return (
      <ResetLinkProblem title="This reset link is incomplete">
        Open the link from your email again, or ask for a new one.
      </ResetLinkProblem>
    )
  }
  if (resetError.error?.response?.data?.error?.code === 'INVALID_RESET_TOKEN') {
    return (
      <ResetLinkProblem title="This reset link has expired">
        Reset links work once and expire after 15 minutes. Ask for a new one and use it within that time.
      </ResetLinkProblem>
    )
  }

  // A 400 on the password (the server's rule changed, say) shows under the field; anything else in the alert.
  const { fieldErrors, message } = resetError.forFields(['password'])
  const inputType = showPasswords ? 'text' : 'password'

  return (
    <form onSubmit={handleSubmit((values) => reset.mutate(values.password))}>
      <h1 className="mb-4 font-serif text-lg font-semibold">Choose a new password</h1>
      <ErrorAlert message={message} />
      <FormField
        label="New password"
        htmlFor="new-password"
        error={errors.password ?? fieldErrors.password}
        hint={PASSWORD_HINT}
      >
        <input
          id="new-password"
          type={inputType}
          autoComplete="new-password"
          className={inputClasses(errors.password ?? fieldErrors.password)}
          {...register('password')}
        />
      </FormField>
      <FormField label="Confirm new password" htmlFor="confirm-password" error={errors.confirmPassword}>
        <input
          id="confirm-password"
          type={inputType}
          autoComplete="new-password"
          className={inputClasses(errors.confirmPassword)}
          {...register('confirmPassword')}
        />
      </FormField>
      <button
        type="button"
        aria-pressed={showPasswords}
        onClick={() => setShowPasswords((shown) => !shown)}
        className="-mt-2 mb-4 text-sm text-primary dark:text-primary-dark"
      >
        Show passwords
      </button>
      <Button type="submit" disabled={reset.isPending} className="w-full">
        {reset.isPending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  )
}
