# CLAUDE.md

Project memory for **Nimbus CRM**: a multi-tenant sales CRM with an AI assistant layer.
Read this before changing anything. Overview: [readme.md](readme.md). History: [WORKLOG.md](WORKLOG.md). Detail: [docs/conventions.md](docs/conventions.md), [docs/known-issues.md](docs/known-issues.md).

## 1. Architecture

```
                 same-origin /api/v1
 browser ───────────────────────────▶ Express API  (backend/, :5000) ──read/write──▶ MongoDB
 (frontend/, Vite :5173 / nginx :8080)        │
                                              │ HTTP, internal only, X-Internal-Token
                                              ▼
                                     FastAPI AI service (AI/, :8000) ──▶ provider: fake | Ollama (local)
```

- **The browser only calls same-origin `/api/v1`.** [client.js](frontend/src/api/client.js) hardcodes
  `baseURL: '/api/v1'`. [vite.config.js](frontend/vite.config.js) proxies it in dev and
  [nginx.conf](frontend/nginx.conf) proxies it in Docker. Never put an API host in the client.
- **Express is the only caller of the AI service.** The frontend never talks to FastAPI. The one AI feature, the lead
  brief ([docs/ai.md](docs/ai.md)), goes [aiBriefService.js](backend/src/services/aiBriefService.js) → [aiProxyService.js](backend/src/services/aiProxyService.js).
- **The AI service never touches MongoDB.** Express loads the data (org-scoped), sends a minimal bundle (no emails,
  phones, users or ids beyond history ids), re-validates the answer and saves what it keeps. Everything is free: no paid API.
- Containers are wired in [docker-compose.yml](docker-compose.yml): `client`, `api`, `mongo` (Mongo 7), and
  `ai` (fake provider by default; no host port, only the api calls it).
- **There is no hosted backend.** The full stack runs in docker compose. The public demo ([pages.yml](.github/workflows/pages.yml))
  is a `VITE_DEMO=true` build on GitHub Pages that answers the API in the browser; its shapes are pinned by [contracts/](contracts/).

## 2. Folder map

| Path | Role |
|---|---|
| [backend/src/config/](backend/src/config/) | Env loading, fail-fast check of required vars, `connectDB()`, the pino `logger` |
| [backend/src/middleware/](backend/src/middleware/) | `auth` (JWT → `req.user`), `guards` (`requirePermission`, `validate`), `errorHandler`, `observability` |
| [backend/src/routes/](backend/src/routes/) | HTTP wiring: permission → validation → service → `apiResponse` |
| [backend/src/services/](backend/src/services/) | Business logic. `crudService` factory, `activityLogService` (sole writer of audit log + notifications) |
| [backend/src/policies/](backend/src/policies/) | `ownership.js` (which records) and `membership.js` (which members), §5. Pure rules + a 403/404 helper each |
| [backend/tests/](backend/tests/) | Vitest + supertest + in-memory Mongo. `helpers.js` seeds orgs/records; `factories.js` (typed) does auth fixtures |
| [backend/src/models/](backend/src/models/) | Mongoose schemas. `Organization` is the tenant root; `CRM.js` = Lead/Contact/Company; `Logs.js` = audit + notification |
| [backend/src/schemas/](backend/src/schemas/) | Every Zod request schema plus its `z.infer` typedef. Routes import them; services use the types |
| [backend/src/types/](backend/src/types/) | Shared JSDoc typedefs (`AuthUser`, `ApiResponse<T>`, …) and the `Express.Request` augmentation |
| [backend/src/utils/](backend/src/utils/) | `http.js` envelope + errors, `validators.js` Zod fragments, `queryBuilder.js`, `permissions.js` |
| [frontend/src/api/](frontend/src/api/) | Axios instance, in-memory access token, refresh-on-401 |
| [frontend/src/context/](frontend/src/context/) | `SessionContext`: bootstrap, login/logout, `can()` |
| [frontend/src/features/](frontend/src/features/) | One folder per page/domain (leads, deals, settings, …) |
| [frontend/src/components/](frontend/src/components/) | Shared UI: `DataTable`, `Modal`, `FormField`, `GlobalSearch` (also Ctrl+K palette) |
| [frontend/src/lib/](frontend/src/lib/) | `constants.js` (enums + permission mirror), `queryClient.js`, `utils.js` |
| [frontend/src/layouts/](frontend/src/layouts/) | `AppLayout` (shell, nav, guest banner), `AuthLayout` |
| [frontend/src/demo/](frontend/src/demo/) | Pages demo only (MSW handlers + seed); never in a normal build ([check-no-demo.mjs](frontend/scripts/check-no-demo.mjs)) |
| [AI/app/](AI/app/) | FastAPI service: `lead_brief/` (models, prompt, validation, retry), `providers/` (fake, ollama); evals in [AI/evals/](AI/evals/) |

