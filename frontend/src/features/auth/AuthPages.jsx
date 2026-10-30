// Login, RegisterOrg, and AcceptInvite forms.
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../../context/SessionContext.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button } from '../../components/ui.jsx'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { apiErrorMessage } from '../../lib/utils.js'

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
})

export function LoginPage() {
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState(null)
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
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
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
  password: z.string().min(8, 'Password must be at least 8 characters'),
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
      <FormField label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters.">
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
  password: z.string().min(8, 'Password must be at least 8 characters'),
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
      <FormField label="Choose a password" htmlFor="password" error={errors.password} hint="At least 8 characters.">
        <input id="password" type="password" className={inputClasses(errors.password)} {...register('password')} />
      </FormField>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Joining…' : 'Accept invite'}
      </Button>
    </form>
  )
}
