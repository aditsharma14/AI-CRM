# Backend benchmark: the five most-used reads at 100,000 leads

How the API's busiest reads perform on one org with 100,000 leads, 10,000 deals, 50,000 activities and 20 users
(plus 50 small orgs), before and after S1.9. Data: [scripts/bench/seed.mjs](../scripts/bench/seed.mjs) (deterministic:
the same documents and ids on every run). Runner: [scripts/bench/run.mjs](../scripts/bench/run.mjs). Raw results:
[bench/results/](results/).

```bash
node scripts/bench/seed.mjs          # local mongodb://localhost:27017/nimbus-bench only; ~9 s
node scripts/bench/run.mjs <label>   # ~4 min; writes bench/results/<label>.json and prints these tables
```

## Method

- **Machine:** AMD Ryzen 7 8840HS (8 cores, 16 threads), 31 GB RAM, Windows 11 (10.0.26200), Node 24.16.0, MongoDB
  8.3.4.
- **The load generator and the API share the machine** (autocannon, the API and mongod all on the same CPU), so the
  absolute numbers are lower than on separate hosts. Before and after ran the same way, so they compare.
- **Local MongoDB is a standalone server**, not a replica set. Fine for these reads: none of them uses a transaction.
- The API runs with `NODE_ENV=production` and silent logs, its rate limiter raised out of the way. The runner first
  makes the database's indexes match the models (`syncIndexes`), so a run measures the code as committed.
- Per endpoint: one 5 s warm-up run (discarded), then **3 runs of 10 s with 10 connections**. The tables show the
  **median** of the 3 runs, and the spread (min-max) across them. p95 is read from autocannon's full latency histogram.
- **Query plans:** the profiler records every command one request sends, and each is run again with
  `explain('executionStats')`. The plans are taken before any load, so nothing from another endpoint gets in.
- Signed in as the big org's owner (sees the whole org).

## Before (commit `ecf9754`)

| Endpoint | Request | p50 ms | p95 ms | req/s | spread p50 / p95 / req/s |
|---|---|---|---|---|---|
| lead list (default sort) | `GET /leads?limit=20` | 257 | 332 | 38 | 254-277 / 302-338 / 35-38 |
| lead list, status filter | `GET /leads?limit=20&status=qualified` | 65 | 74 | 152 | 65-68 / 73-77 / 146-152 |
| lead list, search | `GET /leads?limit=20&q=sharma` | 40 | 47 | 244 | 40-40 / 46-47 / 243-247 |
| deal list | `GET /deals?limit=20&sort=-createdAt` | 47 | 57 | 209 | 46-47 / 57-57 / 209-211 |
| dashboard overview | `GET /dashboard/overview` | 101 | 122 | 96 | 99-105 / 114-130 / 92-98 |

### Query plans before

`keys` / `docs` are `totalKeysExamined` / `totalDocsExamined`; `returned` is `nReturned`.

| Endpoint | Query | Winning plan | keys | docs | returned | ms |
|---|---|---|---|---|---|---|
| lead list | count | `GROUP > COUNT_SCAN {orgId_1}` | 100,000 | 0 | 1 | 38 |
| | page | `SORT > FETCH > IXSCAN {orgId_1}` (**in-memory sort**) | 100,000 | 100,000 | 20 | 277 |
| | companies populate | `FETCH > IXSCAN {_id_}` | 28 | 14 | 14 | 1 |
| status filter | count | `GROUP > COUNT_SCAN {orgId_1_status_1}` | 19,991 | 0 | 1 | 9 |
| | page | `SORT > FETCH > IXSCAN {orgId_1_status_1}` (**in-memory sort**) | 19,991 | 19,991 | 20 | 82 |
| search | count | `GROUP > FETCH > TEXT_MATCH > FETCH > IXSCAN {name_text_email_text}` | 4,689 | 4,689 | 1 | 23 |
| | page | `SORT > FETCH > TEXT_MATCH > FETCH > IXSCAN {name_text_email_text}` (**in-memory sort**) | 4,689 | 9,378 | 20 | 19 |
| deal list | count | `GROUP > COUNT_SCAN {orgId_1}` | 10,000 | 0 | 1 | 4 |
| | page | `SORT > FETCH > IXSCAN {orgId_1}` (**in-memory sort**) | 10,000 | 10,000 | 20 | 45 |
| dashboard | recent activity | `LIMIT > FETCH > IXSCAN {orgId_1_createdAt_-1}` | 10 | 10 | 10 | 0 |
| | its users populate | `FETCH > IXSCAN {_id_}` | 13 | 8 | 8 | 0 |
| | deals by stage | `GROUP > FETCH > IXSCAN {orgId_1}` | 10,000 | 10,000 | 6 | 21 |
| | open pipeline value | `GROUP > FETCH > IXSCAN {orgId_1_closedAt_1}` | 10,000 | 10,000 | 1 | 28 |
| | leads by status | `GROUP > PROJECTION_COVERED > IXSCAN {orgId_1_status_1}` | 100,000 | 0 | 5 | 89 |