## 3. API contract

Every response uses one envelope, built only by `apiResponse()` and the `AppError` helpers in
[http.js](backend/src/utils/http.js). [errorHandler.js](backend/src/middleware/errorHandler.js) is the only code that writes an error.

Success: `GET /api/v1/leads?limit=20`, a cursor list (`cursorPaginate()` in [queryBuilder.js](backend/src/utils/queryBuilder.js); page-numbered lists like `/contacts` return `{ page, limit, total, hasMore }`):
```json
{ "success": true,
  "data": [{ "_id": "…", "orgId": "…", "name": "Acme lead", "status": "new", "score": 0,
             "companyId": { "_id": "…", "name": "Acme" }, "ownerId": "…", "createdAt": "…" }],
  "error": null,
  "meta": { "limit": 20, "hasMore": true, "nextCursor": "WyJ…" } }
```

Error: `GET /api/v1/leads/<unknown id>` → 404 (thrown by `getById` in [crudService.js](backend/src/services/crudService.js)):
```json
{ "success": false, "data": null, "error": { "code": "NOT_FOUND", "message": "Lead not found." }, "meta": null }
```

| Status | Codes | Source |
|---|---|---|
| 400 | `VALIDATION_ERROR` (`field: message`, joined by `; `), `BAD_REQUEST`, domain codes like `ALREADY_CONVERTED`, `INVALID_CURSOR` | `validate()` in [guards.js](backend/src/middleware/guards.js), services, bad JSON, Mongoose validation/cast errors |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | [auth.js](backend/src/middleware/auth.js), `authService` |
| 403 | `FORBIDDEN` | `requirePermission()` |
| 404 | `NOT_FOUND` | services; unknown routes (but an unknown path under a resource, e.g. `/leads/x/y`, is 401 for a guest: that router authenticates first) |
| 409 | `DUPLICATE_KEY` | Mongo error 11000 |
| 413, 429 | `PAYLOAD_TOO_LARGE` (body over 100 kB), `RATE_LIMITED`, `AI_RATE_LIMITED` | `express.json()`, the `/api` rate limiter, the AI limits |
| 502, 503 | `AI_BAD_OUTPUT`, `AI_UNAVAILABLE` (AI off, down or too slow) | [aiProxyService.js](backend/src/services/aiProxyService.js) |
| 500 | `INTERNAL_ERROR` | anything else, logged with the request id |

The client reads `response.data.data`. `useList` in [hooks.js](frontend/src/hooks.js) returns the whole body (`{ data, meta }`).

## 4. Tenancy

**Every query on tenant data is scoped by `orgId`.**

- **Source of truth:** [auth.js](backend/src/middleware/auth.js) sets `req.user.orgId` from the verified JWT.
  Never take `orgId` from body, query or params.
- **Enforcement:** services take `actor` (= `req.user`, `{ id, orgId, role }`). [crudService.js](backend/src/services/crudService.js)
  adds `actor.orgId` to every list/get/update/delete and sets it last on create, so the body can't override it. The ownership
  policy also strips `orgId` from every write body. Other services query `{ _id: id, orgId, ...scopeFor(...) }`.
  Aggregations in [insightsService.js](backend/src/services/insightsService.js) `$match` it first.
- **Intentional global lookups:** only in [authService.js](backend/src/services/authService.js) (login by email, refresh/reset/invite
  by token hash). Email is globally unique ([User.js](backend/src/models/User.js)).
- **References stay in the org:** every stored reference is checked with `assertReferencesInOrg` and every populate goes
  through `scopedPopulate` ([references.js](backend/src/policies/references.js)). Gap: no explicit guard for a token without `orgId`.

