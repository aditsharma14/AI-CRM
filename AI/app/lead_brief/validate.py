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
# check), and never mid-host; after any scheme, `hxxps://` included, a host still counts.
TLDS = (
    "com|net|org|info|biz|io|ai|app|dev|xyz|top|site|online|link|click|live|shop|store|tech|cloud|email|support|"
    "help|page|website|space|digital|ly|gl|gd|cc|tk|ml|ga|cf|gq|pw|ws|tv|su|in|co|uk|de|fr|ru|cn|jp|br|au|ca|nl|"
    "es|ch|se|pl|ua|ir|pk|bd|lk|np|ae|sa|sg|hk|kr|vn|th|ph|za|ng|ke|mx|ar|cl|pe|eu"
)
# Also English words: they count only when the host looks like a link (a hyphen, three or more labels, or a path),
# so "done.It" and "Go.to the meeting" stay text. A two-label host with one of these and no path is not caught.
WORD_TLDS = "to|us|it|is|so|at|be|my|go|do|no|am|me"
# A host may also use other scripts: a look-alike (`sahyadrі.co.in`, Cyrillic і) or a full IDN (`пример.рф`). Any
# non-ASCII character that isn't space or punctuation can be part of a label. A non-ASCII TLD counts only in a
# non-Latin script and with 2+ characters (`рф`, `भारत`): accented Latin makes words, so "Gracias.Señor" and
# "Merci.À" stay text. Punycode TLDs (`xn--p1ai`) count too.
NON_ASCII = r"[^\x00-\x7f\s\u00a0-\u00bf\u00d7\u00f7\u0964\u0965\u2000-\u206f\u3000-\u303f\ufe30-\ufe4f\uff00-\uff0f]"
NON_LATIN = rf"(?:(?![\u00c0-\u024f\u1e00-\u1eff]){NON_ASCII})"
LABEL_CHAR = rf"(?:[a-z0-9]|{NON_ASCII})"
LABEL = rf"{LABEL_CHAR}(?:(?:{LABEL_CHAR}|-)*{LABEL_CHAR})?"
IDN_TLD = rf"{NON_LATIN}(?:{NON_LATIN}|-)*{NON_LATIN}|xn--[a-z0-9-]+"
DOMAIN = re.compile(
    rf"(?<![a-z0-9@._-])(?<!{NON_ASCII})((?:{LABEL}\.)+)({TLDS}|{WORD_TLDS}|{IDN_TLD})(?![a-z0-9_-])(?!{NON_ASCII})"
    r"(/[^\s<>\"')\]]*)?",
    re.IGNORECASE,
)
TRAILING = ".,;:!?/"
# What a link's host is: after the scheme and any `user@`, before the port, path, query or fragment.
HOST = re.compile(r"^(?:[a-z][a-z0-9+.-]*://)?(?:[^/?#\s]*@)?([^/?#:\s]+)", re.IGNORECASE)
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


def canonical_host(host: str) -> str | None:
    """One spelling per host: lower case, no trailing dot, other scripts as punycode (`пример.рф` and
    `xn--e1afmkfd.xn--p1ai` are the same host; `sahyadrі.co.in` with a Cyrillic і is not `sahyadri.co.in`). None when
    it can't be a host name."""
    host = host.strip().rstrip(".").lower()
    try:
        return host.encode("idna").decode("ascii") if host else None
    except UnicodeError:
        return None


def is_company_site(link: str, domain: str | None) -> bool:
    """The link is on the company's website: its host is the domain or, for a plain ASCII host, a subdomain of it.
    A host in another script or in punycode must be the domain exactly: a subdomain there is a look-alike risk."""
    match = HOST.match(link)
    site = canonical_host(domain) if domain else None
    host = canonical_host(match.group(1)) if match else None
    if not site or not host:
        return False
    if not match.group(1).isascii() or any(label.startswith("xn--") for label in host.split(".")):
        return host == site
    return host == site or host.endswith("." + site)


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

    # The only link allowed is the company's own website, from the CRM's structured field. History text is untrusted
    # (an attacker can write a note), so a link there, however plainly stated, never makes a link allowed.
    domain = request.lead.company_domain
    email = f"{brief.follow_up_email.subject}\n{brief.follow_up_email.body}"
    for name, value in (("followUpEmail", email), ("nextAction", brief.next_action.action)):
        identity_free = _without_identity(value, request)
        if EMAIL.search(identity_free):
            problems.append(f"{name} contains an email address")
        if _has_phone(identity_free):
            problems.append(f"{name} contains a phone number")
        if any(not is_company_site(link, domain) for link in find_links(value)):
            problems.append(f"{name} contains a link that is not the company's website")

    due = brief.next_action.due_date
    if not request.today <= due <= request.today + timedelta(days=MAX_DUE_DAYS):
        problems.append(f"nextAction.dueDate must be between today and {MAX_DUE_DAYS} days from today")

    if len(SENTENCE_END.findall(brief.summary.strip() + " ")) > 5:
        problems.append("summary is longer than 2 or 3 sentences")

    return Checked(brief, problems, rejected)
