// The demo's own UI: the banner on every page and the two sign-in buttons. Registered by start.js only.
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ErrorAlert } from '../components/ErrorAlert.jsx'
import { Button } from '../components/ui.jsx'
import { useSession } from '../context/SessionContext.jsx'
import { apiErrorMessage } from '../lib/utils.js'
import { DEMO_ACCOUNTS } from './seed.js'

const README = 'https://github.com/aditsharma14/AI-CRM#readme'

export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demo mode"
      className="sticky top-0 z-50 border-b border-border bg-accent-50 px-4 py-2 text-center text-sm text-accent dark:border-border-dark dark:bg-accent/10 dark:text-accent-dark"
    >
      Demo mode: data stays in your browser and resets on reload. The real backend runs in Docker; see{' '}
      <a href={README} className="font-medium underline underline-offset-2">
        README
      </a>
      .
    </div>
  )
}

export function DemoSignIn() {
  const { login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)

  const signInAs = async (account) => {
    setError(null)
    setPending(account.email)
    try {
      // The demo answers for its two seeded people with any password; there are no credentials to keep.
      await login({ email: account.email, password: 'demo' })
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err))
      setPending(null)
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-2 border-b border-border pb-6 dark:border-border-dark">
      <ErrorAlert message={error} />
      {Object.values(DEMO_ACCOUNTS).map((account) => (
        <Button key={account.email} onClick={() => signInAs(account)} disabled={pending !== null} className="w-full">
          {account.label}
        </Button>
      ))}
      <p className="text-center text-xs text-muted dark:text-muted-dark">
        Sales Manager sees and changes everything; Member changes only their own records and can't delete.
      </p>
    </div>
  )
}
