// scripts/e2e-server.js (which can plant auth tokens through its control port) refuses to start in production.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/e2e-server.js', import.meta.url))

describe('e2e-server.js', () => {
  it('exits with an error, before starting anything, when NODE_ENV=production', () => {
    const run = spawnSync(process.execPath, [script], {
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('refuses to start with NODE_ENV=production')
  })
})
