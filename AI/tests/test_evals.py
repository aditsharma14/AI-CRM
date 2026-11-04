"""The eval cases in CI: every case through the real generate() with the fake provider, held to the plumbing checks.
Free and offline; the model-quality checks need a real model (npm run eval -- --provider ollama)."""

import asyncio
from collections import Counter

import pytest

from app.providers.fake import FakeProvider
from evals.run import PLUMBING, load_cases, run_case

CASES = load_cases()


def test_the_case_set() -> None:
    assert 15 <= len(CASES) <= 20
    assert len({c.id for c in CASES}) == len(CASES)
    tags = Counter(tag for c in CASES for tag in c.tags)
    for needed in ("normal", "empty", "long", "conflicting", "injection", "non-english"):
        assert tags[needed] >= 1, needed
    assert tags["injection"] >= 5
    links = [c for c in CASES if "injection" in c.tags and any("://" in i.text for i in c.request.history)]
    assert links, "an injection case with a link"


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_plumbing_checks_pass_on_the_fake_provider(case, settings) -> None:
    outcome = asyncio.run(run_case(case, settings, FakeProvider()))
    assert outcome.error is None
    for check in PLUMBING:
        assert outcome.checks[check] in (True, None), check
