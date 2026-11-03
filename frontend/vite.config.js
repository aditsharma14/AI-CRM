import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { msw } from 'msw/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

// VITE_DEMO=true builds the GitHub Pages demo: served under /AI-CRM/, the API answered in the browser by MSW
// (src/demo/), and a 404.html copy of index.html so a reload of /AI-CRM/deals still loads the app.
const demo = process.env.VITE_DEMO === 'true'
// ANALYZE=1 npm run build writes a treemap of the bundle (sizes per module, raw and gzip) to dist/stats.html, and the
// same data as dist/stats.json for scripts/bundle-report.mjs.
const analyze = process.env.ANALYZE === '1'

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
  plugins: [
    react(),
    ...(demo ? [msw({ mode: 'worker-only' }), spaFallback] : []),
    ...(analyze
      ? [
          visualizer({ filename: 'dist/stats.html', gzipSize: true, template: 'treemap' }),
          visualizer({ filename: 'dist/stats.json', gzipSize: true, template: 'raw-data' }),
        ]
      : []),
  ],
  // dist/.vite/manifest.json: which chunk is the entry and what it imports (scripts/bundle-report.mjs, the CI budget).
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // Libraries in their own chunks: they change far less often than the app, so a deploy keeps them cached.
        codeSplitting: {
          groups: [
            // [\\/]: module ids use backslashes on Windows.
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/ },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'forms', test: /node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
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
