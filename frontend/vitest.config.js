// Unit/component test runner: jsdom + RTL, network mocked by MSW (tests/setup.js). e2e/ is Playwright's.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}', 'tests/**/*.test.{js,jsx}'],
    setupFiles: ['./tests/setup.js'],
    // `npm run test:coverage`. Scoped to the session plumbing the brief asks
    // to report on; pages are covered by behaviour tests, not a % target.
    coverage: {
      provider: 'v8',
      include: ['src/api/**', 'src/context/**'],
      reporter: ['text', 'json-summary'],
    },
  },
})
