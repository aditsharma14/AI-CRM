# Nimbus CRM

[![CI](https://github.com/aditsharma14/AI-CRM/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aditsharma14/AI-CRM/actions/workflows/ci.yml)
[![Coverage: backend services](https://img.shields.io/badge/coverage%20(services)-99.65%25-brightgreen)](docs/ci.md#coverage)

A multi-tenant CRM with an AI assistant layered on top: leads, contacts, companies, deals
pipeline, tasks, calendar, and org/role management, backed by an Express API and a FastAPI
service that handles LLM-powered chat, content generation, and insights.

## Architecture

Four services, wired together in [docker-compose.yml](docker-compose.yml):

| Service    | Path        | Stack                          | Port  |
|------------|-------------|---------------------------------|-------|
| `client`   | `frontend/` | React 19 + Vite + Tailwind      | 8080  |
| `api`      | `backend/`  | Node/Express + Mongoose         | 5000  |
| `ai`       | `AI/`       | Python FastAPI + LangChain      | 8000  |
| `mongo`    | —           | MongoDB 7 (local dev only)      | 27017 |

The client always calls same-origin `/api/v1` — in dev, Vite proxies it to the `api`
container ([vite.config.js](frontend/vite.config.js)); in production, nginx reverse-proxies
it the same way ([nginx.conf](frontend/nginx.conf)). The `api` service is the only caller of
the `ai` service, which in turn reads (never writes) the same MongoDB data for
retrieval-augmented context.

## Getting started

### Docker (all services)

```bash
docker compose up --build
```

Then visit `http://localhost:8080`. No `.env` is needed: compose sets the API's development values itself
(the AI container is behind the `ai` profile until it's built).

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
pip install -r requirements.txt
cp .env.example .env       # fill in LLM_PROVIDER + API key
uvicorn app.main:app --reload --port 8000
```

**MongoDB** — the `mongo` container from docker-compose, or any replica set via `MONGO_URI`.

## Environment variables

- `backend/.env.example` — every variable the API reads: Mongo URI, JWT secret and TTLs, CORS
  origin, `TRUST_PROXY`, `EMAIL_ENABLED`, rate limits, log level, `GIT_COMMIT`.
- `AI/.env.example` — Mongo URI (read-only), `LLM_PROVIDER` (`gemini` or `openai`, with
  automatic fallback to the other on timeout/5xx), and the corresponding API key.
- The frontend needs none: it always calls same-origin `/api/v1`.

## Auth model

Short-lived JWT access tokens (never persisted) plus a long-lived refresh token, stored
hashed on the user record and shipped as an httpOnly cookie. Org membership and roles gate
admin actions (invites, renaming the org, etc.) — see
[backend/src/middleware/guards.js](backend/src/middleware/guards.js) and
[backend/src/utils/permissions.js](backend/src/utils/permissions.js).

## Deployment

There is no hosted backend. The full stack runs with `docker compose up --build` (above); CI builds and
smoke-tests that same stack on every push ([docs/ci.md](docs/ci.md)).

## Project layout

```
frontend/   React app (routes, features, API client) — see frontend/src/App.jsx
backend/    Express API (routes, services, Mongoose models)
AI/         FastAPI service (LangChain chains, LLM provider, RAG memory)
```
