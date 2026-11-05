"""The eval cases in CI: every case through the real generate() with the fake provider, held to the plumbing checks.
Free and offline; the model-quality checks need a real model (npm run eval -- --provider ollama)."""

import asyncio
import json
from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest

from app.providers.fake import FakeProvider
from evals.run import PLUMBING, load_cases, report, result_name, run_case

from .conftest import ScriptedProvider

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


def test_the_report_keeps_the_model_output_of_failed_cases_only(settings) -> None:
    failing, passing = CASES[0], CASES[1]
    broken = "not json at all, marker-7f3a"
    uncited = json.dumps({**FakeProvider().brief(failing.request), "citations": []})
    bad = asyncio.run(run_case(failing, settings, ScriptedProvider(broken, uncited)))
    good = asyncio.run(run_case(passing, settings, FakeProvider()))
    assert bad.error == "BAD_OUTPUT" and bad.outputs == [broken, uncited]
    text = report([bad, good], settings, "ollama", "llama3.2:3b", "100% CPU", datetime.now().astimezone())
    failed = text.split("## Failed cases", 1)[1]
    assert "synthetic" in failed
    assert f"### {failing.id}" in failed and f"### {passing.id}" not in failed
    assert broken in failed and uncited in failed
    assert "does not match the schema" in failed  # the first attempt's problems: which rule failed
    assert "no citation points at an id" in failed
    assert good.outputs[0] not in text


def test_a_report_with_no_failures_has_no_failed_cases_section(settings) -> None:
    good = asyncio.run(run_case(CASES[1], settings, FakeProvider()))
    assert not any(v is False for v in good.checks.values())
    assert "## Failed cases" not in report([good], settings, "fake", "fake", "in-process", datetime.now().astimezone())
