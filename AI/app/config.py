"""Settings from the environment (and AI/.env): provider choice, model, limits, price, the internal token."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Shared secret Express sends as X-Internal-Token. Required: the service refuses to start without one, so it is
    # never reachable unauthenticated by mistake.
    ai_internal_token: SecretStr = Field(min_length=16)

    # fake: deterministic, offline (tests, CI, compose, the demo). ollama: a real model running locally.
    ai_provider: Literal["fake", "ollama"] = "fake"

    ollama_url: str = "http://localhost:11434"
    # Picked for a CPU-only laptop (docs/ai.md): 2 GB, Hindi among its official languages.
    ollama_model: str = "llama3.2:3b"
    # Context window to request; must hold the whole prompt (Express caps the history at about 12,000 characters).
    ollama_num_ctx: int = Field(default=8192, ge=2048, le=131072)
    ollama_keep_alive: str = "30m"
    # Thinking models (qwen3): false turns thinking off, which saves many seconds on a CPU. Unset: the field is not
    # sent and the model's default applies (llama3.2 has no thinking mode).
    ollama_think: bool | None = None

    ai_max_output_tokens: int = Field(default=800, ge=128, le=8000)
    # One attempt gets this whole budget; Express aborts a little later (its AI_TIMEOUT_MS plus a margin).
    ai_timeout_ms: int = Field(default=60_000, ge=1000, le=300_000)

    # USD per million tokens. Zero: both providers are free. A paid hosted model needs only these and a provider.
    ai_price_input_per_mtok: float = Field(default=0.0, ge=0)
    ai_price_output_per_mtok: float = Field(default=0.0, ge=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