## 5. Permissions

The role → resource → action table lives in [permissions.js](backend/src/utils/permissions.js) and is mirrored
in [constants.js](frontend/src/lib/constants.js). The two copies are identical as of 2026-10-29.

| Role | org | members | pipeline | crm | reports | ai |
|---|---|---|---|---|---|---|
| owner | manage | manage | configure | read, write, delete | view | use |
| admin | — | manage | configure | read, write, delete | view | use |
| manager | — | — | — | read, write, delete | view | use |
| member | — | — | — | read, write | view | use |

- **Any change updates both files in the same commit.**
- The backend is the authority (`requirePermission(resource, action)` on routes). The frontend copy only hides UI through
  `useSession().can()` (Settings tabs; CRM Delete buttons).

### Ownership policy ("own records only")

`requirePermission` decides *whether* a role may write CRM data at all. [ownership.js](backend/src/policies/ownership.js)
decides *which records*. It is enforced in services, never routes, and mirrored for UI only by `canModifyRecord` in
[constants.js](frontend/src/lib/constants.js).

| Action | member | manager / admin / owner |
|---|---|---|
| list, get | whole org | whole org |
| update, convert, move-stage, toggle | own records only | whole org |
| delete | 403 (no `crm:delete`) | whole org |
| create | owner field forced to self | may set owner (same-org user, else 400 `INVALID_OWNER`) |
| change owner field | silently stripped | allowed (same-org user only) |
| `orgId` in body | always stripped | always stripped |

- **Owner field:** `ownerId` for lead, deal, contact and company; `assigneeId` for activity; `authorId` for note.
  A note's author is never reassignable, by anyone.
- **Status codes:** another org's id or an unknown id gives **404**. Same org but not yours gives **403** `FORBIDDEN`.
  `missOrForbidden()` picks between them *after* the scoped query misses, so a 404 never reveals that another tenant's record exists.
- **How to apply it:** use the crud factory with a `resource` option. Any other write must query
  `{ _id, orgId: actor.orgId, ...scopeFor(actor, resource, 'write') }` and throw `await missOrForbidden(...)` on a miss
  (see `convertToDeal`, `moveStage`, `toggleStatus`). A new owned resource needs an entry in `OWNER_FIELD`; `ownerField()`
  throws for unknown resources on purpose.
- **Proof:** [backend/tests/](backend/tests/) holds a 64-case role × action × ownership matrix for leads and deals, the custom
  actions, cross-org 404s on every `:id` route, and mass assignment.

### Member management (who may re-role or remove whom)
[membership.js](backend/src/policies/membership.js), enforced in [orgAdminService.js](backend/src/services/orgAdminService.js):
- **Admins are owner-managed:** only the owner grants, revokes or removes admin. Admins manage managers and members.
- **Nobody acts on themselves:** changing your own role or removing yourself → 403.
- **The owner is never a target:** 404. `owner` can't be assigned (400).
- **Same pattern as ownership:** one role-scoped atomic write; on a miss, `memberMissOrForbidden` picks 404 or 403.
  Invites follow `assertCanAssign` too. UI mirror: `manageableRoles` / `canManageMember` in [constants.js](frontend/src/lib/constants.js).

### Auth
15m access JWT (`sub`, `orgId`, `role`) kept in memory only. 7d refresh token in an httpOnly `SameSite=strict` cookie
  scoped to `/api/v1/auth`, stored hashed, rotated on every use with atomic `$push`/`$pull` (keep them atomic; see
  `authService.js`), all revoked by a password reset. Role changes take effect when the access token expires. Passwords:
  one rule, `password` in [validators.js](backend/src/utils/validators.js) (8+ characters, not only whitespace, ≤ 72 UTF-8 bytes), mirrored by [password.js](frontend/src/lib/password.js).

## 6. Running locally

Copy `backend/.env.example` → `backend/.env` and `AI/.env.example` → `AI/.env`. The frontend needs no env.

```bash
# MongoDB must be a replica set (lead convert uses a transaction): a 1-node local set on :27017 (see
# "Replica set" below), `docker compose up mongo` (already one)
cd backend  && npm install && npm run dev     # :5000, GET /health → {"success":true,...}
cd frontend && npm install && npm run dev     # :5173, proxies /api → :5000
cd frontend && npm run build                  # production bundle → frontend/dist
cd AI && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # fake provider; AI_PROVIDER=ollama for a local model (docs/ai.md)
docker compose up --build                     # client, api, mongo; :8080. See Docker below.
```

