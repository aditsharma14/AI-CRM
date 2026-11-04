"""The app boots from settings, answers /health, and refuses to start without an internal token."""

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_health(client) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_no_interactive_docs(client) -> None:
    # Internal service: no /docs or /openapi.json to map its surface.
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize("token", [None, "", "short"])
def test_settings_require_a_real_internal_token(token, monkeypatch) -> None:
    monkeypatch.delenv("AI_INTERNAL_TOKEN", raising=False)
    kwargs = {} if token is None else {"ai_internal_token": token}
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **kwargs)  # type: ignore[call-arg]


def test_defaults_are_the_fake_provider_and_a_free_local_model(settings) -> None:
    assert settings.ai_provider == "fake"
    assert settings.ollama_model == "llama3.2:3b"
    assert (settings.ai_price_input_per_mtok, settings.ai_price_output_per_mtok) == (0.0, 0.0)
