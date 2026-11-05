"""The AI service: FastAPI, called only by the Express API over the internal network. It never touches MongoDB.

Every route but /health needs the shared secret in X-Internal-Token. Errors are {"error": {"code", "message"}} and
never echo the request body (FastAPI's default 422 would)."""

import hmac
import logging
import time
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse

from app.config import Settings, get_settings
from app.lead_brief.models import LeadBriefRequest
from app.lead_brief.prompt import PROMPT_VERSION
from app.lead_brief.service import BriefError, generate
from app.metrics import Metrics
from app.providers import make_provider
from app.providers.base import Provider

STATUS = {"BAD_OUTPUT": 502, "TIMEOUT": 504, "RATE_LIMITED": 429, "PROVIDER_ERROR": 503}


def error(status: int, code: str, message: str, **extra: object) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}, **extra})


def create_app(settings: Settings | None = None, provider: Provider | None = None) -> FastAPI:
    """Builds the app; tests pass their own settings and provider instead of reading the environment."""
    settings = settings or get_settings()
    provider = provider or make_provider(settings)
    metrics = Metrics()
    logging.getLogger("app").setLevel(logging.INFO)
    app = FastAPI(title="Nimbus CRM AI service", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings, app.state.provider, app.state.metrics = settings, provider, metrics
    expected = settings.ai_internal_token.get_secret_value().encode()

    def require_token(x_internal_token: str | None = Header(default=None)) -> None:
        # Constant-time comparison: the response time says nothing about how much of a guess was right.
        if not hmac.compare_digest((x_internal_token or "").encode(), expected):
            raise HTTPException(status_code=401, detail="missing or wrong X-Internal-Token")

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        code = "UNAUTHORIZED" if exc.status_code == 401 else "NOT_FOUND" if exc.status_code == 404 else "BAD_REQUEST"
        return error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        where = "; ".join(f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors()[:5])
        return error(422, "INVALID_REQUEST", where)

    @app.get("/health")
    def health() -> dict[str, str]:
        # Unauthenticated on purpose: the container check. Says nothing about configuration.
        return {"status": "ok"}

    @app.get("/metrics", dependencies=[Depends(require_token)], response_class=PlainTextResponse)
    def metrics_text() -> str:
        return metrics.render()

    @app.get("/v1/info", dependencies=[Depends(require_token)])
    def info() -> dict[str, str]:
        # What decides a brief's content besides its input: Express puts these in its cache key, so a new prompt,
        # provider or model never serves an old brief.
        return {"provider": provider.name, "model": provider.model, "promptVersion": PROMPT_VERSION}

    @app.post("/v1/lead-brief", dependencies=[Depends(require_token)])
    async def lead_brief(
        body: LeadBriefRequest,
        # The time left on Express's budget when it sent the request: it gives up after that.
        x_deadline_ms: Annotated[int | None, Header(ge=1000, le=300_000)] = None,
    ) -> JSONResponse:
        deadline = None if x_deadline_ms is None else time.monotonic() + x_deadline_ms / 1000
        try:
            brief, meta = await generate(body, provider, settings, metrics, deadline=deadline)
        except BriefError as err:
            return error(STATUS[err.code], err.code, str(err), meta=err.meta.as_json())
        return JSONResponse({"brief": brief.model_dump(by_alias=True, mode="json"), "meta": meta.as_json()})

    return app


def __getattr__(name: str) -> FastAPI:
    # `uvicorn app.main:app` builds the app on first access, so importing this module (tests) needs no environment.
    if name == "app":
        return create_app()
    raise AttributeError(name)
