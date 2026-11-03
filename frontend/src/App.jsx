// Providers, route table, and the top-level error boundary.
import { QueryClientProvider } from '@tanstack/react-query'
import { Component, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  LoginPage,
  RegisterOrgPage,
  ResetPasswordPage,
} from './features/auth/AuthPages.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import AuthLayout from './layouts/AuthLayout.jsx'
import { demoUi } from './lib/demo.js'
import { queryClient } from './lib/queryClient.js'

// Each page is its own chunk, fetched the first time its route renders (AppLayout shows a skeleton meanwhile), so the
// first load carries only the shell and the page in view. The auth pages stay in the entry: sign-in is where most
// visits start, and they are small.
const CalendarPage = lazy(() => import('./features/calendar/CalendarPage.jsx'))
const CompaniesPage = lazy(() => import('./features/companies/CompaniesPage.jsx'))
const ContactsPage = lazy(() => import('./features/contacts/ContactsPage.jsx'))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage.jsx'))
const PipelinePage = lazy(() => import('./features/deals/PipelinePage.jsx'))
const LeadsPage = lazy(() => import('./features/leads/LeadsPage.jsx'))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage.jsx'))
const TasksPage = lazy(() => import('./features/tasks/TasksPage.jsx'))

class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="font-serif text-lg font-semibold">Something broke.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-white"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/** The route table, apart from the router so tests can mount it in a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterOrgPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/deals" element={<PipelinePage />} />
          {/* The page is called Pipeline; links and bookmarks may use that name. */}
          <Route path="/pipeline" element={<Navigate to="/deals" replace />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          {/* Every member can reach Settings — the tabs gate individual
              management actions (invite, rename org, etc.) by role themselves. */}
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const { Banner } = demoUi()
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* The Pages demo is served under /AI-CRM/; elsewhere BASE_URL is '/'. */}
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
          <SessionProvider>
            {Banner && <Banner />}
            <AppRoutes />
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
