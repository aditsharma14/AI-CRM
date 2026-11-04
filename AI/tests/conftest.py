"""Shared fixtures: settings that need no environment, and a client on a fresh app."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-internal-token-0123456789"


@pytest.fixture
def settings() -> Settings:
    return Settings(ai_internal_token=TOKEN, ai_provider="fake", _env_file=None)  # type: ignore[call-arg]


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
