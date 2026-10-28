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
