// In production the backend refuses to boot with a missing, short or placeholder JWT_ACCESS_SECRET.
import { afterEach, describe, expect, it, vi } from 'vitest'

const STRONG = 'k'.repeat(32)

/** Imports config/index.js fresh, with these env vars on top of the test env. */
async function bootWith(vars) {
  vi.resetModules()
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value)
  return import('../src/config/index.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('JWT_ACCESS_SECRET in production', () => {
  it.each([
    ['missing', ''],
    ['31 characters', 'k'.repeat(31)],
    ['the docker-compose dev default', 'dev-only-compose-secret-change-me'],
    ['the .env.example placeholder', 'change-me-access-secret'],
  ])('%s -> refuses to start', async (_, secret) => {
    await expect(bootWith({ NODE_ENV: 'production', JWT_ACCESS_SECRET: secret })).rejects.toThrow(/JWT_ACCESS_SECRET/)
  })

  it('never puts the secret in the error', async () => {
    const secret = 'dev-only-compose-secret-change-me'
    await expect(bootWith({ NODE_ENV: 'production', JWT_ACCESS_SECRET: secret })).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    )
  })

  it('a 32-character secret that is not a placeholder starts', async () => {
    const { env } = await bootWith({ NODE_ENV: 'production', JWT_ACCESS_SECRET: STRONG })
    expect(env.nodeEnv).toBe('production')
  })
})

describe('outside production', () => {
  it.each(['development', 'test'])('%s accepts the dev default', async (nodeEnv) => {
    const { env } = await bootWith({ NODE_ENV: nodeEnv, JWT_ACCESS_SECRET: 'dev-only-compose-secret-change-me' })
    expect(env.nodeEnv).toBe(nodeEnv)
  })
})
