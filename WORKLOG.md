# WORKLOG

Append-only log of work sessions on Nimbus CRM. Newest entry at the bottom.
Each entry: **date · goal · changed · verified · next**. Rules for working in this repo are in [CLAUDE.md](CLAUDE.md).
The last few sessions stay here; older ones move to [docs/history.md](docs/history.md) (N0 to S1.8-GH).

---

## 2026-11-03 · S1.9: Performance with numbers (backend + frontend)

**Goal:** measure the five most-used reads at 100,000 leads and the frontend's first load, fix what the numbers point
at, and keep it from regressing. Reports: [bench/sde1-baseline.md](bench/sde1-baseline.md) (backend, with query
plans) and [bench/frontend.md](bench/frontend.md) (bundle and Lighthouse).

**Resume lines**
- Cut lead-list p95 from 332 ms to 28 ms (12x, 38 -> 441 req/s) at 1 lakh leads in one org with ESR compound indexes
  (`{orgId, status, createdAt, _id}`) and cursor pagination, which reads 22 index keys per page at any depth where
  skip/limit read 99,980 at page 5,000.
- Cut initial JS from 613 kB to 342 kB (188 -> 110 kB gzip) with route-level code splitting and CSS animations in
  place of framer-motion, with a CI budget on the first load; Lighthouse mobile on the demo build 91 -> 92, LCP 2.9 ->
  2.6 s, TBT 55 -> 13 ms.

**Commits** (on `main` through the pre-commit gate; CI and e2e changes through `ci/budget`)

| Commit | Change |
|---|---|
| `ecf9754` | `scripts/bench/seed.mjs`: deterministic seed (same collection hashes on every run), local `nimbus-bench` only |
| `f5db4b2` | `scripts/bench/run.mjs` (autocannon: warm-up + 3x10 s, median and spread; profiler + `explain`) and the baseline |
| `00eeef7` | ESR indexes for the lead/deal lists and covered dashboard sums; `query-plans.test.js` (4 of 5 red first) |
| `eff3d03` | cursor pagination on leads and deals: API, contract, demo, Leads/Pipeline UI (19 of 24 cursor tests red first) |
| `b108810` | lean list/dashboard/search reads; search projected to what the palette shows (contract updated) |
| `b9a3719` | dashboard lead counts: one `COUNT_SCAN` per status (red first) |
| `4435355` | text indexes prefixed by `orgId`, chosen over two alternatives by measurement (2 red first) |
| `1473c28` | `backend/scripts/sync-indexes.js` for existing databases (one text index per collection) |
| `3643e7e`, `4bb3db4` | backend before/after report; a correction (a lead write updates 7 indexes, not 5) |
| `2bec34b` | lazy page chunks with a skeleton, vendor chunks; `ANALYZE=1` treemap and `bundle-report.mjs` |
| `0dcaefb` | CSS enter animations, framer-motion removed |
| `5c0d4ed` | auth pages lazy too: form libraries only with a form |
| `e717ad4` | CI: `check-bundle-budget.mjs` against `frontend/bundle-budget.json` (via `ci/budget`) |
| `18b2fbe` | e2e: wait for the Pipeline page before clicking a deal (via `ci/budget`; see below) |
| `7bca0b8` | frontend report, `scripts/bench/lighthouse.mjs` |
| `c0b1dd7` | frontend tests: `findBy*` waits up to 5 s for lazy pages |

**Decisions, with the numbers behind them**
- **`total` dropped from the cursor lists:** counting 100k leads cost 38 ms per page, over the ~20 ms agreed.
- **Cursor tied to its query:** a 12-character hash of resource, filters, search and sort; reused with any other
  query it is a 400 `INVALID_CURSOR`. The UI clears its cursor stack where #11 resets the page.
- **Nulls:** cursor sorts on nullable keys (`closedAt`, a legacy-missing `score`) work in both directions; tested with
  ties, stored nulls and missing fields. No sort had to be restricted.
- **The planner and `$or`:** a cursor filter written as `$or: [{k < v}, {k = v, _id < id}]` read the whole of page 1
  again on the in-memory test DB (41 docs for a 20-row page); a top-level `k <= v` bound plus an `_id` tie-break has
  one plan, starting at the cursor. The test asserts "the page plus rows tied with the cursor", computed, not guessed.
