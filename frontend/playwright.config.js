// @ts-check
// Playwright: one Chromium run against a throwaway API (in-memory Mongo), the AI service on the fake provider and its
// own Vite dev server, on ports dev servers don't use.
import { defineConfig, devices } from '@playwright/test'

const API_PORT = 5055
const WEB_PORT = 5175
const AI_PORT = 5057
// Shared by the API and the AI service it calls; e2e only.
const AI_TOKEN = 'e2e-internal-token-0123456789'
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`

export default defineConfig({
  testDir: './e2e',
  // One flow that shares nothing between runs; serial keeps output readable.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The AI service with the fake provider: deterministic, offline, free.
      command: 'node ../scripts/ai-serve.mjs',
      url: `http://127.0.0.1:${AI_PORT}/health`,
      env: { AI_PORT: String(AI_PORT), AI_INTERNAL_TOKEN: AI_TOKEN, AI_PROVIDER: 'fake' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node ../backend/scripts/e2e-server.js',
      url: `http://localhost:${API_PORT}/health`,
      env: {
        E2E_API_PORT: String(API_PORT),
        E2E_CLIENT_ORIGIN: WEB_ORIGIN,
        E2E_AI_PORT: String(AI_PORT),
        E2E_AI_TOKEN: AI_TOKEN,
      },
      // Never reuse: a developer's own API on this port would mean real data.
      reuseExistingServer: false,
      // The first run downloads a mongod binary (~70 MB).
      timeout: 180_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      env: { VITE_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      // Cold starts under load (e.g. right after the unit suites) have taken over 60s.
      timeout: 120_000,
    },
  ],
})
