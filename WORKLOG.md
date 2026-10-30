# WORKLOG

Append-only log of work sessions on Nimbus CRM. Newest entry at the bottom.
Each entry: **date · goal · changed · verified · next**. Rules for working in this repo are in [CLAUDE.md](CLAUDE.md).

---

## 2026-10-29 · N0: Project memory

**Goal:** write the project memory (`CLAUDE.md`) so a new engineer or Claude session can make a correct change without re-reading the repo. Documentation only.

**Changed**
- `CLAUDE.md` (new): architecture, folder map, API contract, tenancy, permissions, running locally, coding rules, Claude workflow rules, known gaps, other findings, open questions.
- `WORKLOG.md` (new): this file.
- No code changed. Nothing committed (branch is `main`).

**How**
- Three read-only explorers, one each for `backend/`, `frontend/`, and `AI/` + root config.
- Their key claims were re-checked by hand before going into CLAUDE.md:
  - Zod strips unknown query keys.
  - The env vars listed as dead are never read.
  - Raw tokens are logged.
  - Pipeline stages are hardcoded in the frontend.

**Verified** (Windows, Node 24.16, Python 3.13, local MongoDB on :27017)

| Command | Result |
|---|---|
| `npx eslint .` (backend) | pass, no output |
| `npm run lint` (frontend) | pass |
| `npm test` (backend) | exit 1: npm placeholder "no test specified" (no tests exist) |
| `npm run dev` (backend) + `GET /health` | `{"success":true,"data":{"status":"ok"}}`; Mongo connected; Cloudinary warning |
| `npm run build` (frontend) | built in ~13s; warning: a chunk is > 500 kB |
| `uvicorn app.main:app` (AI) | exit 3: `Attribute "app" not found in module "app.main"` (main.py is a stub) |
| `docker compose up --build` | **not run**: Docker is not installed on this machine |
| Path check over CLAUDE.md | every referenced path exists (see end of session) |

**Findings beyond the original 8 gaps** (detailed in CLAUDE.md §9)
- `validate({ query: paginationQuery })` strips filter params, so `NotesPanel` shows every note in the org and the lead status filter does nothing.
- Pipeline stages are hardcoded in the frontend.
- `stageKey` is unvalidated outside `move-stage`.
- Three required or documented env vars are never read.
- Docker env values use `localhost`, and there is no `.dockerignore`.
- `activities.routes.js` and `notifications.routes.js` hold business logic.
- Raw reset and invite tokens are logged.

**Next**
1. Fix the filter-stripping bug in `validators.js` / the list routes, with the first backend test framework (CLAUDE.md rule 3).
2. Decide the open questions in CLAUDE.md §9 (product name, own-records-only, Vercel setup).
3. Add `.dockerignore` files and Compose-specific env values.
4. Build the AI service skeleton (`AI/app/main.py`) and the Express proxy.

### Interview angle: "Walk me through your architecture"
> The browser only ever talks to one origin, `/api/v1`, which Vite (in dev) or nginx (in Docker) proxies to an Express 5 API.
> Express owns all auth (15-minute JWT plus a rotating httpOnly refresh cookie), permissions (a role matrix mirrored in the UI) and business logic, and every query is scoped by the `orgId` from the token, which is what makes it multi-tenant.
> AI features are a separate FastAPI service that only Express may call, so auth and tenancy are enforced in one place before any prompt is built.
> That service reads MongoDB for RAG context but never writes. Express persists any AI output, so the data model has one writer and one audit trail.

---

## 2026-10-29 · S1.2: Enforce "own records only" (authorization bug)

**Goal:** members may change only records they own. Enforce it in the service layer on every write path and prove it with a role × action matrix.

**Policy decisions (yours):** members still can't delete at all (permissions table unchanged); the policy covers every owned resource; tests use Vitest + supertest + mongodb-memory-server.

**Changed**
- New `backend/src/policies/ownership.js`: `ownerField`, `scopeFor`, `canReassign`, `sanitizeWrite`, `missOrForbidden`.
- `crudService.js`:
  - Methods take `actor` (`req.user`).
  - update and remove are single scoped atomic queries.
  - create and update sanitize the body and check that a new owner is in the same org.
