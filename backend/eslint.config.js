import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsdoc from 'eslint-plugin-jsdoc'
import globals from 'globals'

import { CHECKED_FOLDERS } from './scripts/checked-folders.js'

export default defineConfig([
  globalIgnores(['node_modules']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // JSDoc is the type system in type-checked folders, so keep it honest.
    files: CHECKED_FOLDERS.map((folder) => `${folder}/**/*.js`),
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc/require-param': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/check-types': 'error',
      'jsdoc/no-undefined-types': 'error',
    },
  },
])
