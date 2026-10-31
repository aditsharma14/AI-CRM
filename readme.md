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

Then visit `http://localhost:8080`. Requires an `.env` in `backend/` and `AI/` (copy from
each directory's `.env.example`).

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

**MongoDB** — either the `mongo` container from docker-compose, or point `MONGO_URI` at an
Atlas cluster.

## Environment variables

- `backend/.env.example` — Mongo URI, JWT access/refresh secrets and TTLs, CORS origin,
  Cloudinary credentials, the internal `AI_SERVICE_URL`, and rate-limit settings.
- `AI/.env.example` — Mongo URI (read-only), `LLM_PROVIDER` (`gemini` or `openai`, with
  automatic fallback to the other on timeout/5xx), and the corresponding API key.
- `frontend/.env.example` — only needed if the API is ever served from a different origin
  than the client (`VITE_API_BASE_URL`); same-origin `/api/v1` requires no config.

## Auth model

Short-lived JWT access tokens (never persisted) plus a long-lived refresh token, stored
hashed on the user record and shipped as an httpOnly cookie. Org membership and roles gate
admin actions (invites, renaming the org, etc.) — see
[backend/src/middleware/guards.js](backend/src/middleware/guards.js) and
[backend/src/utils/permissions.js](backend/src/utils/permissions.js).

## Deployment

[vercel.json](vercel.json) at the repo root builds and deploys the `frontend/` Vite app as a
static site on Vercel, rewriting `/api/*` to wherever the backend ends up hosted (edit the
placeholder URL there). The `backend` and `AI` services are long-running servers, not
serverless functions, so they need a separate host (Render, Railway, Fly, etc.) — the
included `Dockerfile`s in each of `backend/`, `AI/`, and `frontend/` cover that.

## Project layout

```
frontend/   React app (routes, features, API client) — see frontend/src/App.jsx
backend/    Express API (routes, services, Mongoose models)
AI/         FastAPI service (LangChain chains, LLM provider, RAG memory)
```
