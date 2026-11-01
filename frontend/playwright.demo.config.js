// @ts-check
// Playwright for the GitHub Pages demo: the VITE_DEMO build in dist/, served the way Pages serves it
// (e2e-demo/pages-server.mjs). No backend. Run: VITE_DEMO=true npm run build && npm run e2e:demo
import { defineConfig, devices } from '@playwright/test'

const PORT = 4176

export default defineConfig({
  testDir: './e2e-demo',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/AI-CRM/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node e2e-demo/pages-server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/AI-CRM/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
