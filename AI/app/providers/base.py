"""The provider interface: one structured completion for the lead brief, and the typed failures it may raise."""

from dataclasses import dataclass
from typing import Any, Protocol

from app.lead_brief.models import LeadBriefRequest


@dataclass(frozen=True)
class Completion:
    text: str
    input_tokens: int
    output_tokens: int
    model: str
    # Time until the first output token, when the provider reports it (Ollama: model load + prompt processing).
    first_token_ms: int | None = None


class ProviderTimeoutError(Exception):
    """The call ran out of time. Never retried: a timed-out call has already used its whole budget."""


class ProviderRateLimitedError(Exception):
    """The provider said 429. Express turns this into AI_RATE_LIMITED."""


class ProviderError(Exception):
    """Anything else (unreachable, 5xx, model not installed). Messages never carry request content or keys."""


class Provider(Protocol):
    name: str
    model: str

    async def complete(
        self, *, request: LeadBriefRequest, system: str, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> Completion: ...
