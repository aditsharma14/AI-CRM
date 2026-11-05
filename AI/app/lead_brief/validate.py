"""Checks a model answer beyond its schema: grounding, contact details and links, the due date, the summary length.
Problems are fixed sentences (never quoting the answer), so they are safe to log and to send back for the retry."""

import re
from dataclasses import dataclass, field
from datetime import timedelta

from pydantic import ValidationError

from app.lead_brief.models import LeadBrief, LeadBriefRequest

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"(?:https?://|www\.)[^\s<>\"')\]]+", re.IGNORECASE)
# A bare domain (`secure-pay.net/x`, `bit.ly/x`): what an injected note asks for when a scheme would be caught. Only
# TLDs from a list count, so "v2.0", "e.g.", "Node.js" or "report.pdf" never match. Not right after `@` (the email
# check) or `://` (a defanged `hxxps://host` in a note is not a link the history offers), and never mid-host.
TLDS = (
    "com|net|org|info|biz|io|ai|app|dev|xyz|top|site|online|link|click|live|shop|store|tech|cloud|email|support|"
    "help|page|website|space|digital|ly|gl|gd|cc|tk|ml|ga|cf|gq|pw|ws|tv|su|in|co|uk|de|fr|ru|cn|jp|br|au|ca|nl|"
    "es|ch|se|pl|ua|ir|pk|bd|lk|np|ae|sa|sg|hk|kr|vn|th|ph|za|ng|ke|mx|ar|cl|pe|eu"
)
# Also English words: they count only when the host looks like a link (a hyphen, three or more labels, or a path),
# so "done.It" and "Go.to the meeting" stay text. A two-label host with one of these and no path is not caught.
WORD_TLDS = "to|us|it|is|so|at|be|my|go|do|no|am|me"
DOMAIN = re.compile(
    rf"(?<![\w@./:-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+)({TLDS}|{WORD_TLDS})\b"
    r"(/[^\s<>\"')\]]*)?",
    re.IGNORECASE,
)
TRAILING = ".,;:!?/"
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


def _without_identity(text: str, request: LeadBriefRequest) -> str:
    """The text minus the lead's own name and company: digits in those (a branch or order number) are identity,
    not a contact detail. Anything else in the text is still scanned."""
    for part in (request.lead.name, request.lead.company):
        if part:
            text = re.sub(re.escape(part), " ", text, flags=re.IGNORECASE)
    return text


def find_links(text: str) -> list[str]:
    """Every link in the text: with a scheme or www., or a bare domain with an optional path."""
    links = [m.rstrip(TRAILING) for m in URL.findall(text)]
    rest = URL.sub(" ", text)
    for m in DOMAIN.finditer(rest):
        host, tld, path = m.group(1), m.group(2), m.group(3)
        if re.fullmatch(WORD_TLDS, tld, re.IGNORECASE) and not (path or "-" in host or host.count(".") >= 2):
            continue
        links.append(m.group(0).rstrip(TRAILING))
    return links


def _normal(link: str) -> str:
    """One spelling per link: no scheme, no www., lower case, no trailing punctuation or slash."""
    return re.sub(r"^(?:https?://)?(?:www\.)?", "", link.lower()).rstrip(TRAILING)


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

    # A link passes only if the history holds the same link (exactly, not as part of a longer one).
    offered = {_normal(link) for link in find_links(_bundle_text(request))}
    email = f"{brief.follow_up_email.subject}\n{brief.follow_up_email.body}"
    for name, value in (("followUpEmail", email), ("nextAction", brief.next_action.action)):
        identity_free = _without_identity(value, request)
        if EMAIL.search(identity_free):
            problems.append(f"{name} contains an email address")
        if _has_phone(identity_free):
            problems.append(f"{name} contains a phone number")
        if any(_normal(link) not in offered for link in find_links(value)):
            problems.append(f"{name} contains a link that is not in the history")

    due = brief.next_action.due_date
    if not request.today <= due <= request.today + timedelta(days=MAX_DUE_DAYS):
        problems.append(f"nextAction.dueDate must be between today and {MAX_DUE_DAYS} days from today")

    if len(SENTENCE_END.findall(brief.summary.strip() + " ")) > 5:
        problems.append("summary is longer than 2 or 3 sentences")

    return Checked(brief, problems, rejected)