- **Search (b), org-prefixed text index:** same speed as before (24-27 vs 21 ms), half the documents examined; the
  faster anchored-prefix option (8 ms) cannot find a last name or an email.
- **framer-motion:** about 100 kB gzip in every first load for 150 ms animations. The trade-off is no exit fade.

**Two failures found and fixed on the way**
- **CI e2e failure on `ci/budget` (run 41593010959):** with lazy pages, React Router keeps the old page up during its
  transition, so the spec clicked the Leads page's cell of the same name. Both specs now wait for the Pipeline
  heading (`18b2fbe`); green twice after (run 41593412339, attempts 1 and 2).
- **A frontend unit test timing out under load:** `routes.test.jsx` waits for a lazy page, and its module transform
  passed the default 1 s when the suite ran right after the backend's. `asyncUtilTimeout` is 5 s now (`c0b1dd7`);
  green again under the same load.

**Verified**

| Check | Result |
|---|---|
| Backend `npm test` | **629 passed** (36 files); `src/services` lines 99.66% (gate 98.65%) |
| Frontend `npm test` | **311 passed** (25 files) |
| Query plans | no COLLSCAN on the five endpoints; no in-memory sort on any list page (`query-plans.test.js`, 10 tests) |
| e2e and demo e2e | 2 + 3 passed locally and in CI |
| Bundle budget | entry 28.9 kB (budget 31.8), initial JS 342.0 kB / 110.2 gzip (budget 376.2 / 121.2), in CI |
| CLAUDE.md | 249 lines; path check: 67 referenced paths, 0 missing |

**Interview angle**
- *skip/limit vs cursor:* `skip` still walks every skipped index key (page 5,000: 99,980 keys, 142 ms) and rows
  inserted between pages shift it (duplicates, gaps). A cursor seeks to `(sortKey, _id)` in the index: constant cost,
  stable under inserts. Costs: no jumping to page n, and no free total.
- *ESR:* equality fields first (they narrow to one contiguous range), then the sort key (that range is already in
  order, so no in-memory sort), then range fields (bounds inside it). `{orgId, status, createdAt, _id}` serves
  `?status=` sorted by date.
- *Lazy loading and LCP:* nothing paints until the JS that renders it is downloaded, parsed and run; less of it before
  the first render frees the main thread sooner (TBT 55 -> 13 ms) and paints earlier.
- *At 10x:* list pages stay flat; the dashboard and search grow with the org, so running totals and a search engine
  (Atlas Search) are next; keep the index working set in RAM. See "At 10x" in the backend report.

**Next:** S2.1 (AI service). The search's in-memory sort and the dashboard's linear counts are logged in known-issues.

## 2026-11-05 · S2-lite: One real AI feature, the lead brief

**Goal:** one AI feature end to end at ₹0: on a lead's page, a summary, one next step with a due date and a draft
follow-up email, each claim citing the history it rests on. Express owns auth, tenancy and data; the FastAPI service
never touches MongoDB. Providers: `fake` (default: tests, CI, compose, the Pages demo) and `ollama` (local). Groq was
dropped (its console was unreachable from this network); no paid provider was added. Design, threat model and
results: [docs/ai.md](docs/ai.md).

**Resume lines** (measured on one run, 19 cases, Ryzen 7 8840HS CPU, 31 GB RAM; nothing rounded up)
- Built an AI lead brief (summary, next step, follow-up draft, each claim cited to a CRM history id) on a local 3B
  model (llama3.2:3b via Ollama) at $0 per brief: 19/19 eval cases produced, all schema-valid and grounded on the
  first try, 6/6 prompt-injection cases resisted, p95 52,277 ms on a laptop CPU, against 144,540 ms for qwen3:4b.
