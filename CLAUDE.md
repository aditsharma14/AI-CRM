# CLAUDE.md

Project memory for **Nimbus CRM**: a multi-tenant sales CRM with an AI assistant layer.
Read this before changing anything. Overview: [readme.md](readme.md). History: [WORKLOG.md](WORKLOG.md). Detail: [docs/conventions.md](docs/conventions.md), [docs/known-issues.md](docs/known-issues.md).

## 1. Architecture

```
                 same-origin /api/v1
 browser ───────────────────────────▶ Express API  (backend/, :5000) ──read/write──▶ MongoDB
 (frontend/, Vite :5173 / nginx :8080)        │                                         ▲
                                              │ HTTP, internal only                     │ read-only
                                              ▼                                         │
                                     FastAPI AI service (AI/, :8000) ───────────────────┘
```

- **The browser only calls same-origin `/api/v1`.** [client.js](frontend/src/api/client.js) hardcodes
  `baseURL: '/api/v1'`. [vite.config.js](frontend/vite.config.js) proxies it in dev and
  [nginx.conf](frontend/nginx.conf) proxies it in Docker. Never put an API host in the client.
- **Express is the only caller of the AI service.** The frontend never talks to FastAPI. AI features go
  [ai.routes.js](backend/src/routes/ai.routes.js) → [aiProxyService.js](backend/src/services/aiProxyService.js)
  (both empty today).
- **The AI service reads MongoDB and never writes.** It reads only for RAG context, filtered by the `orgId`
  Express sends. If an AI result must be saved (e.g. a lead score), Express saves it.
- Containers are wired in [docker-compose.yml](docker-compose.yml): `client`, `api`, `ai`, `mongo` (Mongo 7, dev only; Atlas in prod).

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
| [AI/app/](AI/app/) | FastAPI service: `core/` (config, LLM, memory/RAG), `routers/` (assistant, generate). **All stubs.** |

## 3. API contract

Every response uses one envelope, built only by `apiResponse()` and the `AppError` helpers in
[http.js](backend/src/utils/http.js) and formatted by [errorHandler.js](backend/src/middleware/errorHandler.js).

Success: `GET /api/v1/leads?page=1&limit=20` (`meta` comes from `paginate()` in [queryBuilder.js](backend/src/utils/queryBuilder.js)):
```json
{ "success": true,
  "data": [{ "_id": "…", "orgId": "…", "name": "Acme lead", "status": "new", "score": 0,
             "companyId": { "_id": "…", "name": "Acme" }, "ownerId": "…", "createdAt": "…" }],
  "error": null,
  "meta": { "page": 1, "limit": 20, "total": 37, "hasMore": true } }
```

Error: `GET /api/v1/leads/<unknown id>` → 404 (thrown by `getById` in [crudService.js](backend/src/services/crudService.js)):
```json
{ "success": false, "data": null, "error": { "code": "NOT_FOUND", "message": "Lead not found." }, "meta": null }
```

| Status | Codes | Source |
|---|---|---|
| 400 | `VALIDATION_ERROR` (`field: message`, joined by `; `), `BAD_REQUEST`, domain codes like `ALREADY_CONVERTED` | `validate()` in [guards.js](backend/src/middleware/guards.js), services |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | [auth.js](backend/src/middleware/auth.js), `authService` |
| 403 | `FORBIDDEN` | `requirePermission()` |
| 404 | `NOT_FOUND` | services; unknown routes |
| 409 | `DUPLICATE_KEY` | Mongo error 11000 |
| 500 | `INTERNAL_ERROR` | anything else (also Mongoose `CastError`) |

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
- **Gaps:** there's no explicit guard for a token without `orgId`, and referenced ids (`companyId`, team `memberIds`, …)
  aren't checked against the org. Both are in [docs/known-issues.md](docs/known-issues.md). Owner fields *are* checked (§5).

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
15m access JWT (`sub`, `orgId`, `role`) kept in memory only. 7d refresh token in an httpOnly
  `SameSite=strict` cookie scoped to `/api/v1/auth`, stored hashed and rotated on every use with atomic `$push`/`$pull`
  (see the comments in `authService.js`; keep them atomic). Role changes take effect when the access token expires.

