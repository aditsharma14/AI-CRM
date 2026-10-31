# Known issues

Everything known to be wrong, missing or unverified that isn't a top-level gap in [CLAUDE.md](../CLAUDE.md) §9,
plus a record of what has been resolved. Newest resolutions first.

## Open findings (verified 2026-10-29, updated 2026-11-01; GitHub issue numbers in brackets)
- **After a password reset, a tab that is already open keeps working for up to 15 minutes.** The reset revokes every
  refresh token, but an access token already in a tab's memory stays valid until it expires (same as role changes, §5).
  The next refresh or reload signs the tab out (the e2e checks this).
- **Marking a notification read from the bell panel fails silently.** The panel closes on click, so there's nowhere to
  show the error; the dot just stays. The only mutation without error UI (S1.7 audit).
- **The production bundle is one chunk over 500 kB** (Vite warns on `npm run build`). No code splitting yet.
- **[#18] The `won`/`lost` stage keys are hardcoded** (`CLOSING_KEYS` in [dealsService.js](../backend/src/services/dealsService.js);
  closing a deal is keyed on them). An org that renames its closing stages' *keys* never closes a deal. Open for S2.7.
- **[#19] Pipeline save is two calls (move-stage, then update), not atomic;** revisit with a single endpoint or transaction in
  S2.7. (S1.3b made the UI resync after a partial failure, and a retry doesn't repeat the move.)

### Lint disables (S1.7 audit)
- No `react-hooks` rule is disabled anywhere in the frontend (the one in `GlobalSearch` was #12).
- Three `react-refresh/only-export-components` disables remain, in `FormField.jsx` (`inputClasses`), `SessionContext.jsx`
  (`useSession`) and `NotificationsPanel.jsx`. They only cost Fast Refresh a full reload of those modules; no bug hides
  behind them. Left as they are.

## Open questions
- What exactly happens if a token lacked `orgId`? Mongoose likely casts it to `null` and matches nothing. (A token whose
  org *document* is gone gets a 404; see [missing-org.test.js](../backend/tests/missing-org.test.js).) Not tested.
- Does the [vercel.json](../vercel.json) rewrite really fail on `/api/v1/...`? Reasoned from path-to-regexp; not deployed.
- Is "Clarion" a deliberate rebrand, or should it be "Nimbus"?

## Resolved
| Date | Issue | Fix |
|---|---|---|
| 2026-11-01 | **No reset-password page** (CLAUDE.md gap 9.1): the backend issued `/reset-password?token=` links the app couldn't open, and there was no way to ask for one | `/forgot-password` and `/reset-password` (token removed from the URL with `replaceState`; missing, expired and success states) (`2f85355`); e2e with planted tokens, mutation-checked (`a41586c`) |
| 2026-11-01 | **The password rule was only `min(8)`:** eight spaces were a valid password; bcrypt silently ignored everything after 72 bytes; four emoji counted as 8 characters | one shared rule: 8+ code points, not only whitespace (never trimmed), ≤ 72 UTF-8 bytes, on all four endpoints; client mirror with the same case table (`37a8f60`, `2f85355`). Existing passwords still log in |
| 2026-11-01 | **[#13] Save errors were silent** on Contacts, Companies, Tasks, Calendar, Notes and Settings (unhandled `mutateAsync` rejections, fire-and-forget `mutate`) | `useMutationError` + `ErrorAlert` everywhere, input kept on failure, field-level 400s via `forFields` (`324b7d7`, `63bfab1`; hook `7a45269`) |
| 2026-11-01 | **[#12]** `GlobalSearch`'s Escape listener kept the `onClose` from the render that opened it (`exhaustive-deps` was disabled) | `useCallback` + real deps, rule back on (`31f5a69`) |
| 2026-11-01 | **[#11]** Changing the search or status filter kept the page number | `usePaginationState(filters)` derives page 1 when the filters change (`6717d12`) |
| 2026-11-01 | **[#10] Settings → Members crashed** when `/org/members` failed (`members.map` on `undefined`); NotesPanel, Settings → Pipeline, Calendar and the Dashboard showed empty data or zeros on a failed load | `ErrorAlert` with Retry on every failed load (`e80412c`, Calendar `324b7d7`) |
| 2026-11-01 | About 30 form fields (Calendar, Companies, Contacts, Tasks, Settings) had labels not linked to their inputs, and no field linked its error | `FormField` sets the id, `aria-invalid` and `aria-describedby` (`7a45269`) |
| 2026-11-01 | **[#21] Docker Compose had never been started**, and couldn't be from a fresh clone (required `.env` files with `localhost` values, a healthcheck that passed before PRIMARY, an AI stub that exits) | compose fixed (`68b2463`); the CI `docker` job builds and starts it, proves PRIMARY and a transactional lead conversion on every push (`72e51fb`). A client on the host may still need `?directConnection=true`, since the set advertises `mongo:27017` |
| 2026-10-31 | **[#15] References weren't checked against the org, and populate() wasn't org-scoped:** a member could point `companyId`, `contactIds`, a note's `entityId` or an activity's `linkedTo` (and an admin a team's `memberIds`) at another org's document, and the next read populated that org's names (and, for teams, emails) into the response | `assertReferencesInOrg` on every write and `scopedPopulate` on every read, in [references.js](../backend/src/policies/references.js) (`ec78fed`, `f9b29d7`); read-only [audit-references.js](../backend/scripts/audit-references.js) for stored data (`fd980be`) |
| 2026-10-31 | **[#14] Signup wasn't transactional:** a failed user write left an org with no owner; two parallel invite accepts both got past the invite check | `registerOrg` and `acceptInvite` each run in one transaction; the invite is consumed by a conditional `$pull` (`97eb052`) |
| 2026-10-31 | **[#17]** `dealsService` exported its CRUD factory, so `crud.create` could skip `dealsService.create` | `crud` is private (`b0408cb`) |
| 2026-10-31 | **[#5–#9] Error contract:** malformed/oversized JSON was 500, the 429 was HTML, an unknown `/api/v1` path was 401 for guests, a Mongoose `ValidationError` sent its raw message (model and path names), a `CastError` was 500 | 400 / 413 (`db74807`), enveloped `RATE_LIMITED` (`59559c0`), one router per prefix (`507082b`), `field: message` and `id: invalid id` (`41ce061`) |
| 2026-10-31 | **[#16] Dead config:** `JWT_REFRESH_SECRET` and `AI_SERVICE_URL` were required but unread; the refresh cookie ignored `REFRESH_TOKEN_TTL` | both removed, `AI_SERVICE_URL` returns in S2.2 (`715eaa5`); cookie `maxAge` follows the TTL, checked at boot (`921be14`) |
| 2026-10-31 | Typecheck (and lint) weren't in a pre-commit hook, and CI doesn't block merges | husky + lint-staged: ESLint, ruff, Prettier and typecheck block the commit (`501ccc1`, Windows spawn fix `1dffe3f`) |
| 2026-10-31 | `activityService` (now `activityLogService`) had 66.7% line coverage | [activity-log.unit.test.js](../backend/tests/activity-log.unit.test.js); now 100% (`ec0a26f`) |
| 2026-10-31 | **Lead conversion bypassed both stage rules:** `POST /leads/:id/convert` called `Deal.create` directly, so any `stageKey` (another org's included) was stored and converting into `won`/`lost` left the deal open. It also wasn't atomic: a failed lead write left an orphan deal, and two parallel converts made two deals | the deal now comes from `dealsService.create`, and everything runs in one MongoDB transaction with a conditional lead update (`18bc2a6`; replica-set infra `2fd6b12`) |
| 2026-10-30 | **Creating a deal directly in `won` or `lost` skipped the close:** `POST /deals` stored the stage but not `status`/`closedAt`, and didn't log or notify like move-stage | the close logic moved into one helper, `applyStageTransition`, called by both `moveStage` and `create` (`b0cdd6a`) |
| 2026-10-30 | **`stageKey` was only validated by move-stage:** `POST` accepted any string (including another org's key), and `PATCH` could change the stage while skipping move-stage's status, `closedAt`, log and notification | `dealsService.create` checks the key against the requesting org's stages and defaults to its first stage by order; `update` refuses `stageKey`; move-stage returns `VALIDATION_ERROR` (`8581e26`) |
| 2026-10-30 | **List filters were silently dropped** for leads, deals, contacts, companies, notes and notifications: the shared non-strict `paginationQuery` stripped every filter key before the service saw it, so the Leads status filter did nothing and NotesPanel listed every note in the org | strict per-resource `listQuery()` specs; unknown keys, bad values, `$` operators, repeated keys and bad sorts are 400 (`83b0e08`, UI contract `20d2f49`) |
| 2026-10-30 | **Failed saves on Leads and Pipeline showed nothing** (unhandled rejections from `mutateAsync`; convert and delete had no error UI) | `useMutationError` + `ErrorAlert`, status-aware messages, a resync and a no-double-move retry after a partial Pipeline save (`9c445a9`) |
| 2026-10-30 | **Pipeline stages were hardcoded on the frontend** (`PIPELINE_STAGE_DEFAULTS` in Pipeline and Dashboard, not the org's stages) | `usePipelineStages()` reads the org's stages in `order`; the defaults now live only in the backend (`93f1cf9`) |
| 2026-10-30 | An unhandled MSW request only logged (and Vitest hides passing tests' logs), so 7 tests ran without a handler and stayed green | unhandled requests now fail the test in [setup.js](../frontend/tests/setup.js) (`5d226fe`) |
| 2026-10-30 | An admin could still grant admin by inviting someone with `role: 'admin'` | `inviteMember` applies `assertCanAssign` (`4ac76ec`) |
| 2026-10-30 | Settings → Members offered role/remove controls on your own row and, to admins, on peer admins (with "Admin" as an option) | UI mirror `canManageMember` / `manageableRoles` in [constants.js](../frontend/src/lib/constants.js) (`714d587`) |
| 2026-10-30 | A refused (403) role change or removal failed silently in the UI | shared [ErrorAlert.jsx](../frontend/src/components/ErrorAlert.jsx) (`714d587`) |
| 2026-10-30 | The frontend had no component tests, no e2e test and no typecheck | Vitest + Testing Library + MSW, Playwright, `tsc` opt-in (S1.3) |
| 2026-10-30 | Deleting an unknown team or email template id returned 200 (was a pinned suspect) | 404 in the same atomic write, `fix/s1.1b-suspects` (`1f35fdc`) |
| 2026-10-30 | An admin could demote or remove a peer admin, grant admin, or change or remove their own account (was a pinned suspect) | owner-only admin management, no self actions; [membership.js](../backend/src/policies/membership.js) (`85dc27e`) |
| 2026-10-30 | `activitiesService.list` had 40.9% line coverage | [activities-list.test.js](../backend/tests/activities-list.test.js); now 100% |
| 2026-10-29 | Auth, org admin and dashboards had no permanent tests (Known Gap #8) | [auth.test.js](../backend/tests/auth.test.js), [org-admin.test.js](../backend/tests/org-admin.test.js), [insights.test.js](../backend/tests/insights.test.js) |
| 2026-10-29 | Convert and move-stage crashed with a 500 when the org document was missing | 404, found by `tsc` strict null checks (`441a448`) |
| 2026-10-29 | Members could change anyone's records ("own records only" not enforced, Known Gap #1) | [ownership.js](../backend/src/policies/ownership.js) (`dacde27`) |
