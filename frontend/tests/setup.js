// @ts-check
// Global test setup: jest-dom matchers, MSW lifecycle, and resetting the app's module-level singletons.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server.js'
import { setAccessToken, setOnUnauthorized } from '../src/api/client.js'
import { queryClient } from '../src/lib/queryClient.js'

// 'error' makes any request a test didn't plan for fail loudly instead of
// hanging or silently hitting a real network.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  // client.js and queryClient.js are module singletons shared by every test
  // in a file; without this a token or cached query leaks into the next test.
  queryClient.clear()
  setAccessToken(null)
  setOnUnauthorized(() => {})
})

afterAll(() => server.close())
