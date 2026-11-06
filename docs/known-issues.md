# Known issues

Everything known to be wrong, missing or unverified that isn't a top-level gap in [CLAUDE.md](../CLAUDE.md) §9,
plus a record of what has been resolved. Newest resolutions first.

## Open findings (verified 2026-10-29, updated 2026-11-03; GitHub issue numbers in brackets)
- **After a password reset, a tab that is already open keeps working for up to 15 minutes.** The reset revokes every
  refresh token, but an access token already in a tab's memory stays valid until it expires (same as role changes, §5).
  The next refresh or reload signs the tab out (the e2e checks this).
- **Marking a notification read from the bell panel fails silently.** The panel closes on click, so there's nowhere to
  show the error; the dot just stays. The only mutation without error UI (S1.7 audit).
- **Search sorts every text match in memory** (S1.9): the org-prefixed text index finds the matches, then they are
  sorted by date (4,258 for "sharma" at 100k leads, 15 ms). Fine now; at 10x data see "At 10x" in
  [bench/sde1-baseline.md](../bench/sde1-baseline.md) (relevance order or Atlas Search).
- **The Dashboard's counts and sums walk every index key of the org** (S1.9: covered, no documents read, 46 ms p95 at
  100k leads). They grow linearly; running totals per org would make them constant.
- **[#18] The `won`/`lost` stage keys are hardcoded** (`CLOSING_KEYS` in [dealsService.js](../backend/src/services/dealsService.js);
  closing a deal is keyed on them). An org that renames its closing stages' *keys* never closes a deal. Open for S2.7.
