"""OllamaProvider: a model running locally in Ollama (POST /api/chat, `format` = the brief's JSON schema), over httpx.
Nothing leaves the machine and nothing costs money. Settings pick the URL, model and limits."""

from typing import Any

import httpx

from app.config import Settings
from app.lead_brief.models import LeadBriefRequest
from app.providers.base import Completion, ProviderError, ProviderRateLimitedError, ProviderTimeoutError

NS_PER_MS = 1_000_000


class OllamaProvider:
    name = "ollama"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.model = settings.ollama_model
        self._settings = settings
        self._url = f"{settings.ollama_url.rstrip('/')}/api/chat"
        self._client = client or httpx.AsyncClient()

    async def complete(
        self,
        *,
        request: LeadBriefRequest,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, Any],
        timeout_ms: int,
    ) -> Completion:
        s = self._settings
        body = {
            "model": self.model,
            "stream": False,
            "format": schema,
            "messages": [{"role": "system", "content": system}, *messages],
            # Temperature 0 for repeatable briefs (Ollama's structured-output guidance). num_ctx must hold the whole
            # prompt: Ollama's default window would silently cut the oldest history off.
            "options": {"temperature": 0, "num_ctx": s.ollama_num_ctx, "num_predict": s.ai_max_output_tokens},
            # Keeps the model loaded between briefs; a cold load took 14 s on the bench machine.
            "keep_alive": s.ollama_keep_alive,
        }
        if s.ollama_think is not None:
            body["think"] = s.ollama_think
        try:
            res = await self._client.post(self._url, json=body, timeout=timeout_ms / 1000)
        except httpx.TimeoutException as err:
            raise ProviderTimeoutError("the local model did not answer in time") from err
        except httpx.HTTPError as err:
            raise ProviderError(f"could not reach Ollama at {s.ollama_url}") from err

        if res.status_code == 429:
            raise ProviderRateLimitedError("Ollama is busy")
        if res.status_code == 404:
            raise ProviderError(f"model {self.model} is not installed in Ollama (run: ollama pull {self.model})")
        if res.status_code >= 400:
            raise ProviderError(f"Ollama returned {res.status_code}")
        try:
            data = res.json()
            text = data["message"]["content"]
        except (ValueError, KeyError, TypeError) as err:
            raise ProviderError("Ollama returned a response without a message") from err

        input_tokens = int(data.get("prompt_eval_count", 0)) + int(data.get("prompt_eval_cached_count", 0))
        load_and_prompt_ns = int(data.get("load_duration", 0)) + int(data.get("prompt_eval_duration", 0))
        return Completion(
            text=text,
            input_tokens=input_tokens,
            output_tokens=int(data.get("eval_count", 0)),
            model=str(data.get("model", self.model)),
            first_token_ms=load_and_prompt_ns // NS_PER_MS,
        )