**What this shows**
- **No COLLSCAN anywhere.** Every query starts with an `orgId` index. The cost is elsewhere.
- **Every list sorts in memory.** No index has the sort key after `orgId`, so to return 20 leads Mongo fetches all
  100,000 of the org's leads, sorts them, and throws away 99,980: 277 ms of the default list's ~260 ms p50.
- **Every page also counts every match.** `countDocuments` behind `meta.total` is a `COUNT_SCAN`: no documents, but
  every index key. 38 ms at 100,000 leads, and it grows with the org.
- **The search's text index has no `orgId` prefix.** It finds "sharma" in every tenant's leads, then filters by org.
- **No N+1.** Populates are one batched `_id $in` query per list.
- **The Dashboard reads 20,000 deal documents** for two sums (no index holds `value`), and walks all 100,000 lead
  index keys to count five statuses.

## After (commit `1473c28`)

Same machine, same seed, same method. The middle column is the run after the indexes and cursor pagination only
(`eff3d03`); the last adds lean reads, the per-status lead counts and the org-prefixed text index.

| Endpoint | p95 before | p95 indexes + cursor | **p95 after** | p50 before → after | req/s before → after | spread after p50 / p95 / req/s |
|---|---|---|---|---|---|---|
| lead list (default sort) | 332 | 38 | **28** | 257 → 22 | 38 → 441 | 21-23 / 27-28 / 429-449 |
| lead list, status filter | 74 | 38 | **25** | 65 → 19 | 152 → 493 | 19-20 / 25-26 / 485-497 |
| lead list, search | 47 | 87 | **36** | 40 → 30 | 244 → 326 | 30-31 / 36-53 / 278-329 |
| deal list | 57 | 43 | **30** | 47 → 25 | 209 → 387 | 24-25 / 30-31 / 385-396 |
| dashboard overview | 122 | 86 | **46** | 101 → 40 | 96 → 244 | 38-41 / 44-47 / 238-258 |

