# Provider routing & 8-hour-hunt cost comparison (pi-hunt)

**Prepared:** 2026-10-26. **Goal:** pick API/model providers for the harness's three tiers that give smooth orchestration + delegation, strong pattern-recognition/escalation reasoning, and no refusals on in-scope offensive tasks — and cost a self-hosted abliterated model on a rented GPU against the hosted options for an 8-hour intensive hunt. Authorized bug-bounty use only; the harness's scope/safety guardrails (scope section first, never auto-submit) are unaffected by any routing choice.

**Evidence legend:** `[EXT …,2026-10-26]` verified primary source · `[REC]` recommendation · `[ASSUMPTION]` illustrative · `[UNVERIFIED]`.

---

## 1. What each tier actually needs

| Tier | Agents | Dominant need | Refusals a problem? |
|---|---|---|---|
| **ELITE** | hypothesis-redteam, strict-triager, security-analyzer (chaining) | **Reasoning quality** — pattern recognition, chain composition, escalation judgement, strict replay | Rarely — these *judge/validate*, they don't craft the offensive act |
| **FLAGSHIP** | 16 hunters + coordinator | **Throughput under concurrency** + willingness to craft in-scope payloads/exploits | **Yes** — aligned models over-refuse in-scope offensive work |
| **MECHANICAL** | scope-loaders, recon-normalize, wordlist/payload chores | **Cost ≈ 0**, non-sensitive bulk | No |

The key insight for your stated goals: **put reasoning quality where escalation happens (elite), and put the uncensored model where refusals bite (the offensive flagship hunters).** Don't conflate the two — the abliterated open models are materially weaker reasoners than frontier, so using them for triage/chaining would *lower* escalation quality.

---

## 2. Hosted API providers (free + paid), verified [EXT, 2026-10-26]

Per 1M tokens unless noted. "No-train" = provider contractually does not train on your API data.

| Provider / model | In | Out | No-train? | Concurrency reality for a 16-agent fleet | Tier fit |
|---|---|---|---|---|---|
| **Kimi k3.1-pro** (your current elite, subscription) | 0 | 0 | subscription terms | quota-bound, not rate-metered | **ELITE** (keep) |
| Claude Haiku 5.5 | $0.10 | $0.50 | **yes** (API) | high | flagship/mechanical |
| Claude Sonnet 5.5 | $2.00 | $10.00 | **yes** | high | elite (paid alt) |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | **paid yes / free NO (trains+human-review)** | per-project cap; free trains | mechanical (non-sensitive) |
| Gemini 2.5 Flash | $0.30 | $2.50 | paid yes | per-project | flagship (paid) |
| OpenAI gpt-5-nano | $0.05 | $0.40 | yes (30-day abuse log; ZDR on approval) | high | mechanical |
| OpenAI gpt-5-mini | $0.25 | $2.00 | yes | high | flagship |
| **DeepSeek-flash** | $0.30 (miss)/$0.006 (hit) | $1.20 | **NO by default (PRC), opt-out** | good; **50% off-peak** | flagship (non-sensitive) |
| DeepSeek-v4-pro | $1.32 | $3.96 | NO default | good | elite (paid, non-sensitive) |
| **Groq gpt-oss-120b** | $0.15 | $0.60 | **yes** | fast (~500 tps) but **low TPM throttles parallelism** | flagship backbone |
| Groq Llama-3.1-8b-instant | (free dev) | — | yes | fast | mechanical |
| Mistral Codestral | $0.30 | $0.90 | free trains/opt-out | ok | mechanical |
| **Fireworks** 70B-class | ~$0.90 | ~$0.90 | **yes (ZDR default)** | card tier → 6000 RPM | flagship |
| Cerebras gpt-oss-120b | paid `[UNVERIFIED]` | — | per privacy pg | **fastest (~3000 tps)**; free 5 RPM | latency-critical flagship (paid) |
| OpenRouter `:free` | 0 | 0 | **may train** | 20 RPM, 1000 RPD (≥$10 credit) | burst/overflow only |
| SambaNova free | 0 | 0 | marketing-only | **20 req/day — useless** | n/a |
| **Ollama local** | 0 | 0 | **on your box** | hardware-bound, no rate limit | mechanical / self-host |
| ~~GitHub Models~~ | — | — | — | **RETIRED 2026-07-30** | remove |

