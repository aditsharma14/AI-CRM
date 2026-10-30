import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Test helpers, specs and tool configs run in Node (vitest, Playwright).
    files: ['tests/**', 'e2e/**', '*.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    // Helpers export plain functions next to components; Fast Refresh doesn't apply.
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
