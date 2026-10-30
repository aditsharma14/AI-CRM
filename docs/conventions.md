# Conventions

Detail behind the rules in [CLAUDE.md](../CLAUDE.md). CLAUDE.md says *what* the rules are; this file shows *how*.

## Types: JSDoc checked by `tsc --checkJs`

The backend stays JavaScript and has no build step. [backend/tsconfig.json](../backend/tsconfig.json) (`strict`,
`noUncheckedIndexedAccess`, `noEmit`) checks only files whose first line is `// @ts-check`.
[checked-folders.js](../backend/scripts/checked-folders.js) lists the folders where *every* file must carry it.
`npm run typecheck` enforces that list, and ESLint's JSDoc rules (`require-param`, `require-returns`, `check-types`,
`no-undefined-types`) apply to the same folders.

**Status:**
- **Checked:** `src/types`, `src/utils`, `src/policies`, `src/schemas`, `src/models`, `src/services`.
- **Strict-checked test helper:** [tests/factories.js](../backend/tests/factories.js).
- **Not yet checked:** `src/routes`, `src/middleware`, `src/config`, `src/app.js`, `src/server.js`.

**Migrating a folder:**
1. Add `// @ts-check` as the first line of every file in it.
2. Add the folder to `CHECKED_FOLDERS`.
3. Make `npm run typecheck` pass.
4. Commit it on its own (one folder per commit).

### One example of each pattern
- **Shared typedef.** Shared types live in [src/types/index.js](../backend/src/types/index.js) and are imported where used:
  ```js
  /** @typedef {import('../types/index.js').AuthUser} AuthUser */
  ```
- **Types from Zod (`z.infer`).** Never hand-write a request type. Each file in
  [src/schemas/](../backend/src/schemas/) exports one next to its schema:
  ```js
  /** @typedef {z.infer<typeof leadCreate>} LeadCreateInput */
  ```
  Services then take `@param {import('../schemas/leads.js').LeadConvertInput} input`. Change the schema and the
  service signature changes with it.
- **Generics (`@template`).** See `createCrudService` in [crudService.js](../backend/src/services/crudService.js):
  ```js
  /**
   * @template T Raw document shape of the model (e.g. LeadRecord).
   * @param {import('mongoose').Model<T>} Model
   */
  ```
  Model typedefs come from the schema: `InferSchemaType<typeof leadSchema>` (`LeadRecord`, `DealRecord`, …).
- **Request extension.** [src/types/express.d.ts](../backend/src/types/express.d.ts) is the only `.d.ts`. It adds
  `user?: AuthUser` to `Express.Request` via `declare global`.

### Escape hatches
- No `any`, `@ts-ignore` or `@ts-nocheck`.
- If something must be forced, use a cast `/** @type {X} */ (expr)` with a `// Boundary cast:` comment saying why.
- Prefer `@ts-expect-error <reason>` over `@ts-ignore`.
- **Current count:** 0 `any`, 0 ignores, 0 expect-errors, 11 boundary casts (`grep -rn 'Boundary cast' backend/src`):
  `crudService` ×3 (generic `T`), `authService` ×5 (env JWT secret and TTL, three `create([doc], { session })` results),
  `validators` ×2, `dealsService` ×1 (closing key).

### Mongoose quirks
- Assign DocumentArrays with `doc.set('field', value)`, not `doc.field = [...]`.
- Declare instance methods in the schema's `methods` option, so the types can see them (see `comparePassword` in
  [User.js](../backend/src/models/User.js)).
- Type aggregation rows with a cast on `aggregate(...).exec()` (see
  [insightsService.js](../backend/src/services/insightsService.js)).

## Tests

- **Shape.** HTTP-level through `app` with supertest, one in-memory MongoDB per file ([setup.js](../backend/tests/setup.js)).
- **Helpers.**
  - [helpers.js](../backend/tests/helpers.js): `seedOrg` (one user per role plus signed tokens), `makeRecord`, `bearer`.
  - [factories.js](../backend/tests/factories.js): real-password users, planted invite and reset tokens, `login`,
    `sessionCount`, refresh-cookie helpers.