**Two hard routing constraints:** (1) **never send target-identifying recon through a training-on provider** (Gemini free, DeepSeek default, OpenRouter `:free`); (2) the free tiers **cannot sustain 16 parallel agents** — Groq's TPM cap, Gemini's per-project cap, and OpenRouter's RPD cap all throttle a swarm. Free tiers are overflow, not a backbone.

---

## 3. Self-hosted abliterated model on a rented GPU [EXT, 2026-10-26]

Run an open-weights abliterated model behind vLLM's OpenAI-compatible server (`vllm serve <model> --api-key <TOKEN>`); the harness points at `http://<host>:8000/v1` with that token — exactly like the existing `ollama`/`freellm` provider entries. Three things it buys that no hosted API does at once: **no reflexive refusals** on in-scope offensive tasks, **recon data never leaves your box** (solves constraint #1 outright), and **no rate limits** (sustains all 16 agents). Honest cost: the endpoint bills **continuously for the whole session** whether or not a request is in flight.

**Decent abliterated models (present on Hugging Face):**
- **70B class (best for the offensive flagship doers):** `huihui-ai/Llama-3.3-70B-Instruct-abliterated`, `huihui-ai/Qwen2.5-72B-Instruct-abliterated`. 4-bit AWQ ≈ 40GB → fits one 80GB GPU.
- **24–32B mid (one 48GB GPU):** `TheDrummer/Big-Tiger-Gemma-27B`, `huihui_ai/dolphin3-r1-abliterated` (24B), `Huihui-Qwen3.8-27B-abliterated` (`[UNVERIFIED]` specs).
- **7–14B fast (mechanical):** `Goekdeniz-Guelmez/Josiefied-Qwen3-14B-abliterated`, `mlabonne/NeuralDaredevil-8B-abliterated`.
- **Security-specialized (not strictly abliterated):** `WhiteRabbitNeo` 7B/8B/70B (dual-use, trained for offensive+defensive; Extended license restricts some uses).

**Quality gap (be honest):** these top out ≈ GPT-4 / Llama-3.3-70B class and abliteration measurably dents reasoning vs the aligned base. They are **weaker than frontier** (Claude/Gemini/GPT-5-class) at nuanced chain reasoning and novel-bug hypotheses. Right role = the offensive/bulk layer, **not** elite escalation judgement.

**Verified GPU on-demand $/hr (cheapest credible) and the 8-hour cost:**

| Combo | GPU | Cheapest $/hr | **8h cost** | Source |
|---|---|---|---|---|
| 27–32B abliterated, 4-bit | 1×L40S 48G | RunPod Community **$0.79** | **$6.32** | runpod.io/pricing |
| **70B abliterated AWQ** | 1×A100 80G | RunPod Community **$1.19** | **$9.52** | runpod.io/pricing |
| 70B abliterated AWQ, ~2× faster | 1×H100 80G | Hyperstack **$1.90** | **$15.20** | hyperstack.cloud/gpu-pricing |

Secure/reserved tiers run higher (A100-80 Secure $1.79 → $14.32/8h; H100 Secure → ~$23/8h). Vast.ai spot can ~halve these but can reclaim the box mid-hunt — poor for a live endpoint. `[EXT, runpod.io/pricing; hyperstack.cloud/gpu-pricing; lambda.ai; verda.com, 2026-10-26]` MI300X and Vast.ai figures `[UNVERIFIED]`.

---

## 4. The 8-hour-hunt cost comparison

APIs are per-token, so their 8h cost depends on token burn. **Illustrative scenario `[ASSUMPTION]`:** 4 concurrent agents (your `PI_SUBAGENT_MAX_CONCURRENCY=4` default) over 8h ≈ **~20M tokens** processed, input:output ≈ 3:1. Self-hosted is flat regardless of tokens.

