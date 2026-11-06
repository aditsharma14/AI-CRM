// The lead-brief worker: a process of its own (compose service `worker`, scale it to N). It claims queued jobs from
// MongoDB, calls the AI service and writes the brief. On SIGTERM it finishes the job in hand, claims no other, and
// exits; compose's stop_grace_period must outlast AI_TIMEOUT_MS for that.
import mongoose from 'mongoose'

import { connectDB, env } from './config/index.js'
import { logger } from './config/logger.js'
import { startWorker } from './services/aiJobService.js'

try {
  await connectDB()
} catch (err) {
  logger.fatal({ err }, 'ai worker: failed to start')
  process.exit(1)
}

const worker = startWorker({ log: logger })
logger.info(
  { workerId: worker.workerId, leaseMs: env.aiJobLeaseMs, pollMs: env.aiWorkerPollMs, aiEnabled: env.aiEnabled },
  'ai worker started',
)

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    logger.info({ workerId: worker.workerId, signal }, 'ai worker stopping: finishing the job in hand')
    await worker.stop()
    await mongoose.disconnect()
    logger.info({ workerId: worker.workerId }, 'ai worker stopped')
    process.exit(0)
  })
}
