"""Request and output models for POST /v1/lead-brief. camelCase on the wire; unknown fields are rejected."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

OBJECT_ID = r"^[0-9a-f]{24}$"


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


# ---- what Express sends: the minimal bundle (docs/ai.md lists every field and where it may go)


class Lead(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    # The company's website (`Company.domain`, a bare host): the only link a brief may contain.
    company_domain: str | None = Field(default=None, max_length=253)
    status: Literal["new", "contacted", "qualified", "unqualified", "converted"]
    score: int | None = Field(default=None, ge=0, le=100)
    source: str | None = Field(default=None, max_length=100)
    created_at: datetime


class HistoryItem(CamelModel):
    """One activity or note. `id` is the only internal id that leaves Express: citations point at it."""

    id: str = Field(pattern=OBJECT_ID)
    kind: Literal["activity", "note"]
    type: Literal["task", "call", "meeting", "event"] | None = None
    title: str | None = Field(default=None, max_length=200)
    text: str = Field(default="", max_length=1000)
    date: datetime
    status: Literal["open", "done"] | None = None


class LeadBriefRequest(CamelModel):
    today: date
    lead: Lead
    history: list[HistoryItem] = Field(default_factory=list, max_length=20)
    # How many older items Express left out to stay under its size cap.
    truncated: int = Field(default=0, ge=0)


# ---- what the model must return (its JSON schema is sent to the provider as the output format)


class NextAction(CamelModel):
    action: str = Field(min_length=1, max_length=200)
    due_date: date


class FollowUpEmail(CamelModel):
    subject: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)


class Citation(CamelModel):
    claim: str = Field(min_length=1, max_length=300, description="The sentence or part of the brief this supports.")
    source_ids: list[str] = Field(max_length=10, description="ids of the history items the claim is based on.")


class LeadBrief(CamelModel):
    summary: str = Field(min_length=1, max_length=800)
    next_action: NextAction
    follow_up_email: FollowUpEmail
    citations: list[Citation] = Field(max_length=10)
