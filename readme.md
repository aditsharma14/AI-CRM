# Nimbus CRM

**[Live demo](https://aditsharma14.github.io/AI-CRM/login)**: sign in as a Sales Manager or a Member with one click.

[![Live demo](https://img.shields.io/badge/live%20demo-GitHub%20Pages-2ea44f)](https://aditsharma14.github.io/AI-CRM/login)
[![Pages](https://github.com/aditsharma14/AI-CRM/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/aditsharma14/AI-CRM/actions/workflows/pages.yml)
[![CI](https://github.com/aditsharma14/AI-CRM/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aditsharma14/AI-CRM/actions/workflows/ci.yml)
[![Line coverage: backend services](https://img.shields.io/badge/lines%20(services)-99.77%25-brightgreen)](docs/ci.md#coverage)
[![Branch coverage: backend services](https://img.shields.io/badge/branches%20(services)-88.85%25-green)](docs/ci.md#coverage)

A multi-tenant sales CRM: leads, contacts, companies, a deals pipeline, tasks, calendar, and org and role management,
backed by an Express API. One AI feature, the **lead brief**: on a lead's page, a summary, a next step and a draft
follow-up email written from the lead's history, each claim citing the entries it rests on
([docs/ai.md](docs/ai.md)). It runs at zero cost: a deterministic fake provider by default, or a free local model
in Ollama.

## Start here

1. [CLAUDE.md §4–5](CLAUDE.md#4-tenancy): the architecture, tenancy and the role and ownership rules.
2. [bench/sde1-baseline.md](bench/sde1-baseline.md): the busiest reads at 100,000 leads, before and after, with query plans.
3. [docs/ai.md](docs/ai.md): the lead brief: grounding, prompt-injection defences and the eval results.
4. [docs/known-issues.md](docs/known-issues.md): what is still wrong or unfinished.

## How I built this

I built this with Claude Code as a pair programmer. The design decisions and the reviews of every change were mine.
[CLAUDE.md](CLAUDE.md) is the brief I keep for the agent: the architecture, the rules it must follow and how it
should work in this repo.

## The live demo

The demo is this repo's real React frontend, built with `VITE_DEMO=true` and served by GitHub Pages. A mock service
worker in your tab answers every `/api/v1` call from an in-memory copy of a seeded Pune sales team (INR deals in every
stage, 60 days of activity), following the API's rules: ownership, roles, the won/lost close, the dashboard numbers.
It is not the backend: nothing is stored or sent anywhere, a reload starts over, and signup, invites, password
reset and settings changes say they're not available in the demo. The AI brief works too, answered by the fake
provider's rules in your browser. Its responses are checked against the same
committed contract as the real API's ([contracts/api-shapes.json](contracts/api-shapes.json)), so the two can't drift
apart. The full stack, Express, MongoDB and all, runs locally with Docker:

```bash
docker compose up --build      # then open http://localhost:8080 and create an organization
```

## Architecture

Four services, wired together in [docker-compose.yml](docker-compose.yml):

| Service    | Path        | Stack                          | Port  |
|------------|-------------|---------------------------------|-------|
| `client`   | `frontend/` | React 19 + Vite + Tailwind      | 8080  |
| `api`      | `backend/`  | Node/Express + Mongoose         | 5000  |
| `ai`       | `AI/`       | Python FastAPI (lead brief)     | internal only |
| `mongo`    | —           | MongoDB 7 (local dev only)      | 27017 |

The client always calls same-origin `/api/v1` — in dev, Vite proxies it to the `api`
container ([vite.config.js](frontend/vite.config.js)); in production, nginx reverse-proxies
it the same way ([nginx.conf](frontend/nginx.conf)). The `api` service is the only caller of
the `ai` service, sending it only a minimal bundle for each brief; the `ai` service never touches MongoDB.

## Getting started

### Docker (all services)

```bash
docker compose up --build
```

Then visit `http://localhost:8080`, register an organization, and open a lead. No `.env` is needed: compose sets
the development values itself, and the AI brief answers with the fake provider (no model, no key, no cost).

### Real AI (optional, free)

Install [Ollama](https://ollama.com/download), then:

```bash
ollama pull llama3.2:3b                  # 2 GB, runs on a laptop CPU
AI_PROVIDER=ollama docker compose up --build
```

The brief is then written by the local model; no lead data leaves your machine. On a CPU a brief takes a while
(the card says so). Measure it with `npm run eval -- --provider ollama` ([docs/ai.md](docs/ai.md#evals)).

### Running services individually

**Frontend**
```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

**Backend**
```bash
cd backend
npm install
cp .env.example .env   # fill in secrets
npm run dev        # http://localhost:5000
```

**AI service**
```bash
cd AI
python -m venv .venv
.venv/Scripts/activate     # Windows; use .venv/bin/activate on macOS/Linux
pip install -r requirements-dev.txt
cp .env.example .env       # the shared token; AI_PROVIDER=fake (default) or ollama
uvicorn app.main:app --reload --port 8000
pytest                     # the tests and the eval cases on the fake provider
```

**MongoDB** — the `mongo` container from docker-compose, or any replica set via `MONGO_URI`.

## Environment variables

- `backend/.env.example` — every variable the API reads: Mongo URI, JWT secret and TTLs, CORS
  origin, `TRUST_PROXY`, `EMAIL_ENABLED`, rate limits, log level, `GIT_COMMIT`.
- `AI/.env.example` — the shared `AI_INTERNAL_TOKEN` (also in `backend/.env` with `AI_ENABLED=true`), the provider
  (`fake` or `ollama`), the Ollama URL and model, the time limit. No API keys: nothing here is paid.
- The frontend needs none: it always calls same-origin `/api/v1`.

## Auth model

Short-lived JWT access tokens (never persisted) plus a long-lived refresh token, stored
hashed on the user record and shipped as an httpOnly cookie. Org membership and roles gate
admin actions (invites, renaming the org, etc.) — see
[backend/src/middleware/guards.js](backend/src/middleware/guards.js) and
[backend/src/utils/permissions.js](backend/src/utils/permissions.js).

## Deployment

There is no hosted backend. The full stack runs with `docker compose up --build` (above); CI builds and
smoke-tests that same stack on every push ([docs/ci.md](docs/ci.md)). The public demo is the frontend alone on
GitHub Pages, deployed by [pages.yml](.github/workflows/pages.yml) after a Playwright run against the exact build
it deploys.

## Project layout

```
frontend/   React app (routes, features, API client) — see frontend/src/App.jsx
backend/    Express API (routes, services, Mongoose models)
AI/         FastAPI service: the lead brief (prompt, validation, providers) and its evals
```
