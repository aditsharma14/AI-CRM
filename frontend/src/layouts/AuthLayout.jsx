// Centered shell for login/register/invite screens.
import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

import { Loader } from '../components/ui.jsx'

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 dark:bg-background-dark">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-soft dark:border-border-dark dark:bg-surface-dark">
        <div className="mb-6 text-center font-serif text-xl font-semibold text-primary dark:text-primary-dark">
          Nimbus CRM
        </div>
        {/* The auth pages are a lazy chunk (App.jsx). */}
        <Suspense
          fallback={
            <div className="flex justify-center py-8">
              <Loader className="h-5 w-5" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
