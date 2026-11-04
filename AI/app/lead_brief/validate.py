"""Checks a model answer beyond its schema: grounding, contact details and links, the due date, the summary length.
Problems are fixed sentences (never quoting the answer), so they are safe to log and to send back for the retry."""

import re
from dataclasses import dataclass, field
from datetime import timedelta

from pydantic import ValidationError

from app.lead_brief.models import LeadBrief, LeadBriefRequest

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"(?:https?://|www\.)[^\s<>\"')\]]+", re.IGNORECASE)
ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
# A run of digits with phone-style separators; 9+ digits makes it a phone number (Indian mobiles have 10).
DIGIT_RUN = re.compile(r"[+(]?\d[\d\s().-]{6,}\d")
SENTENCE_END = re.compile(r"[.!?।](?:\s|$)")
MAX_DUE_DAYS = 60


@dataclass
class Checked:
    brief: LeadBrief | None
    problems: list[str] = field(default_factory=list)
    citations_rejected: int = 0


def _has_phone(text: str) -> bool:
    text = ISO_DATE.sub(" ", text)
    return any(sum(ch.isdigit() for ch in run) >= 9 for run in DIGIT_RUN.findall(text))


def _bundle_text(request: LeadBriefRequest) -> str:
    lead = request.lead
    parts = [lead.name, lead.company or "", lead.source or ""]
    parts += [part for item in request.history for part in (item.title or "", item.text)]
    return "\n".join(parts)


def _schema_problem(err: ValidationError) -> str:
    # Field paths and messages only: Pydantic's "input" would quote the answer.
    where = "; ".join(f"{'.'.join(str(p) for p in e['loc']) or 'answer'}: {e['msg']}" for e in err.errors()[:5])
    return f"the answer does not match the schema ({where})"


def check(text: str, request: LeadBriefRequest) -> Checked:
    try:
        brief = LeadBrief.model_validate_json(text)
    except ValidationError as err:
        return Checked(None, [_schema_problem(err)])

    known = {item.id for item in request.history}
    rejected = 0
    citations = []
    for citation in brief.citations:
        ids = list(dict.fromkeys(citation.source_ids))
        good = [i for i in ids if i in known]
        rejected += len(ids) - len(good)
        if good:
            citations.append(citation.model_copy(update={"source_ids": good}))
    brief = brief.model_copy(update={"citations": citations})

    problems = []
    if request.history and not citations:
        problems.append("no citation points at an id from <history>")

    bundle = _bundle_text(request)
    email = f"{brief.follow_up_email.subject}\n{brief.follow_up_email.body}"
    for name, value in (("followUpEmail", email), ("nextAction", brief.next_action.action)):
        if EMAIL.search(value):
            problems.append(f"{name} contains an email address")
        if _has_phone(value):
            problems.append(f"{name} contains a phone number")
        if any(link.rstrip(".,;:!?") not in bundle for link in URL.findall(value)):
            problems.append(f"{name} contains a link that is not in the history")

    due = brief.next_action.due_date
    if not request.today <= due <= request.today + timedelta(days=MAX_DUE_DAYS):
        problems.append(f"nextAction.dueDate must be between today and {MAX_DUE_DAYS} days from today")

    if len(SENTENCE_END.findall(brief.summary.strip() + " ")) > 5:
        problems.append("summary is longer than 2 or 3 sentences")

    return Checked(brief, problems, rejected)
