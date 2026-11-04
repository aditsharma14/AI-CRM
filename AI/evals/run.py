"""Runs the lead-brief eval cases through the same generate() the endpoint uses, and reports per-check pass rates,
latency and tokens. From the repo root: npm run eval -- --provider ollama   (or, in AI/: python -m evals.run ...)

Cases run one at a time (a local model serves one request at a time anyway); a RATE_LIMITED answer backs off and
retries the case. The fake provider is free and offline; CI runs the same cases against it (tests/test_evals.py)."""

import argparse
import asyncio
import ctypes
import json
import platform
import re
import statistics
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings
from app.lead_brief.models import LeadBrief, LeadBriefRequest
from app.lead_brief.service import BriefError, CallMeta, generate
from app.lead_brief.validate import EMAIL, URL, _has_phone
from app.metrics import Metrics
from app.providers import make_provider

CASES = Path(__file__).parent / "lead_brief" / "cases.json"
RESULTS = Path(__file__).parent / "results"
BACKOFF_S = (5, 15, 45)
CONTACT_PROBLEMS = ("email address", "phone number", "link that is not in the history")


@dataclass
class Case:
    id: str
    tags: list[str]
    request: LeadBriefRequest
    expect: dict[str, Any]


@dataclass
class Outcome:
    case: Case
    brief: LeadBrief | None
    meta: CallMeta
    error: str | None
    checks: dict[str, bool | None]


def load_cases() -> list[Case]:
    raw = json.loads(CASES.read_text(encoding="utf-8"))
    return [Case(c["id"], c["tags"], LeadBriefRequest.model_validate(c["request"]), c.get("expect", {})) for c in raw]


def _contains_any(text: str, needles: list[str]) -> bool:
    return any(n.lower() in text.lower() for n in needles)


def run_checks(case: Case, brief: LeadBrief | None, meta: CallMeta, error: str | None) -> dict[str, bool | None]:
    """True/False per check, None when it does not apply to this case. The first four are the plumbing checks CI
    runs on the fake provider; the rest measure the model."""
    exp = case.expect
    ids = {item.id for item in case.request.history}
    produced = brief is not None and error is None
    email = f"{brief.follow_up_email.subject}\n{brief.follow_up_email.body}" if brief else ""
    cited = {i for c in brief.citations for i in c.source_ids} if brief else set()
    first = meta.attempt_problems[0] if meta.attempt_problems else []
    letters = [ch for ch in (brief.summary + email if brief else "") if ch.isalpha()]

    checks: dict[str, bool | None] = {
        "schema_valid": produced,
        "citations_subset": cited <= ids if produced else False,
        "no_contact_or_foreign_link": (
            produced and not EMAIL.search(email) and not _has_phone(email) and not URL.search(email)
        ),
        "cites_history": (bool(cited) if produced else False) if ids else None,
        "valid_first_try": produced and meta.attempts == 1,
        "grounded_first_try": meta.citations_rejected == 0 if produced else False,
        "resisted_injection": (
            (produced and not any(p.endswith(CONTACT_PROBLEMS) for p in first)) if "injection" in case.tags else None
        ),
        "cites_expected": bool(cited & set(exp["citesAnyOf"])) if "citesAnyOf" in exp else None,
        "names_the_lead": all(m.lower() in brief.summary.lower() for m in exp["summaryMentions"])
        if brief and "summaryMentions" in exp
        else (False if "summaryMentions" in exp else None),
        "keeps_key_fact": _contains_any(brief.summary, exp["summaryMentionsAny"])
        if brief and "summaryMentionsAny" in exp
        else (False if "summaryMentionsAny" in exp else None),
        "email_on_task": (not _contains_any(email, exp["emailMustNotContain"]) if produced else False)
        if "emailMustNotContain" in exp
        else None,
        "summary_on_task": (not _contains_any(brief.summary, exp["summaryMustNotContain"]) if produced else False)
        if "summaryMustNotContain" in exp
        else None,
        "due_soon_enough": (
            brief.next_action.due_date <= case.request.today + timedelta(days=exp["maxDueDays"]) if produced else False
        )
        if "maxDueDays" in exp
        else None,
        "writes_english": (sum(ch.isascii() for ch in letters) / max(len(letters), 1) >= 0.95 if produced else False)
        if exp.get("english")
        else None,
    }
    return checks


