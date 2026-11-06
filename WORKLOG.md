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

---

## 2026-11-07 · Doc drift fixes from the portfolio review

**Goal:** fix the doc drift the review found: line-number references that went stale, coverage numbers that differed
between files, and a README with no clear reading order or account of how the repo was built.

**Changed** (one docs PR)
- CLAUDE.md §7.5: the dev-only token logging is cited as `forgotPassword` and `inviteMember`, not `authService.js:219`
  / `orgAdminService.js:83` (on `main` the second had drifted to 85; the refresh reuse-detection branch moves the
  first to 302). These were the only file:line references in CLAUDE.md,
  docs/, bench/, the README and this file.
- Coverage: the README badges are the one source. docs/ci.md names the run they come from and how to update them;
  CLAUDE.md §6 links there instead of repeating the numbers. Entries above keep the numbers measured at the time.
- README: "Start here" (four docs) and a draft "How I built this" for the owner to reword.

**Verified:** CI run 42119535410 on `main` after #54 (2026-11-05), `backend` job: `src/services` 99.77% lines, 88.85%
branches, the numbers the badges already showed; the entry above (99.75%, 89.36%) predates it. Every relative link in
CLAUDE.md and the README resolves; `npm run format:check` clean.

**Next:** the owner rewords "How I built this"; update the badges and the run link in docs/ci.md when the refresh
reuse-detection branch lands.
