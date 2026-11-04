"""Shared fixtures: settings that need no environment, a scripted provider, and clients on fresh apps."""

import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.lead_brief.models import LeadBriefRequest
from app.main import create_app
from app.providers.base import Completion

TOKEN = "test-internal-token-0123456789"
AUTH = {"X-Internal-Token": TOKEN}


@pytest.fixture
def settings() -> Settings:
    return Settings(ai_internal_token=TOKEN, ai_provider="fake", _env_file=None)  # type: ignore[call-arg]


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))


class ScriptedProvider:
    """Answers each call with the next scripted step: a dict (sent as JSON), a raw string, or an exception to raise.
    Records every call's messages, so tests can read the retry prompt."""

    name = "scripted"
    model = "scripted-model"

    def __init__(self, *steps: Any) -> None:
        self.steps = list(steps)
        self.calls: list[list[dict[str, str]]] = []

    async def complete(
        self, *, request: LeadBriefRequest, system: str, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> Completion:
        self.calls.append(messages)
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        text = step if isinstance(step, str) else json.dumps(step)
        return Completion(text, input_tokens=1000, output_tokens=200, model=self.model, first_token_ms=1500)


@pytest.fixture
def scripted(settings: Settings) -> Callable[..., tuple[TestClient, ScriptedProvider]]:
    def make(*steps: Any) -> tuple[TestClient, ScriptedProvider]:
        provider = ScriptedProvider(*steps)
        return TestClient(create_app(settings, provider)), provider

    return make
