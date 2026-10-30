// Dev-only: boots the API against a throwaway in-memory MongoDB for Playwright (frontend/e2e). Never used in production.
import { MongoMemoryReplSet } from 'mongodb-memory-server'

// A one-node replica set: lead conversion uses a transaction, which standalone MongoDB can't run.
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })

// Set before config/index.js loads; dotenv never overrides a var that's
// already set, so a developer's backend/.env can't point e2e at real data.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: process.env.E2E_API_PORT ?? '5055',
  MONGO_URI: mongod.getUri('nimbus-e2e'),
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  CLIENT_ORIGIN: process.env.E2E_CLIENT_ORIGIN ?? 'http://localhost:5175',
  RATE_LIMIT_MAX: '1000000',
})

// Playwright stops this process when the run ends; take mongod down with it.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await mongod.stop()
    process.exit(0)
  })
}

await import('../src/server.js')
