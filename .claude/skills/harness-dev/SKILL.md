---
name: harness-dev
description: >-
  Develop the pi-hunt harness itself — the bin/ & lib/ tools, the config layer,
  the pi-agent prompts/skills, and install.sh. Use when editing or adding harness
  tooling. Encodes the config→compile, prompt-build→QA, and redeploy disciplines
  that are easy to forget.
allowed-tools: >-
  Read, Edit, Write, Grep, Glob,
  Bash(./bin/*), Bash(bin/*), Bash(node bin/*), Bash(python3 bin/*),
  Bash(./install.sh*), Bash(cp -p *), Bash(pihunt-config*), Bash(make *),
  mcp__github__*, mcp__pihunt-rag__*
paths:
  - "bin/**"
  - "lib/**"
  - "config/**"
  - "pi-agent/**"
  - "prompts/**"
  - "skills/**"
  - "install.sh"
---

# harness-dev — building the toolkit

The harness is config-driven: `config/*.toml` is the single source of truth, and
most tool/agent/skill machinery targets the **pi** runtime (`~/.pi/agent`), deployed
by `install.sh`. Follow the right discipline for what you changed.

## Discipline by change type

**Config (`config/*.toml`)**
- Edit the TOML, then `pihunt-config validate && pihunt-config build` (regenerates
  `pi-agent/models.json` + `build/` artifacts). Never hand-edit generated files.

**A bash/python tool (`bin/*`, `lib/*.sh`)**
- Edit in the repo, then **REDEPLOY** — the tools run from `~/.local/bin`, not the
  repo: `cp -p bin/<tool> ~/.local/bin/` (and `cp -p lib/*.sh ~/.local/lib/` if you
  touched the shared lib). Simplest and safest: re-run `./install.sh`, which
  redeploys tools + lib together. **A change you don't redeploy does not take
  effect.** (This checklist is the lightweight stand-in for an auto-redeploy hook.)

**Prompts (`pi-agent/prompts/*`, `prompts/build.md`)**
- Rebuild with `node bin/prompt-build.mjs`, then run the QA gates:
  `node bin/prompt-gate.mjs`, `node bin/ref-check.mjs`, `node bin/signature-check.mjs`.

**Skills / agents (`skills/*`, `pi-agent/agents/*`)**
- Validate the manifest: `node bin/skill-manifest.mjs`. These deploy to pi's runtime
  via `install.sh` — they are NOT the Claude Code skills under `.claude/skills/`.

**Claude Code surfaces (`.claude/*`, `.mcp.json`)**
- Read live from the repo — no redeploy needed. Keep `.mcp.json` on `${VAR}`
  expansion; never commit a literal secret (verify with `git grep -n ghp_`).

## Test gates before you call it done
- `bash bin/elite-regression.sh` — strict-triager regression (reject dup/known,
  accept novel).
- `bash bin/hunter-signal-check.sh` — hunters vs vuln fixture + clean control.
- For the scope guard: feed sample PreToolUse JSON to `bin/pihunt-scope-guard` and
  assert the `permissionDecision`.

Use `mcp__github__*` (read-only) to check upstream tool/library sources and
techniques; `mcp__pihunt-rag__*` for prior harness decisions.