- **[#19] Pipeline save is two calls (move-stage, then update), not atomic;** revisit with a single endpoint or transaction in
  S2.7. (S1.3b made the UI resync after a partial failure, and a retry doesn't repeat the move.)
- **A hard load of a demo route with a parameter answers HTTP 404** (`/AI-CRM/leads/<id>`, `/AI-CRM/invite/<token>`).
  GitHub Pages has no rewrites, so only a file can answer 200; the demo build writes one per route without a
  parameter ([pages-routes.mjs](../frontend/scripts/pages-routes.mjs)), and these fall through to `404.html`, which
  is the app and loads normally. Only crawlers and link previews see the 404. The Docker build (nginx) is unaffected.
- **[#27] The Dashboard sums deals in mixed currencies without conversion.** Totals are formatted in the org's currency
  (S1.8-GH), but a deal created in another currency is added at face value. No exchange rates yet.

- **The `/api` rate limiter counts per API process** (express-rate-limit's MemoryStore). Compose runs one api; with
  N replicas a client gets up to N times `RATE_LIMIT_MAX`. A MongoDB store was built and measured in S2.1 (#58): it
  added 14–27% to the filtered lead list's p95, over the 10% allowed, so it was not kept. A shared store waits for
  Redis (S2.5). The AI limits are shared (in MongoDB, [docs/ai.md](ai.md#the-job-queue)).
- **A stack with no worker leaves briefs queued.** The API only queues; if no `worker` runs (an old compose file, a
  worker crash loop), jobs stay `queued` and the card keeps polling every 5 s. The owners' `GET /ai/queue/stats`
  shows it (the oldest queued job's age); alerting on it is S2.6.
- **The brief is polled, not pushed:** a fake brief usually shows on the first poll (1 s); a slow one costs a
  request per 5 s per open card. A push (SSE) would remove both.
- **At the AI limit, two concurrent requests can both be refused** (insert, then count): the safe direction; neither
  is let through over the limit.
- **Mongoose warns that `new: true` is deprecated** (`returnDocument: 'after'`): the job service uses the new option;
  the older services (crud, orgAdmin, notifications) still pass `new`. Harmless until a Mongoose major.
- **Output checks catch contact details, links and invented citations, not a subtly wrong summary.** A note that
  misleads (a false "budget approved") yields a confident, cited, wrong brief. The draft is for a person to review,
  never sent by the app; the evals measure the rest ([docs/ai.md](ai.md#threat-model)).
- **The company's website is rep-typed.** `Company.domain` is the one link a brief may contain, and anyone with CRM
  write access sets it: someone who can edit a company can make any domain allowed for its leads' briefs. Express
  sends it only if it is a real host name ([aiBriefService.js](../backend/src/services/aiBriefService.js)).
- **The link check still misses some hosts** ([validate.py](../AI/app/lead_brief/validate.py)): a two-label host on
  an English-word TLD with no path (`pay.so`, `desk.to`) or on a TLD not on the list is not a link to it, the price
  of not flagging "done.It". The model's own resistance covers these; the eval's `email_on_task` measures it. In the
  other direction, a missing space after a full stop in a non-Latin script (`Привет.Как`) reads as an IDN and costs
  a retry; briefs are written in English, so this should be rare.
- **The ESLint toolchain has one moderate advisory, dev only** (#30): minimatch ReDoS, GHSA-g3hv-75wg-m249, under
  `eslint` 10.14 (backend 7 findings, frontend 4, all the same chain). Nothing shipped is affected: `npm audit
  --omit=dev` is clean in both. npm's only fixes are majors (eslint back to 9, `eslint-plugin-jsdoc` to 64), so they
  wait for a separate low-priority PR; until then the risk is a slow lint on a hostile glob, on a dev machine or in CI.

### Lint disables (S1.7 audit)
- No `react-hooks` rule is disabled anywhere in the frontend (the one in `GlobalSearch` was #12).
- Three `react-refresh/only-export-components` disables remain, in `FormField.jsx` (`inputClasses`), `SessionContext.jsx`
  (`useSession`) and `NotificationsPanel.jsx`. They only cost Fast Refresh a full reload of those modules; no bug hides
  behind them. Left as they are.

## Open questions
- What exactly happens if a token lacked `orgId`? Mongoose likely casts it to `null` and matches nothing. (A token whose
  org *document* is gone gets a 404; see [missing-org.test.js](../backend/tests/missing-org.test.js).) Not tested.

## Resolved
| Date | Issue | Fix |
|---|---|---|
| 2026-11-07 | **The AI brief's limits and single-flight lived in the API process** (two Maps and an in-flight promise table): each replica had its own, and a slow brief held an HTTP request open for up to 90 s | the brief is a job in MongoDB, run by separate worker processes: a partial unique index is the single-flight, the limits are rows counted on `at`, and every claim, lease, retry and shutdown path is tested, including a real worker killed mid-job (#58) |
| 2026-11-06 | **Every demo deep link answered HTTP 404** (`/AI-CRM/login`, `/AI-CRM/deals`): Pages served `404.html`, which is the app, so it loaded, but crawlers and link previews saw a 404 | the demo build writes a copy of `index.html` per route without a parameter, which Pages serves with 200; a test keeps the list in step with `App.jsx`, and the demo e2e checks both statuses (#39) |
| 2026-11-06 | **A link stated plainly in a note was allowed in the email** (the check allowed any link the history held) | links only from the company's website (`Company.domain`, or an ASCII subdomain), never from history text; hosts compared lower case, without a trailing dot and as punycode, so Cyrillic look-alikes, IDNs and `user@host` don't match; prompt `lead-brief/2` (#36) |
| 2026-11-05 | **The AI layer was stubs** (RAG, chat, chains; LangChain, Gemini and OpenAI dependencies nobody used) | the lead brief end to end on free providers (fake, local Ollama): prompt v1, validation and one retry, cache, single-flight, limits, kill switch, evals, the card ([docs/ai.md](ai.md)); the stubs are gone (`c148568` to `b5235c7`) |
| 2026-11-05 | **The link check missed bare domains** (`secure-pay-update.net`, `bit.ly/x`), and a link passed if it was any substring of the history, so a defanged `hxxps://` link in a note licensed its re-fanged form | bare domains on a TLD list (English-word TLDs only with a hyphen, three labels or a path); a link passes only if the history holds the same link; eval case `injection-bare-domain` (`b498281`) |
| 2026-11-05 | **A brief that needed its retry could hit Express's time limit** (per attempt in the AI service, per request in Express) | Express sends `X-Deadline-Ms`; each attempt gets at most the time left, and the retry is skipped as `BAD_OUTPUT` unless the time left is 1.2x the first attempt (`a1d6422`, `eb055d7`) |
| 2026-11-05 | **`AI_TIMEOUT_MS` (60 s) was a placeholder** | 90 s from the first local eval: `llama3.2:3b` p95 52,277 ms, slowest 56,331 ms ([docs/ai.md](ai.md#results)) |
| 2026-11-05 | **Deleting a lead left its rows behind** (there was no lead cleanup) | `leadsService.remove` deletes the lead and its cached AI briefs in one transaction (`6a28d31`) |
| 2026-11-03 | **The production bundle was one 613 kB chunk** (Vite warned on every build) | pages are lazy chunks, libraries in their own chunks, framer-motion replaced by CSS, form libraries only with a form: initial JS 342 kB (110 kB gzip), and CI fails above [bundle-budget.json](../frontend/bundle-budget.json) (`2bec34b`, `0dcaefb`, `5c0d4ed`, `e717ad4`; [bench/frontend.md](../bench/frontend.md)) |
| 2026-11-03 | **Lead and deal lists sorted the whole org in memory and counted it on every page** (332 ms p95 at 100k leads) | ESR compound indexes, cursor pagination, lean reads: 28 ms (`00eeef7`, `eff3d03`, `b108810`; [bench/sde1-baseline.md](../bench/sde1-baseline.md)) |
| 2026-11-03 | **Text search was not scoped to the org's index entries** (the text indexes had no `orgId` prefix) | `{orgId, …text}` indexes (`4435355`); `node scripts/sync-indexes.js --apply` for an existing database (`1473c28`) |
| 2026-11-01 | **Deployment config disagreed with the docs** (CLAUDE.md gap 9.5): the root `vercel.json` declared the backend as a Vercel service, and its `"/api/(/.*)?"` rewrite never matched `/api/v1/...` | root `vercel.json` deleted (`bb1d8a5`), `frontend/vercel.json` too (`a479131`); there is no hosted backend, and the public demo is a static GitHub Pages build (S1.8-GH). [#26] (spoofed `X-Forwarded-For` on a direct Render origin) closed as not planned |
| 2026-11-01 | **The dev-only token logs would have run in production** | they run only when `NODE_ENV` isn't production (tested); invite links go back to the inviter while `EMAIL_ENABLED=false` (`23dcde0`) |
| 2026-11-01 | **Product name inconsistent:** "Nimbus CRM" in the readme, another name in the app shell, sign-in and the page title | Nimbus CRM everywhere (`2b8ebac`; the database name was already `nimbus-crm`) |
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
