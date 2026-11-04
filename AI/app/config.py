"""Settings from the environment (and AI/.env): provider choice, model and price, limits, the internal token."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Shared secret Express sends as X-Internal-Token. Required: the service refuses to start without one, so it is
    # never reachable unauthenticated by mistake.
    ai_internal_token: SecretStr = Field(min_length=16)

    # fake: deterministic, offline, free (tests, CI, local dev). anthropic: the real model; needs ANTHROPIC_API_KEY.
    ai_provider: Literal["fake", "anthropic"] = "fake"
    anthropic_api_key: SecretStr | None = None

    # Model and price come from config, never from code. Checked 2026-11-05 on Anthropic's models overview and
    # pricing pages: Claude Haiku 5.5, USD per million tokens for prompts up to 100K tokens (ours are far smaller).
    ai_model: str = "claude-haiku-5-5"
    ai_price_input_per_mtok: float = 0.10
    ai_price_output_per_mtok: float = 0.50
    ai_effort: Literal["low", "medium", "high"] = "low"
    ai_thinking: Literal["adaptive", "disabled"] = "adaptive"
    # Covers thinking plus the brief itself.
    ai_max_output_tokens: int = Field(default=2000, ge=256, le=16000)
    # One attempt gets the whole budget; Express gives up at 15 s.
    ai_request_timeout_s: float = Field(default=12.0, gt=0, le=60)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