| Var | Service | Required at boot | Actually read? |
|---|---|---|---|
| `MONGO_URI` | backend | yes | yes |
| `JWT_ACCESS_SECRET` | backend | yes | yes |
| `CLIENT_ORIGIN` | backend | yes | yes (CORS) |
| `AI_ENABLED`, `AI_SERVICE_URL`, `AI_INTERNAL_TOKEN`, `AI_TIMEOUT_MS` | backend | token: when AI is on | yes (kill switch, default off; compose on) |
| `ACCESS_TOKEN_TTL` | backend | no (`15m`) | yes |
| `REFRESH_TOKEN_TTL` | backend | no (`7d`; `30s`/`15m`/`2h`/`7d` form, checked at boot) | yes (refresh cookie lifetime) |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | backend | no (`LOG_LEVEL`: `info`; `silent` under test) | yes |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | backend | no | yes |
| `TRUST_PROXY`, `EMAIL_ENABLED` | backend | no (`0`, `false`; checked at boot) | yes (proxy hops: compose sets `1`; reset/invite UI) |
| `GIT_COMMIT` | backend | no (`dev`) | yes (`/api/v1/health`; CI sets it to the commit under test) |
| `AI_INTERNAL_TOKEN`, `AI_PROVIDER`, `OLLAMA_URL`, `OLLAMA_MODEL`, `AI_TIMEOUT_MS`, `AI_PRICE_*` | AI | token: yes | yes ([docs/ai.md](docs/ai.md)) |

Read in [backend/src/config/index.js](backend/src/config/index.js) (`GIT_COMMIT`: [app.js](backend/src/app.js)); listed in [backend/.env.example](backend/.env.example) and [AI/.env.example](AI/.env.example). The frontend reads none.

- **Seed data:** none. Register an org at `/register`, and you become its owner.
- **Invite and reset links** are printed to the backend console (no email provider).
- **Tests:** `npm test` in `backend/` (Vitest + supertest + mongodb-memory-server; first run downloads a ~70 MB mongod) and in
  `frontend/` (Vitest + Testing Library + MSW). No `.env` needed. **e2e:** `npm run e2e` in `frontend/` (Playwright; starts its
  own API on in-memory Mongo, the AI service + Vite on :5055/:5057/:5175; first time: `npx playwright install chromium`). AI: `pytest` in `AI/`.
- **Coverage and budgets:** `npm run test:coverage` in both (backend `src/services` 99.66% lines, 2026-11-03). Budgets ([bench/](bench/)): lead
  list p95 under 200 ms at 100k leads on the bench machine (28 ms); first-load JS under [bundle-budget.json](frontend/bundle-budget.json) (CI).
- **Checks (repo root):** `npm run lint` (ESLint, zero warnings, plus ruff), `npm run typecheck`, `npm run format:check`. The husky
  pre-commit hook runs them on staged files and blocks the commit; see [CONTRIBUTING.md](CONTRIBUTING.md). Logs are pino JSON.
- **CI** ([docs/ci.md](docs/ci.md)): `repo`, `ai`, `backend` (fails below 98.65% `src/services` line coverage), `frontend`, `e2e`,
  `docker` (compose stack, PRIMARY replica set, [smoke.mjs](scripts/smoke.mjs) through nginx). Its 6 jobs are required checks on `main`'s ruleset: a PR merges only when they pass ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Docker:** compose sets the api's own env (replica-set `MONGO_URI`, `CLIENT_ORIGIN`, a dev-only JWT secret); `backend/.env` is optional;
  `.dockerignore` keeps `.env` and `node_modules` out. An existing DB after an index change: `node scripts/sync-indexes.js --apply` (backend/).
- **Replica set:** a standalone mongod makes lead convert fail ("Transaction numbers are only allowed on a replica set").
  To convert a local service: add `replication:` / `  replSetName: rs0` to `mongod.cfg`, restart the service, then run
  `mongosh --eval "rs.initiate()"` once. Tests and e2e start their own in-memory replica sets.

