// Test runner config: env for config/index.js's boot check, one in-memory Mongo per file.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    // config/index.js throws at import if these are missing. dotenv never
    // overrides a var that's already set, so a developer's backend/.env can't
    // leak into tests.
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://unused-tests-connect-in-setup',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CLIENT_ORIGIN: 'http://localhost:5173',
      AI_SERVICE_URL: 'http://localhost:8000',
      // The role matrix fires hundreds of requests per file — well past the
      // production limit of 100/min.
      RATE_LIMIT_MAX: '1000000',
    },
    // Files share one mongod binary download on first run; serialising them
    // avoids racing that download and keeps output readable.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // `npm run test:coverage`. Scoped to the logic layers; routes are thin
    // wiring exercised through these same HTTP tests.
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/policies/**', 'src/utils/**'],
      // Empty stub until S2.2 builds the AI proxy; it would report a
      // meaningless 100% and inflate the services total.
      exclude: ['src/services/aiProxyService.js'],
      reporter: ['text', 'json-summary'],
    },
  },
})
