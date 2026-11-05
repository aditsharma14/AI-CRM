"""Generates one lead brief: prompt, provider call, validation, and at most one retry when validation fails.

A timeout, a 429 or a provider error is never retried: a timed-out call has already used its whole budget, and the
other two would most likely fail again. With a deadline (Express's X-Deadline-Ms), each attempt gets at most the time
left, and the retry runs only if it can finish: the time left must be at least RETRY_MARGIN x the first attempt's
duration (same model, input and hardware: the best predictor of the second). Otherwise the answer is BAD_OUTPUT now,
not a cut-off attempt later. Each call ends with one log line: numbers and codes, no content."""

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from app.config import Settings
from app.lead_brief.models import LeadBrief, LeadBriefRequest
from app.lead_brief.prompt import PROMPT_VERSION, SYSTEM, build_retry_message, build_user_message
from app.lead_brief.validate import check
from app.metrics import Metrics
from app.providers.base import Provider, ProviderError, ProviderRateLimitedError, ProviderTimeoutError

log = logging.getLogger("app.lead_brief")
SCHEMA = LeadBrief.model_json_schema(by_alias=True)
MAX_ATTEMPTS = 2
RETRY_MARGIN = 1.2

ErrorCode = Literal["BAD_OUTPUT", "TIMEOUT", "RATE_LIMITED", "PROVIDER_ERROR"]


@dataclass
class CallMeta:
    provider: str
    model: str
    prompt_version: str = PROMPT_VERSION
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    first_token_ms: int | None = None
    attempts: int = 0
    citations_rejected: int = 0
    problems: list[str] = field(default_factory=list)
    # Each attempt's problems, in order (the eval tells a caught injection from one never tried).
    attempt_problems: list[list[str]] = field(default_factory=list)
    retry_skipped: bool = False

    def as_json(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "promptVersion": self.prompt_version,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "costUsd": round(self.cost_usd, 6),
            "latencyMs": self.latency_ms,
            "firstTokenMs": self.first_token_ms,
            "attempts": self.attempts,
            "citationsRejected": self.citations_rejected,
        }


class BriefError(Exception):
    def __init__(self, code: ErrorCode, message: str, meta: CallMeta) -> None:
        super().__init__(message)
        self.code = code
        self.meta = meta


async def generate(
    request: LeadBriefRequest,
    provider: Provider,
    settings: Settings,
    metrics: Metrics,
    *,
    deadline: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[LeadBrief, CallMeta]:
    """`deadline`: a `clock()` reading by which the answer must be back. None: only the per-attempt limit."""
    meta = CallMeta(provider=provider.name, model=provider.model)
    messages = [{"role": "user", "content": build_user_message(request)}]
    started = time.perf_counter()
    outcome = "ok"
    try:
        for _ in range(MAX_ATTEMPTS):
            timeout_ms = settings.ai_timeout_ms
            if deadline is not None:
                timeout_ms = min(timeout_ms, int((deadline - clock()) * 1000))
                if timeout_ms <= 0:
                    outcome = "timeout"
                    raise BriefError("TIMEOUT", "no time left before the caller's deadline", meta)
            meta.attempts += 1
            attempt_started = clock()
            try:
                completion = await provider.complete(
                    request=request, system=SYSTEM, messages=messages, schema=SCHEMA, timeout_ms=timeout_ms
                )
            except ProviderTimeoutError as err:
                outcome = "timeout"
                raise BriefError("TIMEOUT", str(err), meta) from err
            except ProviderRateLimitedError as err:
                outcome = "rate_limited"
                raise BriefError("RATE_LIMITED", str(err), meta) from err
            except ProviderError as err:
                outcome = "provider_error"
                raise BriefError("PROVIDER_ERROR", str(err), meta) from err

            meta.model = completion.model
            meta.input_tokens += completion.input_tokens
            meta.output_tokens += completion.output_tokens
            if meta.first_token_ms is None:
                meta.first_token_ms = completion.first_token_ms
            checked = check(completion.text, request)
            meta.citations_rejected += checked.citations_rejected
            meta.problems = checked.problems
            meta.attempt_problems.append(checked.problems)
            if checked.brief is not None and not checked.problems:
                return checked.brief, meta
            took = clock() - attempt_started
            if deadline is not None and deadline - clock() < RETRY_MARGIN * took:
                meta.retry_skipped = True
                outcome = "bad_output"
                raise BriefError("BAD_OUTPUT", "the answer failed validation and a retry would not finish", meta)
            messages = [
                *messages,
                {"role": "assistant", "content": completion.text},
                {"role": "user", "content": build_retry_message(checked.problems)},
            ]
        outcome = "bad_output"
        raise BriefError("BAD_OUTPUT", "the model's answer failed validation twice", meta)
    finally:
        meta.latency_ms = round((time.perf_counter() - started) * 1000)
        meta.cost_usd = (
            meta.input_tokens * settings.ai_price_input_per_mtok
            + meta.output_tokens * settings.ai_price_output_per_mtok
        ) / 1_000_000
        metrics.inc("lead_brief_requests_total", outcome=outcome)
        metrics.inc("lead_brief_attempts_total", meta.attempts)
        metrics.inc("lead_brief_retries_skipped_total", int(meta.retry_skipped))
        metrics.inc("lead_brief_citations_rejected_total", meta.citations_rejected)
        metrics.inc("lead_brief_tokens_total", meta.input_tokens, direction="input")
        metrics.inc("lead_brief_tokens_total", meta.output_tokens, direction="output")
        # One line per call; problems are fixed sentences, never quotes of the answer or the notes.
        line = {"event": "lead_brief", "outcome": outcome, **meta.as_json()}
        log.info(json.dumps({**line, "retrySkipped": meta.retry_skipped, "problems": meta.problems}))
