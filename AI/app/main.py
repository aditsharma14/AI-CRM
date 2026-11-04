"""The AI service: FastAPI, called only by the Express API over the internal network. It never touches MongoDB."""

from fastapi import FastAPI

from app.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds the app; tests pass their own settings (and, later, a provider) instead of reading the environment."""
    settings = settings or get_settings()
    app = FastAPI(title="Nimbus CRM AI service", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict[str, str]:
        # Unauthenticated on purpose: the container check. Says nothing about configuration.
        return {"status": "ok"}

    return app


def __getattr__(name: str) -> FastAPI:
    # `uvicorn app.main:app` builds the app on first access, so importing this module (tests) needs no environment.
    if name == "app":
        return create_app()
    raise AttributeError(name)
