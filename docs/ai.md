# AI: the lead brief

Nimbus CRM has one AI feature: the **lead brief** on a lead's page (`/leads/:id`). One click writes a 2–3 sentence
summary of the lead, one next step with a due date, and a draft follow-up email (copied by the rep, never sent by
the app), each claim citing the history entries it rests on. Nothing else is built: no chat, no memory, no search
over documents.

**It costs ₹0 to build, test, run and demo.** Two providers exist and both are free:

| Provider | Used by | What it is |
|---|---|---|
| `fake` (default) | tests, CI, `docker compose`, the GitHub Pages demo | A deterministic brief built from the lead's data by fixed rules. Offline, instant. |
| `ollama` | anyone who installs Ollama | A real model running locally in [Ollama](https://ollama.com). No account, no key, no card. |

No paid API, hosted service or key is needed anywhere: not in CI, the tests, compose, the README quickstart or the demo.

## Data flow

```
 browser ──POST /api/v1/ai/leads/:id/brief──▶ Express API (backend/)
                                               │ auth → ai:use → AI_ENABLED? → lead in the caller's org? (else 404, no AI call)
                                               │ lead + last 20 activities and notes, org-scoped; minimal bundle (below)
                                               │ cache (Mongo, per org, 7-day TTL) ─ hit ─▶ answer, no AI call
                                               │ one in-flight call per key; 20 calls/org/hour; 5 refreshes/lead/hour
                                               ▼  X-Internal-Token, AI_TIMEOUT_MS (+1 s)
                                     AI service (AI/, FastAPI; never touches MongoDB)
                                               │ prompt v1: history in escaped, delimited data blocks
                                               ▼
                                     provider: fake (in-process) | ollama (http://<host>:11434)
                                               │ JSON shaped by the brief's schema
                                               ▼
                                     validate (schema, citations ⊆ bundle, no contact details or foreign links,
                                     due date) ─ fail ─▶ one retry with the reasons ─ fail ─▶ BAD_OUTPUT
                                               ▼
 Express: re-validate (Zod), drop citations outside the bundle, cache, one log line ──▶ the card
```

Code: [aiBriefService.js](../backend/src/services/aiBriefService.js) (bundle, cache, limits),
[aiProxyService.js](../backend/src/services/aiProxyService.js) (HTTP, errors),
[AI/app/lead_brief/](../AI/app/lead_brief/) (prompt, validation, retry), [AI/app/providers/](../AI/app/providers/).

### What leaves the API

Express sends the AI service only this, built in `buildBundle`:

- **The lead:** name, company name, status, score, source, creation date.
- **Per history item (at most 20):** its id, kind (activity or note), type, title (≤ 200 characters), text
  (≤ 1,000), date, status. At most 12,000 characters in all; the oldest are left out first.
- **Today's date**, and how many older items were left out.

Never sent: any email address or phone number (the lead's included: the UI fills the recipient from the lead record),
user names or ids, the org id, the lead's id, or any other id.

**Where it goes:** with `fake`, nowhere: the brief is computed inside the AI service. With `ollama`, to the Ollama
server at `OLLAMA_URL`, which is this machine (`localhost`, or `host.docker.internal` from compose). **No lead data
leaves the machine with either provider.**

## Threat model

1. **Prompt injection through notes.** Activity and note text is untrusted (reps paste customer emails). It goes in
   delimited `<history><item id=…>` blocks with `<`, `>` and `&` escaped, so a note cannot close its block, and the
   system prompt says those blocks are data, never instructions. The output is then checked, not trusted: citations
   must point at ids that were sent, and the email and next step may contain no email address, no phone number and
   no link that wasn't already in the history (an injected phishing link is the realistic attack). The email is a
   draft a person copies; the app never sends anything. Six eval cases attack this directly.
2. **Data leaving the machine.** The bundle above is the minimum the brief needs, and both providers run locally.
   Logs carry numbers and codes only (no prompt, note, brief or email text): one line per call in each service.
3. **Cross-tenant access.** The lead is loaded with the caller's `orgId` from the JWT; another org's lead is a 404
   and the AI service is never called. The history is loaded the same way, cache rows are keyed and stored per org,
   and the in-flight table is keyed by org and cache key.
4. **Abuse, cost and availability.** 20 AI calls per org per hour (cache hits are free), 5 regenerations per lead per
   hour, one shared call for concurrent identical requests, a time limit on every call (`AI_TIMEOUT_MS`), and a
   kill switch: `AI_ENABLED=false` hides the button and makes the endpoint answer 503 `AI_UNAVAILABLE`.
5. **The service-to-service hop.** The AI service has no public port in compose and requires `X-Internal-Token`
   (compared in constant time) on everything but `/health`; it refuses to start without a 16+ character token, and
   Express refuses to start with AI on and no token, or with a known placeholder token in production.

## Prompt versioning

The prompt lives in [AI/app/lead_brief/prompt.py](../AI/app/lead_brief/prompt.py) with `PROMPT_VERSION`
(now `lead-brief/1`). Any change to its text bumps the version. Express reads the provider, model and prompt version
from the AI service (`GET /v1/info`) and puts them in the cache key, so a new prompt, provider or model never serves an
old brief. Every brief and every eval results file records the version it was made with.

## Evals

19 hand-written cases in [AI/evals/lead_brief/cases.json](../AI/evals/lead_brief/cases.json): normal (4), empty history,
long histories (one with 15 older items left out, one with a note at the size cap), conflicting notes (2), six injection
attempts (email everyone, a fake closing tag, a phishing link, an attacker's address and phone, bogus citation ids,
reveal the prompt), Hindi and Spanish notes, a lead lost to a competitor, and a minimal converted lead.

- **In CI** (free): every case runs through the real `generate()` with the fake provider, held to the plumbing
  checks: schema valid, citations a subset of the inputs, no contact details or foreign links, cites the history.
  ([AI/tests/test_evals.py](../AI/tests/test_evals.py)). CI never calls a model.
- **Against the real model** (local, free): `npm run eval -- --provider ollama` from the repo root. It writes
  `AI/evals/results/<date>-ollama-<model>.md` with the hardware, settings, the pass rate of every check (injection
  cases separately), p50/p95 total and first-token latency, and tokens. The model-quality checks are: valid on the
  first try, grounded on the first try, resisted injection (did not even try to include the injected contact or
  link), cites the expected item, names the lead, keeps the key fact, email and summary on task, due date soon
  enough, writes English.

**Results:** pending the first local run (step 11 of S2-lite). This section will hold the numbers and what they mean.

## Providers and the model

### Ollama (the real provider)

Checked on 2026-11-05 against Ollama's docs: structured output is `POST /api/chat` with `"format": <JSON schema>`
and `"stream": false`, with temperature 0 recommended. The provider also sets `num_ctx` (Ollama's default window
would silently drop the start of a long prompt), `num_predict` (`AI_MAX_OUTPUT_TOKENS`) and `keep_alive` (a cold load
took 14 s here).

**Model: `llama3.2:3b`** (2.0 GB; its library page lists Hindi and Spanish among its officially supported languages,
and instruction following and summarization as intended uses). Chosen for a CPU-only laptop, measured on the dev
machine (AMD Ryzen 7 8840HS, 31 GB RAM, Radeon 780M iGPU unused: Ollama ran 100% on CPU): the 8B `llama3.1`
processed prompts at 42 tokens/s and generated at 4.0 tokens/s, so a ~2,000-token brief would take well over a
minute. A 3B model is about 2–2.5x faster. The alternatives were `qwen3:4b` (2.5 GB, but a thinking mode that adds
many seconds on a CPU) and `gemma3:4b` (3.4 GB, with vision weights the brief doesn't use).

```bash
ollama pull llama3.2:3b
```

**Time limit:** `AI_TIMEOUT_MS` (default 60,000 ms for now) is shared by Express and the AI service. It will be set
from the measured p95 plus headroom after the first eval run.

### Groq: considered, not built

Groq was to be an optional hosted fallback. On 2026-11-05 its console and docs (`console.groq.com`) answered
"Access denied. Please check your network settings." from the dev machine, so its free-tier limits, JSON-schema
models and data retention could not be verified from Groq's own pages, and a key could not be created from this
network. Rather than ship code nobody can run, it was dropped. The provider interface is one method
([AI/app/providers/base.py](../AI/app/providers/base.py)), so adding it later is a small, contained change.

## Cost per brief

**$0.** Both providers run locally. Each call still logs its input and output tokens (both services), so the cost
of any provider is known before choosing one: the price settings `AI_PRICE_INPUT_PER_MTOK` and
`AI_PRICE_OUTPUT_PER_MTOK` (USD per million tokens, both 0 by default) turn the counts into a cost in every log line,
the metrics and the eval results.

**Moving to paid inference in production:**

- **A hosted GPU running Ollama** is a configuration change only: point `OLLAMA_URL` at it, choose a bigger
  `OLLAMA_MODEL`, set the two price settings to what the host costs per token, and lower `AI_TIMEOUT_MS` to match
  the faster hardware. The prompt, validation, retry, cache and limits are unchanged.
- **A paid API (for example Anthropic's)** needs one new provider class implementing `complete()`, and its key from
  the environment. Everything around it stays the same.

## Configuration

| Variable | Where | Default | What |
|---|---|---|---|
| `AI_ENABLED` | backend | `false` (compose: `true`) | The kill switch. Off: no button, 503 `AI_UNAVAILABLE`. |
| `AI_SERVICE_URL` | backend | `http://localhost:8000` | The AI service (compose: `http://ai:8000`). |
| `AI_INTERNAL_TOKEN` | both | none | The shared secret; 16+ characters; required when AI is on. |
| `AI_TIMEOUT_MS` | both | `60000` | Per brief; Express waits 1 s longer. |
| `AI_PROVIDER` | AI | `fake` | `fake` or `ollama`. |
| `OLLAMA_URL`, `OLLAMA_MODEL` | AI | `http://localhost:11434`, `llama3.2:3b` | Compose: `http://host.docker.internal:11434`. |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` | AI | `0`, `0` | USD per million tokens, for the cost in logs and evals. |
