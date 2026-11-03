// @ts-check
// Global test setup: jest-dom matchers, MSW lifecycle, and resetting the app's module-level singletons.
import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { setAccessToken, setOnUnauthorized } from '../src/api/client.js'
import { queryClient } from '../src/lib/queryClient.js'
import { server } from './server.js'

// Pages are lazy chunks (App.jsx): the first render of one in a test file includes Vite transforming its module, which
// can pass findBy*'s default 1 s on a busy machine. A wait for something that never appears still fails, just later.
configure({ asyncUtilTimeout: 5000 })

// A request no handler matches is rejected (MSW's 'error') *and* fails the
// test. 'error' alone isn't enough: it only logs, the app often swallows the
// rejected request, and Vitest hides the console output of passing tests,
// so a page could silently be missing data and still go green.
/** @type {string[]} */
const unhandled = []
beforeAll(() =>
  server.listen({
    onUnhandledFrame: async ({ frame, defaults }) => {
      unhandled.push(await frame.getUnhandledMessage())
      defaults.error()
    },
  }),
)

afterEach(() => {
  if (unhandled.length) {
    const messages = unhandled.splice(0)
    throw new Error(`Unhandled request(s); add an MSW handler:\n${messages.join('\n')}`)
  }
})

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
