// @ts-check
// @vitest-environment node
// frontend/vercel.json, compiled with Vercel's own rewrite converter (@vercel/routing-utils), routes the browser's
// same-origin /api/* to the Render API unchanged, falls back to index.html for client routes, and never caches the API.
import { readFileSync } from 'node:fs'

import { convertRewrites } from '@vercel/routing-utils'
import { describe, expect, it } from 'vitest'

/** @type {{ rewrites: { source: string, destination: string }[], headers: { source: string, headers: { key: string, value: string }[] }[] }} */
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const BACKEND = 'https://nimbus-crm-api.onrender.com'

// What Vercel does with the rewrites: one route per rule, tried in order after the static files.
const routes = convertRewrites(config.rewrites)

/**
 * Where Vercel sends `path` (after the filesystem: real files such as /assets/*.js are served before any rewrite).
 * @param {string} path
 * @returns {string | null}
 */
function destinationOf(path) {
  for (const route of routes) {
    if (!('src' in route) || !route.src || !route.dest) continue
    const match = new RegExp(route.src).exec(path)
    if (!match) continue
    // Fill $1/$name references the way the router does.
    return route.dest.replace(/\$(\w+)/g, (_, key) =>
      String((/^\d+$/.test(key) ? match[Number(key)] : match.groups?.[key]) ?? ''),
    )
  }
  return null
}

describe('vercel.json rewrites', () => {
  it.each([
    ['/api/v1/health', `${BACKEND}/api/v1/health`],
    ['/api/v1/leads', `${BACKEND}/api/v1/leads`],
    ['/api/v1/leads/123', `${BACKEND}/api/v1/leads/123`],
    ['/api/v1/leads/123/convert', `${BACKEND}/api/v1/leads/123/convert`],
    ['/api/v1/auth/refresh', `${BACKEND}/api/v1/auth/refresh`],
  ])('%s → the API, path unchanged', (path, expected) => {
    expect(destinationOf(path)).toBe(expected)
  })

  it.each(['/', '/login', '/reset-password', '/invite/abc123', '/leads', '/settings'])(
    '%s → index.html (client route)',
    (path) => {
      expect(destinationOf(path)).toBe('/index.html')
    },
  )

  it.each(['/apix', '/apiary/v1'])('%s is not the API (needs "/api/")', (path) => {
    expect(destinationOf(path)).toBe('/index.html')
  })

  it('the old pattern "/api/(/.*)?" never matched /api/v1/... (the bug this file fixes)', () => {
    const [old] = convertRewrites([{ source: '/api/(/.*)?', destination: `${BACKEND}/api$1` }])
    expect(old && 'src' in old && new RegExp(String(old.src)).test('/api/v1/leads')).toBe(false)
  })

  it('API responses are never cached by the CDN', () => {
    const api = config.headers.find((h) => h.source === '/api/:path*')
    expect(api?.headers).toContainEqual({ key: 'x-vercel-enable-rewrite-caching', value: '0' })
  })
})
