#!/usr/bin/env bash
# =============================================================================
# pi-hunt restore/install
# Restores the pi-hunt bug-bounty setup for the current machine:
#   pi.dev coordinator + 26 specialist subagents (incl. hypothesis-redteam)
#   Kimi Code coordinator + Google-direct mechanical tier
#   ALL 7 MCP servers (browser-live, burp, memory, github, medium, pihunt-rag, gmail)
#   steering, skills, coordinator prompt, systemd auto-start
#
# Usage:   ./install.sh                 # full install
#          GITHUB_MCP_TOKEN=ghp_xxx ./install.sh   # also wire the github MCP token
#          ./install.sh --dry-run       # print actions, change nothing
#
# Safe to re-run: existing targets are backed up to <path>.bak-<timestamp>.
# =============================================================================
set -uo pipefail

SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
H="$HOME"
OLD_HOME="__PIHUNT_HOME__"                  # neutral token, re-homed to $H below
USER_NAME="$(id -un)"
TS="$(date +%Y%m%d-%H%M%S)"
PI_PKG="@earendil-works/pi-coding-agent@0.79.0"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
DRYARG=""; [ "$DRY" = 1 ] && DRYARG="--dry-run"
DRYNOTE=""; [ "$DRY" = 1 ] && DRYNOTE=" (dry-run — nothing changed)"
MACHINE="${PIHUNT_MACHINE:-default}"   # machine profile for pihunt-config build (config/machines.toml)