## 7. Coding rules

1. **Zod at every boundary.** Every route validates `body`/`query`/`params` with `validate({...})` using schemas from
   [backend/src/schemas/](backend/src/schemas/) (never defined inline in routes) built from fragments in
   [validators.js](backend/src/utils/validators.js). Forms use React Hook Form + `zodResolver` (exceptions: `NotesPanel`,
   the Settings team and stage editors). AI I/O uses Pydantic in `AI/app/lead_brief/models.py`, and Express re-validates AI responses.
   **List queries are strict:** build them with `listQuery(spec)` from one per-resource spec (e.g. `leadList` in
   [schemas/leads.js](backend/src/schemas/leads.js)) that the service also uses. Unknown or invalid params are 400, never
   ignored. Optional text fields must treat `''` as omitted (use the `optional*` helpers).
2. **routes → services → models.** Routes do permission → validation → one service call → `apiResponse`. Queries,
   side effects, audit logs and notifications live in `services/`, which take plain values and never `req`/`res`.
3. **Tests with every change.** New or changed behaviour ships with tests in the same change. Write the failing test first.
   Backend tests go through `app` with supertest (see [helpers.js](backend/tests/helpers.js)); AI tests, when they come, use pytest.
4. **Never bypass `orgId` or the ownership policy** (§4, §5). New tenant models get a required, indexed `orgId`; new
   owned resources get an `OWNER_FIELD` entry and matrix tests.
5. **Never log secrets or tokens** (raw tokens, passwords, JWTs, API keys, cookies).
   *Known dev-only violations, never run in production (tested), removed once email exists:* [authService.js:219](backend/src/services/authService.js#L219)
   (reset token) and [orgAdminService.js:83](backend/src/services/orgAdminService.js#L83) (invite token). Do not add more.
6. CRM mutations go through `activityLogService.logActivity` (the CRUD factory does this when given `activityLabel`).
7. Keep the envelope: throw `AppError` helpers; never hand-build error JSON or call `res.json` in routes. Log with `req.log`.
8. Style: Prettier and sorted imports (both enforced), ESM, a one-line purpose comment per file, comments that explain *why*.
9. **Types are JSDoc checked by `tsc` under `strict`.** No build step and no `any`. Files in `src/types`, `utils`,
   `policies`, `schemas`, `models` and `services` must start with `// @ts-check`; routes, middleware and config aren't checked yet.
   Request types come from Zod via `z.infer`. Patterns, escape hatches and the migration steps are in
   [docs/conventions.md](docs/conventions.md). The frontend opts in per file (test helpers, `constants.js`); same rules.

## 8. Workflow rules for Claude

1. **Plan first.** For anything beyond a trivial fix, explore, then present a plan and wait for approval.
2. **Run tests and lint before saying done**, and show the output. If no tests exist for the area, say so explicitly.
3. **Update [WORKLOG.md](WORKLOG.md) at the end of every session:** goal, what changed, how it was verified, next steps.
4. **Every change is a PR.** A short branch off `main` (`<type>/<short-description>`), one task per PR, merged with
   **Rebase and merge** once the 6 CI checks are green, so every commit lands on `main` as written. Never push to
   `main` (a ruleset blocks it, and force pushes). Commit, push and open the PR only when asked.
5. When editing this file, re-run the path check so every referenced path exists.

## 9. Known gaps

Open gaps only. Smaller findings, open questions and everything resolved (with dates and commits) are in
[docs/known-issues.md](docs/known-issues.md). There are no open `// suspect:` tests.

1. **No email verification.** All users are created with `isEmailVerified: true`. (Reset works end to end since S1.7.)
2. **No email sending** (`EMAIL_ENABLED=false`): no reset offered; the inviting admin copies the invite link. Dev logs the links.
3. **One AI feature** (the lead brief). The rescore promised in [leadsService.js](backend/src/services/leadsService.js) doesn't exist.
   Upload stubs: [upload.js](backend/src/middleware/upload.js), [cloudinaryUpload.js](backend/src/utils/cloudinaryUpload.js), [FileUploader.jsx](frontend/src/components/FileUploader.jsx).
4. **No Kanban board.** [PipelinePage.jsx](frontend/src/features/deals/PipelinePage.jsx) renders a table.
