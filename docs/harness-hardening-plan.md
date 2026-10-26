# pi-hunt harness hardening: assessment + prioritized plan

**Prepared:** 2026-10-26. **Scope:** harness well-being, orchestration, escalation (low→HIGH/CRITICAL), provider routing across the elite/flagship/mechanical tiers, and keeping RAG current with CVEs + attack patterns. Authorized bug-bounty use only; the safety invariants (scope-compliance section first in every agent, never auto-submit) are preserved throughout.

**Evidence legend:** `[REPO]` verified in-repo (path cited) · `[EXT …,2026-10-26]` external primary source · `[DONE]` implemented this session · `[REC]` recommended, not yet applied · `[UNVERIFIED]`.

---

## 0. What I changed this session (shipped, tested) `[DONE]`

A self-contained, additive CVE/attack-pattern freshness layer for RAG — the single biggest gap against your "keep RAG current with recent and common CVEs and advanced attack patterns" goal. It touches no orchestration or routing behavior.

- **New `rag/pihunt_rag/cve_ingest.py`** — pulls three free feeds and indexes them as searchable chunks:
  - **CISA KEV** (known-exploited, CC0) — `metadata.kev=true`, `kind=cve-kev`.
  - **NVD 2.0** recent window (public-domain) — `kind=cve-critical|cve-high|cve`.
  - **EPSS** (FIRST) exploit-prediction score — enriches every CVE for prioritization.
  - Optional **nuclei template metadata** as `source=attack-pattern` (skips cleanly until you run `nuclei -update-templates`).
  - Stdlib-only networking, offline-first (a failed feed is skipped, never fatal, existing index kept), stable ids (idempotent re-ingest), KEV-preserving prune to bound the DB.
- **`rag/pihunt_rag/ingest.py`** — new `ingest_live_intel()` indexes `reports/<program>/live-intel/<stack>.md`, so `deep-research`'s per-hunt CVE intel is **retained in RAG** instead of lost after the hunt (it previously failed the `title.txt` glob). Wired into `ingest_all` and the CLI. [REPO ingest.py:124]
- **`rag/pihunt_rag/cli.py`** — new `pihunt-rag cve-refresh [--days N] [--kev-only] [--no-nuclei] [--nuclei-dir P] [--cap N] [--nvd-key K]`; `live-intel` registered as a refreshable source.
- **`mcp-servers/pihunt-rag-mcp/server.mjs`** — `rag_search` descriptions now advertise the new `cve`, `attack-pattern`, and `live-intel` sources so agents actually query them (search already passed `source`/`kind`/`program` through). [REPO server.mjs:33-37]
- **`systemd/pihunt-cve.{service,timer}` + `install.sh`** — a daily timer refreshes KEV/NVD/EPSS into RAG, mirroring the recon timer; enabled by the installer alongside it.
- **`continuous-learning/README.md`** — corrected a false claim that the extension stores `CHAIN:` tags (it does not; see §3).

**Tested** against a throwaway DB in your RAG venv: synthetic parse/merge/search/prune path, idempotent re-ingest, KEV-preserving prune, and a live run that ingested the full **1,756-CVE KEV catalog**, EPSS-scored every one, embedded with your model2vec backend, and returned correctly-ranked known-exploited results for a semantic query. The real `~/.pi-hunt-rag/data/rag.db` was not touched.

**Use it now:**
```
pihunt-rag cve-refresh --days 14          # KEV + 14-day NVD + EPSS + nuclei
pihunt-rag cve-refresh --kev-only          # fast: known-exploited + EPSS only
pihunt-rag search "known-exploited RCE in a Spring stack" --source cve
```
The daily timer keeps it fresh automatically after the next `install.sh` run (or enable now: `systemctl --user enable --now pihunt-cve.timer`).

---

## 1. Well-being assessment (what's solid, what's fragile)

**Strongest layer — keep as the model:** the subagent orchestration in `pi-agent/extensions/subagent/index.ts`. Empty/"No result" detection, gateway-placeholder-as-empty, `salvageWorkSummary`, in-code retry (default 2), RAM gating, concurrency + queue caps, depth cap, per-child MCP profiles, and the code-enforced disconfirmation gate are real, tested, and inherited by every delegation mode. [REPO index.ts:235-540]

**Fragile by design — the core risk:** nearly the entire escalation/chaining spine is **prompt-advisory with no code enforcement**, executed by the weakest model in the fleet (the coordinator on `DeepSeek-V4.1-Flash`). [REPO settings.json:2-3] The gadget ledger, authz-differential matrix, candidate→confirmed promotion, severity floor, chain-every-wave, and ensemble/swarm firing all depend on the coordinator remembering to do them. Nothing notices if it forgets. [REPO pi-coordinator-adapter.md:63-91; build.md:44-59]

