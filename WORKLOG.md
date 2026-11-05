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

---

## 2026-11-05 · Process and security cleanup (PRs from here on)

**Goal:** make the process match the docs (PRs instead of pushes to `main`), watch and fix the dependencies, show
branch coverage, make demo deep links answer 200, delete dead stubs, and shorten this file. One PR per item.

**Note:** the AI-service sessions (2026-11-05, `c148568` to `3ebbf26`) have no entry here; [docs/ai.md](docs/ai.md)
and the commit bodies record them.

**PRs** (each branched from `main`, none merged yet; merge with Rebase and merge)

| PR | Branch | Change |
|---|---|---|
| #28 | `docs/pr-workflow` | CLAUDE.md §8.4, CONTRIBUTING.md, docs/ci.md, ci.yml header: every change is a PR, 6 required checks, rebase merges; the ruleset settings are in the PR body |
| #29 | `chore/dependabot` | `.github/dependabot.yml`: npm (backend, frontend), pip (AI), github-actions; weekly, minor and patch grouped |
| #30 | `fix/npm-audit` | `npm audit fix` (no `--force`): axios, follow-redirects, react-router, body-parser, ip-address and 6 more fixed; `--omit=dev` audits clean |
| #31 | `docs/coverage-badges` | README badges: `src/services` lines 99.74%, branches 89.13% |
| #32 | `fix/pages-deep-links` | demo build writes `<route>.html` per parameterless route (200 on Pages); `/leads/:id` stays on 404.html (known issue) |
| #33 | `chore/remove-upload-stubs` | three one-line stub files deleted, and their line in CLAUDE.md §9 |
| this | `docs/worklog-history` | entries N0 to S1.8-GH moved to [docs/history.md](docs/history.md) |

**Verified**

| Check | Result |
|---|---|
| CI on #28 to #32 | all six jobs green; #30's `frontend` and `e2e` green on the new lockfiles |
| Backend `npm test` (#30 lockfile) | **669 passed** (37 files) |
| AI `pytest` | **79 passed** |
| Frontend `npm test` (#30 lockfile, locally) | 325-327 of 330: 3-5 timeouts at ~5 s, different tests each run, while an Ollama eval held the CPU (82 s run vs 30 s); green in CI |
| Lint, typecheck, format, build, bundle budget | pass (initial JS 114.1 kB gzip, budget 121.2) |
| Demo e2e (#32) | 4/4 locally (200 for `/deals` and `/pipeline`, 404 for a lead's page); Pages workflow on the branch green |
| `pages-routes.test.js` | fails when the list and App.jsx disagree (mutation-checked) |
| CLAUDE.md path check | 64 to 67 referenced paths per branch, 0 missing |

**Not fixed:** minimatch 10.x under eslint 10 (dev only, moderate): every 10.x is in the advisory's range and npm's
only fix is a downgrade to eslint 9. Dependabot will offer the fix when eslint moves.

**Gotcha (Windows):** `npm ci` in `frontend/` while a Vite dev server or Playwright run is open fails with `EPERM` on
rolldown's `.node` binary *after* it has deleted most of `node_modules`. Stop the servers first, or use `npm install`.
Playwright also takes minutes to stop `e2e-demo/pages-server.mjs` on Windows after the tests pass.

**Next:** turn on the ruleset and merge settings (#28) and Dependabot security updates (#29); merge #28 first, then
the rest, rebasing each on `main`. Raise the coverage gate to 98.74% (99.74 − 1) in its own PR. After #32 deploys:
`curl -I https://aditsharma14.github.io/AI-CRM/login` should be 200.
