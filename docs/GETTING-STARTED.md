# Getting started

Clone → configure → install → hunt. Aimed at a fresh machine (yours or a friend's).

## 0. Prerequisites

Node 22+, python3 (3.11+), git, curl, rsync. The bootstrap installer can install these
for you on apt/dnf/pacman/brew systems. Optional: java (Burp MCP), chromium (browser-live).

## 1. Clone

```bash
git clone <your-fork-url> pi-hunt
cd pi-hunt
```

## 2. Configure (the `config/` layer)

Set your engagement:

```bash
cp config/engagement.toml config/engagement.local.toml
$EDITOR config/engagement.local.toml      # program / platform / researcher / floor
```

Fill in the provider/integration keys you'll use. The installer seeds these from templates,
but you can also do it by hand:

```bash
mkdir -p ~/.pi/secrets && chmod 700 ~/.pi/secrets
for f in config/secrets/*.env.example; do
  dst=~/.pi/secrets/$(basename "${f%.example}")
  [ -e "$dst" ] || cp "$f" "$dst"
done
$EDITOR ~/.pi/secrets/openrouter.env      # at minimum the coordinator backbone key
```

See `config/README.md` for what each file does. Providers, model tiers, and machine
profiles live in `config/providers.toml` / `tiers.toml` / `machines.toml`; `pihunt-config`
compiles them into `models.json` + pi-tier's defaults (run automatically by `install.sh`).

Pick your machine profile (sizes local-agent concurrency; see `config/machines.toml`):

```bash
export PIHUNT_MACHINE=desktop     # or laptop; falls back to [default] (4-core/8GB) if unset
```

## 3. Install

```bash
./bootstrap.sh            # installs prereqs, then runs install.sh
#  or, if prereqs are already present:
./install.sh              # framework only  (./install.sh --dry-run to preview)
make full                 # framework + recon CLIs & SecLists (needs sudo)
```

`install.sh` deploys the pi runtime + agents to `~/.pi/agent/`, the CLI tools to
`~/.local/bin/`, the shared lib to `~/.local/lib/`, seeds missing secrets from templates,
and adds a managed provider-key sourcing block to your shell rc. Re-runnable; it backs up
anything it replaces to `.bak-<timestamp>`.

Make sure `~/.local/bin` is on your `PATH`, then open a fresh shell so the keys are sourced.

## 4. First hunt

```bash
hunt-brief                # read-only: current engagement + state + suggested next action
hunt-session up           # apply tiering + size concurrency to live quota
hunt-session watchers     # start the safety watchers (background)
# then, in a fresh shell:
source ~/.pi/secrets/pihunt-tuning.env && pi-hunt
#   at the pi prompt:  Hunt <program> in <platform> for <severity>
```

Hunt state is written under `reports/<program>/` (git-ignored; machine-local).

## Troubleshooting

- **`No API key found for <provider>`** — the shell didn't source the keys. Open a new shell,
  or `source ~/.pi/secrets/<provider>.env`. Confirm `install.sh` added the managed block to
  your rc (`grep pi-hunt ~/.zshrc`).
- **A tool can't find the repo** — run it from inside the clone, or `export PIHUNT_REPO=/path/to/clone`.
  The tools locate the repo by the `.pihunt-root` marker.
- **Wrong program** — check `config/engagement.local.toml` (or `echo $PIHUNT_PROGRAM`); `hunt-brief` prints what resolved.
