#!/usr/bin/env bash
# pihunt-common.sh — shared helpers for the pi-hunt CLI tools.
#
# Single source of truth for: repo-root discovery, engagement/program resolution,
# and reading scalars out of the TOML config layer (config/*.toml). Safe to source
# more than once. Requires python3 (already a hard prerequisite) for TOML reads.
#
# Tools source it with a locator block that works from a clone or an installed copy:
#
#   for __l in "$(dirname "${BASH_SOURCE[0]}")/../lib/pihunt-common.sh" \
#              "$HOME/.local/lib/pihunt-common.sh" \
#              "${PIHUNT_REPO:-}/lib/pihunt-common.sh"; do
#     [ -r "$__l" ] && { . "$__l"; break; }
#   done; unset __l
#
# (install.sh deploys this file to ~/.local/lib/ so ~/.local/bin/<tool>/../lib resolves.)

# Guard against double-sourcing.
[ -n "${__PIHUNT_COMMON_SOURCED:-}" ] && return 0
__PIHUNT_COMMON_SOURCED=1

# --- repo root -------------------------------------------------------------
# Resolution order: $PIHUNT_REPO (if a real dir) > walk up from CWD to the dir
# holding the .pihunt-root marker > the parent of this lib's own dir (clone
# layout: <repo>/lib/..). Prints the path and returns 0, else returns 1.
pihunt_repo_root() {
  if [ -n "${PIHUNT_REPO:-}" ] && [ -d "$PIHUNT_REPO" ]; then
    printf '%s\n' "$PIHUNT_REPO"; return 0
  fi
  local d="$PWD"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/.pihunt-root" ] && { printf '%s\n' "$d"; return 0; }
    d="$(dirname "$d")"
  done
  d="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
  [ -n "$d" ] && [ -f "$d/.pihunt-root" ] && { printf '%s\n' "$d"; return 0; }
  return 1
}

# --- TOML scalar read ------------------------------------------------------
# pihunt_toml_get <file> <dotted.key>  ->  scalar value on stdout (empty if absent
# or not a scalar). Uses python3 stdlib tomllib (python 3.11+); no extra deps.
pihunt_toml_get() {
  [ -r "${1:-}" ] || return 0
  python3 - "$1" "$2" <<'PY'
import sys, tomllib
try:
    with open(sys.argv[1], "rb") as fh:
        data = tomllib.load(fh)
except Exception:
    sys.exit(0)
cur = data
for part in sys.argv[2].split("."):
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        sys.exit(0)
if not isinstance(cur, (dict, list)):
    print(cur)
PY
}

# --- engagement ------------------------------------------------------------
# The engagement config file: the git-ignored local override wins over the
# committed template. Prints the path or returns 1.
pihunt_engagement_file() {
  local root; root="$(pihunt_repo_root)" || return 1
  if [ -f "$root/config/engagement.local.toml" ]; then
    printf '%s\n' "$root/config/engagement.local.toml"; return 0
  fi
  if [ -f "$root/config/engagement.toml" ]; then
    printf '%s\n' "$root/config/engagement.toml"; return 0
  fi
  return 1
}

# One engagement field: program | platform | researcher | floor.
pihunt_engagement_get() { # $1=field
  local f; f="$(pihunt_engagement_file)" || return 0
  pihunt_toml_get "$f" "engagement.$1"
}

# The active program slug: $PIHUNT_PROGRAM overrides the engagement config.
# Prints empty if neither is set — callers decide how to handle that.
pihunt_program() {
  if [ -n "${PIHUNT_PROGRAM:-}" ]; then printf '%s\n' "$PIHUNT_PROGRAM"; return 0; fi
  pihunt_engagement_get program
}

# --- TOML list read --------------------------------------------------------
# pihunt_toml_list <file> <dotted.key>  ->  one array element per line (empty if
# absent or not a list). Complements pihunt_toml_get, which skips lists. Only
# scalar elements are printed; nested tables/arrays are skipped.
pihunt_toml_list() {
  [ -r "${1:-}" ] || return 0
  python3 - "$1" "$2" <<'PY'
import sys, tomllib
try:
    with open(sys.argv[1], "rb") as fh:
        data = tomllib.load(fh)
except Exception:
    sys.exit(0)
cur = data
for part in sys.argv[2].split("."):
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        sys.exit(0)
if isinstance(cur, list):
    for item in cur:
        if not isinstance(item, (dict, list)):
            print(item)
PY
}

# --- engagement scope ------------------------------------------------------
# The [scope] block of the engagement config (local override wins). Read by the
# ROE/scope guard. Fields:
#   in_scope / out_of_scope  -> host globs, one per line (pihunt_scope_list)
#   max_req_per_sec          -> scalar (pihunt_scope_get)
pihunt_scope_get() { # $1=field (e.g. max_req_per_sec)
  local f; f="$(pihunt_engagement_file)" || return 0
  pihunt_toml_get "$f" "scope.$1"
}
pihunt_scope_list() { # $1=in_scope|out_of_scope
  local f; f="$(pihunt_engagement_file)" || return 0
  pihunt_toml_list "$f" "scope.$1"
}
