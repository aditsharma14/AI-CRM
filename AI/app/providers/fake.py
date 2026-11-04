"""FakeProvider: a deterministic brief built from the bundle alone. Tests, CI, compose and the Pages demo use it
(frontend/src/demo/ has the same rules in JavaScript). It never calls out and costs nothing."""

import json
from datetime import timedelta
from typing import Any

from app.lead_brief.models import HistoryItem, LeadBriefRequest
from app.providers.base import Completion


def _label(item: HistoryItem) -> str:
    return item.title or (item.text[:80] if item.text else item.kind)


class FakeProvider:
    name = "fake"
    model = "fake"

    def brief(self, request: LeadBriefRequest) -> dict[str, Any]:
        lead = request.lead
        history = sorted(request.history, key=lambda item: item.date, reverse=True)
        open_tasks = sorted((h for h in history if h.type == "task" and h.status == "open"), key=lambda h: h.date)

        who = f"{lead.name} at {lead.company}" if lead.company else lead.name
        summary = f"{who} is a {lead.status} lead from {lead.source or 'an unknown source'}."
        citations = []
        if history:
            latest = history[0]
            when = latest.date.date()
            summary += f" There are {len(history)} recorded updates; the latest, on {when}, is: {_label(latest)}."
            citations.append({"claim": summary[:300], "sourceIds": [latest.id]})
        else:
            summary += " There is no recorded activity yet."

        due = request.today + timedelta(days=2)
        if open_tasks:
            task = open_tasks[0]
            action = f"Complete the open task: {_label(task)}"[:200]
            due = max(request.today, min(task.date.date(), request.today + timedelta(days=60)))
            citations.append({"claim": action, "sourceIds": [task.id]})
        else:
            action = f"Call {lead.name} to agree on next steps"[:200]

        # Built from the lead's name only, never from note text: nothing a note says can reach the email.
        first_name = lead.name.split()[0]
        email = {
            "subject": f"Following up, {first_name}"[:120],
            "body": (
                f"Hi {first_name},\n\nThank you for your time so far. I wanted to follow up on where things stand "
                "and see whether a short call this week would help.\n\nBest regards"
            ),
        }
        return {
            "summary": summary[:800],
            "nextAction": {"action": action, "dueDate": due.isoformat()},
            "followUpEmail": email,
            "citations": citations,
        }

    async def complete(
        self, *, request: LeadBriefRequest, system: str, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> Completion:
        text = json.dumps(self.brief(request))
        prompt_chars = len(system) + sum(len(m["content"]) for m in messages)
        # Rough token counts (4 characters a token), so the log and metrics plumbing sees realistic numbers.
        return Completion(text, prompt_chars // 4, len(text) // 4, self.model, first_token_ms=0)