## 6. Running locally

Copy `backend/.env.example` → `backend/.env` and `AI/.env.example` → `AI/.env`. The frontend needs no env.

```bash
# MongoDB must be a replica set (lead convert uses a transaction): a 1-node local set on :27017 (see
# "Replica set" below), `docker compose up mongo` (already one), or MONGO_URI → Atlas (already one)
cd backend  && npm install && npm run dev     # :5000, GET /health → {"success":true,...}
cd frontend && npm install && npm run dev     # :5173, proxies /api → :5000
cd frontend && npm run build                  # production bundle → frontend/dist
cd AI && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # currently FAILS: app/main.py is a stub
docker compose up --build                     # all services, :8080. See Docker caveat below.
```

| Var | Service | Required at boot | Actually read? |
|---|---|---|---|
| `MONGO_URI` | backend, AI | backend: yes | backend yes; AI not yet |
| `JWT_ACCESS_SECRET` | backend | yes | yes |
| `JWT_REFRESH_SECRET` | backend | yes | **no** (refresh tokens are random hex, not JWTs) |
| `CLIENT_ORIGIN` | backend | yes | yes (CORS) |
| `AI_SERVICE_URL` | backend | yes | **no** (AI proxy not built) |
| `ACCESS_TOKEN_TTL` | backend | no (`15m`) | yes |
| `REFRESH_TOKEN_TTL` | backend | no (`7d`) | **no** (cookie maxAge is hardcoded in `auth.routes.js`) |
| `NODE_ENV`, `PORT` | backend | no | yes |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | backend | no | yes |
| `PORT`, `API_INTERNAL_ORIGIN`, `LLM_PROVIDER`, `GOOGLE_API_KEY`, `OPENAI_API_KEY` | AI | n/a | not yet (stubs) |
| `VITE_API_BASE_URL` | frontend | no | **no** (`client.js` ignores it) |

All of these are read in [backend/src/config/index.js](backend/src/config/index.js), [AI/.env.example](AI/.env.example) and [frontend/.env.example](frontend/.env.example).

- **Seed data:** none. Register an org at `/register`, and you become its owner.
- **Invite and reset links** are printed to the backend console (no email provider).
- **Tests:** `npm test` in `backend/` (Vitest + supertest + mongodb-memory-server; first run downloads a ~70 MB mongod) and in
  `frontend/` (Vitest + Testing Library + MSW). No `.env` needed. **e2e:** `npm run e2e` in `frontend/` (Playwright; starts its
  own API on in-memory Mongo + Vite on :5055/:5175; first time: `npx playwright install chromium`). No AI tests yet.
- **Coverage:** `npm run test:coverage` in both. As of 2026-10-30: backend `src/services` 97.5% lines / 79.5% branches / 100% funcs;
  frontend `src/api` + `src/context` 100% lines / 95.7% branches. Helpers and conventions: [docs/conventions.md](docs/conventions.md).
- **Lint / typecheck:** `npm run lint` and `npm run typecheck` in both `frontend/` and `backend/` (JSDoc checked by `tsc`, §7). All pass.
- **CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs `backend`, `frontend` and `e2e` jobs on every push and PR.
  To make them block merges, a repo admin adds a branch protection rule for `main` requiring those checks.
- **Docker caveat:** the `.env.example` values use `localhost`. Under Compose, set `MONGO_URI=mongodb://mongo:27017/nimbus-crm`,
  `AI_SERVICE_URL=http://ai:8000` and `CLIENT_ORIGIN=http://localhost:8080`. There is no `.dockerignore`, so local `.env`
  files and `node_modules` get copied into images.
- **Replica set:** a standalone mongod makes lead convert fail ("Transaction numbers are only allowed on a replica set").
  To convert a local service: add `replication:` / `  replSetName: rs0` to `mongod.cfg`, restart the service, then run
  `mongosh --eval "rs.initiate()"` once. Tests and e2e start their own in-memory replica sets.