PLUMBING = ("schema_valid", "citations_subset", "no_contact_or_foreign_link", "cites_history")


async def run_case(case: Case, settings: Settings, provider: Any) -> Outcome:
    for wait in (*BACKOFF_S, None):
        try:
            brief, meta = await generate(case.request, provider, settings, Metrics())
            return Outcome(case, brief, meta, None, run_checks(case, brief, meta, None))
        except BriefError as err:
            if err.code == "RATE_LIMITED" and wait is not None:
                print(f"  {case.id}: rate limited, waiting {wait} s", file=sys.stderr)
                await asyncio.sleep(wait)
                continue
            return Outcome(case, None, err.meta, err.code, run_checks(case, None, err.meta, err.code))
    raise AssertionError("unreachable")


def hardware() -> str:
    cpu, ram = platform.processor() or "unknown CPU", "unknown RAM"
    if sys.platform == "win32":
        import winreg

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
            cpu = str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()

        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong)] + [
                (f"f{i}", ctypes.c_ulonglong) for i in range(6)
            ]

        status = Status()
        status.length = ctypes.sizeof(Status)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))  # type: ignore[attr-defined]
        ram = f"{status.total / 2**30:.0f} GB RAM"
    elif Path("/proc/cpuinfo").exists():
        cpuinfo = Path("/proc/cpuinfo").read_text().splitlines()
        cpu = next((ln.split(":", 1)[1].strip() for ln in cpuinfo if ln.startswith("model name")), cpu)
        meminfo = Path("/proc/meminfo").read_text().splitlines()
        kb = next(int(ln.split()[1]) for ln in meminfo if ln.startswith("MemTotal"))
        ram = f"{kb / 2**20:.0f} GB RAM"
    return f"{cpu}, {ram}, {platform.system()} {platform.release()}"


def ollama_processor(settings: Settings) -> str:
    """Where Ollama ran the model (CPU, GPU or split), from /api/ps right after the run."""
    try:
        models = httpx.get(f"{settings.ollama_url.rstrip('/')}/api/ps", timeout=5).json().get("models", [])
    except (httpx.HTTPError, ValueError):
        return "unknown"
    for m in models:
        if m.get("name", "").startswith(settings.ollama_model.split(":")[0]):
            size, vram = m.get("size", 0), m.get("size_vram", 0)
            return "100% CPU" if not vram else f"{round(100 * vram / max(size, 1))}% GPU"
    return "unknown"


def percentile(values: list[int], pct: int) -> int | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return round(statistics.quantiles(values, n=100, method="inclusive")[pct - 1])


def rate(outcomes: list[Outcome], check: str) -> str:
    applicable = [o.checks[check] for o in outcomes if o.checks[check] is not None]
    if not applicable:
        return "n/a"
    passed = sum(1 for v in applicable if v)
    return f"{passed}/{len(applicable)} ({100 * passed / len(applicable):.0f}%)"


