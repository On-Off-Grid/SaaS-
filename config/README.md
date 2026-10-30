# `config/` — the declarative config layer

This directory is the **single source of truth** for how the harness is configured.
Everything here is committed-and-shareable TOML (plus `.env.example` secret templates).
Real secrets and your personal engagement live outside git — see below.

Think of it as the harness's "tenant config": a friend clones the repo, edits a couple
of files here, runs the installer, and hunts — without touching tool code.

## Files

| File | Committed? | Purpose |
|------|-----------|---------|
| `engagement.toml` | yes (template) | The hunt engagement: `program` / `platform` / `researcher` / `floor`, plus a `[scope]` ROE block. Generic placeholder values. |
| `engagement.local.toml` | **no** (git-ignored) | Your real engagement + your real `[scope]`. Overrides `engagement.toml`. This is what keeps a machine pointed at its actual program. |
| `providers.toml` | yes | LLM provider definitions: `base_url`, `api`, key env-var, `models[]`, cost, probe metadata. `pihunt-config build` regenerates `models.json` from the `managed` blocks (dormant preserved). |
| `tiers.toml` | yes | Tier → model map (fast/hunter/flagship/elite/coordinator) + which agent is in which tier. Compiled into pi-tier's tier defaults. |
| `machines.toml` | yes | **Generic** machine profiles (`[laptop]` / `[desktop]` / `[default]`): cores, RAM, concurrency ceiling. Shareable; no box-specific data. |
| `machines.local.toml` | **no** (git-ignored) | This box's `active = "<profile>"` selection plus any profile overrides with real local hardware. Overrides `machines.toml`. |
| `secrets/*.env.example` | yes (templates) | One per provider/integration. Copy each to `~/.pi/secrets/<name>.env` and fill in the key. |

## How resolution works

- **Program / engagement:** `$PIHUNT_PROGRAM` (per-shell) → `engagement.local.toml` →
  `engagement.toml`. Resolved by `lib/pihunt-common.sh` (`pihunt_program`) for the bash
  tools and by an equivalent reader in the python tools (`pihunt-gadgets/-authz/-triage`).
  Run `hunt-brief` to see what resolves.
- **Secrets:** never committed. `install.sh` seeds any missing `~/.pi/secrets/<name>.env`
  from the matching `.env.example` here, then warns you to fill them in. `pi` and the tools
  read the keys from the environment (the shell rc sources `~/.pi/secrets/*.env`).
- **Machine profile:** `--machine` → `$PIHUNT_MACHINE` → `machines.local.toml` `active` →
  `[default]`. Set it per box in `machines.local.toml` (git-ignored) so it is never pushed;
  `pihunt-config active-machine` prints what resolves, and `install.sh` seeds the file
  (`active = "default"`) if the box has none yet.

## Set your engagement

```bash
cp config/engagement.toml config/engagement.local.toml
$EDITOR config/engagement.local.toml      # set program / platform / researcher / floor
# or, one-off for a single shell:
export PIHUNT_PROGRAM=yourprogram
```

## Set your scope (ROE guard)

The `[scope]` block in `engagement.local.toml` backs the Claude Code `PreToolUse`
scope guard (`bin/pihunt-scope-guard`): a defense-in-depth guardrail that challenges
`Bash`/`WebFetch` calls to hosts outside your program's scope. It is **not** a
security boundary — obfuscated shell can evade it; it catches honest mistakes and
accidental pivots. Layer it under the sandbox and Burp's `scope_check`.

```toml
[scope]
in_scope        = ["*.digitalocean.com", "api.digitalocean.com"]
out_of_scope    = ["status.digitalocean.com"]
max_req_per_sec = 10
enforce         = "auto"
```

**When it enforces (`enforce`, default `auto`):** so it never nags during ordinary
doc/dev work, the guard only challenges when a hunt is **live** or you switch it on:
- `auto` — enforce only while a `pi` hunt is running (`pgrep -x pi`, the harness's
  canonical live-hunt signal). Passive otherwise.
- `always` — always enforce. `off`/`never` — never enforce (fully passive).
- The `PIHUNT_SCOPE_GUARD` env var (`on|off|auto|always|never`), **set before
  launching Claude Code**, overrides the config — e.g. `export PIHUNT_SCOPE_GUARD=on`
  to force the guard on for a session.

- **`in_scope` empty → the guard has no scope to check** (allows all hosts). Populate it
  from your program's scope page.
- `out_of_scope` is always denied, even if an `in_scope` glob would match.
- `localhost` / private ranges are always allowed (local tooling).
- Read by `pihunt_scope_list` / `pihunt_scope_get` in `lib/pihunt-common.sh`.

## Commands (`pihunt-config` / `make`)

```bash
pihunt-config validate                 # check coherence (providers/tiers/machines/secrets)
pihunt-config show --machine desktop    # print the resolved config
pihunt-config build --machine desktop   # regenerate models.json + build/ artifacts
#   or: make config-validate / config-show / config-build   (PIHUNT_MACHINE=laptop make config-build)
```

`build` regenerates `pi-agent/models.json` for `managed` providers (dormant blocks preserved
byte-for-byte), and writes `build/tier-defaults.sh` (pi-tier's tier defaults + the machine
profile's CONC_* ceilings) and `build/pihunt-tuning.env`. `install.sh` runs validate + build
and deploys those. pi-tier sources `.tier-defaults.sh` as an overlay over its built-in
fallbacks, so an un-built harness still works unchanged.

## Add / switch a provider

1. Add (or edit) a `[providers.<name>]` block in `providers.toml`. For a generated models.json
   block set `managed = true` with `base_url` / `api` / `key_env` and `[[providers.<name>.models]]`;
   set `probe = true` to have pi-tier health-probe it; `builtin = true` for a provider pi resolves
   itself (like OpenRouter — not written to models.json).
2. Add `config/secrets/<name>.env.example` and your real `~/.pi/secrets/<name>.env`.
3. Point a tier at it in `tiers.toml` if it should be used by default.
4. `pihunt-config validate && pihunt-config build` (or just re-run `install.sh`).

Switching a provider is the same edit in reverse; nothing else in the codebase hardcodes it.

## Safety

`.gitignore` keeps `engagement.local.toml` and any real `config/secrets/*.env` out of git;
only the templates and the committed `*.toml` are tracked. Don't put live keys in any
committed file.
