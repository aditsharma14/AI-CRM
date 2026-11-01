// Boots React and mounts <App/> to the DOM; in the GitHub Pages demo build, starts the in-browser API first.
import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'

// Replaced with a literal at build time (vite.config.js), so in a normal build this branch and the whole of
// src/demo/ (MSW included) are dropped; scripts/check-no-demo.mjs proves it.
if (import.meta.env.VITE_DEMO === 'true') {
  const { startDemo } = await import('./demo/start.js')
  await startDemo()
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
