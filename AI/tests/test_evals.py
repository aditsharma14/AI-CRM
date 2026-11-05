"""The eval cases in CI: every case through the real generate() with the fake provider, held to the plumbing checks.
Free and offline; the model-quality checks need a real model (npm run eval -- --provider ollama)."""

import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest

from app.providers.fake import FakeProvider
from evals.run import PLUMBING, load_cases, report, result_name, run_case

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


def test_the_report_header_and_the_file_name_carry_the_same_local_date(settings) -> None:
    # 03:14 in India is 21:44 UTC the day before: a UTC header once disagreed with the local file name.
    when = datetime(2026, 11, 5, 3, 14, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    outcome = asyncio.run(run_case(CASES[0], settings, FakeProvider()))
    text = report([outcome], settings, "ollama", "llama3.2:3b", "100% CPU", when)
    assert "- **Date:** 2026-11-05 03:14 +0530\n" in text
    assert result_name(when, "ollama", "llama3.2:3b", None) == "2026-11-05-ollama-llama3.2-3b.md"
    assert result_name(when, "ollama", "qwen3:4b", False) == "2026-11-05-ollama-qwen3-4b-nothink.md"
