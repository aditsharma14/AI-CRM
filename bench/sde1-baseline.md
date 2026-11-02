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
