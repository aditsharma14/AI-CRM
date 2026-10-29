// The type-checking migration status: folders whose every file is `// @ts-check`ed.
// Read by scripts/check-ts-optin.js (enforces the header) and eslint.config.js
// (applies the JSDoc rules). Add a folder only once all of its files pass `tsc`.
export const CHECKED_FOLDERS = ['src/types', 'src/utils', 'src/policies', 'src/schemas', 'src/models', 'src/services']