| Option | 8h cost @ ~20M tok | Notes |
|---|---|---|
| Kimi subscription / Gemini free | **$0** | but rate-limited / refuses / (free) trains on data |
| Gemini 2.5 Flash-Lite (paid) | **~$3.50** | cheapest paid; non-sensitive only |
| Claude Haiku 5.5 | **~$4.00** | no-train, reliable |
| Groq gpt-oss-120b | **~$5.25** | no-train, fast; TPM-throttled at 16-way |
| **Self-host 27–32B (L40S)** | **$6.32 flat** | no refusals, private, unthrottled |
| **Self-host 70B (A100-80)** | **$9.52 flat** | no refusals, private, unthrottled, best self-host reasoning |
| DeepSeek-flash | **~$10.50** | cheap but trains by default (PRC) |
| Self-host 70B (H100) | **$15.20 flat** | ~2× throughput |
| Claude Sonnet 5.5 | **~$80** | frontier reasoning; reserve for elite only |

**Break-even (when flat self-host beats per-token), anchored to the $9.52 A100-70B row, 3:1 blend:**

| vs provider | break-even tokens/8h | verdict at ~20M |
|---|---|---|
| Claude Sonnet 5.5 | **~2.4M** | self-host wins easily |
| DeepSeek-flash | ~18M | ~even |
| Groq gpt-oss-120b | ~36M | API cheaper on $ |
| Gemini Flash-Lite | ~54M | API cheaper on $ |

**Reading it:** self-hosting is **not** about beating the cheap fast APIs on raw dollars — it rarely does. It wins on the three things those APIs can't give together: **no refusals, no data egress, no rate limits** for a 16-way parallel offensive hunt. Against *frontier* models it's also far cheaper. So the money question isn't "self-host vs Gemini" — it's "which work genuinely needs the uncensored, private, unthrottled endpoint," and route only that there.

---

## 5. Recommended routing [REC]

| Tier | Route to | Why |
|---|---|---|
| **ELITE** (triage, hypothesis, chaining) | **Kimi k3.1-pro** (keep; free, strong). Paid alt for sensitive: **Claude Sonnet 5.5** or **Gemini 2.5 Flash paid** (both no-train). | Escalation/pattern quality is paramount; refusals don't bite judges; do **not** downgrade this to an abliterated model. |
| **COORDINATOR** | Move off `DeepSeek-V4.1-Flash` (the one paid model in your config) to **Kimi k3.1-pro** (quota permitting) or a self-host 70B. | It drives the escalation spine; today it runs the weakest model. |
| **FLAGSHIP offensive doers** (rce, sqli, xss, injection, ssrf, bypass-innovator, cve-misconfig) | **Self-hosted 70B abliterated** (A100-80, ~$9.52/8h) for intensive sessions. Overflow: Groq/Fireworks (no-train). | Where aligned-model refusals block in-scope payload/exploit work; private + unthrottled. |
| **FLAGSHIP logic/recon hunters** (idor, oauth, race, cache, smuggling, traversal, recon-driven) | **Groq gpt-oss-120b** / **Fireworks** (no-train) with a provider-pool router; DeepSeek paid as overflow. | Throughput-bound, less refusal-sensitive; keep target data off training-on providers. |
| **MECHANICAL** | **Ollama local** (Qwen2.5-Coder) or the small abliterated model on the same GPU; Gemini free only for non-sensitive normalization. | $0, no egress, no rate limit. |

**Session shape:** spin the self-host endpoint up for scheduled intensive hunts (it bills continuously), not 24/7; for light/always-on use, the per-token no-train APIs are cheaper. Schedule heavy batch work in **DeepSeek's UTC off-peak window (50% off)** if you use it.

---

## 6. How to apply (pending your available keys)

Add a self-hosted provider to `pi-agent/models.json` (mirrors the existing `ollama`/`freellm` blocks), then map tiers via `bin/pi-tier`:

