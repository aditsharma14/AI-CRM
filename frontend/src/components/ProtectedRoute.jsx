// Renders pages for everyone; gates by role only once a session exists.
// Pages are viewable without logging in — the backend still requires a
// valid session for every real read/write, so an unauthenticated visitor
// just sees empty/error states until they log in (see AppLayout's guest banner).
import { Outlet } from 'react-router-dom'

import { useSession } from '../context/SessionContext.jsx'
import { Loader } from './ui.jsx'

/** @param {{ roles?: string[] }} props Omit roles to admit every signed-in role (and guests). */
export default function ProtectedRoute({ roles }) {
  const { isBootstrapping, isAuthenticated, role } = useSession()

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader className="h-6 w-6" />
      </div>
    )
  }

  if (roles && isAuthenticated && !roles.includes(role)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted dark:text-muted-dark">
        You don&apos;t have permission to view this page.
      </div>
    )
  }

  return <Outlet />
}
