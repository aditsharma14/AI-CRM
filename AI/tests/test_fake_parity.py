"""FakeProvider's output is pinned by contracts/lead-brief-fake.json, which the Pages demo's JavaScript port
(frontend/src/demo/leadBrief.js) is also held to: change one without the other and a test fails."""

import json
from pathlib import Path

import pytest

from app.lead_brief.models import LeadBriefRequest
from app.providers.fake import FakeProvider

FIXTURE = json.loads((Path(__file__).parents[2] / "contracts" / "lead-brief-fake.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("entry", FIXTURE, ids=[str(i) for i in range(len(FIXTURE))])
def test_fake_provider_matches_the_fixture(entry) -> None:
    assert FakeProvider().brief(LeadBriefRequest.model_validate(entry["bundle"])) == entry["brief"]
