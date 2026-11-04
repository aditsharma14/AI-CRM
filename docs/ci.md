# CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs six jobs in parallel on every push and pull request, and
by hand with `gh workflow run ci.yml --ref <branch>`. A newer push to the same branch cancels the run it supersedes.

**CI gates merges.** `main` takes changes only through pull requests, and its ruleset requires all six jobs below
to pass before a PR merges ([CONTRIBUTING.md](../CONTRIBUTING.md#pull-requests)). The pre-commit hook (lint, typecheck,
format, ruff on staged files) is the fast local check; CI is the full one on a clean machine, including the test
suites and the Docker stack.

## Jobs

| Job | What it runs | Run it locally |
|---|---|---|
| `repo` | `npx prettier --check .` over JS, JSON, YAML and CSS | `npx prettier --check .` (repo root) |
| `ai` | `pip install -r requirements-dev.txt`, then `ruff check .`, `ruff format --check .`, `pytest` (one placeholder test until S2.1) | `node scripts/ruff.mjs check AI`, `node scripts/ruff.mjs format --check AI`, then in `AI/`: `.venv/Scripts/python -m pytest` |
| `backend` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` (fails below the coverage gate) | in `backend/`: the same four commands |
| `frontend` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then [check-no-demo.mjs](../frontend/scripts/check-no-demo.mjs) (no MSW, worker, `404.html` or demo data in a normal build) and [check-bundle-budget.mjs](../frontend/scripts/check-bundle-budget.mjs) (entry chunk and initial JS within [bundle-budget.json](../frontend/bundle-budget.json); see [bench/frontend.md](../bench/frontend.md)) | in `frontend/`: the same commands |
| `e2e` | `npm ci` in both packages, Python 3.13 with `AI/requirements.txt`, `npx playwright install --with-deps chromium`, `npm run e2e` (starts its own API on in-memory Mongo, the AI service on the fake provider and a Vite server). Traces are uploaded on failure | in `frontend/`: `npm run e2e` (first time: `npx playwright install chromium`; on Windows, `C:\Windows\System32` must be on `PATH`) |
| `docker` | `docker compose build`, `docker compose up -d`, [docker-smoke.sh](../scripts/ci/docker-smoke.sh), logs on failure, `docker compose down -v` | `docker compose up -d --build`, then `bash scripts/ci/docker-smoke.sh` (needs curl and jq), then `docker compose down -v` |

**The demo** ([pages.yml](../.github/workflows/pages.yml), a separate workflow): on every push to `main` and `ci/**`, build
with `VITE_DEMO=true`, run [demo.spec.js](../frontend/e2e-demo/demo.spec.js) against that exact artifact served the way
Pages serves it ([pages-server.mjs](../frontend/e2e-demo/pages-server.mjs)), and deploy to
https://aditsharma14.github.io/AI-CRM/ only from `main` and only if the smoke passed. Locally:
`VITE_DEMO=true npm run build && npm run e2e:demo` in `frontend/` (on Windows the run ends slowly: Playwright takes
minutes to stop the static server after the tests pass; on Linux CI it's instant).

**What the docker job proves** ([docker-smoke.sh](../scripts/ci/docker-smoke.sh)):
- the API answers `/health`;
- mongo reports **PRIMARY** (`rs.status()`): it's a real replica set, so transactions work;
- nginx proxies `/api` to the API (the API's own 404 envelope comes back through `:8080`);
- registering an org, creating a lead and converting it returns 201, the deal carries `convertedFromLeadId`, and
  the lead is `converted`;
- [scripts/smoke.mjs](../scripts/smoke.mjs) passes through nginx on `:8080`, the browser's same-origin path:
  `/api/v1/health` reports this commit (`GIT_COMMIT`), a `smoke-<ts>` org registers, a lead is created and converted,
  an AI lead brief is generated (the api calling the ai service with its token) and the second one comes from the cache,
  the session refreshes, and after logout the old refresh token gets 401. Locally: `node scripts/smoke.mjs http://localhost:8080`.

The AI container sits behind the `ai` compose profile until S2.1, so the stack is `client`, `api` and `mongo`.

**Caching:** npm in every Node job (keyed on the lockfiles) and pip in the `ai` job (keyed on
`AI/requirements-dev.txt`). Docker layers aren't cached; the whole docker job, builds included, takes about 50 s.

## Coverage

The backend job fails if **`src/services` line coverage drops below 98.65%** (`coverage.thresholds` in
[backend/vitest.config.js](../backend/vitest.config.js)). That's the 99.65% measured when the gate was set (S1.6),
minus 1. When coverage rises, raise the threshold with it; never lower it to make a change pass.

The README's coverage badge is a static shields.io badge with that same number. Update it in a docs commit when
the number changes. It isn't live because a live badge needs the number published somewhere (a gist and a token
secret, or a bot commit back to `main`); the gate already catches a real drop.

Locally: `npm run test:coverage` in `backend/` prints the table and applies the same threshold.

## Timing

Wall-clock time of the last three runs, all six jobs (jobs run in parallel, so the total is roughly the slowest job
plus queueing):

| Run | Commit | Total | repo | ai | backend | frontend | e2e | docker |
|---|---|---|---|---|---|---|---|---|
| [41231289454](https://github.com/aditsharma14/AI-CRM/actions/runs/41231289454) | `f29a3b4` | 59 s | 9 s | 8 s | 46 s | 26 s | 55 s | 50 s |
| [41230948709](https://github.com/aditsharma14/AI-CRM/actions/runs/41230948709) | `b578538` | 70 s | 10 s | 9 s | 60 s | 31 s | 50 s | 49 s |
| [41230616639](https://github.com/aditsharma14/AI-CRM/actions/runs/41230616639) | `5f3aa3b` | 82 s | 12 s | 9 s | 77 s | 30 s | 59 s | 49 s |

The e2e, docker and backend jobs set the pace (about 50–75 s each). Before S1.6 (four jobs, no docker) a run took
51–58 s.
