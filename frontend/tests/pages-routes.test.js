// @vitest-environment node
// The Pages demo writes one HTML file per route without a parameter (scripts/pages-routes.mjs). A route added to
// App.jsx but not to that list would answer a hard reload with status 404 again.
import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { STATIC_ROUTES } from '../scripts/pages-routes.mjs'

it('lists exactly the routes in App.jsx that have no parameter', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const paths = [...app.matchAll(/<Route path="\/([^"*]+)"/g)].map((match) => match[1])
  expect(paths.length).toBeGreaterThan(10)
  expect([...STATIC_ROUTES].sort()).toEqual(paths.filter((path) => !path.includes(':')).sort())
})
