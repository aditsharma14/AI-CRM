// Axios instance, access-token holder, the refresh-on-401 interceptor, and idempotent writes (one key per mutation).
import axios from 'axios'

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // ships the httpOnly refresh cookie
})

// The access token lives in memory only (never localStorage) to limit XSS
// blast radius — SessionContext is the only thing that calls this setter.
let accessToken = null
export const setAccessToken = (token) => {
  accessToken = token
}
export const getAccessToken = () => accessToken

// SessionContext registers this once, so a failed refresh can trigger a
// logout/redirect without client.js importing React context (no cycle).
let onUnauthorized = () => {}
export const setOnUnauthorized = (fn) => {
  onUnauthorized = fn
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

/**
 * Sends a write the server makes idempotent (docs/conventions.md#idempotency) with one Idempotency-Key for the whole
 * mutation. A dropped connection or a 409 IDEMPOTENCY_IN_PROGRESS is retried with that same key, so a write the
 * server already committed is replayed, not repeated. The refresh-on-401 replay below resends the same config, and so
 * the same key. Any other answer the server gave is final.
 * @param {(config: import('axios').AxiosRequestConfig) => Promise<import('axios').AxiosResponse>} send
 * @param {{ retries?: number, delayMs?: number }} [options] delayMs doubles on each retry.
 */
export async function idempotent(send, { retries = 2, delayMs = 300 } = {}) {
  const config = { headers: { 'Idempotency-Key': crypto.randomUUID() } }
  for (let attempt = 0; ; attempt++) {
    try {
      return await send(config)
    } catch (error) {
      const inProgress = error.response?.data?.error?.code === 'IDEMPOTENCY_IN_PROGRESS'
      if ((error.response && !inProgress) || attempt >= retries) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt))
    }
  }
}

/** Resources whose POST takes an Idempotency-Key. A create anywhere else is sent once, never retried. */
const IDEMPOTENT_CREATES = new Set(['leads', 'deals'])

/** @returns {Promise<unknown>} The created record. */
export async function createRecord(resource, payload) {
  const send = (config) => api.post(`/${resource}`, payload, config)
  const res = IDEMPOTENT_CREATES.has(resource) ? await idempotent(send) : await send()
  return res.data.data
}

let refreshPromise = null

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error
    const isAuthRoute = config?.url?.startsWith('/auth/')

    if (response?.status !== 401 || isAuthRoute || config._retried) {
      return Promise.reject(error)
    }

    // No access token to begin with means this is a guest browsing a page
    // that happens to need a session (see ProtectedRoute) — an expected
    // 401, not an expired session. Attempting a refresh — and, on its
    // failure, clearing the query cache via onUnauthorized — would wipe the
    // in-flight query this same interceptor is handling, leaving its
    // useQuery() stuck "loading" forever. Just let it reject normally...
    if (!accessToken) {
      // ...except when they were actually trying to change something (not
      // just viewing a list). Browsing is free; "doing stuff" needs a login,
      // so send them there instead of leaving a form silently failing.
      if (config.method !== 'get') {
        // BASE_URL, not '/': the GitHub Pages demo lives under /AI-CRM/.
        window.location.assign(`${import.meta.env.BASE_URL}login`)
      }
      return Promise.reject(error)
    }
    config._retried = true

    try {
      // Multiple 401s in flight share one refresh call instead of racing.
      refreshPromise ??= api.post('/auth/refresh').finally(() => {
        refreshPromise = null
      })
      const { data } = await refreshPromise
      setAccessToken(data.data.accessToken)
      return api(config)
    } catch (refreshError) {
      setAccessToken(null)
      onUnauthorized()
      return Promise.reject(refreshError)
    }
  },
)