**Concrete defects found:**
- **Continuous-learning loop is wired but degenerate** (§3) — 0 promotions ever.
- **CVE/attack-pattern knowledge was stale by design** — fixed this session (§0).
- **Cost tiering is inverted** (§4) — the bulk tier runs on the only non-free model.
- **Residual work-loss paths** (§5).
- **Minor:** duplicate step numbers in `build.md` (two "5") and `bugbounty-autoflow.md` (two "7"); the adapter's "no subagent+bash in one turn" footgun is prose-only. [REPO build.md:55-56; bugbounty-autoflow.md:47-48]

---

## 2. Escalation (low → HIGH/CRITICAL): make the spine enforceable `[REC]`

The escalation design is good; the gap is that it's all prose. Highest-leverage hardening, in order:

1. **Enforce the gadget-ledger → analyzer hand-off after every wave.** Today it's prompt-only and `gadget-ledger.md` has zero code touching it. [REPO: grep found no code refs] Add a lightweight check (in the subagent extension or a wave hook): after a wave completes, if `reports/<program>/gadget-ledger.md` gained lines since the last analyzer pass, require a `security-analyzer` + `hypothesis-redteam` chaining pass before the coordinator may declare a wave done.
2. **Schema-validate `authz-matrix.json`.** It's the one place the harness defaults to a modern-critical class (BOLA/BFLA), but it's prompt-only; a missing/malformed file silently leaves hunters without cross-identity tokens — exactly when BOLA goes undetected. [REPO pi-coordinator-adapter.md:74-79] Add a tiny validator that fails loud.
3. **Move the coordinator onto a stronger model** (§4). The escalation spine is the worst place to run the weakest model.
4. **Chain-aware severity:** `strict-triager` only ever *downgrades* (its job is catching inflation), and its dedup can split chain parts into "duplicates" rather than composing them upward. [REPO strict-triager.md:99-126] Make the coordinator assemble a chain into a single report *before* triage (prompt + a ledger→report step), so the composite severity is what gets judged.

These are code/enforcement changes to behavior; I've left them for your go-ahead rather than editing the coordinator prompts unilaterally.

---

## 3. Continuous-learning loop: repair or retire `[REC]`

Wired but degenerate. [REPO continuous-learning/index.ts] The live store `~/.pi-hunt-rag/data/instincts.jsonl` has 10 records, **all `promoted:false`, all confidence 0.47, zero semantic `INSTINCT:`/`DEADEND:` tags, nothing ever promoted, stale since 2026-08-28.** It only captured signal-2 noise (`httpx --help`, `httpx -version`) that never dedupes, so it never reinforces past the 0.70 threshold. The valuable `model-notes.md` content came from the manual `rag_record_technique` path, not this loop.

Root cause: tagged lines are emitted by *specialists* running as isolated child processes; the `turn_end` handler and the bash signal-2 allowlist rarely fire in the delegating coordinator process. Plus `saveStore` is an unlocked whole-file `writeFileSync` — a concurrent-write hazard under swarm. [REPO index.ts:130-135]

**Options:** (a) **Repair** — load the extension in child processes too, drop the degenerate bash-shape signal, make promotion write through the same `withFileMutationQueue` the subagent extension uses, and route confirmed `CHAIN:`s into RAG automatically (the README now notes this is currently manual). (b) **Retire** the auto-loop and lean on the manual `rag_record_technique` path that already works, plus the new `live-intel` persistence (§0). Given the loop has never produced value, I leaned (b); you chose a **targeted repair**.

**Status (DONE 2026-10-26):** removed the degenerate tool-command signal; added a reliable path that, when the `subagent` tool returns a `strict-triager` VALID verdict, promotes each confirmed finding (program, class, severity, chain flag, reusable pattern) into RAG as a technique, deduped via `confirmed-promotions.jsonl` under a file lock. Fixed a latent RAG-path bug (now calls the `pihunt-rag` wrapper so promotion no longer silently no-ops), made the instinct store write atomically, and split the pure parser into `confirmed.ts` (unit-tested). 17/17 tests pass incl. a full load-and-fire integration against a stubbed SDK + fake wrapper. The 10 pre-existing noise records in `instincts.jsonl` are harmless and can be cleared at will (`rm ~/.pi-hunt-rag/data/instincts.jsonl`).

---

## 4. Provider routing: fix the inverted cost, correlate the tiers `[REC]`

**The inversion:** the only non-zero-cost model in `models.json` is `amd-radeon/DeepSeek-V4.1-Flash` ($0.28/$0.56), and it's exactly what the 16 hunters **and the coordinator** run on. The "elite" Kimi pair and every other provider are cost 0. [REPO models.json; bin/pi-tier] So the bulk, highest-volume tier is the only thing costing money, and the escalation-driving coordinator runs on a weak model.

