import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { msw } from 'msw/vite'
import { defineConfig } from 'vite'

// VITE_DEMO=true builds the GitHub Pages demo: served under /AI-CRM/, the API answered in the browser by MSW
// (src/demo/), and a 404.html copy of index.html so a reload of /AI-CRM/deals still loads the app.
const demo = process.env.VITE_DEMO === 'true'

/** GitHub Pages serves 404.html for any unknown path; the app's router then reads the URL. */
const spaFallback = {
  name: 'pages-spa-fallback',
  apply: 'build',
  writeBundle({ dir }) {
    copyFileSync(join(dir, 'index.html'), join(dir, '404.html'))
  },
}

// https://vite.dev/config/
export default defineConfig({
  base: demo ? '/AI-CRM/' : '/',
  // Always a literal, so `import.meta.env.VITE_DEMO === 'true'` folds to false in a normal build and the demo is
  // tree-shaken out.
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify(demo ? 'true' : 'false') },
  // worker-only: emits mockServiceWorker.js, and only in the demo build, where this plugin is present at all.
  plugins: [react(), ...(demo ? [msw({ mode: 'worker-only' }), spaFallback] : [])],
  server: {
    port: 5173,
    proxy: {
      // dev-only convenience: the client always calls same-origin '/api/v1',
      // so it behaves identically to the reverse-proxied production setup.
      '/api': {
        // VITE_PROXY_TARGET lets Playwright point the dev server at its own
        // throwaway API (see playwright.config.js); the client never sees it.
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