- Services:
  - `leadsService.convertToDeal` and `dealsService.moveStage` are now scoped. The deal lookup moved ahead of stage validation.
  - New `activitiesService.js`, which moves list, create and toggle out of the route. That clears one of the two layering exceptions.
- Routes:
  - They pass `req.user` and nothing else changed.
  - Lead, deal, contact and company schemas accept `ownerId`, which the policy drops for members.
- Frontend:
  - `canModifyRecord` added in `constants.js`.
  - Delete is gated by `can('crm','delete')` on six pages.
  - Save and Convert are disabled for members on others' records, and so is the task toggle.
- Tooling:
  - Backend `test` and `lint` scripts, `vitest.config.js` and `tests/`; frontend `test` script.
  - morgan is silenced when `NODE_ENV=test`.
- Docs: CLAUDE.md §2, §4, §5 (policy table), §6, §7 and §9.

**Verified**

| Check | Result |
|---|---|
| Backend `npm test`, **before** the fix | 15 failed / 119 passed. Members got 200 on others' records; activity `assigneeId` was writable by members; managers couldn't reassign; the policy module didn't exist yet |
| Backend `npm test`, after | **151 passed** in 6 files: matrix 64 + 1 count check, custom actions 24, cross-org 22, mass assignment 11, other resources 12, unit 17 |
| Frontend `npm test` | 8 passed |
| Lint (both), frontend build | clean |
| Grep for direct Lead/Deal/Activity/Contact/Company/Note calls | Every write is scoped. Remaining hits are read-only (`insightsService`), a scoped read (`activitiesService.list`), or `Deal.create` in convert, which runs after the scoped lead check |
| Live server (throwaway DB, dropped afterwards) | Member PATCH on the owner's lead: **403** `FORBIDDEN` envelope. Member GET: 200. Owner PATCH: 200. Unknown id: **404** |

**Next**
- Move `notifications.routes.js` logic into a service.
- Check `companyId`, `contactIds` and `entityId` against the org, the way owner fields now are.
- Fix the list-filter stripping (CLAUDE.md §9).

### Interview angle (STAR): "Tell me about an authorization bug you fixed"
- **Situation.**
  - A multi-tenant CRM where the role matrix's own comment promised that members could only change their own records.
  - Writing the project memory, I traced that claim through the code and found the CRUD factory filtered only by `orgId`.
  - So any member could edit or convert any colleague's leads, deals, contacts and tasks. Activity `assigneeId` was even writable, so a member could reassign tasks.
- **Task.**
  - Enforce ownership on every read and write path, not just the obvious PATCH routes.
  - Return the right status codes.
  - Prove it.
