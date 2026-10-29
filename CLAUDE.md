# CLAUDE.md

This repo is a **bug-bounty hunting harness** (pi-hunt). The engagement it targets — program,
platform, researcher, severity floor — is **not hardcoded here**: it lives in declarative config
(`config/engagement.toml`, overridden by the git-ignored `config/engagement.local.toml`, and by
`$PIHUNT_PROGRAM` per-shell), and the tools resolve it via `lib/pihunt-common.sh`. Run `hunt-brief`
to see the active engagement. Launch Claude Code **from this folder** so cwd + claude-mem keys align.

## Configure (the `config/` layer is the single source of truth)
Declarative TOML under `config/`:
- `config/engagement.toml` — program / platform / researcher / floor (copy to `engagement.local.toml`).
- `config/providers.toml` · `config/tiers.toml` · `config/machines.toml` — LLM providers, per-agent
  model tiers, and named laptop/desktop profiles (selected by `$PIHUNT_MACHINE`). Compiled by
  `bin/pihunt-config` into `models.json` + pi-tier's tier defaults.
- `config/secrets/*.env.example` — copy each to `~/.pi/secrets/<name>.env` and fill in the key(s).

See `config/README.md` for the full reference (and `docs/SANDBOX.md` if this is the refactor clone).

## Rapid context (read in this order)
1. **`reports/<program>/SESSION-BRIEF.md`** (`<program>` = your engagement slug) — auto-generated every session by the `hunt-brief`
   SessionStart hook (also printed into your first turn): last state, the graph+registry **suggested
   next action**, the exact endpoint, live-ish quota, and the commands to act. Read-only; regenerated.
   Run `hunt-brief` (or `hunt-session brief`) anytime to refresh it.
2. **`reports/<program>/SESSION-HANDOFF-<date>.md`** — the **curated** "where to steer" narrative
   (campaign state, ROE, provider notes). Hand-authored; the brief complements it, never overwrites it.
3. **`docs/operator/OPERATOR-GUIDE.md`** — the before/during/after routine. Reading the graph output:
   **`docs/operator/reading-the-steer-output.md`**.

`reports/` is **gitignored** — all hunt state (graph, authz, triggers, submissions, briefs, handoffs)
lives only on disk, so these files are the source of truth for a fresh session.

## Features at a glance
- **Session:** `hunt-session brief` (read-only orient — the default) · `up` (apply tiering + size
  concurrency to quota, advises watchers) · `watchers` (start the 5 safety watchers) · `steer`
  (synthesis snapshot) · `preflight` / `status` / `down`.
- **Graph synthesis (`pihunt-gadgets`):** `rank` (where to spend — live actionable vs a parked
  dead-end trailer) · `chains` (composability; a probed-negative need shows `DEAD`) · `patterns`
  (each chain → the practitioner pattern it instantiates + the predicted next link + source) ·
  `suggest` (the single best next action) · `triggers` / `check` / `report`.
- **Authz differential (`pihunt-authz`):** `gaps` (forgotten-sibling-verb cells, SPLIT first) · `grid` · `report`.
- **Triage loop (`pihunt-triage`):** `record` → `verdict` → `sync` → `report` (program verdicts feed the graph).
- **Provider/model (`pi-tier`):** tiering + the failover/concurrency/stall watchers.
- **Chaining registry:** `knowledge/chaining-patterns.jsonl` — program-agnostic hunter patterns
  (named researchers' primary work), the source behind `pihunt-gadgets patterns`/`suggest`.

## Keeping state honest (do this on every confirm/kill)
A probe result must land in **all three** files or the ranking lies (see "Graph hygiene" in
reading-the-steer-output.md): the gadget node (`gadget-graph.jsonl`, fill `grants` on a negative),
its chain's status, and `authz-differential.jsonl`. Then the brief/rank/gaps self-correct.
Edit a `bin/*` tool → redeploy with `cp -p bin/<tool> ~/.local/bin/` (and `lib/*.sh` → `~/.local/lib/`
if you touched the shared lib). Simplest: rerun `install.sh` to redeploy tools + lib together.
