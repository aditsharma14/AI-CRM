// The app's routes with no parameters, for the GitHub Pages demo build. Pages serves dist/deals.html at /AI-CRM/deals
// with status 200, so vite.config.js writes a copy of index.html per route here; only routes with a parameter
// (/leads/:id, /invite/:token) fall through to 404.html. tests/pages-routes.test.js keeps this in step with App.jsx.
export const STATIC_ROUTES = [
  'calendar',
  'companies',
  'contacts',
  'deals',
  'forgot-password',
  'leads',
  'login',
  'pipeline',
  'register',
  'reset-password',
  'settings',
  'tasks',
]
