import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