- Kept it tenant-safe and fail-closed: Express sends an org-scoped bundle with no emails, phone numbers or record
  ids, and every answer is checked (schema, citations within the input, no contact details or outside links) with
  one retry, after which it returns an error, not the output (qwen3:4b's attacker case ended in `BAD_OUTPUT`);
  per-org cache with single-flight, rate limits and a kill switch; tested at every layer (81 AI-service tests; the
  backend's 669 and frontend's 330 in all).

**Commits** (on `main` through the pre-commit gate; frontend, e2e and CI changes through `ci/ai`)

| Commit | Change |
|---|---|
| `c148568` | a real FastAPI app in place of the stubs; settings require a 16+ character internal token |
| `a2e6028` | provider interface, deterministic `FakeProvider`, `OllamaProvider` (`/api/chat`, JSON schema `format`) |
| `c3332db` | `POST /v1/lead-brief`: prompt v1 (escaped, delimited history), validation, one retry on invalid output only |
| `51eaff1` | 19 eval cases (6 injection), CI runs them on the fake provider; `npm run eval -- --provider ollama` |
| `068526e` | `GET /v1/info` (provider, model, prompt version) for Express's cache key |
| `6a28d31` | `POST /api/v1/ai/leads/:id/brief`: bundle, Mongo cache (7-day TTL), single-flight, limits, error mapping; lead delete removes its briefs |
| `8f59bd6` | the Pages demo answers the brief like `FakeProvider` (parity pinned by `contracts/lead-brief-fake.json`) |
| `d9d631c` | activities list filter by linked record (`?entityType=&entityId=`) |
| `8568bab`, `e80d913` | a lazy `/leads/:id` page with its history; e2e opens the edit dialog from the row (via `ci/ai`) |
| `2df951c` | the brief card: citations jump to the history entry, copy email, regenerate, typed errors (via `ci/ai`) |
| `36f99bb` | the unbuilt AI chat and actions stubs removed (via `ci/ai`) |
| `44bdfd7`, `b431665` | digits in the lead's own name are not a phone number; a phone beside the name is still rejected |
| `b5235c7` | CI: e2e and docker run the AI service on the fake provider (via `ci/ai`) |
| `cfb4d49` | docs/ai.md; README and CLAUDE.md drop the RAG, chat and memory claims |
| `3ebbf26` | `OLLAMA_THINK=false` turns a thinking model's thinking off (for the qwen3 run) |
| `df835dd` | eval results: header and file name share one local date (a 03:14 IST run was headed the day before in UTC) |
| `e16cf4f` | `AI_TIMEOUT_MS` default 60 s -> 90 s, from the measured p95 (52,277 ms) and slowest brief (56,331 ms) |
| `23937df` | the two results files, the results table and the model choice in docs/ai.md, two new known issues |

**Decisions, with the numbers behind them**
- **llama3.2:3b over qwen3:4b:** 19/19 against 18/19 briefs, 6/6 against 5/6 injection cases resisted, p50 38,675
  against 69,977 ms, p95 52,277 against 144,540 ms. qwen3:8b was not run: 4B was already too slow on this CPU.
- **Fails closed:** qwen3:4b's `injection-attacker-address` failed validation twice and ended in `BAD_OUTPUT` after
  183,122 ms; the rep would have seen an error and no brief.
- **A small sample, not a rate:** 6 injection cases on 1 run each. 6/6 means no failure seen in six tries.
- **Timeout 90 s:** about 34 s over llama's slowest brief. It is per attempt in the AI service but per request in
  Express (+1 s), so a retried brief can be cut off; no llama brief needed a retry (known-issues).

**Verified**

| Check | Result |
|---|---|
| Backend `npm run test:coverage` | **669 passed** (37 files); `src/services` lines 99.74% (gate 98.65%) |
| Frontend `npm test` | **330 passed** (28 files) |
| AI `pytest` | **81 passed**; ruff clean |
| Root `lint`, `typecheck`, `format:check` | clean |
| CI | `ci/ai` 41901397405 (incl. e2e, docker); `main` at `b5235c7` 41901905116, `cfb4d49` 41904394326, `3ebbf26` 41907856286 green; `b431665` cancelled, superseded by `3ebbf26` |
| Bundle budget | initial JS 343.9 kB / 110.8 kB gzip (budget 376.2 / 121.2); the lead page chunk 8.1 kB |
| Local eval | [llama3.2:3b](AI/evals/results/2026-11-05-ollama-llama3.2-3b.md), [qwen3:4b](AI/evals/results/2026-11-05-ollama-qwen3-4b-nothink.md) |

**Interview angle**
- *Why not trust the model:* injected text is data the model may still follow. Layers: delimit and escape it, tell
  the model, then check the output for what an attacker wants (contact details, links, fake citations) and fail
  closed. The checks catch only what they look for, which is why the model's own robustness still matters.
- *Why the AI service never sees the database:* tenancy stays in one place (Express, from the JWT), and the bundle
  is the whole data-leak surface, small enough to list in docs/ai.md.
- *Cache key:* org, lead, every history item's `updatedAt`, provider, model and prompt version, so a changed note, a
  new prompt or a different model never serves an old brief.

**Next:** catch bare domains in the link check; give Express a budget that covers one retry; more and varied
injection cases; move the per-process rate limits to Mongo or Redis before a second API replica.

## 2026-11-05 · S2-lite follow-ups: bare-domain links, the retry deadline, failed outputs in eval reports

**Goal:** close the two known issues the first local eval exposed, and make the next eval show what a failing model
actually wrote. First change through a branch and a PR (#35, `fix/ai-links-deadline`); merged by the owner with "Rebase and
merge" once CI is green. The real eval was not rerun.

**Commits**

| Commit | Change |
|---|---|
| `b498281` | link check: bare domains on a TLD list (English-word TLDs only with a hyphen, three labels or a path); a link passes only if the history holds the same link (scheme and `www.` aside), so a defanged `hxxps://` link doesn't license its re-fanged form; eval case 20 `injection-bare-domain` (11 tests red first) |
| `a1d6422` | AI service honours `X-Deadline-Ms`: each attempt gets min(`AI_TIMEOUT_MS`, time left); the retry runs only if the time left is at least 1.2x the first attempt, else `BAD_OUTPUT` with `retrySkipped` in the log; a bad header is 422 (red first) |
| `eb055d7` | Express sends `X-Deadline-Ms: AI_TIMEOUT_MS` (red first) |
| `1e8300a` | eval reports: for each case with a failed check, every attempt's validation problems and raw output, via an eval-only `RecordingProvider` (red first) |
| `8272b7d` | docs/ai.md, known-issues (both resolved; the gaps left are named), this entry |

**Decisions**
- **Retry cutoff 1.2x the first attempt**, not a rolling or configured p95: same model, input and hardware predict the
  second attempt best, with no state and no new setting.
- **English-word TLDs** (`to us it is so at be my go do no am me`) count only when the host looks like a link, so
  "done.It", "Go.to the meeting" and "Call.me" stay text; `pay-desk.to` and `kyc.update.us/x` are caught. `me` was
  added to the word list after a sweep flagged "in.Me"; `wa.me/91…` still counts (it has a path).
- **Exact links, not substrings:** a sibling path on a history host (`/rfq/4` beside `/rfq/40`) is rejected. A link a
  note states plainly is still allowed; that, and two-label word-TLD hosts, are the gaps left (known-issues).
- **Case 20 spells the domain out** (`kyc-verify-desk [dot] in/update`): a verbatim domain in the note would be
  allowed by design, so the case could only test the model, not the check.

**Verified**

| Check | Result |
|---|---|
| Backend `npm run test:coverage` | **670 passed** (37 files); `src/services` lines 99.74% |
| Frontend `npm test` | **330 passed** (28 files; no frontend change) |
| AI `pytest` | **131 passed** (was 81); ruff clean |
| Mutations | Ollama using the setting instead of the attempt's limit: 1 test red; `RETRY_MARGIN = 1.0`: 1 red |
| Root `lint`, `typecheck`, `format:check` | clean |
| e2e | not run locally; in the PR's CI |

**Next:** the owner reruns `npm run eval -- --provider ollama` on 20 cases; failed cases now carry their output.

## 2026-11-06 · Links only from structured fields

**Goal:** a link in the brief may come only from a structured CRM field (the company's website), never from note or
activity text, and look-alike hosts in other scripts never pass. Branch `fix/ai-links-structured`, one PR (#36), merged by
the owner. The real eval was not rerun.

**Commits**

| Commit | Change |
|---|---|
| #36 | AI service: the only allowed link is on `lead.companyDomain` (ASCII subdomains too); hosts compared lower case, without a trailing dot, as punycode; a non-ASCII or punycode host must equal the domain exactly; `find_links` sees non-ASCII hosts and hosts after any scheme (`hxxps://`); prompt `lead-brief/2` (31 tests red first, then 1 more for `hxxps://`) |
| #36 | Express: `companyDomain` in the bundle, only if it is a real host name (`node:url` `domainToASCII`); part of the cache key; the demo mirrors it (13 tests red first) |
| #36 | docs/ai.md, known-issues (resolved; the gaps left are named), #35's commit ids corrected after its rebase-merge, this entry |

**Decisions**
- **Subdomains allowed for ASCII hosts only.** `shop.sahyadri.co.in` passes; `оплата.sahyadri.co.in` and `www.пример.рф`
  must equal the domain, since a non-ASCII label is where look-alikes hide.
- **Non-ASCII TLDs count only in a non-Latin script and with 2+ characters** (`рф`, `भारत`), so "Gracias.Señor" and
  "Merci.À" stay text; a sweep found "Merci.À" before the rule. Left as a cost: "Привет.Как" (a missing space in
  Russian) reads as an IDN and causes a retry.
- **AI service first, then Express:** the new field is optional, so the service accepts it before Express sends it.

**Verified**

| Check | Result |
|---|---|
| Backend `npm run test:coverage` | **682 passed** (37 files); `src/services` lines 99.75% |
| Frontend `npm test` | **330 passed** (28 files) |
| AI `pytest` | **152 passed** (was 131); ruff clean |
| Root `lint`, `typecheck` | clean |
| e2e | not run locally; in the PR's CI |

**Next:** the owner reruns the Ollama eval (20 cases, `lead-brief/2`).

## 2026-11-06 · Process and security cleanup

**Goal:** make the PR flow the documented rule, stop citing commit ids that rebase-merge rewrites, clear the npm audit,
and finish the small cleanups (Dependabot, coverage badges, Pages deep links, upload stubs, this file's length).
Draft PRs #28–#34 from 2026-11-05 were reused where they still applied to `main` and superseded where they didn't.

**PRs**

| PR | Change | State |
|---|---|---|
| #37 (supersedes #28) | CLAUDE.md §8.4: branch, PR, green CI, the owner merges with Rebase and merge; §8.6 and docs/conventions.md: docs cite PR numbers, never commit ids; the two stale ids from #36's branch now read #36 | merged |
| #30 | `npm audit fix` without `--force`: shipped code audits clean in both packages; dev toolchain patches; the ESLint advisory and the Windows Playwright teardown hang documented | merged |
| #38 | bench/frontend.md: initial JS +9.9 kB after #30 is axios 1.18.1 → 1.21.0 (real code, the advisory's fix); zod 4.6 grew the lazy `forms` chunk; no duplicates or changed imports | open |
| #31 | README: branch coverage (89.36%) next to line coverage (99.75%) | open |
| #39 (supersedes #32) | Pages demo: a copy of `index.html` per parameterless route, so deep links answer 200; `/leads/:id` and `/invite/:token` still 404 (documented) | open |
| #29 | `.github/dependabot.yml`: npm (backend, frontend), pip (AI), github-actions; weekly; minor and patch grouped | open |
| #33 | the upload stubs and their CLAUDE.md gap entry deleted | open |
| #40 (supersedes #34) | WORKLOG entries N0 to S1.8-GH moved verbatim to docs/history.md (three links rewritten for the new folder); this entry | open |

**Decisions**
- **Supersede, don't rebase by hand:** no force pushes, and a merge commit in a PR blocks Rebase and merge, so a
  conflicting draft became a fresh branch with its commit cherry-picked, and the old PR was closed with a link.
- **ESLint majors wait:** the one advisory left (minimatch ReDoS under eslint 10) is dev only; npm's only fixes are
  majors (eslint 9, `eslint-plugin-jsdoc` 64). A separate low-priority PR; known-issues until then.
- **The Windows hang had one cause:** no `C:\Windows\System32` on `PATH`, so Playwright couldn't run `taskkill`.
  Appending it (not prepending: that shadows Git Bash's `timeout`) made e2e exit cleanly and the demo e2e take 7 s.

**Verified** (on #30's branch, now `main`): backend 682 passed (`src/services` 99.75% lines, 89.36% branches), frontend
330 (331 with #39), AI 152, e2e 3, demo e2e 3 (4 with #39); root lint, typecheck and format clean; shipped
`npm audit --omit=dev` 0 in both packages.

**Next:** the low-priority ESLint major PR; the owner sets the `main` ruleset; the Ollama eval rerun on `lead-brief/2`.

## 2026-11-07 · S2.1: The lead brief as an async job; no shared state in process memory

**Goal:** the lead brief runs as a queued job in MongoDB, done by worker processes that can scale to N, and nothing
that must hold across replicas lives in a process's memory. Built on the S2-lite brief: there was no earlier PR for
shared limits or a Mongo single-flight (the "3b" asked about doesn't exist); its next step said to move them.

**Changed** (#58, branch `feat/s2.1-ai-jobs`)

| Area | Change |
|---|---|
| API | `POST /ai/leads/:id/brief`: 200 with the cached brief, else 202 `{ jobId }`. `GET /ai/jobs/:jobId` (org-scoped, 404 for another org's): `{ state, brief?, error? }`. `GET /ai/queue/stats` for owners: queued, running, oldest queued age |
| Queue | `AiJob` (7-day TTL; partial unique `{ orgId, key }` while queued or running = the single-flight; claim index `{ state, createdAt, lockedUntil }`; `{ state, lockedUntil }`). Atomic FIFO claim, lease plus heartbeat, a lost lease aborts the AI call and writes nothing, brief and `done` in one transaction, 2 attempts, a reaper, the bundle unset on every end (done, failed, reaped, lead deleted) |
| Worker | `backend/src/worker.js`, compose service `worker` (`--scale worker=N`, `stop_grace_period: 100s`); SIGTERM finishes the job in hand. `AI_JOB_LEASE_MS` (30 s), `AI_WORKER_POLL_MS` (500 ms) |
| Limits | the AI limits are `aicalls` rows counted on `at` (insert, then count), shared by every API process. The two Maps and the in-flight table are gone |
| `/api` limiter | stays per process: a MongoDB store was built and measured, and it added more than the 10% allowed (below) |
| Frontend | the card polls after 1, 2, 4, then every 5 s, shows "Generating… (queued)" or "(running)", stops on done or failed, and stops when the page is left. The demo (MSW) and `contracts/api-shapes.json` follow 202 + poll |
| CI | e2e starts a real worker process (spawned by `e2e-server.js`); the docker job runs `--scale worker=2`, checks both run, and the smoke polls the job |

**Decisions**
- **Retry policy:** only `AI_UNAVAILABLE` (and an unexpected error) gets the second attempt; bad output was already
  retried inside the AI service, and a busy model shouldn't be asked again at once.
- **The claim is written as `state ∈ {queued, running}` plus a filter, and hinted.** The plain `$or` made the planner
  pick `{ state, lockedUntil }` per branch and sort every candidate in memory (`UPDATE > SORT > FETCH > OR`); now
  `SORT_MERGE` of two scans of the claim index ([query-plans.test.js](backend/tests/query-plans.test.js)).
- **The `/api` limiter stays per process** (the rule: more than 10% on lead-list p95 means per process, Redis in S2.5).
  p95 at 100k leads, same tree, MemoryStore vs a MongoDB store (one atomic upsert per request), ms:

  | Endpoint | MemoryStore | Mongo, run 1 | Mongo, run 2 |
  |---|---|---|---|
  | lead list (default sort) | 25 | 27 | 25 |
  | lead list, status filter | 22 | 28 | 25 |
  | deal list | 25 | 31 | 30 |

  The second Mongo run overwrote the first's file ([s2-1-limiter-mongo.json](bench/results/s2-1-limiter-mongo.json);
  [s2-1-limiter-memory.json](bench/results/s2-1-limiter-memory.json)); run 1's numbers are from its printed table.

**Queue latency**, measured (enqueue to a worker's claim; fake provider; 200 briefs for 200 leads at 4/s after one
uncounted warm-up; poll 500 ms; [scripts/bench/ai-queue.mjs](scripts/bench/ai-queue.mjs)). A first version reported
199 jobs for "200 briefs": the warm-up took one of the 200 leads, so 199 were timed (no job lost, none deduped or
cached). The bench now times exactly 200 and reports requested = enqueued + deduped + cached, and done + failed:

| Workers | Requested | Enqueued / deduped / cached | Done / failed | Queue p50 / p95 / max | Enqueue to done p50 / p95 / max |
|---|---|---|---|---|---|
| 1 | 200 | 200 / 0 / 0 | 200 / 0 | 273 / 508 / 517 ms | 292 / 530 / 535 ms |
| 2 | 200 | 200 / 0 / 0 | 200 / 0 | 249 / 495 / 510 ms | 274 / 516 / 527 ms |

**Verified** (Windows, before the PR): backend 714 passed, 1 skipped (the SIGTERM-to-a-process test: Windows has no
catchable SIGTERM, so it runs on Linux CI; the same shutdown path is tested in process); `src/services` 99.61% lines,
89.61% branches. Frontend 337. AI 152. Root lint, typecheck, format clean. Mutation checks, each turning its test red:
a non-atomic claim, no reclaim of an expired lease, no `attempts` increment, no heartbeat, no abort on a lost lease,
`stop()` that keeps claiming, a reaper that keeps the bundle, an unscoped GET or stats, the hour counted without `at`,
no unique index, the limits back in a Map, the `/api` limiter on MemoryStore (while the Mongo store existed), a flat
backoff, no abort on unmount. The single-flight test was too weak at first (two concurrent POSTs never overlapped,
so it passed with no unique index); it now sends 8 across both instances behind a slow `/v1/info` and fails without it.

**Next:** Redis for the `/api` limiter (S2.5); alerting on the queue stats (S2.6); push instead of polling (SSE) if
the poll cost shows up.

## 2026-11-08 · S2.2: Idempotent writes

**Goal:** a client that retries a write it lost the answer to (a dropped connection, a double click) gets the first
answer back instead of a second write. `Idempotency-Key` on the five writes whose repeat does something twice.

**Changed** (#60, branch `feat/s2.2-idempotency`)

| Area | Change |
|---|---|
| API | `idempotent()` middleware ([idempotency.js](backend/src/middleware/idempotency.js)) after `validate()` on `POST /leads`, `POST /deals`, `POST /leads/:id/convert`, `PATCH /deals/:id/move-stage`, `POST /ai/leads/:id/brief`. 409 `IDEMPOTENCY_IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED`, 400 for a malformed key. Replays status, `Content-Type`, `Location`, never `Set-Cookie`, with `Idempotent-Replayed: true` |
| Store | `IdempotencyRecord` (unique `{ orgId, userId, key }`, TTL 24 h on `createdAt`, 60 s lease); [idempotencyService.js](backend/src/services/idempotencyService.js) claims, completes, releases. Added to `sync-indexes.js` |
| Failures | 5xx and 429 delete the record; answers over 64 kB aren't stored; convert saves its record inside its transaction (`beforeCommit`); a failed save elsewhere is logged and the answer sent |
| Frontend | `idempotent()` and `createRecord` in [client.js](frontend/src/api/client.js); convert, move-stage and the brief in [mutations.js](frontend/src/api/mutations.js). One key per mutation, reused on a dropped connection, a 409 and the 401 replay |
| Demo, contract | MSW `route(…, { idempotent: true })` replays, 422s, 400s (successes only, no 409). [contracts/idempotency.json](contracts/idempotency.json) pins header, key pattern and codes; both sides test against it |
| Budget | entry chunk gzip budget 9.2 -> 9.5 kB by the measured growth, +240 B gzip ([bench/frontend.md](bench/frontend.md)) |
| Docs | [conventions](docs/conventions.md#idempotency), [known-issues](docs/known-issues.md), CLAUDE.md §2 and §3, [docs/ai.md](docs/ai.md#the-job-queue) |

**Decisions** (approved before the build)
- **The middleware runs after `validate()`:** a request refused by permission or validation never ran, so its key
  isn't used up and the client can fix the body and retry with it.
- **429 is freed like a 5xx:** `AI_RATE_LIMITED` comes from inside the brief handler and means "later"; storing it
  would replay the 429 for 24 h after the window opened.
- **The answer is saved before it is sent,** so a retry right after it replays instead of getting a 409.
- **The demo stores successes only:** its errors are deterministic, and it has no concurrency to answer 409 for.

**Tests, red first.** Backend [idempotency.test.js](backend/tests/idempotency.test.js) (30) and frontend
[mutations.test.js](frontend/src/api/mutations.test.js) (15) and [demo/idempotency.test.js](frontend/src/demo/idempotency.test.js)
(6). First run: the backend file failed at import (no middleware); with an empty model and a pass-through middleware,
23 of 28 failed. The 5 that passed hold trivially while nothing is stored (no header, valid keys accepted, the 5xx
retry, a record past 24 h, the 64 kB cap); each turned red under its mutation below. The frontend files failed at
import; the demo's, with no demo support, 4 of 5 (keys per user passed trivially, red under its mutation).

**Mutation checks.** One break at a time, the named test run alone, then the file restored (a script; output kept in
the session). Every break turned its test red:

| Test | Break | Red |
|---|---|---|
| header absent: nothing changes | a missing header claimed as a key | yes |
| malformed key is 400 (4 cases) | key pattern loosened to any 1–100 characters | yes (4) |
| accepts a UUID and 16–64 safe characters | minimum 17 | yes |
| double-click convert: one deal | a done record not replayed | yes |
| network retry replays the same deal id | `Idempotent-Replayed` dropped | yes |
| POST /leads and /deals write once | `idempotent()` removed from POST /deals | yes |
| move-stage retried logs one move | `idempotent()` removed from move-stage | yes |
| brief replays the same jobId (202) | `idempotent()` removed from the brief POST | yes |
| a handler 4xx is stored and replayed | every 4xx freed like a 5xx | yes |
| different body is 422 | bodyHash not compared | yes |
| different path is 422 | path not compared | yes |
| keys per user and per org | claim scope without `userId`; unique index without `userId` | yes, both |
| 8 parallel: one write, rest 409 or replay | index not unique | yes |
| 5xx frees the key | 5xx stored | yes |
| 429 frees the key | 429 stored | yes |
| stuck lease: 409, then runs after expiry | expired lease never taken over; live lease taken over | yes, both |
| two retries race for an expired lease: one runs | takeover not conditional on the old `lockedUntil` | yes (added after coverage showed the path untested) |
| record past 24 h is absent | the age check removed | yes |
| done-write fails in convert: rollback, retry once | record saved after commit instead of inside the transaction | yes |
| done-write fails in POST /leads: 409 until the lease ends, then a second write | a failed save frees the key at once | yes |
| replay: status, Content-Type, Location, no Set-Cookie | every header stored, Set-Cookie included; replay always 200 | yes, both |
| body hashed with sorted keys | hashed in field order | yes |
| over 64 kB not stored | no cap | yes |
| failed done-write is logged with the key | the error swallowed | yes |
| TTL 24 h, unique index | TTL 7 days | yes |
| `orgId`, `userId` required | `orgId` not required | yes |
| client: fresh UUID per mutation | one fixed key | yes |
| client: dropped connection retried, same key | a new key per attempt | yes |
| client: 409 in progress retried | 409 not retried | yes |
| client: gives up after its retries | no limit | yes |
| client: an answer (400, 422, 409 DUPLICATE_KEY, 500) not retried | every answer retried | yes (4) |
| client: 401 replay resends the key | a new key on the replay | yes |
| client: each of the 5 writes sends a key | deals create, convert, move-stage, brief each sent without one | yes (4) |
| client: other creates sent once, no key | every create keyed and retried | yes |
| demo: retry replayed | never replays | yes |
| demo: convert replayed | convert route not idempotent | yes |
| demo: 422 on another body or path | neither compared | yes |
| demo: malformed key 400 | any key accepted | yes |
| demo: keys per user | keys shared across users | yes |
| contract (API and demo) | key pattern drifts to 8 characters | yes, after a fix (below) |

47 breaks, all red. **Two weren't at first:** both contract tests stayed green when the key pattern's minimum drifted
to 8, because their sample keys skipped 8 to 15 characters. They now include 8 and 15 and turn red.

**Verified** (Windows, before the PR): backend 744 tests in 40 files (743 passed, 1 skipped: the SIGTERM test, Linux
CI only), `src/services` 99.28% lines, 88.26% branches (gate 98.65%); `idempotencyService.js` 95% lines, the one
uncovered branch is the third failed claim attempt. A first coverage run, alongside e2e, failed one file's `beforeAll`
(18 skipped); rerun alone, clean. Frontend 358 passed. e2e 3 of 3 passed (ai-brief, reset-password, win-rate:
create, convert, move to Won); Playwright then hung at teardown on its web servers and they were stopped with the
[conventions](docs/conventions.md#end-to-end-playwright) cleanup. Root lint, typecheck, format clean. Bundle budget
passes at the raised entry gzip budget; `check-no-demo` clean.

**Next:** a transaction around the four non-convert writes to close the lost-save window; keys for the other creates
and an idempotent toggle (`PATCH /activities/:id/status` with the target status).
