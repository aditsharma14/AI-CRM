// Pre-commit gate (see .husky/pre-commit). Any failing command blocks the commit.
// Each package is linted with its own ESLint and config; typecheck covers the whole package.
const quote = (files) => files.map((file) => JSON.stringify(file)).join(' ')

export default {
  'backend/**/*.js': (files) => [
    `backend/node_modules/.bin/eslint --max-warnings 0 --fix ${quote(files)}`,
    'npm --prefix backend run -s typecheck',
  ],
  'frontend/**/*.{js,jsx}': (files) => [
    `frontend/node_modules/.bin/eslint --max-warnings 0 --fix ${quote(files)}`,
    'npm --prefix frontend run -s typecheck',
  ],
  'AI/**/*.py': (files) => [
    `node scripts/ruff.mjs check --fix ${quote(files)}`,
    `node scripts/ruff.mjs format ${quote(files)}`,
  ],
  '*': 'node_modules/.bin/prettier --write --ignore-unknown',
}