(The middle run's search p95 was noisy, 55-89 ms across its three runs; it had no search change.)

### Query plans after

| Endpoint | Query | Winning plan | keys | docs | returned | ms |
|---|---|---|---|---|---|---|
| lead list | page | `LIMIT > FETCH > IXSCAN {orgId_1_createdAt_-1__id_-1}` | 21 | 21 | 21 | 1 |
| | companies populate | `FETCH > IXSCAN {_id_}` | 28 | 14 | 14 | 0 |
| status filter | page | `LIMIT > FETCH > IXSCAN {orgId_1_status_1_createdAt_-1__id_-1}` | 21 | 21 | 21 | 1 |
| search | page | `SORT > TEXT_MATCH > FETCH > IXSCAN {orgId_1_name_text_email_text}` (in-memory sort of the matches) | 4,258 | 4,258 | 21 | 15 |
| deal list | page | `LIMIT > FETCH > IXSCAN {orgId_1_createdAt_-1__id_-1}` | 21 | 21 | 21 | 0 |
| dashboard | lead counts (×5) | `GROUP > COUNT_SCAN {orgId_1_status_1_createdAt_-1__id_-1}` | 10,023-30,128 each | 0 | 1 each | 3-11 |
| | deals by stage | `GROUP > PROJECTION_COVERED > IXSCAN {orgId_1_stageKey_1_value_1}` | 10,000 | 0 | 6 | 11 |
| | open pipeline value | `GROUP > PROJECTION_COVERED > IXSCAN {orgId_1_status_1_value_1}` | 6,522 | 0 | 1 | 5 |
| | recent activity, its users | `LIMIT > FETCH > IXSCAN {orgId_1_createdAt_-1}`, `FETCH > IXSCAN {_id_}` | 10, 13 | 10, 8 | 10, 8 | 0 |

**No COLLSCAN and no in-memory sort on any list page.** A page reads 21 index keys and 21 documents (the page and one
more, to know there is a next page), however big the org. The count per page is gone. The dashboard reads no
documents for its sums and counts. `backend/tests/query-plans.test.js` fails if any of this regresses.

### What changed, and why

- **ESR compound indexes** (equality, sort, range), defined in the models: `{orgId, createdAt:-1, _id:-1}` and
  `{orgId, status, createdAt:-1, _id:-1}` for leads, `{orgId, createdAt:-1, _id:-1}` for deals. The equality fields come
  first, then the sort key, so a page is read in order straight from the index. Deal sums are covered by
  `{orgId, stageKey, value}` and `{orgId, status, value}`. Indexes for the API-only sorts (lead name/score, deal
  value/closedAt) were not added: the UI never sends them, and each index costs every write. Those sorts still work,
  with a bounded in-memory top-k sort.
- **Cursor pagination** on leads and deals: `?cursor=` (last row's sort value and `_id`, plus a hash of the query)
  instead of `?page=`. **`total` was dropped:** counting the org's leads was a 38 ms `COUNT_SCAN` on every page, over
  the ~20 ms we agreed to pay. Deep pages show why skip/limit had to go, even with the right index:

  | Page (20 per page) | skip/limit: keys read | ms | cursor: keys read | ms |
  |---|---|---|---|---|
  | 1 | 20 | 0 | 21 | 0 |
  | 250 | 5,000 | 22 | 22 | 2 |
  | 2,500 | 50,000 | 79 | 22 | 3 |
  | 4,999 | 99,980 | 142 | 22 | 5 |

- **Lean reads** for list rows, the dashboard's recent activity and search: no Mongoose documents for data that is
  only serialized (28 vs 38 ms p95 on the lead list). **Projection** where it removes something: search returns
  `_id` and `name`/`title`, all the palette shows. List rows are not projected: they are also the edit dialog's data,
  so trimming them would cost a GET per edit.
- **Dashboard lead counts:** five parallel `COUNT_SCAN`s, one per status, instead of a `$group` over every lead key.
- **N+1:** none found. Every populate is one batched `_id $in` query per list.

### Search: which index

Measured with [scripts/bench/search-options.js](../scripts/bench/search-options.js) on the big org (first page, newest
first, median of 5):

| Option | "sharma" (last name): matches / docs examined / ms | "priya" (first name) | "kaveri" (no match) |
|---|---|---|---|
| (a) text index `{name, email}`, as before | 4,258 / 9,378 / 21 | 4,192 / 9,266 / 21 | 0 / 0 / 2 |
| **(b) text index `{orgId, name, email}`** | 4,258 / 4,258 / 27 | 4,192 / 4,192 / 24 | 0 / 0 / 1 |
| (c) anchored prefix on a lowercased name `{orgId, nameLower}` | **0** / 0 / 2 | 4,192 / 467 / 8 | 0 / 0 / 2 |

**Chose (b).** It costs the same as (a) here, but it reads only this org's entries, so its cost grows with the org
instead of with every tenant in the collection. (c) is faster for a first name but can't find a last name ("sharma":
nothing) or an email, so it would make search worse to make it faster. All three still sort the matches in memory
(4,258 here), so search is the slowest list read left: see "At 10x" below.

MongoDB allows one text index per collection, so a database created before this change keeps the old one and the new
one can't be built: run `node scripts/sync-indexes.js --apply` in `backend/` once (it lists the changes without
`--apply`).

## Budget

**Lead list p95 under 200 ms at 100,000 leads on this machine** (method above). Today: 28 ms. The query-plan test
guards the plans; this benchmark is the number.

## At 10x (1,000,000 leads in one org)

- **List pages stay flat:** a cursor page reads 21 index keys whatever the size. The indexes grow (about 10x the RAM
  to keep them hot); the working set, not the query, becomes the limit.
- **The dashboard grows linearly:** the counts and sums walk every key of the org (about 100,000 today). At 10x,
  keep running totals per org (updated by the services that write leads and deals, or a scheduled `$merge` into a
  summary collection) and read those.
- **Search grows with the matches:** a common surname would match about 40,000 leads, all sorted in memory. Options:
  cap and sort the text matches by relevance instead of date, or move search to Atlas Search (a Lucene index that
  pages sorted results), which would also give prefix and fuzzy matching.
- **Writes:** each lead write updates 5 indexes now (was 4). Fine at this rate; worth measuring under a bulk import.
