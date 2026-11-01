// Connects to MongoDB, then starts the HTTP listener.
import app from './app.js'
import { connectDB, env } from './config/index.js'
import { logger } from './config/logger.js'

try {
  await connectDB()
  logger.info('MongoDB connected')

  app.listen(env.port, () => {
    // trustProxy in the startup line, so the logs show which hop count it runs with.
    logger.info({ port: env.port, nodeEnv: env.nodeEnv, trustProxy: env.trustProxy }, 'listening')
  })
} catch (err) {
  logger.fatal({ err }, 'failed to start')
  process.exit(1)
}
