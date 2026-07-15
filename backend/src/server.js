// Connects to MongoDB, then starts the HTTP listener.
import app from './app.js'
import { env, connectDB } from './config/index.js'

try {
  await connectDB()
  console.log('[server] MongoDB connected')

  app.listen(env.port, () => {
    console.log(`[server] listening on port ${env.port} (${env.nodeEnv})`)
  })
} catch (err) {
  console.error('[server] failed to start:', err.message)
  process.exit(1)
}
