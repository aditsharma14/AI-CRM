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
- **Coverage.** `npm run test:coverage` (v8, over services, policies and utils, nothing excluded; `aiProxyService.js`
  was left out while it was an empty stub and is counted since it was built).

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
- **Coverage scope.** `npm run test:coverage` reports only `src/api` and `src/context` (78 statements, the session
  plumbing), so its 100% says nothing about the pages, which behaviour tests cover. It isn't gated.
- **Unhandled requests fail the test.** [setup.js](../frontend/tests/setup.js) collects them and throws in `afterEach`.
  MSW's plain `'error'` mode isn't enough: it only logs, and Vitest hides the logs of passing tests. Mock every
  endpoint a component calls, including the ones it reads in the background (e.g. Pipeline reads `/org/pipeline-stages`).
- **Failed mutations:** test 400, 403 and 500 with `fail()`. The user must see a specific message in `role="alert"`, and
  nothing unsaved may appear as saved. See the `*.errors.test.jsx` and `*-save-errors.test.jsx` files.
- **Failed loads:** a failed query shows `ErrorAlert` with Retry, never an empty state that reads as "no data"
  ([load-errors.test.jsx](../frontend/src/features/load-errors.test.jsx)). Queries retry once, so allow ~4 s for the alert.

## Frontend errors and forms

