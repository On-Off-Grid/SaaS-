# SANDBOX — this is the refactor working copy

This directory (`~/Desktop/Desktop/pihunt-refactor`) is a **source-only sandbox clone** of the
live harness (`~/Desktop/Desktop/side-hustle-harness`), created for the config-driven "mini-SaaS"
repolish. Branch: `refactor/config-driven-saas`.

## Why a sandbox
The harness **runtime is global and shared**, not contained in the repo:
`~/.pi/agent/`, `~/.local/bin/`, `~/.pi/secrets/`, the shell rc provider-key block, and systemd
user units. Two repo copies on disk still drive **one** runtime. So source edits here are
isolated, but **deploying or running the tools from here is not** — it would hit the same
runtime your live `digitalocean` hunt depends on.

## Golden rule (while refactoring)
**Edit source here. Deploy only at cutover, deliberately.**

Do NOT, from this sandbox, run any of:
- `install.sh` / `bootstrap.sh`
- `pi-tier` / `hunt-session` / `pi-hunt` (they mutate `~/.pi/agent/` state + `pihunt-tuning.env`)
- `cp -p bin/* ~/.local/bin/` or `node bin/prompt-build.mjs` without `--dry`/`--check`

Safe here: editing files, `pihunt-config validate`, `pihunt-config build --dry`,
`prompt-build.mjs --check`/`--dry`, `install.sh --dry-run`, `make gate-repo`.

## How it was created
```
git clone ~/Desktop/Desktop/side-hustle-harness ~/Desktop/Desktop/pihunt-refactor
# then carried over uncommitted + untracked source the clone would have missed:
#   bin/hunt-session, bin/pi-tier, pi-agent/settings.json   (modified)
#   bin/pihunt-missions, bin/pihunt-profile, bin/pihunt-watchdog, .github/copilot-instructions.md (untracked)
git checkout -b refactor/config-driven-saas
```
Git-ignored runtime state (`reports/`, `.pi/`, `.browser-live/`, `node_modules/`, burp jar,
`CL4R1T4S/`) was intentionally excluded.

## Cutover checklist (run ON the live machine, deliberately, when the refactor is approved)
1. Review the diff; merge `refactor/config-driven-saas` back (PR or fast-forward).
2. `bin/pihunt-config validate` → passes.
3. `bin/pihunt-config build --machine "$PIHUNT_MACHINE"` → regenerates models.json + tier defaults.
4. `install.sh` (or targeted redeploy) to sync `~/.pi/agent/` + `~/.local/bin/` + `~/.local/lib/`.
5. `grep -r codecraft ~/.pi/agent/agents` → empty (stale drift cleared).
6. `pi-tier status` → providers probe healthy; `hunt-brief` renders.
7. Launch the live `digitalocean` hunt → comes up on the same providers/models as before.
8. Remove the stale `~/.zshrc` codecraft source line; open a fresh shell.

Until cutover, the live harness is untouched.