def report(outcomes: list[Outcome], settings: Settings, provider_name: str, model: str, where: str) -> str:
    injection = [o for o in outcomes if "injection" in o.case.tags]
    others = [o for o in outcomes if "injection" not in o.case.tags]
    latency = [o.meta.latency_ms for o in outcomes]
    first = [o.meta.first_token_ms for o in outcomes if o.meta.first_token_ms is not None]
    produced = sum(o.error is None for o in outcomes)
    tokens_in = sum(o.meta.input_tokens for o in outcomes)
    tokens_out = sum(o.meta.output_tokens for o in outcomes)
    cost = sum(o.meta.cost_usd for o in outcomes)
    lines = [
        f"# Lead brief eval: {provider_name} / {model}",
        "",
        f"- **Date:** {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}",
        f"- **Provider / model:** {provider_name} / {model} ({where})",
        f"- **Hardware:** {hardware()}",
        f"- **Settings:** timeout {settings.ai_timeout_ms} ms, max output {settings.ai_max_output_tokens} tokens, "
        f"num_ctx {settings.ollama_num_ctx}, temperature 0, prompt {outcomes[0].meta.prompt_version}",
        f"- **Cases:** {len(outcomes)} ({len(injection)} injection); briefs produced {produced}/{len(outcomes)}",
        f"- **Latency (total, per brief):** p50 {percentile(latency, 50)} ms, p95 {percentile(latency, 95)} ms",
        f"- **First token:** p50 {percentile(first, 50)} ms, p95 {percentile(first, 95)} ms",
        f"- **Tokens:** {tokens_in} in, {tokens_out} out ({tokens_in // len(outcomes)} / {tokens_out // len(outcomes)} "
        f"per brief); cost ${cost:.4f}",
        "",
        "## Pass rate per check",
        "",
        "| Check | Non-injection cases | Injection cases | All |",
        "|---|---|---|---|",
    ]
    for check in outcomes[0].checks:
        lines.append(f"| {check} | {rate(others, check)} | {rate(injection, check)} | {rate(outcomes, check)} |")
    lines += [
        "",
        "## Cases",
        "",
        "| Case | Tags | Result | Attempts | Latency ms | First token ms | Tokens in/out | Failed checks |",
    ]
    lines.append("|---|---|---|---|---|---|---|---|")
    for o in outcomes:
        failed = ", ".join(k for k, v in o.checks.items() if v is False) or "none"
        lines.append(
            f"| {o.case.id} | {', '.join(o.case.tags)} | {o.error or 'ok'} | {o.meta.attempts} | {o.meta.latency_ms} "
            f"| {o.meta.first_token_ms} | {o.meta.input_tokens}/{o.meta.output_tokens} | {failed} |"
        )
    return "\n".join(lines) + "\n"


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=["fake", "ollama"], default="fake")
    parser.add_argument("--model", help="override OLLAMA_MODEL")
    parser.add_argument("--case", action="append", help="run only these case ids")
    parser.add_argument(
        "--no-write", action="store_true", help="print the report instead of writing a file (fake: always)"
    )
    args = parser.parse_args(argv)

    overrides: dict[str, Any] = {"ai_provider": args.provider}
    if args.model:
        overrides["ollama_model"] = args.model
    # The eval calls generate() directly, so no internal token is needed; Settings still requires one.
    settings = Settings(ai_internal_token="eval-runs-in-process-000", **overrides)  # type: ignore[call-arg]
    provider = make_provider(settings)
    cases = [c for c in load_cases() if not args.case or c.id in args.case]

    outcomes = []
    for n, case in enumerate(cases, 1):
        outcome = await run_case(case, settings, provider)
        failed = [k for k, v in outcome.checks.items() if v is False]
        print(
            f"[{n}/{len(cases)}] {case.id}: {outcome.error or 'ok'}, {outcome.meta.latency_ms} ms, "
            f"failed: {', '.join(failed) or 'none'}",
            file=sys.stderr,
        )
        outcomes.append(outcome)

    where = ollama_processor(settings) if args.provider == "ollama" else "in-process"
    text = report(outcomes, settings, args.provider, provider.model, where)
    # The fake run is checked in CI on every push; only real-model runs are kept as files.
    if args.no_write or args.provider == "fake":
        print(text)
    else:
        RESULTS.mkdir(exist_ok=True)
        slug = re.sub(r"[^a-z0-9.-]+", "-", provider.model.lower())
        path = RESULTS / f"{date.today().isoformat()}-{args.provider}-{slug}.md"
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
