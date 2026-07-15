// Axios instance, refresh-on-401 interceptor, endpoint path map.
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
        window.location.assign('/login')
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