```jsonc
// models.json — new provider
"selfhost-vllm": {
  "api": "openai-completions",
  "baseURL": "http://<your-gpu-host>:8000/v1",
  "apiKey": "$SELFHOST_API_KEY",            // the vLLM --api-key value
  "models": { "llama-3.3-70b-abliterated-awq": { "cost": { "input": 0, "output": 0 } } }
}
```
Then: elite→`kimi-coding/k3.1-pro` (unchanged), coordinator→`kimi-coding/k3.1-pro`, offensive hunters→`selfhost-vllm/...`, logic/recon hunters→`groq-direct/...`, mechanical→`ollama/...`. The provider-pool router (weighted round-robin + 429-reroute + data-sensitivity flag) is a small addition to the subagent launch path if you want automatic lane-spreading.

**I need from you to write the exact config:** which of these you actually hold — Kimi subscription (confirmed), Groq key, Fireworks key, DeepSeek key, Gemini paid key, and whether you want me to provision/assume a specific GPU host for `selfhost-vllm`. Give me that set and I'll produce the precise `models.json` + `pi-tier` diff.

## Caveats
Prices are a 2026-10-26 snapshot (RunPod repriced Sept 2026; Vast.ai is a live marketplace). Abliterated-model param/base specs for the newest huihui 2026 entries, Cerebras paid pricing, Vast.ai/Paperspace/MI300X rates, and all GPU tok/s figures are `[UNVERIFIED]` — re-check before committing. The ~20M-token 8h burn is an illustrative assumption, not a measurement; meter one real hunt to calibrate.

---

## 7. Your actual setup, Morocco deployment, and what I added (2026-10-26)

### What you actually have (discovered locally; no secrets printed)
Direct keys in `~/.pi/secrets/`: **AMD Radeon, Google Gemini, Mistral, Groq, Kimi** (plus GitHub/H1/Intigriti, non-LLM). Biggest asset: the **freellm pool** (`FREELLM_POOL_KEY` → `127.0.0.1:3001`), a self-hosted key-aggregator already serving ~278 live models for free, including strong reasoners (`claude-sonnet-4-5`, `claude-opus-4-5`, `deepseek-v4-pro`, `qwen3-max`, `nemotron-3-ultra-550b`) and uncensored ones (`unmoderated-gpt`, `gemma-4-31b-heretic`, `cydonia-24b`, `behemoth-128b`). **Cost-minimising consequence: route most tiers through the free pool and spend only on the GPU.** Caveats: the pool fronts free/unofficial upstreams — reliability varies and some train on data, so keep target-identifying recon off it (that's the self-host's job).

### Best GPU host for Morocco (latency + price) [EXT, 2026-10-26]
Morocco's lowest latency is to **France** (est. ~20–40 ms RTT to Paris; `[UNVERIFIED]` — test with RIPE Atlas before committing). France-region GPU hosts:

| Host (France region) | L40S 48G | H100 PCIe 80G | Notes |
|---|---|---|---|
| **OVHcloud — Gravelines** | €1.40/hr | €2.80/hr | French-sovereign, closest; A100 retired from page |
| **Scaleway — Paris (PAR-2)** | €1.40/hr | €2.73/hr | Other true EU-West option |
| RunPod — EU-RO/EU-CZ | $0.79/hr | $1.99/hr (A100-80 $1.19) | Cheapest, but +~20–30 ms (Eastern EU) |

**Recommendation:** **OVHcloud Gravelines or Scaleway Paris** for lowest Morocco latency. Sweet spot = **L40S 48G in France (€1.40/hr → ~€11.20/8h)** running a 32B abliterated. For a 70B, step up to **France H100 (~€2.75/hr → ~€22/8h)**, or take **RunPod A100-80 EU-RO ($1.19/hr → $9.52/8h)** if you'll accept slightly higher latency for the lower price. Avoid Hyperstack/Verda (Norway/Finland only). `[EXT ovhcloud.com; scaleway.com/pricing/gpu; runpod.io/pricing, 2026-10-26]`

