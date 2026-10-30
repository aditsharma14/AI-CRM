// Providers, route table, and the top-level error boundary.
import { QueryClientProvider } from '@tanstack/react-query'
import { Component } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import ProtectedRoute from './components/ProtectedRoute.jsx'
import { SessionProvider } from './context/SessionContext.jsx'
import { AcceptInvitePage, LoginPage, RegisterOrgPage } from './features/auth/AuthPages.jsx'
import CalendarPage from './features/calendar/CalendarPage.jsx'
import CompaniesPage from './features/companies/CompaniesPage.jsx'
import ContactsPage from './features/contacts/ContactsPage.jsx'
import DashboardPage from './features/dashboard/DashboardPage.jsx'
import PipelinePage from './features/deals/PipelinePage.jsx'
import LeadsPage from './features/leads/LeadsPage.jsx'
import SettingsPage from './features/settings/SettingsPage.jsx'
import TasksPage from './features/tasks/TasksPage.jsx'
import AppLayout from './layouts/AppLayout.jsx'
import AuthLayout from './layouts/AuthLayout.jsx'
import { queryClient } from './lib/queryClient.js'

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

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionProvider>
            <Routes>
              <Route element={<AuthLayout />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterOrgPage />} />
                <Route path="/invite/:token" element={<AcceptInvitePage />} />
              </Route>
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="/leads" element={<LeadsPage />} />
                  <Route path="/contacts" element={<ContactsPage />} />
                  <Route path="/companies" element={<CompaniesPage />} />
                  <Route path="/deals" element={<PipelinePage />} />
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  {/* Every member can reach Settings — the tabs gate individual
                      management actions (invite, rename org, etc.) by role themselves. */}
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