- **Plant tokens, don't scrape them.** Invite and reset tokens are written with the factories (hash only, as the
  services store them). Never read them from `console.log`: that logging is a dev-only stand-in that goes away with email.
- **Silence token logs.** Tests that hit the invite or forgot-password endpoints mock `console.log`, so raw tokens
  never reach test output.
- **Test first.** For a fix, write the failing test and show it red before changing the code.
- **Mutation-check the important ones.** For a security- or tenancy-critical property, temporarily break the
  service code, confirm the specific test fails with a meaningful diff, then revert. (S1.1 and S1.1b each did this.)
- **Pinning suspect behaviour.** If a test must encode behaviour that looks wrong, mark it `// suspect: <why>` and list
  it in [known-issues.md](known-issues.md). Whoever fixes it flips the test.
- **Coverage.** `npm run test:coverage` (v8, over services, policies and utils; the empty `aiProxyService.js` is
  excluded until S2.2).

## Frontend tests

- **Shape.** Vitest + jsdom + Testing Library ([frontend/vitest.config.js](../frontend/vitest.config.js)). The network is
  mocked with MSW at the HTTP layer, so the real axios instance and interceptors run. Tests sit next to the code
  (`src/**/*.test.jsx`); shared helpers live in [frontend/tests/](../frontend/tests/).
- **Helpers (all `// @ts-check`, typed JSDoc):**
  - [server.js](../frontend/tests/server.js): the MSW server and envelope builders `ok`, `fail` and `page`, so every mock
    returns the real `{ success, data, error, meta }` shape.
  - [factories.js](../frontend/tests/factories.js): `makeUser(role)` (the session user) and `makeMember(role)` (an
    `/org/members` row), with typedefs.
  - [render.jsx](../frontend/tests/render.jsx): `renderWithProviders(ui, { session, route, strict })` wraps the real
    QueryClient, router, `SessionProvider` and `ProtectedRoute`. The session is restored through a mocked
    `POST /auth/refresh`, never a mocked context, so every test runs the real bootstrap.
- **Unhandled requests fail the test.** [setup.js](../frontend/tests/setup.js) collects them and throws in `afterEach`.
  MSW's plain `'error'` mode isn't enough: it only logs, and Vitest hides the logs of passing tests. Mock every
  endpoint a component calls, including the ones it reads in the background (e.g. Pipeline reads `/org/pipeline-stages`).
- **Failed mutations:** test 400, 403 and 500 with `fail()`. The user must see a specific message in `role="alert"`, and
  nothing unsaved may appear as saved. See the `*.errors.test.jsx` files.
- **Singletons are reset after each test** ([setup.js](../frontend/tests/setup.js)): access token, `onUnauthorized` and
  the shared `queryClient`.
- **Query by role and accessible name**, not CSS or test ids. If a control can't be found that way, give it a label;
  that's an a11y fix, not a test hack.
- **Mirrors get mirrored tests.** [constants.test.js](../frontend/src/lib/constants.test.js) follows the backend's
  `membership.unit.test.js` case by case.
- **Typecheck.** [frontend/tsconfig.json](../frontend/tsconfig.json) uses the same opt-in model as the backend. Checked
  today: `tests/`, `e2e/`, `playwright.config.js` and `src/lib/constants.js`.

## End-to-end (Playwright)

- `npm run e2e` in `frontend/`. [playwright.config.js](../frontend/playwright.config.js) starts two servers and never reuses
  existing ones:
  - [backend/scripts/e2e-server.js](../backend/scripts/e2e-server.js): the API on :5055 against a fresh in-memory Mongo, with
    fixed test secrets.
  - Vite on :5175, proxied to that API via `VITE_PROXY_TARGET` (dev-server config only; the client still calls `/api/v1`).
- Every run starts from an empty database. The spec registers its own org; there are no seeds or shared state.
- **Windows:** Playwright stops its servers with `taskkill`, so `C:\Windows\System32` must be on `PATH`. Without it the run
  passes and then hangs on teardown. Normal terminals already have it on `PATH`; some agent or Git Bash shells don't.
