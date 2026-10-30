---
name: hunt-ops
description: >-
  Run a bug-bounty hunt from Claude Code as the operator cockpit for the pi-hunt
  harness. Use when orienting on the active engagement, deciding the next action,
  steering the hunt, keeping graph/authz state honest, or driving the
  triage→submission→write-up loop. Complements (does not replace) the pi runtime.
argument-hint: "[program]"
allowed-tools: >-
  Bash(hunt-brief), Bash(hunt-brief *), Bash(hunt-session *), Bash(pihunt-gadgets *),
  Bash(pihunt-authz *), Bash(pihunt-triage *), Read, Edit,
  mcp__pihunt-rag__*, mcp__burp__*
---

# hunt-ops — operator cockpit

You are driving an **authorized, ROE-bound** bug-bounty engagement from Claude Code.
The live hunters run in the separate `pi` runtime; your job here is to orient,
steer, keep state honest, and close findings out — not to re-run the hunters.

## Step 0 — load live state

Run these first (read-only) and read the output before doing anything else:

```bash
bin/hunt-brief --quick        # session brief: last state + suggested next action
bin/pihunt-gadgets suggest    # single best next action (graph + chaining registry)
bin/pihunt-authz gaps         # forgotten-sibling-verb cells to test next
```

## The loop

1. **Orient.** Read the brief + suggestion from Step 0. If a `[program]` argument was
   given ($ARGUMENTS), confirm it matches the resolved engagement; otherwise use the
   resolved one. For deeper context, query `mcp__pihunt-rag__*` for prior work on
   this program, techniques for the vuln class, and current recon.
2. **Steer.** `hunt-session steer` for a synthesis snapshot; `pihunt-gadgets rank`
   (where to spend) and `chains` (composability). Pick the action that can still
   meet the engagement's severity floor.
3. **Act / verify.** Confirm or kill the primitive. Use `mcp__burp__*` `scope_check`
   before any active check, and the proxy history to inspect traffic. The
   PreToolUse scope guard will challenge out-of-scope hosts — that is expected.
4. **Keep state honest (non-negotiable).** A probe result MUST land in **all three**
   or the ranking lies:
   - the gadget node in `reports/<program>/gadget-graph.jsonl` (fill `grants` on a
     negative),
   - its chain's status,
   - `reports/<program>/authz-differential.jsonl`.
   Then re-run `hunt-brief` / `pihunt-gadgets rank` and confirm the synthesis
   self-corrected.
5. **Triage.** `pihunt-triage record → verdict → sync → report`. Program verdicts
   feed back into the graph.
6. **Publish.** For a confirmed finding, hand off to the `writeup` skill
   (`/writeup <case-id>`) to produce a redacted, private, shareable report.

## Rules
- Stay within the engagement's scope and rate floor (see the `[scope]` block / brief).
- Never use destructive payloads; confirm authorization before any active test.
- Edit only under `reports/**` from this skill; tool code changes go through
  `harness-dev`.