### Abliterated models worth hosting (Hugging Face, by tier) [EXT, 2026-10-26]
| Tier | Best pick (security/coding) | Repo | Fits | Worthiness |
|---|---|---|---|---|
| Minimal 7–14B | Josiefied-Qwen3-14B-abliterated-v3 (keeps tool-use+reasoning) | `Goekdeniz-Guelmez/Josiefied-Qwen3-14B-abliterated-v3` | L4 24G (INT4) / L40S | 160 DL/mo (low); mlabonne/NeuralDaredevil-8B is the adoption leader (15.4k DL) but Llama-3-8B general |
| **Mid 24–32B (sweet spot)** | **huihui-ai/Qwen3-32B-abliterated** (apache-2.0, strong coder) | `huihui-ai/Qwen3-32B-abliterated` | **1×L40S 48G (INT4)** | 608 DL; Dolphin-Mistral-24B-Venice is adoption leader (7.5k DL, ships vLLM cmd) |
| High-end 70B+ | **huihui-ai/Llama-3.3-70B-Instruct-abliterated** (most adopted abliterated 70B) | `huihui-ai/Llama-3.3-70B-Instruct-abliterated` | 1×80G (AWQ ~40G / FP8 ~70G) | 21.1k DL/mo — the worthiness leader |
| High-end, code-first | Huihui-Qwen3-Coder-Next-abliterated (80B, purpose-built code+tools) | `huihui-ai/Huihui-Qwen3-Coder-Next-abliterated` | 1×80G INT4 | 858 DL |

Skip RP-tuned ones (Tiger-Gemma, cydonia, behemoth, safeword) for security — they're roleplay decensors, weak at code/exploit reasoning. All serve on vLLM out of the box; use AWQ/GPTQ-INT4 or FP8 on a single 80G card.

### Recommended entry build (cheapest that leaves budget for the GPU)
1. **Mid sweet spot:** OVH/Scaleway **L40S (France) + `huihui-ai/Qwen3-32B-abliterated` (AWQ)** → ~€11/8h, low latency, strong security/coding, no refusals, data stays in-region.
2. **When you need a 70B:** France **H100 + `Llama-3.3-70B-Instruct-abliterated` (AWQ)** (~€22/8h) or RunPod A100-80 EU-RO ($9.52/8h).
3. Everything else free via the pool/direct keys (below).

### Catalogue entries I added (to repo + deployed `models.json`, additive)
- **9 free pool models** under `freellm`: `claude-sonnet-4-5`, `deepseek-v4-pro`, `qwen3-coder`, `llama-3.3-70b-fp8-fast`, `gpt-oss-120b`, `unmoderated-gpt`, `gemma-4-31b-heretic`, `ministral-3b`, `qwen3.5-flash` (all cost 0).
- **New provider `selfhost-vllm`** with `Llama-3.3-70B-Instruct-abliterated-AWQ`, `Huihui-Qwen3-Coder-Next-abliterated`, `Qwen3-32B-abliterated-AWQ`. Set its `baseUrl` to your GPU host and export `SELFHOST_API_KEY` (the vLLM `--api-key`) to activate.

### Recommended routing (ready pi-tier commands — your call to run)
```
pi-tier set-coordinator freellm/claude-sonnet-4-5   # or keep kimi-coding/k3.1-pro
pi-tier set-hunter      freellm/qwen3-coder         # ALL hunters, free, for normal hunts
pi-tier set-fast        freellm/ministral-3b        # mechanical, free
# intensive offensive session — point ALL hunters at the self-host GPU endpoint:
pi-tier set-hunter      selfhost-vllm/Llama-3.3-70B-Instruct-abliterated-AWQ
```
**Granularity note:** `pi-tier set-hunter` sets *every* hunter at once — it has no per-agent form, and `pi-tier on` resets hunters to that default. To route ONLY the offensive doers (rce/sqli/xss/injection/ssrf/bypass-innovator/cve-misconfig) to self-host while logic/recon hunters stay on the free pool, either (a) edit those agents' `model:` line directly in `~/.pi/agent/agents/<agent>.md` (non-sticky — `pi-tier on` overwrites), or (b) I add a first-class `pi-tier set-agent <agent> <ref>` override that persists. Say the word for (b).
Elite pair stays on Kimi (don't abliterate the judges). Keep Groq/Gemini direct keys as reliable no-train fallback when the pool is flaky; never route target-identifying recon through the pool or Gemini-free (they may train on it).
