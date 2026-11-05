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


class Clock:
    """A monotonic clock that moves only when told to (ScriptedProvider moves it by `took` per call)."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class ScriptedProvider:
    """Answers each call with the next scripted step: a dict (sent as JSON), a raw string, or an exception to raise.
    Records every call's messages and time limit, so tests can read the retry prompt. With a clock, each call takes
    `took` seconds."""

    name = "scripted"
    model = "scripted-model"

    def __init__(self, *steps: Any, clock: Clock | None = None, took: float = 0.0) -> None:
        self.steps = list(steps)
        self.calls: list[list[dict[str, str]]] = []
        self.timeouts: list[int] = []
        self.clock, self.took = clock, took

    async def complete(
        self,
        *,
        request: LeadBriefRequest,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        timeout_ms: int,
    ) -> Completion:
        self.calls.append(messages)
        self.timeouts.append(timeout_ms)
        if self.clock:
            self.clock.now += self.took
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
