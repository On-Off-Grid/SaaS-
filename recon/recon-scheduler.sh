#!/usr/bin/env bash
# =============================================================================
# pihunt-recon-scheduler — run continuous recon for every registered program.
#
# Reads a simple registry file (one program per line) and runs recon-engine for
# each, so recon keeps refreshing in the background and the RAG stays current.
# Driven by a systemd user timer (see systemd/pihunt-recon.{service,timer}).
#
# Registry: ~/.pi-hunt-rag/recon-programs.txt
#   format (one per line):   <program> <domain[,domain2,...]> [mode]
#   mode = fast | normal | deep   (default: normal; timer uses fast for cadence)
#   lines starting with # are ignored. Manage with:  pihunt-recon-add / -list / -rm
#
# Canonical output: reports/<program>/structured-recon under PIHUNT_RECON_ROOT
# (default: ~/Desktop/Desktop/harness/reports). The legacy ~/hunts tree is never
# used unless the operator explicitly overrides PIHUNT_RECON_ROOT.
#
# Each program is bounded by PIHUNT_RECON_PROG_TIMEOUT (default 2700s) so one
# wedged target cannot block the whole rotation. The systemd unit has no global
# timeout; the per-program bound rotates to the next target on timeout.
#
# Usage:
#   pihunt-recon-scheduler            # run all registered programs (mode from registry)
#   pihunt-recon-scheduler --fast     # force fast mode for all (timer default)
#   pihunt-recon-scheduler --deep     # force deep mode for all (heavy; manual)
#   pihunt-recon-scheduler <program>  # run just one registered program
# =============================================================================
set -uo pipefail

RAG_HOME="${PIHUNT_RAG_HOME:-$HOME/.pi-hunt-rag}"
REGISTRY="${PIHUNT_RECON_REGISTRY:-$RAG_HOME/recon-programs.txt}"
LOCK="$RAG_HOME/.recon-scheduler.lock"
LOG="$RAG_HOME/recon-scheduler.log"
PIHUNT_RECON_ROOT="${PIHUNT_RECON_ROOT:-$HOME/Desktop/Desktop/harness/reports}"
PROG_TIMEOUT="${PIHUNT_RECON_PROG_TIMEOUT:-2700}"
export PIHUNT_RECON_ROOT
ENGINE=""
for c in "$HOME/.local/bin/pihunt-recon" "$(dirname "$0")/recon-engine.sh"; do
  [ -x "$c" ] && { ENGINE="$c"; break; }
done
[ -z "$ENGINE" ] && { echo "recon-engine not found"; exit 1; }

FORCE_MODE=""; ONLY=""
for a in "$@"; do case "$a" in
  --fast) FORCE_MODE="fast";; --normal) FORCE_MODE="normal";; --deep) FORCE_MODE="deep";;
  -*) ;; *) ONLY="$a";;
esac; done

[ -f "$REGISTRY" ] || { echo "no registry at $REGISTRY (add one with: pihunt-recon-add <program> <domains>)"; exit 0; }

# single-flight: don't overlap scheduler runs
exec 9>"$LOCK"
if ! flock -n 9; then echo "another recon-scheduler run is active; exiting"; exit 0; fi

ts(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "[$(ts)] scheduler start (force_mode=${FORCE_MODE:-registry} only=${ONLY:-all} root=$PIHUNT_RECON_ROOT prog_timeout=${PROG_TIMEOUT}s)" >> "$LOG"

while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"; [ -z "$line" ] && continue
  prog="$(echo "$line" | awk '{print $1}')"
  doms="$(echo "$line" | awk '{print $2}')"
  mode="$(echo "$line" | awk '{print $3}')"; mode="${mode:-normal}"
  [ -n "$FORCE_MODE" ] && mode="$FORCE_MODE"
  [ -n "$ONLY" ] && [ "$prog" != "$ONLY" ] && continue
  [ -z "$prog" ] || [ -z "$doms" ] && continue
  echo "[$(ts)] recon $prog ($doms) mode=$mode" >> "$LOG"
  if timeout --signal=TERM --kill-after=60 "$PROG_TIMEOUT" \
      env PIHUNT_RAG_HOME="$RAG_HOME" PIHUNT_RECON_ROOT="$PIHUNT_RECON_ROOT" \
      "$ENGINE" "$prog" "$doms" --"$mode" >> "$LOG" 2>&1; then
    echo "[$(ts)] done $prog" >> "$LOG"
  else
    rc=$?
    if [ "$rc" -eq 124 ]; then
      echo "[$(ts)] TIMEOUT $prog after ${PROG_TIMEOUT}s (rotating to next)" >> "$LOG"
    else
      echo "[$(ts)] FAILED $prog (rc=$rc)" >> "$LOG"
    fi
  fi
done < "$REGISTRY"

echo "[$(ts)] scheduler complete" >> "$LOG"
