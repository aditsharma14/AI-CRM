"""The retry deadline: Express sends X-Deadline-Ms (the time left on its own budget). Each attempt gets at most the
time left, and the one retry runs only if it can finish: time left >= 1.2 x the first attempt's duration."""

import asyncio
import json
import logging

import pytest

from app.lead_brief.models import LeadBriefRequest
from app.lead_brief.service import BriefError, generate
from app.metrics import Metrics

from .conftest import AUTH as AUTH_HEADERS
from .conftest import Clock, ScriptedProvider
from .test_lead_brief import answer, body, post

INVALID = answer(citations=[])  # fails validation: history but no citation


def run(provider: ScriptedProvider, settings, clock: Clock, deadline_s: float | None):
    req = LeadBriefRequest.model_validate(body())
    deadline = None if deadline_s is None else clock.now + deadline_s
    return asyncio.run(generate(req, provider, settings, Metrics(), deadline=deadline, clock=clock))


def test_enough_time_left_gives_the_retry_with_the_time_left_as_its_limit(settings) -> None:
    clock = Clock()
    provider = ScriptedProvider(INVALID, answer(), clock=clock, took=30)
    brief, meta = run(provider, settings, clock, deadline_s=90)
    assert meta.attempts == 2
    # 60 s left after a 30 s attempt: 60 >= 36, and the retry may use all 60 (under the 90 s per-attempt limit).
    assert provider.timeouts == [90_000, 60_000]


def test_too_little_time_left_skips_the_retry_as_bad_output(settings, caplog) -> None:
    clock = Clock()
    provider = ScriptedProvider(INVALID, answer(), clock=clock, took=45)
    with caplog.at_level(logging.INFO, logger="app.lead_brief"), pytest.raises(BriefError) as caught:
        run(provider, settings, clock, deadline_s=90)
    # 45 s left after a 45 s attempt: under 1.2 x 45 = 54 s, so a second attempt would most likely be cut off.
    assert caught.value.code == "BAD_OUTPUT"
    assert caught.value.meta.attempts == 1
    assert len(provider.calls) == 1
    line = json.loads(next(r.getMessage() for r in caplog.records if r.name == "app.lead_brief"))
    assert line["outcome"] == "bad_output" and line["retrySkipped"] is True and line["attempts"] == 1


def test_the_retry_cutoff_is_1_2_times_the_first_attempt(settings) -> None:
    # 100 s deadline, 45 s attempt: 55 s left >= 54 s, so the retry runs.
    clock = Clock()
    provider = ScriptedProvider(INVALID, answer(), clock=clock, took=45)
    assert run(provider, settings, clock, deadline_s=100)[1].attempts == 2


def test_each_attempt_gets_at_most_the_per_attempt_limit(settings) -> None:
    clock = Clock()
    provider = ScriptedProvider(answer(), clock=clock)
    run(provider, settings, clock, deadline_s=200)
    assert provider.timeouts == [settings.ai_timeout_ms]
    short = ScriptedProvider(answer(), clock=clock)
    run(short, settings, clock, deadline_s=20)
    assert short.timeouts == [20_000]


def test_without_a_deadline_the_retry_always_runs_with_the_full_limit(settings) -> None:
    clock = Clock()
    provider = ScriptedProvider(INVALID, answer(), clock=clock, took=500)
    brief, meta = run(provider, settings, clock, deadline_s=None)
    assert meta.attempts == 2
    assert provider.timeouts == [settings.ai_timeout_ms] * 2


def test_a_deadline_already_passed_is_a_timeout_without_calling_the_model(settings) -> None:
    clock = Clock()
    provider = ScriptedProvider(answer(), clock=clock)
    with pytest.raises(BriefError) as caught:
        run(provider, settings, clock, deadline_s=0)
    assert caught.value.code == "TIMEOUT"
    assert provider.calls == []


def test_the_header_sets_the_first_attempt_s_limit(scripted) -> None:
    client, provider = scripted(answer())
    res = post(client, headers={**AUTH_HEADERS, "X-Deadline-Ms": "5000"})
    assert res.status_code == 200
    assert 4000 < provider.timeouts[0] <= 5000


@pytest.mark.parametrize("value", ["abc", "999", "300001", "-5", "1.5"])
def test_a_bad_deadline_header_is_422_and_no_call(scripted, value) -> None:
    client, provider = scripted(answer())
    res = post(client, headers={**AUTH_HEADERS, "X-Deadline-Ms": value})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "INVALID_REQUEST"
    assert provider.calls == []