c(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok(){ printf '   \033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[1;33m! %s\033[0m\n' "$*"; }
run(){ if [ "$DRY" = 1 ]; then printf '   [dry] %s\n' "$*"; else eval "$@"; fi; }
bk(){ [ -e "$1" ] && { if [ "$DRY" = 1 ]; then printf '   [dry] backup %s\n' "$1"; else cp -a "$1" "$1.bak-$TS" && ok "backed up existing $(basename "$1") -> .bak-$TS"; fi; }; }
rehome(){ [ "$DRY" = 1 ] && { printf '   [dry] rehome %s\n' "$1"; return; }; [ -f "$1" ] && grep -Iq "$OLD_HOME" "$1" 2>/dev/null && sed -i "s|$OLD_HOME|$H|g" "$1" && ok "re-homed $(basename "$1")"; }
npmdeps(){ # npm ci (fallback install) in dir $1
  [ "$DRY" = 1 ] && { printf '   [dry] npm ci in %s\n' "$1"; return; }
  ( cd "$1" && { npm ci --silent 2>/dev/null || npm install --silent; } ) && ok "deps installed: $(basename "$1")" || warn "npm install failed in $1 (run it manually)"; }

c "Prerequisites"
miss=0
for t in node npm python3 curl rsync; do command -v "$t" >/dev/null || { warn "MISSING (required): $t"; miss=1; }; done
[ "$miss" = 1 ] && { echo "Install the missing required tools and re-run."; exit 1; }
echo "   node $(node -v) | npm $(npm -v) | $(python3 -V) | $USER_NAME@$(hostname)"
NODE_MAJ="$(node -v | sed 's/v\([0-9]*\).*/\1/')"; [ "$NODE_MAJ" -lt 22 ] 2>/dev/null && warn "node < 22 — pi 0.79.0 expects Node 22+."
command -v java >/dev/null && ok "java present (burp MCP)" || warn "java NOT found — needed for the burp MCP proxy jar."
{ command -v chromium >/dev/null || [ -x /usr/bin/chromium ] || command -v google-chrome >/dev/null; } && ok "chromium present (browser-live)" || warn "chromium NOT found — browser-live needs /usr/bin/chromium (or set BROWSER_LIVE_CHROME_BIN)."

c "0/9  config: validate + compile (config/*.toml -> models.json + tier defaults)"
if [ -f "$SRC/bin/pihunt-config" ]; then
  # per-machine profile selection (git-ignored); seed active=default if this box has none
  if [ ! -f "$SRC/config/machines.local.toml" ]; then
    if [ "$DRY" = 1 ]; then printf '   [dry] seed config/machines.local.toml (active=default)\n'
    else printf '%s\n' '# per-machine profile (git-ignored). Set active to a profile in machines.toml.' 'active = "default"' > "$SRC/config/machines.local.toml" && warn "seeded config/machines.local.toml (active=default) — set it to laptop/desktop for this box"; fi
  fi
  MACHINE="$(python3 "$SRC/bin/pihunt-config" active-machine 2>/dev/null || echo "$MACHINE")"
  python3 "$SRC/bin/pihunt-config" validate || { warn "config validate FAILED — fix config/*.toml and re-run"; [ "$DRY" = 0 ] && exit 1; }
  if [ "$DRY" = 1 ]; then python3 "$SRC/bin/pihunt-config" build --machine "$MACHINE" --dry >/dev/null && ok "[dry] would compile config (machine=$MACHINE)"
  else python3 "$SRC/bin/pihunt-config" build --machine "$MACHINE" >/dev/null && ok "compiled config (machine=$MACHINE) -> models.json + build/"; fi
else warn "bin/pihunt-config not bundled — skipping config compile (models.json used as-is)"; fi

c "1/9  pi runtime  ($PI_PKG)"
if [ "$(pi --version 2>/dev/null)" = "0.79.0" ]; then ok "pi 0.79.0 already installed"; else
  run "npm install -g '$PI_PKG'" && ok "installed pi" || warn "npm -g install failed (check 'npm prefix -g' / PATH)"; fi

c "2/9  pi agent config  ->  $H/.pi/agent"
run "mkdir -p '$H/.pi/agent'"; bk "$H/.pi/agent"
run "rsync -a '$SRC/pi-agent/' '$H/.pi/agent/'" && ok "26 agents, extensions (mcp-bridge, subagent ensemble/swarm + MCP profiles, human-alert, auto-continue, continuous-learning), models.json, settings.json, prompts, adapter"
[ "$DRY" = 0 ] && grep -Ilr "$OLD_HOME" "$H/.pi/agent" 2>/dev/null | while read -r f; do sed -i "s|$OLD_HOME|$H|g" "$f"; done
[ -f "$H/.pi/agent/extensions/mcp-bridge/package.json" ] && npmdeps "$H/.pi/agent/extensions/mcp-bridge"
[ -f "$H/.pi/agent/bin/fd" ] && chmod +x "$H/.pi/agent/bin/fd" 2>/dev/null
[ "$(uname -m)" != "x86_64" ] && warn "Non-x86_64: bundled pi-agent/bin/fd won't run — install fd-find."

c "2b/9  pi packages (hunt-relevant: recon, pentest, case tracking, web access)"
PI_PKGS=(pi-casefile pi-recon-tools @artale/pi-pentest pi-redteam @vigolium/piolium pi-web-access)
if command -v pi >/dev/null 2>&1; then
  for spec in "${PI_PKGS[@]}"; do
    if [ "$DRY" = 1 ]; then printf '   [dry] pi install npm:%s\n' "$spec"; 
    else pi install "npm:$spec" >/dev/null 2>&1 && ok "installed npm:$spec" || warn "could not install npm:$spec (install later: pi install npm:$spec)"; fi
  done
else warn "pi not on PATH yet — packages will auto-install on first 'pi' run from the bundled settings.json"; fi

c "3/9  MCP config  ->  $H/.pi/agent/mcp.json  (+ github token)"
run "mkdir -p '$H/.pi/agent'"
PRIOR_TOK="$(grep -o 'ghp_[A-Za-z0-9]*' "$H/.pi/agent/mcp.json" 2>/dev/null | head -1)"   # preserve on re-install
if [ -z "$PRIOR_TOK" ]; then
  PRIOR_TOK="$(grep -o 'ghp_[A-Za-z0-9]*' "$H/.kiro/settings/mcp.json" 2>/dev/null | head -1)"  # migrate legacy token
fi
bk "$H/.pi/agent/mcp.json"
run "cp -p '$SRC/mcp-config/mcp.json' '$H/.pi/agent/mcp.json'"
rehome "$H/.pi/agent/mcp.json"
TOK="${GITHUB_MCP_TOKEN:-$PRIOR_TOK}"
if [ -z "$TOK" ] && [ "$DRY" = 0 ] && [ -t 0 ]; then read -rsp '   GitHub MCP token (ghp_… ; Enter to skip): ' TOK; echo; fi
if [ -n "$TOK" ] && [ "$DRY" = 0 ]; then sed -i "s|\${GITHUB_MCP_TOKEN}|$TOK|g" "$H/.pi/agent/mcp.json"; ok "github MCP token wired"; \
  else warn "github token not set — edit \${GITHUB_MCP_TOKEN} in ~/.pi/agent/mcp.json, or re-run with GITHUB_MCP_TOKEN=ghp_…"; fi
ok "mcp.json placed (browser-live, burp, memory, github, medium, gmail; pihunt-rag added by the RAG step)"

c "4/9  MCP server implementations"
# browser-live -> ~/.claude/mcp
run "mkdir -p '$H/.claude/mcp'"
run "rsync -a '$SRC/mcp-servers/browser-live/' '$H/.claude/mcp/'"
[ "$DRY" = 0 ] && chmod +x "$H/.claude/mcp/"*.sh 2>/dev/null
rehome "$H/.claude/mcp/browser-live-launch.sh"
npmdeps "$H/.claude/mcp"
# chrome-devtools-mcp -> ~/.local/share/browser-live/chrome-devtools-mcp (npm ci pulls the 18M dep)
CDT="$H/.local/share/browser-live/chrome-devtools-mcp"
run "mkdir -p '$CDT'"
run "cp -p '$SRC/mcp-servers/chrome-devtools-mcp/'package*.json '$CDT/'"
npmdeps "$CDT"
# medium-rss-mcp -> ~/opencode/medium-rss-mcp
run "mkdir -p '$H/opencode/medium-rss-mcp'"
run "cp -p '$SRC/mcp-servers/medium-rss-mcp/server.mjs' '$H/opencode/medium-rss-mcp/'" && ok "medium-rss-mcp (no deps)"
# burp proxy jar -> ~/.BurpSuite/mcp-proxy (LEGACY stdio bridge; the default runtime
# talks to Burp's MCP SSE server directly. 13MB third-party jar, not bundled — best-effort.)
run "mkdir -p '$H/.BurpSuite/mcp-proxy'"
BURP_JAR="$SRC/mcp-servers/burp-mcp-proxy/mcp-proxy-all.jar"
if [ -f "$BURP_JAR" ]; then
  run "cp -p '$BURP_JAR' '$H/.BurpSuite/mcp-proxy/'" && ok "burp mcp-proxy jar -> ~/.BurpSuite/mcp-proxy (stdio bridge; needs Burp + AI-Agent ext on :9876)"
elif [ -f "$H/.BurpSuite/mcp-proxy/mcp-proxy-all.jar" ]; then
  ok "burp mcp-proxy jar already present (not bundled; kept existing)"
else
  warn "burp mcp-proxy jar not bundled (13MB legacy stdio bridge) and none installed — see mcp-servers/burp-mcp-proxy/README.md. Optional: the default runtime uses Burp's SSE server directly."
fi
# memory data -> ~/.config/opencode/memory (don't clobber an existing graph)
run "mkdir -p '$H/.config/opencode/memory'"
if [ "$DRY" = 0 ] && [ ! -f "$H/.config/opencode/memory/memory.jsonl" ]; then
  cp -p "$SRC/data/memory.jsonl" "$H/.config/opencode/memory/" && ok "seeded memory.jsonl (hunt memory)"
else warn "kept existing memory.jsonl (bundled copy at data/memory.jsonl to merge if wanted)"; fi
warn "gmail MCP: put your OAuth files at $H/.gmail-mcp/{gcp-oauth.keys.json,credentials.json} then auth (npx @gongrzhe/server-gmail-autoauth-mcp auth). NOT bundled (secrets)."

c "5/9  steering + skills + coordinator prompt"
run "mkdir -p '$H/.pi/agent/steering' '$H/.pi/agent/skills' '$H/.config/opencode/prompts/claude-agents'"
run "cp -p '$SRC'/steering/*.md '$H/.pi/agent/steering/'" && ok "steering -> ~/.pi/agent/steering"
run "rsync -a '$SRC/skills/' '$H/.pi/agent/skills/'" && ok "skills (×17) -> ~/.pi/agent/skills (pi runtime)"
run "cp -p '$SRC/prompts/build.md' '$H/.config/opencode/prompts/claude-agents/build.md'" && ok "coordinator brain (build.md)"

c "5b/9  RAG + knowledge-graph (semantic recall over techniques, memory graph, findings)"
if [ -f "$SRC/rag/install-rag.sh" ]; then
  run "bash '$SRC/rag/install-rag.sh' $DRYARG" && ok "pihunt-rag installed (venv + model2vec + MCP server + index)" \
    || warn "RAG install had warnings (see output); fallback embedder keeps it working offline"
else warn "rag/install-rag.sh not bundled — skipping RAG"; fi

c "6/7  launchers  ->  $H/.local/bin"
run "mkdir -p '$H/.local/bin'"
for l in pi-hunt pi-tier pihunt-config pihunt-gadgets pihunt-authz pihunt-triage pihunt-missions pihunt-profile pihunt-watchdog hunt-session hunt-brief submission-shots pihunt-scope-guard; do [ -f "$SRC/bin/$l" ] || continue; bk "$H/.local/bin/$l"; run "cp -p '$SRC/bin/$l' '$H/.local/bin/$l'"; rehome "$H/.local/bin/$l"; run "chmod +x '$H/.local/bin/$l'"; done
ok "launchers: pi-hunt, pi-tier (cost tiering), hunt-session + hunt-brief (session routine), gadgets/authz/triage, missions/profile/watchdog (observability), pihunt-scope-guard (Claude Code ROE PreToolUse guard)"
# shared bash lib the tools source (repo-root discovery, engagement/program resolution, TOML reads)
if [ -d "$SRC/lib" ]; then
  run "mkdir -p '$H/.local/lib'"
  for lf in "$SRC"/lib/*.sh; do [ -f "$lf" ] || continue; bk "$H/.local/lib/$(basename "$lf")"; run "cp -p '$lf' '$H/.local/lib/'"; done
  ok "shared lib -> ~/.local/lib (pihunt-common.sh) — ~/.local/bin/<tool>/../lib resolves"
fi
# continuous-recon engine + scheduler + registry helper
if [ -d "$SRC/recon" ]; then
  run "cp -p '$SRC/recon/recon-engine.sh' '$H/.local/bin/pihunt-recon'" && run "chmod +x '$H/.local/bin/pihunt-recon'"
  run "cp -p '$SRC/recon/recon-scheduler.sh' '$H/.local/bin/pihunt-recon-scheduler'" && run "chmod +x '$H/.local/bin/pihunt-recon-scheduler'"
  run "cp -p '$SRC/recon/recon-reg.sh' '$H/.local/bin/pihunt-recon-reg'" && run "chmod +x '$H/.local/bin/pihunt-recon-reg'"
  [ -f "$SRC/recon/ct-monitor.sh" ] && run "cp -p '$SRC/recon/ct-monitor.sh' '$H/.local/bin/pihunt-ct-monitor'" && run "chmod +x '$H/.local/bin/pihunt-ct-monitor'"
  for rs in wordlist-curator:pihunt-wordlist vulnscan:pihunt-vulnscan payload-curator:pihunt-payload; do sf="${rs%%:*}"; df="${rs##*:}"; [ -f "$SRC/recon/$sf.sh" ] && run "cp -p '$SRC/recon/$sf.sh' '$H/.local/bin/$df'" && run "chmod +x '$H/.local/bin/$df'"; done
  ok "pihunt-recon, -scheduler, -reg, -ct-monitor, pihunt-wordlist (curator), pihunt-vulnscan (CVE/misconfig)"
  # fetch a resolvers list for mass-DNS brute (best effort)
  run "mkdir -p '$H/.pi-hunt-rag/recon-assets'"
  [ "$DRY" = 0 ] && [ ! -s "$H/.pi-hunt-rag/recon-assets/resolvers.txt" ] && curl -s -m20 https://raw.githubusercontent.com/trickest/resolvers/main/resolvers.txt -o "$H/.pi-hunt-rag/recon-assets/resolvers.txt" 2>/dev/null && ok "resolvers.txt fetched"
fi
case ":$PATH:" in *":$H/.local/bin:"*) :;; *) warn "$H/.local/bin not on PATH — add: export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac

c "6b/7  systemd user services (optional recon timer)"
run "mkdir -p '$H/.config/systemd/user'"
# continuous-recon timer (periodic re-recon -> RAG)
if [ -f "$SRC/systemd/pihunt-recon.service" ] && [ "$DRY" = 0 ]; then
  sed "s|$OLD_HOME|$H|g" "$SRC/systemd/pihunt-recon.service" > "$H/.config/systemd/user/pihunt-recon.service"
  cp -p "$SRC/systemd/pihunt-recon.timer" "$H/.config/systemd/user/pihunt-recon.timer"
  ok "recon timer unit installed (every 6h, --fast)"
fi
# CVE + attack-pattern freshness timer (KEV/NVD/EPSS -> RAG)
if [ -f "$SRC/systemd/pihunt-cve.service" ] && [ "$DRY" = 0 ]; then
  sed "s|$OLD_HOME|$H|g" "$SRC/systemd/pihunt-cve.service" > "$H/.config/systemd/user/pihunt-cve.service"
  cp -p "$SRC/systemd/pihunt-cve.timer" "$H/.config/systemd/user/pihunt-cve.timer"
  ok "cve-freshness timer unit installed (daily; KEV/NVD/EPSS -> RAG)"
fi
if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  run "systemctl --user daemon-reload"
  [ -f "$H/.config/systemd/user/pihunt-recon.timer" ] && run "systemctl --user enable --now pihunt-recon.timer" && ok "recon timer enabled (register programs: pihunt-recon-reg add <prog> <domains>)"
  [ -f "$H/.config/systemd/user/pihunt-cve.timer" ] && run "systemctl --user enable --now pihunt-cve.timer" && ok "cve-freshness timer enabled (daily KEV/NVD/EPSS refresh)"
  run "loginctl enable-linger '$USER_NAME'" && ok "linger enabled"
else warn "systemd --user unavailable. The optional recon/cve timers were not enabled."; fi

c "6b2/7  config: seed secret + engagement templates (non-destructive)"
run "mkdir -p '$H/.pi/secrets'"
if [ -d "$SRC/config/secrets" ]; then
  for ex in "$SRC"/config/secrets/*.env.example; do
    [ -f "$ex" ] || continue
    [ "$(basename "$ex")" = "pihunt-tuning.env.example" ] && continue   # machine-specific; handled below
    dst="$H/.pi/secrets/$(basename "${ex%.example}")"
    if [ -e "$dst" ]; then ok "kept existing $(basename "$dst")"
    elif [ "$DRY" = 1 ]; then printf '   [dry] seed %s from template\n' "$dst"
    else cp -p "$ex" "$dst" && warn "seeded $(basename "$dst") — FILL IN its key(s) before launching"; fi
  done
  run "chmod 700 '$H/.pi/secrets'"
fi
if [ -f "$SRC/config/engagement.toml" ] && [ ! -f "$SRC/config/engagement.local.toml" ]; then
  if [ "$DRY" = 1 ]; then printf '   [dry] seed config/engagement.local.toml from template\n'
  else cp -p "$SRC/config/engagement.toml" "$SRC/config/engagement.local.toml" && warn "seeded config/engagement.local.toml — EDIT it: set program/platform/researcher"; fi
fi

# machine subagent tuning: prefer the machine-specific build output, else the template
TUNE_DST="$H/.pi/secrets/pihunt-tuning.env"
if [ -e "$TUNE_DST" ]; then ok "kept existing pihunt-tuning.env"
elif [ -f "$SRC/build/pihunt-tuning.env" ]; then
  if [ "$DRY" = 1 ]; then printf '   [dry] seed pihunt-tuning.env from build (machine=%s)\n' "$MACHINE"
  else cp -p "$SRC/build/pihunt-tuning.env" "$TUNE_DST" && ok "seeded pihunt-tuning.env (machine=$MACHINE)"; fi
elif [ -f "$SRC/config/secrets/pihunt-tuning.env.example" ]; then
  if [ "$DRY" = 1 ]; then printf '   [dry] seed pihunt-tuning.env from template\n'
  else cp -p "$SRC/config/secrets/pihunt-tuning.env.example" "$TUNE_DST" && warn "seeded pihunt-tuning.env from template"; fi
fi
# tier-defaults overlay: pi-tier sources this (tier models + CONC_* from the machine profile)
if [ -f "$SRC/build/tier-defaults.sh" ]; then
  bk "$H/.pi/agent/.tier-defaults.sh"
  run "cp -p '$SRC/build/tier-defaults.sh' '$H/.pi/agent/.tier-defaults.sh'" && ok "deployed tier-defaults overlay (.tier-defaults.sh, machine=$MACHINE)"
fi

c "6c/7  shell env  ->  source LLM provider keys for pi"
# pi reads provider API keys from the ENVIRONMENT ($OPENROUTER_API_KEY, $RADEON_API_KEY,
# $GROQ_API_KEY, $MISTRAL_API_KEY, …). The keys live in ~/.pi/secrets/*.env but a shell
# only has them if its rc sources them — otherwise pi fails with "No API key found for
# <provider>" (classically openrouter, the coordinator). Add ONE idempotent managed block
# to the login shell's rc so every new shell (and interactive pi-hunt) sees them.
case "$(basename "${SHELL:-sh}")" in
  zsh)  RC="$H/.zshrc" ;;
  bash) RC="$H/.bashrc" ;;
  *)    RC="$H/.profile" ;;
esac
PKMARK="# >>> pi-hunt provider keys >>>"
if [ "$DRY" = 1 ]; then printf '   [dry] ensure provider-key sourcing block in %s\n' "$RC"
elif grep -qF "$PKMARK" "$RC" 2>/dev/null; then ok "provider-key sourcing already present in $(basename "$RC")"
else
  { printf '\n%s\n' "$PKMARK"
    printf '%s\n' "# Source the LLM provider keys pi reads from env (managed by install.sh; safe to re-source)."
    printf '%s\n' 'for __pk in openrouter amd groq cerebras kimi direct_llm; do [ -f "$HOME/.pi/secrets/$__pk.env" ] && . "$HOME/.pi/secrets/$__pk.env"; done; unset __pk'
    printf '%s\n' "# <<< pi-hunt provider keys <<<"
  } >> "$RC" && ok "added provider-key sourcing to $(basename "$RC") — open a new shell or 'source $RC'" \
    || warn "could not append provider-key sourcing to $RC (add it by hand; see docs/operator/OPERATOR-GUIDE.md §2)"
fi

c "7/7  verify"
# Offline self-test of the force-multiplier logic (ensemble/swarm builders, MCP
# profiles, RAM gate, depth cap, retry classification). No model calls.
ST="$H/.pi/agent/extensions/subagent/selftest.mjs"
if [ "$DRY" = 0 ] && [ -f "$ST" ]; then
  ( cd "$H/.pi/agent/extensions/subagent" && node --experimental-strip-types ./selftest.mjs >/tmp/pihunt-selftest.log 2>&1 ) \
    && ok "subagent self-test passed (ensemble/swarm/profiles/RAM/depth/retry)" \
    || warn "subagent self-test FAILED — see /tmp/pihunt-selftest.log"
else [ "$DRY" = 1 ] && printf '   [dry] run subagent selftest.mjs\n'; fi
HA="$H/.pi/agent/extensions/human-alert/selftest.mjs"
if [ "$DRY" = 0 ] && [ -f "$HA" ]; then
  ( cd "$H/.pi/agent/extensions/human-alert" && node --experimental-strip-types ./selftest.mjs >/tmp/pihunt-human-alert-selftest.log 2>&1 ) \
    && ok "human-alert self-test passed (browser-only gating/cooldown)" \
    || warn "human-alert self-test FAILED — see /tmp/pihunt-human-alert-selftest.log"
else [ "$DRY" = 1 ] && printf '   [dry] run human-alert selftest.mjs\n'; fi
AGENTS_N="$(ls "$H/.pi/agent/agents/"*.md 2>/dev/null | wc -l)"
[ "$DRY" = 0 ] && ok "$AGENTS_N specialist agents installed"

cat <<EOF

-----------------------------------------------------------------------------
 pi-hunt restore complete${DRYNOTE}.

 STILL MACHINE-SPECIFIC (can't be copied):
   1. Configure Kimi Code (auth.json) and Google AI Studio (google-direct,
      mechanical tier) credentials locally. The copied $H/.pi/agent/models.json
      keeps its apiKey placeholders empty; never add keys to this repo.
   2. GitHub MCP token                       # GITHUB_MCP_TOKEN=ghp_… ./install.sh  (or edit ~/.pi/agent/mcp.json)
   3. Gmail MCP OAuth                         # $H/.gmail-mcp/{gcp-oauth.keys.json,credentials.json} + auth
   4. Burp Suite app + AI-Agent extension     # the bundled jar bridges to Burp on 127.0.0.1:9876

 RUN:
   pi-hunt                                    # then: Hunt <program> for CRITICAL
-----------------------------------------------------------------------------
EOF
