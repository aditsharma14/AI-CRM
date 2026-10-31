// Axios instance, access-token holder, cold-start retries ("Waking up the server…") and the refresh-on-401 interceptor.
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

// --- Cold starts --------------------------------------------------------------------------------------------------
// The API runs on Render's free tier, which sleeps after 15 idle minutes and takes about a minute to wake. Meanwhile
// Render may answer with its HTML loading page, or the proxies with 502/503/504. Those are retried with backoff for
// about 90 s, and WakingBanner says what's going on, instead of the page failing.
// - Not JSON, or 503: the app never saw the request, so any method is retried.
// - 502/504: the app may have handled it before the gateway gave up, so only safe requests (and the session refresh,
//   the first call a cold page makes) are retried; a write fails as usual rather than risk doing it twice.
export const WAKE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000]
let wakeRetryDelays = WAKE_RETRY_DELAYS_MS
let slowRequestMs = 4_000
/** Tests shorten the schedule; setup.js restores it. */
export const setWakeRetryDelays = (delays) => {
  wakeRetryDelays = delays
}
export const setSlowRequestMs = (ms) => {
  slowRequestMs = ms
}

// Requests currently waiting on the server: retrying, or in flight longer than slowRequestMs.
const waitingOn = new Set()
const wakeListeners = new Set()
const setWaitingOn = (id, waiting) => {
  const before = waitingOn.size > 0
  if (waiting) waitingOn.add(id)
  else waitingOn.delete(id)
  if (before !== waitingOn.size > 0) wakeListeners.forEach((listener) => listener())
}
export const isWaking = () => waitingOn.size > 0
/** For useSyncExternalStore (WakingBanner). */
export const subscribeWaking = (listener) => {
  wakeListeners.add(listener)
  return () => wakeListeners.delete(listener)
}
export const resetWaking = () => {
  waitingOn.clear()
  wakeListeners.forEach((listener) => listener())
}

let nextRequestId = 0
const slowTimers = new Map()
api.interceptors.request.use((config) => {
  config._requestId ??= ++nextRequestId
  const id = config._requestId
  clearTimeout(slowTimers.get(id))
  slowTimers.set(
    id,
    setTimeout(() => setWaitingOn(id, true), slowRequestMs),
  )
  return config
})

const isJson = (response) => /application\/json/i.test(String(response.headers?.['content-type'] ?? ''))
const isSafe = (config) => ['get', 'head', 'options'].includes(config.method) || config.url === '/auth/refresh'

/** Whether this response means "the server is still waking up" for this request. */
function isColdStart(config, response) {
  if (!config || !response) return false
  if (!isJson(response) || response.status === 503) return true
  return (response.status === 502 || response.status === 504) && isSafe(config)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Settles a request: it's no longer slow or waiting. */
function settled(config) {
  const id = config?._requestId
  if (id === undefined) return
  clearTimeout(slowTimers.get(id))
  slowTimers.delete(id)
  setWaitingOn(id, false)
}

/** Retries `config` after the next delay, or returns null when the schedule is used up. */
async function retryAfterWaking(config) {
  const attempt = config._wakeAttempt ?? 0
  if (attempt >= wakeRetryDelays.length) return null
  setWaitingOn(config._requestId, true)
  await sleep(wakeRetryDelays[attempt])
  config._wakeAttempt = attempt + 1
  return api(config)
}

function wakeTimedOut(config, response) {
  const error = new Error('The server did not wake up in time.')
  Object.assign(error, { wakeTimedOut: true, config, response, isAxiosError: true })
  return error
}

api.interceptors.response.use(
  async (response) => {
    // A 2xx that isn't JSON is Render's loading page, not our API.
    if (isColdStart(response.config, response)) {
      const retried = await retryAfterWaking(response.config)
      if (retried) return retried
      settled(response.config)
      throw wakeTimedOut(response.config, response)
    }
    settled(response.config)
    return response
  },
  async (error) => {
    const { config, response } = error
    if (error.wakeTimedOut) throw error
    if (isColdStart(config, response)) {
      const retried = await retryAfterWaking(config)
      if (retried) return retried
      settled(config)
      throw wakeTimedOut(config, response)
    }
    settled(config)
    throw error
  },
)

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