## 7. Coding rules

1. **Zod at every boundary.** Every route validates `body`/`query`/`params` with `validate({...})` using schemas from
   [backend/src/schemas/](backend/src/schemas/) (never defined inline in routes) built from fragments in
   [validators.js](backend/src/utils/validators.js). Forms use React Hook Form + `zodResolver` (exceptions: `NotesPanel`,
   the Settings team and stage editors). AI I/O uses Pydantic in `AI/app/schemas.py`, and Express re-validates AI responses.
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
   *Known dev-only violations, to be removed once email exists:* [authService.js:200](backend/src/services/authService.js#L200)
   (reset token) and [orgAdminService.js:83](backend/src/services/orgAdminService.js#L83) (invite token). Do not add more.
6. CRM mutations go through `activityLogService.logActivity` (the CRUD factory does this when given `activityLabel`).
7. Keep the envelope: throw `AppError` helpers and never hand-build error JSON or call `res.json` in routes.
8. Style: ESM, 2-space indent, no semicolons, single quotes, a one-line purpose comment at the top of each file, comments that explain *why*.
9. **Types are JSDoc checked by `tsc` under `strict`.** No build step and no `any`. Files in `src/types`, `utils`,
   `policies`, `schemas`, `models` and `services` must start with `// @ts-check`; routes, middleware and config aren't checked yet.
   Request types come from Zod via `z.infer`. Patterns, escape hatches and the migration steps are in
   [docs/conventions.md](docs/conventions.md). The frontend opts in per file (test helpers, `constants.js`); same rules.

## 8. Workflow rules for Claude

1. **Plan first.** For anything beyond a trivial fix, explore, then present a plan and wait for approval.
2. **Run tests and lint before saying done**, and show the output. If no tests exist for the area, say so explicitly.
3. **Update [WORKLOG.md](WORKLOG.md) at the end of every session:** goal, what changed, how it was verified, next steps.
4. **Never commit to `main`.** Create a branch first. Commit only when asked.
5. When editing this file, re-run the path check so every referenced path exists.

## 9. Known gaps

Open gaps only. Smaller findings, open questions and everything resolved (with dates and commits) are in
[docs/known-issues.md](docs/known-issues.md). There are no open `// suspect:` tests.

1. **No reset-password page or email verification.** [authService.js](backend/src/services/authService.js) issues
   `/reset-password?token=`, but [App.jsx](frontend/src/App.jsx) has no such route. All users are created with `isEmailVerified: true`.
2. **No email sending.** Links are only logged ([authService.js](backend/src/services/authService.js), [orgAdminService.js](backend/src/services/orgAdminService.js)).
3. **AI layer is unbuilt.** The rescore promised in [leadsService.js](backend/src/services/leadsService.js) doesn't exist.
   Stub files: everything in [AI/app/](AI/app/), [aiProxyService.js](backend/src/services/aiProxyService.js),
   [ai.routes.js](backend/src/routes/ai.routes.js), [upload.js](backend/src/middleware/upload.js),
   [cloudinaryUpload.js](backend/src/utils/cloudinaryUpload.js), [FileUploader.jsx](frontend/src/components/FileUploader.jsx),
   [AIChatWidget.jsx](frontend/src/features/ai/AIChatWidget.jsx) and [AIActionsMenu.jsx](frontend/src/features/ai/AIActionsMenu.jsx).
4. **No Kanban board.** [PipelinePage.jsx](frontend/src/features/deals/PipelinePage.jsx) renders a table.
5. **Product name inconsistent.** "Nimbus CRM" in [readme.md](readme.md); "Clarion" in [AppLayout.jsx](frontend/src/layouts/AppLayout.jsx),
   [AuthLayout.jsx](frontend/src/layouts/AuthLayout.jsx) and [index.html](frontend/index.html).
6. **Deployment config disagrees with docs.** [vercel.json](vercel.json) declares the backend as a Vercel service, while the readme
   says it's hosted elsewhere. Its rewrite `"/api/(/.*)?"` likely doesn't match `/api/v1/...` (`"/api(/.*)?"` intended?).
