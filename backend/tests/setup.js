// Per-file in-memory MongoDB; the app itself never connects (server.js does that).
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll } from 'vitest'

let replSet

// A one-node replica set, not a standalone server: lead conversion runs in a
// transaction, and MongoDB only supports transactions on replica sets.
beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(replSet.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await replSet?.stop()
})
