// Auth + active org + role + permission-check state.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, setAccessToken, setOnUnauthorized } from '../api/client.js'
import { hasPermission } from '../lib/constants.js'
import { queryClient } from '../lib/queryClient.js'

const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  const applySession = useCallback(({ accessToken, user: nextUser }) => {
    setAccessToken(accessToken)
    setUser(nextUser)
  }, [])

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    queryClient.clear()
  }, [])

  // Silent bootstrap: an httpOnly refresh cookie from a previous visit, if
  // still valid, re-establishes the session without a login screen flash.
  //
  // hasBootstrapped survives React StrictMode's dev-only double-invoke of
  // this effect (mount → cleanup → mount again) because refs persist across
  // that simulated remount. Without it, both invocations would fire their
  // own POST /auth/refresh with the same cookie — refresh tokens rotate on
  // use, so only one of those two calls can succeed, and it's not
  // guaranteed to be the one whose closure is still "current" by the time
  // it resolves. That's a real race, not just a dev-mode oddity (the same
  // thing can happen for real with two browser tabs loading at once), which
  // is why authService.refresh() is also written to fail that second call
  // cleanly instead of crashing — but the best fix is not sending it twice.
  // No `cancelled`-flag cleanup here on purpose: SessionProvider wraps the
  // whole app at the root (see App.jsx) and never really unmounts while the
  // page is open, so there's no stale-closure case to guard against — the
  // hasBootstrapped ref above is the only guard this effect needs. (An
  // earlier version had both; the cancelled-flag from the first StrictMode
  // invocation ended up permanently true by the time the one real request
  // resolved, which meant setIsBootstrapping(false) never ran and the app
  // stayed on its loading spinner forever. One guard, doing one job.)
  const hasBootstrapped = useRef(false)
  useEffect(() => {
    if (hasBootstrapped.current) return
    hasBootstrapped.current = true

    api
      .post('/auth/refresh')
      .then(({ data }) => applySession(data.data))
      .catch(() => {})
      .finally(() => setIsBootstrapping(false))
  }, [applySession])

  useEffect(() => {
    setOnUnauthorized(clearSession)
  }, [clearSession])

  const login = useCallback(
    async (credentials) => {
      const { data } = await api.post('/auth/login', credentials)
      applySession(data.data)
    },
    [applySession],
  )

  const registerOrg = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/register-org', payload)
      applySession(data.data)
    },
    [applySession],
  )

  const acceptInvite = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/accept-invite', payload)
      applySession(data.data)
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    clearSession()
  }, [clearSession])

  const can = useCallback((resource, action) => (user ? hasPermission(user.role, resource, action) : false), [user])

  // Settings' Profile tab calls this after a successful PATCH /org/me so the
  // header avatar/name update immediately, instead of waiting for the next
  // login or silent refresh to pick up the change.
  const updateLocalUser = useCallback((patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev)), [])

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      org: user?.org ?? null,
      isAuthenticated: Boolean(user),
      isBootstrapping,
      login,
      registerOrg,
      acceptInvite,
      logout,
      can,
      updateLocalUser,
    }),
    [user, isBootstrapping, login, registerOrg, acceptInvite, logout, can, updateLocalUser],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// Context modules conventionally export both the provider and its hook —
// this trades a slightly slower Fast Refresh for not splitting one small,
// cohesive concern across two files.
// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}