- **Every mutation's error is shown.** `useMutationError(...mutations)` in [hooks.js](../frontend/src/hooks.js) +
  `<ErrorAlert message={…} />`: save errors inside the dialog (which stays open with the user's input), delete and row
  actions on the page. Wrap `mutateAsync` in `try`/`catch`; clear success notices in `onMutate`.
- **Field-level 400s:** `useMutationError(m).forFields(['password'])` moves `field: message` issues under those fields
  (`error={errors.password ?? fieldErrors.password}`); the rest goes to the alert.
- **`FormField`** gives its input an id if needed and sets `aria-invalid` / `aria-describedby` to the error or hint, so
  every field is named by its label. Inputs outside a `FormField` need an `aria-label`.
- **Paginated lists with filters:** `usePaginationState({ q, status })`, so a filter change returns to page 1.
- **Mirrored rules:** the client password rule ([password.js](../frontend/src/lib/password.js)) copies the backend's;
  both test files share one case table. Change both together.
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
- **Tokens are planted, not scraped**, as in the backend tests: e2e-server.js has a control port on `127.0.0.1:5056`
  (`POST /reset-token {email}` → `{token}`, via `issueResetToken`). It exists only in that script, and the script
  refuses to start with `NODE_ENV=production`.
- **Windows: the teardown hang.** Playwright stops its servers with `taskkill`, so `C:\Windows\System32` must be on
  `PATH`. Without it the tests pass and the run never exits, and its servers (the e2e API, the AI service, Vite, the
  Pages server) keep running. The next run then fails: their ports are taken (:5055–:5057, :5175, :4176), and Vite's
  lock on rolldown's native binding makes `npm ci` in `frontend/` fail with EPERM. Normal terminals have System32 on
  `PATH`; some agent and Git Bash shells don't. Check with `which taskkill` (Git Bash) or `where.exe taskkill`.
  - **Prevent it:** *append* System32, `export PATH="$PATH:/c/Windows/System32"`. Prepending it shadows Git Bash's
    `timeout`, `find` and `sort` with the Windows tools of the same name.
  - **Clean up after a hang** (PowerShell). It finds the e2e servers by **port and command line**, node or Python
    (the AI service is `python.exe` running uvicorn), adds the Playwright runner and `ai-serve.mjs` wrapper by command
    line, and the e2e API's worker as that API's child (a `npm run worker` of your own is left alone). It lists them
    first; a port held by anything else is only reported. Review the list, then run the last line.

    ```powershell
    $ports = 5055, 5056, 5057, 5175, 4176   # e2e API + control port, AI service, Vite, the Pages server
    $servers = 'e2e-server\.js|uvicorn app\.main:app .*--port 5057|vite.*--port 5175|pages-server\.mjs'
    $all = Get-CimInstance Win32_Process
    $owners = $all | Where-Object ProcessId -In (Get-NetTCPConnection -LocalPort $ports -State Listen `
      -ErrorAction SilentlyContinue).OwningProcess
    $owners | Where-Object CommandLine -NotMatch $servers |
      ForEach-Object { Write-Warning "port held by something else, left alone: $($_.ProcessId) $($_.CommandLine)" }
    $left = @($owners | Where-Object CommandLine -Match $servers)                     # servers: port + command line
    $left += $all | Where-Object { $_.Name -eq 'node.exe' -and                        # helpers with no port
      $_.CommandLine -match 'playwright.*\btest\b|ai-serve\.mjs|mongo_killer' }
    $left += $all | Where-Object { $_.ParentProcessId -in $left.ProcessId -and        # the e2e API's worker
      $_.CommandLine -match 'src[\\/]worker\.js' }
    $left | Select-Object ProcessId, Name, CommandLine
    $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    ```

    The e2e API's in-memory `mongod.exe` exits on its own once its parent is gone (`mongo_killer.js` watches it).

## Idempotency

A client that sends a write and loses the answer (a dropped connection, a timeout, a double click) can't tell
whether the server committed it. `Idempotency-Key` makes the retry safe: the server runs the request once per key and
answers every repeat with the stored answer (S2.2, #60).

**Which endpoints take it**, the writes whose repeat would do something a second time:

| Endpoint | A repeat without a key would |
|---|---|
| `POST /leads`, `POST /deals` | create a second record |
| `POST /leads/:id/convert` | answer 400 `ALREADY_CONVERTED` instead of the deal the first call made |
| `PATCH /deals/:id/move-stage` | write a second audit entry (and, into won/lost, a second notification) |
| `POST /ai/leads/:id/brief` | count against the AI limits again, and may queue a second job if the first is done |

The header is optional: without it, a request behaves as before. Pinned for the API and the demo in
[contracts/idempotency.json](../contracts/idempotency.json).

**Why the rest are left out.** There is no `PUT` in this API. `PATCH /:id` sets the given fields to the given
values, so a repeat leaves the record as the first call did; it does write a second "Updated" audit entry, which is
honest (two requests arrived). `DELETE /:id` repeated answers 404 and changes nothing more. Two writes are *not*
naturally idempotent and have no key yet: the other creates (contacts, companies, activities, notes), so the client
never retries them, and `PATCH /activities/:id/toggle-status`, which flips (known-issues.md).

**The rules** ([middleware/idempotency.js](../backend/src/middleware/idempotency.js),
[idempotencyService.js](../backend/src/services/idempotencyService.js)):
- **Key:** a UUID or 16 to 64 of `A-Z a-z 0-9 . _ : -`, else 400 `VALIDATION_ERROR` (`idempotency-key: …`).
  Scoped per org and per user: the same key from someone else is a different key.
- **Where it runs:** after `auth`, `requirePermission` and `validate`. A request refused there never ran, so it doesn't
  use up its key: the client can fix the body and retry with the same key.
- **First request:** the record is inserted `in_progress` with a 60 s lease. The unique `(orgId, userId, key)` index
  lets exactly one of any number of parallel requests in.
- **Same key, same method, path and body:** while in progress, 409 `IDEMPOTENCY_IN_PROGRESS`; once done, the stored
  answer with its original status, `Content-Type` and `Location` (if any), plus `Idempotent-Replayed: true`. Never
  `Set-Cookie`: a replay must not hand out a session. The body is the stored JSON text, byte for byte.
- **Same key, another body or path:** 422 `IDEMPOTENCY_KEY_REUSED`. The body is compared as a sha256 of the validated
  body with its keys sorted, so field order doesn't matter. `/leads/A/convert` and `/leads/B/convert` are different
  paths.
- **A 4xx from the handler** (`ALREADY_CONVERTED`, 403, 404, …) is stored and replayed like a success: the answer
  won't change on a retry.
- **A 5xx deletes the record**, so the retry runs the handler again. A 5xx is the server failing, not an answer
  about the request: the transaction rolled back or the write never happened, and the next attempt may well
  succeed. Storing it would replay the failure for 24 h to a client that did nothing wrong.
- **A 429 deletes it too** (`AI_RATE_LIMITED` is thrown inside the brief handler): it means "try later", and once
  the hour's window allows, the same key must be able to run.
- **Answers over 64 kB aren't stored** (the record is deleted, the answer is sent): one key can't pin a large
  document for 24 h. None of the five endpoints answers anything near that.
- **The answer is saved before it is sent**, so a retry that arrives right after it replays instead of getting a
  409. Lead convert saves it inside its own transaction (`beforeCommit`), so the deal and the record commit or roll
  back together; if that save fails, the whole convert is a 500 and the retry converts once. For the other four, a
  failed save is logged (`idempotency record not saved`, with the key and the request id) and the answer is sent
  anyway; the key then stays in progress until its lease ends (known-issues.md).
- **A stuck record** (the process died mid-request) is taken over once its lease has expired: one conditional update,
  so of two retries only one runs.
- **Kept 24 h** (TTL index on `createdAt`). The TTL monitor runs about once a minute, so a record past 24 h is
  treated as absent before it is removed.
- **The key is logged** on a failed save: it identifies a request, it isn't a credential.

**The client** ([api/client.js](../frontend/src/api/client.js) `idempotent()`, used by `createRecord` for leads and
deals and by [api/mutations.js](../frontend/src/api/mutations.js)): one `crypto.randomUUID()` per mutation. A dropped
connection or a 409 `IDEMPOTENCY_IN_PROGRESS` is retried with the same key (2 retries, 300 then 600 ms); the
refresh-on-401 replay resends the same config and so the same key. Any other answer is final. **The demo** (MSW)
honours the key the same way, except that it stores only successes and never answers 409 (it answers one request
at a time).

## Citing changes

`main` takes changes through pull requests merged with **Rebase and merge**, which replays each commit onto `main`
with a new id. An id quoted from the branch then points at nothing (it happened to #35's ids, fixed in #36).

- **Docs cite the PR number:** `#36`, in WORKLOG tables, known-issues rows, docs/ai.md and anywhere else.
  GitHub links it and it never changes.
- **A commit id only for work that never had a PR** (the early sessions, committed straight to `main`), and only an
  id that is on `main`: `git merge-base --is-ancestor <id> main` must succeed.
- **Not yet merged?** Write the PR number: it's known as soon as the PR is open.
