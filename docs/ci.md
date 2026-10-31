# CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs six jobs in parallel on every push and pull request, and
by hand with `gh workflow run ci.yml --ref <branch>`. A newer push to the same branch cancels the run it supersedes.

**CI doesn't block merges.** The repo has no branch protection. The gate is the pre-commit hook (lint, typecheck,
format, ruff on staged files; see [CONTRIBUTING.md](../CONTRIBUTING.md)). CI is the full check on a clean machine,
including the test suites and the Docker stack.

## Jobs

| Job | What it runs | Run it locally |
|---|---|---|
| `repo` | `npx prettier --check .` over JS, JSON, YAML and CSS | `npx prettier --check .` (repo root) |
| `ai` | `pip install -r requirements-dev.txt`, then `ruff check .`, `ruff format --check .`, `pytest` (one placeholder test until S2.1) | `node scripts/ruff.mjs check AI`, `node scripts/ruff.mjs format --check AI`, then in `AI/`: `.venv/Scripts/python -m pytest` |
| `backend` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` (fails below the coverage gate) | in `backend/`: the same four commands |
| `frontend` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | in `frontend/`: the same four commands |
| `e2e` | `npm ci` in both packages, `npx playwright install --with-deps chromium`, `npm run e2e` (starts its own API on in-memory Mongo and a Vite server). Traces are uploaded on failure | in `frontend/`: `npm run e2e` (first time: `npx playwright install chromium`; on Windows, `C:\Windows\System32` must be on `PATH`) |
| `docker` | `docker compose build`, `docker compose up -d`, [docker-smoke.sh](../scripts/ci/docker-smoke.sh), logs on failure, `docker compose down -v` | `docker compose up -d --build`, then `bash scripts/ci/docker-smoke.sh` (needs curl and jq), then `docker compose down -v` |

**What the docker job proves** ([docker-smoke.sh](../scripts/ci/docker-smoke.sh)):
- the API answers `/health`;
- mongo reports **PRIMARY** (`rs.status()`): it's a real replica set, so transactions work;
- nginx proxies `/api` to the API (the API's own 404 envelope comes back through `:8080`);
- registering an org, creating a lead and converting it returns 201, the deal carries `convertedFromLeadId`, and
  the lead is `converted`.

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
