"""Picks the provider from AI_PROVIDER: fake (the default) or ollama."""

from app.config import Settings
from app.providers.base import Provider
from app.providers.fake import FakeProvider
from app.providers.ollama import OllamaProvider


def make_provider(settings: Settings) -> Provider:
    return OllamaProvider(settings) if settings.ai_provider == "ollama" else FakeProvider()