**Verified provider facts** (free-to-low-cost; single-operator personal use, so free/dev tiers are acceptable here) [EXT, 2026-10-26]:
- **GitHub Models: retired 2026-07-30** — remove from any config. [EXT docs.github.com/github-models]
- **Free-tier training risk (routing constraint):** Gemini **free** tier trains on your data and is human-reviewed (paid tier is excluded); DeepSeek trains by default (PRC jurisdiction) with opt-out; OpenRouter `:free` may route to training providers. Groq and Fireworks do **not** train on inference data. [EXT ai.google.dev/gemini-api/terms; console.groq.com/docs/your-data; docs.fireworks.ai]
- **Throughput/limits:** Groq is fast (gpt-oss-120b ~500 tps, no-train) but its **TPM cap is the real throttle** for parallel agents; Cerebras is fastest (~3,000 tps) but free is **5 RPM**; Fireworks free is **10 RPM**; SambaNova free is **20 req/day** (useless for loops); NVIDIA NIM ~40 RPM prototyping-only. Free limits for Groq/Gemini/Mistral are **console-only, not in public docs** `[UNVERIFIED]`, and 2026 model IDs came back summarizer-suspect — **read both off the live signed-in consoles before hardcoding.**

**Recommended routing (correlating the tiers to their job):**
- **ELITE (hypothesis-redteam, strict-triager = reasoning, chaining, triage):** keep **Kimi k3.1-pro** — strong reasoning, cost 0 (subscription), already pinned. It is the right home for the "connect/validate patterns" work. If Kimi quota is tight or triage touches sensitive scope, fall back to **paid Gemini Flash** (contractually no-train). `[REC]`
- **COORDINATOR:** move off `DeepSeek-V4.1-Flash` onto a stronger model (Kimi k3.1-pro, quota permitting) — it runs the escalation spine. Weigh the added Kimi load. `[REC]`
- **FLAGSHIP (16 hunters, throughput-bound):** spread across no-train, high-throughput lanes to dodge rate-limit stalls — **Groq** (gpt-oss-120b / Llama-3.3-70B) as backbone, **Cerebras**/**Fireworks** (card tier) for latency, **DeepSeek paid** as overflow. Add a small provider-pool router: weighted round-robin keyed on each provider's binding limit (TPM for Groq, RPM for others), 429→reroute-to-next-lane, and a **data-sensitivity flag that excludes training-on providers (Gemini free, DeepSeek default, OpenRouter `:free`) from any task carrying target-identifying data.** `[REC]`
- **MECHANICAL (8 chores, non-sensitive, bulk):** primary **Ollama local** (Qwen2.5-Coder-7B/14B, tool-capable, $0, never rate-limits, zero data egress); cloud overflow = Gemini free Flash-Lite / Groq Llama-3.1-8b-instant. [EXT ollama.com/library]

This is a `models.json` + `bin/pi-tier` change plus an optional pool-router; I've left it unapplied because it depends on which providers you actually hold keys/quota for. Tell me your available providers and I'll produce the exact config.

---

## 5. Residual work-loss paths `[REC]`
- **RAM-floor fail-open:** after 5 min of pressure, `waitForRam` launches anyway — under a 256-cell swarm on an 8 GB box this risks OOM-killed (empty) children. [REPO index.ts:82] Consider a smaller swarm cap or a hard wait on low-RAM boxes.
- **Disconfirmation only at depth 0:** a specialist that spawns a specialist gets retries but no disconfirmation, so a false-negative can lock in one level down. [REPO index.ts:442-443]
- **Salvage keeps tool *names*, not evidence:** a child that fetched a decisive response body and died before summarizing loses it unless it checkpointed to `reports/` (prompt-only). [REPO index.ts:251-277]

---

## 6. Prioritized next steps

| Prio | Item | Risk | Depends on |
|---|---|---|---|
| **1 — done** | CVE/attack-pattern freshness + live-intel persistence (§0) | low (additive) | — |
| **2 — done** | All 16 hunters query `--source cve` per fingerprint (new `prompts/base/cve-lookup.md`, built + gated 5/5, KEV seeded) | low (tested) | — |
| **3** | Provider rebalance: coordinator→stronger model, flagship spread, mechanical→Ollama (§4) | med (cost/behavior) | your provider keys/quota |
| **4** | Enforce gadget-ledger hand-off + authz-matrix schema check (§2) | med (behavior) | your OK |
| **5 — done** | Continuous-learning loop: targeted repair (§3) | low (tested) | — |
| **6** | Residual work-loss hardening (§5) + fix duplicate step numbers | low | — |

---

## 7. Verification for what shipped
- `pihunt-rag cve-refresh --kev-only` → prints `kev≈1756, epss≈1756`; `pihunt-rag stats` shows a `cve` source.
- `pihunt-rag search "<known-exploited class>" --source cve` returns KEV/EPSS-ranked results.
- Drop a file at `reports/<prog>/live-intel/<stack>.md`, run `pihunt-rag ingest --source live-intel`, then `search --source live-intel` → it comes back.
- `systemctl --user list-timers | grep pihunt-cve` shows the daily cadence after install/enable.
