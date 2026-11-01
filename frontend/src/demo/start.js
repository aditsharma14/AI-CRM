// Starts the demo before the app renders: the mock service worker answers every /api/v1 request in this tab.
import { setupWorker } from 'msw/browser'

import { registerDemoUi } from '../lib/demo.js'
import { DemoBanner, DemoSignIn } from './DemoUi.jsx'
import { createDemoApi } from './handlers.js'

export async function startDemo() {
  const { handlers } = createDemoApi()
  // Under the Pages base path (/AI-CRM/), so the worker's scope covers the app.
  await setupWorker(...handlers).start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame: 'bypass',
    quiet: true,
  })
  registerDemoUi({ Banner: DemoBanner, SignIn: DemoSignIn })
}