- **Action.**
  - **Red first.** I wrote an HTTP-level test matrix first: 4 roles × {list, get, update, delete} × {own, others'} for leads and deals, plus convert, move-stage and toggle, cross-org access on every `:id` route, and mass assignment. Run against the old code, it failed in 15 places.
  - **One policy module in the service layer.** I put the rule in `scopeFor()`, merged into the service layer's queries. Routes can't forget it, and the same code protects anything that isn't HTTP, such as a future AI action calling a service.
  - **Atomic scoped writes.** Each write is a single scoped query, `{ _id, orgId, ownerId }`, so there's no check-then-write race.
  - **404 vs 403.** Only after a miss does the code ask "does this id exist *in your org*?" If it does, the answer is 403; if not, 404. Another tenant's ids therefore look exactly like ids that never existed (no cross-tenant probing), while a colleague's record gets an honest 403.
- **Result.**
  - 151 backend tests, including the 64-case matrix, 24 custom-action cases and 22 cross-org cases. Every write path is covered.
  - A grep confirms no unscoped writes remain, and a live curl shows the 403 envelope.
  - The fix also introduced the project's first test framework and removed a route that held business logic.

---

## 2026-10-29 · S1.5: Type-safe JavaScript for the backend core (JSDoc + checkJs)

**Goal:** compile-time safety for the backend core using JSDoc checked by `tsc --checkJs` under `strict`, with no build step, no renames and no runtime dependencies.

**Setup decisions (yours):**
- N0 and S1.2 were committed first.
- Work is on branch `chore/jsdoc-typecheck`.
- A minimal backend CI job was added.
- lint-staged is deferred to S1.4.
- Zod schemas moved out of routes into `src/schemas/`.

**Folders covered, one commit each, all with typecheck clean and tests green**

| Folder | tsc errors fixed | Notes |
|---|---|---|
| setup | – | `backend/tsconfig.json`, `src/types` (AuthUser, ApiResponse&lt;T&gt;, …), `express.d.ts`, opt-in guard script, eslint-plugin-jsdoc, `.github/workflows/ci.yml` |
| `src/utils` | 29 | generic `apiResponse` / `paginate`; typed permission matrix |
| `src/policies` | 13 | literal unions for resource, owner field and action |
| `src/schemas` | – (new) | all 20+ route schemas moved verbatim; `idParam` 6 copies → 1; each exports a `z.infer` type |
| `src/models` | 1 | Mongoose 9 infers types from schema literals; `InferSchemaType` typedefs; `comparePassword` moved into `methods` |
| `src/services` | 133 | `crudService` is generic over the model's document type; services take the typed actor |
| **Total** | **176** | 31 files checked |

**Escape hatches:**
- 0 `any`, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 `@ts-nocheck`.
- 4 commented boundary casts (generic `T` in `crudService` ×2, env-sourced JWT secret and TTL).
- Plus 8 narrowing casts: 5 aggregate row types, the populated `orgId`, and `activityLabel`.

**Real bug found by the checker:**
- `leadsService.convertToDeal` and `dealsService.moveStage` read `org.pipelineStages` without checking that the org exists. A valid token whose org document is gone crashed with `TypeError` → 500.
- Fixed in its own commit (`fix(deals,leads)`), test first: `tests/missing-org.test.js` was red (500) and is now green (404).

**Verified**
- **After every folder:** `npm run typecheck` (exit 0), `npm run lint` (clean) and `npm test`. The suite was 151 tests until the missing-org fix added 2; it now stands at 153.
- **Deliberate error:** passing `orgId: 42` to `crud.create` gave `TS2322: Type 'number' is not assignable to type 'string'`. `npm run typecheck` exited 2; after the revert it exits 0.
- **Opt-in guard:** removing a `// @ts-check` header made `npm run typecheck` fail and name the file.
- **Smoke check:** auth, org admin and insights have no tests, so a one-off end-to-end run over HTTP covered register, login, refresh, invite/accept, teams, templates, dashboards, search, change and reset password. It passed, and the temporary file was deleted.
- **Not done:** `docker build` (Docker isn't installed here, and there's no build step to verify).

**Next**
- Check `src/middleware` and `src/routes` (the routes still destructure untyped `req.query`).
- Add a typecheck pre-commit hook in S1.4.
- Turn on branch protection so the `backend` check is required.
- Add permanent tests for auth and org admin.

### Interview angles
- **"Why not migrate to TypeScript?"**
  - We get the same compiler and the same `strict` checks, with zero build step: `node src/server.js` still runs the source, so deploys, Docker and stack traces are unchanged.
  - Each folder can still be renamed to `.ts` later, one folder at a time, because the types already exist.
- **"What does strict mode catch?"**
  - Implicit `any` (most of the 176), and nulls you didn't handle. That's the real bug: a `findById` result was used without a check.
  - Indexing that can miss (`noUncheckedIndexedAccess`), and literal-union misuse such as a typo'd role or resource.
- **"How do you keep types and validation in sync?"**
  - Zod is the single source of truth. Each schema in `src/schemas/` exports `z.infer<typeof schema>`, and services take that type.
  - Change the schema and the service signature changes with it, so the two can't drift.
- **"What are the limits of JSDoc types?"**
  - It's more verbose. You can't pass type arguments at call sites (hence the casts on `aggregate(...).exec()`), and generic library types like Mongoose's need occasional boundary casts.
  - Global augmentation still needs one `.d.ts`.

---

## 2026-10-29 · S1.1: Permanent tests for auth, org admin and dashboards

**Goal:** close Known Gap #8 by turning every flow smoke-checked by hand in S1.5 into permanent tests, reusing the existing harness. Tests only; no service changes.

**Changed** (branch `test/auth-orgadmin-insights`, cut from `chore/jsdoc-typecheck`)
- `@vitest/coverage-v8` and `npm run test:coverage`; `@types/supertest`; `tsconfig` now includes `tests/`, still opt-in per file.
- `tests/factories.js`, strict-checked with `// @ts-check`:
  - real-password users;
  - planted invite and reset tokens, stored hash-only exactly as the services do, so no test scrapes the dev-only `console.log` links;
  - refresh-cookie helpers, API `login`, and `sessionCount`.
- `tests/auth.test.js` (18), `tests/org-admin.test.js` (23), `tests/insights.test.js` (8).
- **Suspect behaviour pinned as-is (your call)**, marked `// suspect:` and listed in CLAUDE.md §9:
  - deleting an unknown team or template id returns 200;
  - an admin can change a peer admin's role, or their own.

**Verified**

| Check | Result |
|---|---|
| `npm test` | **202 passed** in 10 files (was 153) |
| `npm run lint`, `npm run typecheck` | clean; a planted error in `factories.js` was caught, then removed |
| Mutation: `refresh` made non-atomic (with a 20 ms window) | the concurrent-refresh test fails: `[200, 200]` instead of `[200, 401]` |
| Mutation: `resetPassword` stops wiping refresh tokens | the all-devices test fails: 2 sessions instead of 0 |
| Mutation: `removeMember` loses its owner guard | the owner-removal test fails: 200 instead of 404 |
| Mutation: open-pipeline `$match` loses `orgId` | totals and isolation tests fail: 10449 vs 450 / 9999 |

**Coverage, `src/services`** (`npm run test:coverage`)

| File | Lines before → after | Branches | Functions |
|---|---|---|---|
| authService.js | 1.8% → **100%** | 93.5% | 100% |
| orgAdminService.js | 1.5% → **100%** | 62.5% | 100% |
| insightsService.js | 5.9% → **100%** | 81.8% | 100% |
| crudService.js | 100% | 100% | 100% |
| leadsService.js | 100% | 85.7% | 100% |
| dealsService.js | 80.0% | 68.8% | 100% |
| activityService.js | 66.7% | 30.0% | 100% |
| activitiesService.js | 40.9% | 15.0% | 66.7% |
| **src/services total** | **91.9%** | **69.0%** | **98.3%** |

`aiProxyService.js` shows 100% because it's an empty stub, so it's left out of the table.

**Next**
- Test `activitiesService.list` (type, status, assignee and date-range filtering for tasks and calendar).
- Fix the pinned suspect behaviour test-first (flip each test), and fix the list-filter stripping from CLAUDE.md §9.

### Interview angle: "How do you know your tests actually test something?"
> Coverage only says a line ran, not that a wrong line would be caught. So for the properties that matter (refresh-token rotation under a race, logout-everywhere on password reset, owner protection, tenant isolation in aggregations), I deliberately broke the service code and watched the specific test go red with a meaningful diff, then reverted. Four mutations, four catches.

---

## 2026-10-30 · S1.1b: Close the S1.1 suspects

**Goal:** fix the three behaviours S1.1 pinned as suspect, cover `activitiesService.list`, drop the empty AI stub from coverage, and get CLAUDE.md under 250 lines.

**Policy decisions (yours):**
- Granting admin is owner-only, like revoking it.
- Removing yourself is blocked, like changing your own role.
- Targeting the owner stays 404.

**Changed** (branch `fix/s1.1b-suspects`, cut from `test/auth-orgadmin-insights`)
- **New `backend/src/policies/membership.js`:**
  - Only the owner grants, revokes or removes admin; nobody acts on themselves.
  - `orgAdminService.updateMemberRole` and `removeMember` now take `actor`, and each does one role-scoped atomic write.
  - On a miss, `memberMissOrForbidden` returns 404 (no such member, or the owner) or 403. Routes only pass `req.user`.
- **Deletes:** `deleteTeam` and `deleteEmailTemplate` match the sub-document id inside the `$pull` write, so an unknown id is a 404.
- **New tests:**
  - `tests/activities-list.test.js` (13);
  - a role-policy table in `tests/org-admin.test.js` (10 role changes + 6 removals);
  - `tests/membership.unit.test.js` (6).
- `aiProxyService.js` is excluded from coverage until S2.2.
- **Docs split:** the JSDoc and testing conventions moved to `docs/conventions.md`; findings, open questions and a dated "Resolved" table moved to `docs/known-issues.md`. CLAUDE.md is 294 → 246 lines.

**Verified**

| Check | Result |
|---|---|
| Role policy, red first | 7 failed before the fix (every denial case), all green after |
| Deletes, red first | 3 failed (200 instead of 404), all green after |
| Mutation: `list` always uses `startAt` | 5 activities tests fail, then reverted |
| `npm test` | **237 passed** in 12 files (was 202) |
| `npm run lint`, `npm run typecheck` | clean |
| `grep suspect` in `src/` and `tests/` | nothing left |

**Coverage, `src/services`** (`aiProxyService.js` excluded)

| File | Lines | Branches | Functions |
|---|---|---|---|
| activitiesService.js | 40.9% → **100%** | 95.0% | 100% |
| authService.js | 100% | 93.5% | 100% |
| crudService.js | 100% | 100% | 100% |
| insightsService.js | 100% | 81.8% | 100% |
| leadsService.js | 100% | 85.7% | 100% |
| orgAdminService.js | 100% | 66.7% | 100% |
| dealsService.js | 80.0% | 68.8% | 100% |
| activityService.js | 66.7% | 30.0% | 100% |
| **total** | **97.5%** (was 91.9%) | **79.5%** (was 69.0%) | **100%** (was 98.3%) |

**Next**
- The list-filter stripping bug (`docs/known-issues.md`) is the most user-visible open bug.
- Branch coverage is still lowest in `activityService.labelFor` and `dealsService`'s won/lost paths.

## 2026-10-30 · S1.3: Frontend tests + one end-to-end test

**Goal:**
- Component tests for the session plumbing and permission-gated UI.
- One Playwright flow covering the core sales loop.
- Member-management UI that matches the S1.1b backend rules, with a visible error when the API refuses a change.
- `// @ts-check` test helpers.

**Bugs found, each fixed test-first**
1. **Backend:** an admin could still mint admins by inviting with `role: 'admin'`. `inviteMember` now takes `actor` and calls `assertCanAssign` (403).
2. **Settings → Members:** role and remove controls appeared on your own row and, for admins, on peer admins, with "Admin" offered as a role.
3. **Silent failures:** a 403 on role change or remove showed nothing. There was no shared error display at all.

**Changed** (branch `test/s1.3-frontend`, cut from `fix/s1.1b-suspects`)
- **Tooling:**
  - Vitest + jsdom + Testing Library + user-event + MSW, with v8 coverage over `src/api` and `src/context`.
  - `tsconfig.json` and `npm run typecheck` (opt-in `// @ts-check`, as in the backend).
  - Playwright.
  - CI now runs `frontend` and `e2e` jobs.
- **Typed helpers** in `frontend/tests/`: an MSW server with envelope builders, role factories, and `renderWithProviders`. The helper restores the session through a mocked refresh behind the real `ProtectedRoute`.
- **`constants.js`** is now `// @ts-check` and mirrors `membership.js` (`manageableRoles`, `canManageMember`). `hasPermission` uses `Object.hasOwn`, so keys like `constructor` can't match.
- **New `components/ErrorAlert.jsx`** (`role="alert"`) and `apiErrorMessage()`, used by the Members tab, AuthPages and the password form.
- **a11y fixes the tests needed:**
  - linked labels on the lead and deal forms;
  - accessible names on the role selects and on the remove and delete icons;
  - `StatCard` is a named group.
- **e2e infrastructure:**
  - `backend/scripts/e2e-server.js` runs the API on in-memory Mongo.
  - `vite.config.js` reads `VITE_PROXY_TARGET`, which affects dev-server config only.

**Verified**

| Check | Result |
|---|---|
| Invite fix, red first | `expected 201 to be 403`, then green |
| Members tab, red first | admin view (own and peer-admin rows) and all three 403-display tests failed; green after |
| Mutation: `refreshPromise ??=` → `=` | single-refresh test fails, `expected 3 to be 1`; reverted |
| Mutation: drop the `hasBootstrapped` guard | both StrictMode restore tests fail, `expected 2 to be 1`; reverted |
| Frontend `npm test` | **73 passed** in 6 files (was 8 in 1) |
| Backend `npm test` | **238 passed** in 12 files |
| `npm run e2e` | passed twice in a row (3.2s each) |
| Lint and typecheck, both packages | clean |

**Coverage, frontend**

| File | Lines | Branches | Functions |
|---|---|---|---|
| src/api/client.js | 100% | 100% | 87.5% (the no-op default `onUnauthorized`) |
| src/context/SessionContext.jsx | 100% | 91.7% | 100% |

**Gotcha:** on Windows, Playwright stops its web servers with `taskkill`. In a shell without `C:\Windows\System32` on `PATH` (this agent's Git Bash), the run passes and then hangs on teardown. This is documented in `docs/conventions.md`.

**Next**
- Mutation error UI everywhere else (S1.4 found it missing). Leads and Pipeline `mutateAsync` failures are still unhandled rejections.
- The list-filter stripping bug is still the most user-visible open bug.
- Opt more frontend files into `// @ts-check`, one folder at a time.

## 2026-10-30 · S1.3b: Fix the three user-visible bugs found in S1.3

**Goal:** fix at the root, test-first:
- list filters that did nothing;
- failed saves that showed nothing;
- pipeline stages hardcoded on the frontend.

All three are now in the Resolved table in `docs/known-issues.md`.

**Changed** (branch `fix/s1.3b-user-visible-bugs`, cut from `test/s1.3-frontend`)

| Commit | What |
|---|---|
| `83b0e08` | **Backend:** strict per-resource `listQuery()` specs; unknown or invalid filters are 400. Notifications handlers move into `notificationsService` and honour `?read=`. `validate()` names the field in each message. |
| `20d2f49` | Frontend contract tests: the Leads status and search params, and NotesPanel's `entityType`/`entityId`. |
| `9c445a9` | `useMutationError` + `ErrorAlert` on Leads and Pipeline. `apiErrorMessage` is status-aware. A partial Pipeline save resyncs, and a retry doesn't move the stage again. |
| `93f1cf9` | `usePipelineStages()`: the org's stages, in order, in Pipeline and the Dashboard funnel. `PIPELINE_STAGE_DEFAULTS` removed. |
| `5d226fe` | An unhandled MSW request now fails the test. Before, 7 tests ran with a missing handler and stayed green. |

### Interview angle (STAR): "Tell me about a bug where the system failed silently"

- **Situation:**
  - On Leads, picking "qualified" in the status filter changed nothing: every lead still showed.
  - Every lead's or deal's Notes panel showed **every note in the org**, not just that record's.
  - The same happened for every list filter on six resources (leads, deals, contacts, companies, notes, notifications).
  - Nothing errored anywhere, so nobody had noticed.
- **Task:** find the layer that lost the filters, fix it once for all six resources, and make bad input impossible to ignore.
- **Action:**
  - Traced the request through the UI, the axios client, the route, the Zod schema and `buildListQuery`. The UI sent the right params, and the services already declared `filterableFields`.
  - The root cause was the **validation layer**. Every list route used one shared `paginationQuery`, a non-strict `z.object`, which **strips unknown keys**. The filters were deleted before the service ran.
  - Replaced it with `listQuery(spec)`. Each resource has one spec (allowlisted filters, sort fields, search, date range) that builds a `.strict()` schema and also feeds the service's filterable and sortable fields, so the two can't drift again.
  - Filter values are typed scalars, so `status[$ne]=x`, repeated keys and objects can't reach Mongo.
- **Result:**
  - Filters work on all six resources.
  - Unknown keys, bad values, operators, repeated keys, bad sorts and `?q=` where there is no search all return **400 `VALIDATION_ERROR` naming the field**.
  - **58 tests prove it:** 55 backend (54 red before the fix) and 3 frontend contract tests.
  - Mutation check: removing `.strict()` turns 15 of them red.

**Why a silent ignore is worse than a 400:**
- An ignored filter returns a *plausible wrong answer*: all leads instead of qualified ones, every note instead of one record's. Users act on it, and nothing in logs or monitoring notices.
- A 400 fails loudly at the first request: in a test, in development, or in the client's error handling.
- An ignored filter defaults to the widest result. Here that stayed inside the org (`orgId` scoping held, and members may read
  every note), but on a resource with tighter read rules the same pattern would be a data-exposure bug.

**Verified**

| Check | Result |
|---|---|
| Filters, red first | 54 of 55 backend tests red (filter returned all rows; unknown key returned 200) |
| Failed saves, red first | 24 red plus 15 unhandled rejections (Leads 14, Pipeline 10) |
| Stages, red first | 4 red (6 hardcoded stages where the org has 5 custom ones) |
| Mutation: drop `.strict()` | 15 filter tests fail |
| Mutation: drop `useMoveStage`'s refetch | partial-failure test fails |
| Mutation: drop the retry guard | `expected 2 to be 1` (stage moved twice) |
| Mutation: drop the stage select's remount key | slow-stages test fails (Save would move the deal to the first stage) |
| Backend `npm test` | **293 passed** in 13 files (was 238) |
| Frontend `npm test` | **107 passed** in 10 files (was 73) |
| `npm run e2e` | passed |
| Lint and typecheck, both packages | clean |

**Found along the way**
- I first added an extra list refetch after a failed Pipeline save. A mutation check showed it was redundant: the move's own `onSuccess` already refetches. Removed.
- S1.3's claim that unhandled requests fail the test was wrong (see `5d226fe`). The docs are corrected.

**Next**
- Error UI for the remaining forms (Contacts, Companies, Tasks, Calendar, Notes, Settings): S1.7 extends `useMutationError`.
- `stageKey` on deal create and update is still not checked against the org's stages (`docs/known-issues.md`).
- The Kanban board (S2.7) is where optimistic stage moves, with rollback, belong.

## 2026-10-30 · S1.3c: Validate stageKey against the org's stages

**Goal:** on deal create, update and move-stage, reject a `stageKey` that isn't in the requesting org's `pipelineStages`, with 400 `VALIDATION_ERROR` naming the field. The check lives in `dealsService`.

**Your three changes, and how each landed**
1. **PATCH bypass: the "no frontend call sends it" case applied.**
   - Pipeline's two-call save strips `stageKey` before `PATCH /deals/:id` (`const { stageKey, ...rest } = values`), and nothing else updates deals.
   - A new frontend test pins this: the PATCH body never has `stageKey`, with or without a stage change.
   - So `update` refuses `stageKey` with `stageKey: use PATCH /deals/:id/move-stage to change a deal's stage.`
2. **Default stage:** creating without `stageKey` used to be a 400, because the schema required it. It now starts in the org's first stage by `order` (`new` by default; `discovery` in the custom test org, whose stages are stored out of order).
3. **Field details:** the error envelope has no field-details slot (`ApiError` is `{ code, message }`), and S1.3b's list-filter errors name the field with a `field: ` message prefix. Stage errors use the same `stageKey: …` prefix; the envelope is unchanged.

**Changed** (branch `fix/s1.3c-stagekey`, cut from `fix/s1.3b-user-visible-bugs`, commit `8581e26`)
- `dealsService`:
  - `stagesOf(orgId)` loads the stages once and returns 404 if the org is gone;
  - `stageIn(stages, key)` is the one check;
  - `create` and `update` are new;
  - `moveStage` reuses the org it already loads and still checks access first.
- Routes call `dealsService.create`/`update`; `dealCreate.stageKey` is optional.
- move-stage's code is `INVALID_STAGE` → `VALIDATION_ERROR`; the one frontend mock was updated.

**Verified**

| Check | Result |
|---|---|
| `tests/deal-stages.test.js`, red first | 8 of 12 red: create accepted unknown and other-org keys (201), a missing stage was a 400, PATCH accepted `stageKey` (200), move-stage used `INVALID_STAGE` |
| Mutation: drop the stage check in `create` | 2 tests fail |
| Mutation: first stage by array position instead of `order` | `expected 'demo' to be 'discovery'` |
| Backend `npm test` | **305 passed** in 14 files |
| Frontend `npm test` | **109 passed** (the 2 new PATCH guard tests passed first time, which is the evidence for case 1) |
| `npm run e2e` | passed |
| Lint and typecheck, both packages | clean |

**Docs:** `docs/known-issues.md` moves the `stageKey` gap to Resolved. Open findings:
- the hardcoded `won`/`lost` keys (still open);
- the two-call Pipeline save (open for S2.7);
- **new:** creating a deal directly in `won`/`lost` skips the close (status, `closedAt`, log, notification). Found here, not fixed: it's outside this brief.

**Next:** decide whether `create` should route a won/lost start stage through the close logic, or refuse it.
