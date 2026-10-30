# Reading the steer output → a launch instruction

`hunt-session steer` (and the raw `pihunt-gadgets rank` / `chains` / `triggers` +
`pihunt-authz gaps` behind it) is the recon synthesis. On its own it is a wall of
rows; this page is how to read those rows and turn the top one into a concrete launch
or steering instruction. **The whole point: pick the one surface with the best
(severity × actionable-today) and phrase the hunt around the exact endpoint+verb it
names — don't re-hunt the hardened core.**

Run the snapshot: `hunt-session steer` (or `pihunt-gadgets rank && pihunt-authz gaps`).

---

## The four outputs, in reading order

### 1. `pihunt-gadgets rank` — where the leverage is
A leverage table. **Each row is a _capability_ (a primitive) that, if you obtain it,
unblocks one or more attack _chains_.** Columns:

| Column | Read it as |
|---|---|
| **CAPABILITY** | the primitive, with a type prefix (see below) |
| **TIER** | the highest severity any chain it unblocks would reach |
| **#** | how many chains it unblocks |
| **CLASS** | `ACTIONABLE (run the probe)` — you can test it today with your own creds — vs `DISCOVER external gadget` — needs recon to find something external first |
| **CHAINS** | the chain id(s) it feeds (cross-ref `chains`) |

The **CAPABILITY prefix is the key tell:**
- `probe.*` → **actionable now.** A test you run against your own two teams. This is
  almost always where to spend.
- `redirect.* / ciphertext.* / oauth.* / tool.* / cache.*` → an **external gadget you
  must discover** in recon before the chain composes. Lower immediate ROI — it's a
  "keep an eye out during recon", not a "point the fleet here".

**Sort order is (max tier → actionable-first → #chains).** So the correct read is
top-down: **the first `ACTIONABLE` row at the highest tier is your best spend.** Ignore
the `DISCOVER` rows for budgeting — they're armed by recon, not by fleet time (they
show up in `triggers` once their gadget is found).

**Dead-end trailer.** Below a `# dead-ends` line sit capabilities marked
`KILLED (probed negative)` — a probe already ran and the capability is **absent**.
These are kept OUT of the ranking so they can't masquerade as actionable; they re-open
*only* via a re-arm trigger. If a killed row is sitting in the *live* table instead of
the trailer, the graph is out of sync — a negative probe wasn't recorded (see
"graph hygiene" below).

### 2. `pihunt-gadgets chains` — is it live yet
Same chains, by composability state. The words mean:
- `untested` — the probe was never run; the primitive is missing because nobody looked.
  **These are the opportunities.**
- `confirmed_partial COMPOSABLE` — the primitive is confirmed and the chain composes
  now. (This is your already-submitted work, e.g. `F_harness_transfer`.)
- `not_composable / blocked / dead / killed` — DISCOVER chains that are stalled; each
  carries its `case_…` id so you can read why it died in the casefile before reopening.

### 3. `pihunt-authz gaps` — the exact endpoint+verb to hit
This is the operational half: the rank tells you *which capability*, this tells you
*which request*. Per-resource cells, tagged:
- `[OPEN]` — leaks already **confirmed** here (`!! LEAK` lines). A `200 cross-team` is a
  live leak; a `409 backend-not-ready (authz passed)` means the authz check already
  passed and it'll be a live cross-team write the day the backend ships — a **re-arm**,
  not a dead end.
- `[SPLIT]` — **highest ROI.** The tenancy boundary is already proven on one verb of
  this resource, but the listed sibling verbs are **untested**. A missing check on a
  sibling is the single most likely live bug. (The submitted transfer BOLA came from
  exactly this.)
- `[COLD]` — frontier surface, no boundary proven yet. More speculative; worth it only
  when the `frontier:` date is very recent.

Every cell carries a **`frontier:` ship-date.** Younger surface = less hardened =
multi-tenant isolation bugs live there before they're found. Rank ties by youth.

### 4. `pihunt-gadgets patterns` — what a decent hunter does *next*
The rank/gaps tell you *where*; this tells you *how to chain it*. For every chain it
prints the **practitioner pattern** it instantiates, the **next link that pattern
predicts**, and the **source** (a named researcher's primary write-up or book, never a
tutorial), so the reasoning is auditable. It is the graph "picking up patterns": a
BOLA read isn't a finding to stop at, it's Sam Curry's sibling-verb sweep with a
predicted next move (leak the id → sweep write/state verbs → escalate to takeover); an
SSRF is Orange Tsai's parser-confusion with its own next move; and so on.

Read it to turn a confirmed primitive into the *rest* of the chain, and to sanity-check
you're not stopping one verb early. The patterns live in the repo-tracked, program-
agnostic registry `knowledge/chaining-patterns.jsonl` — add an entry when a new chain
prints `(no pattern mapped)` rather than forcing a bad fit. Matching is by the chain's
`maps_to`/`pattern` tag or a `grant_match` prefix against the chain's granted
capability, so a new chain that grants a known class auto-links.

### 5. `pihunt-gadgets triggers` — what recon (or a scope change) just unlocked
Re-arm triggers. `ARMED` = a previously-killed case is **reopenable right now**;
`WAITING` = still needs its condition. A trigger arms on ANY of three conditions
(each ARMED line prints *why*):
- `when_capability` — a confirmed gadget now grants the capability (recon found it).
- `when_scope_added` — a matching asset just **entered scope** (from the `pihunt-updates`
  delta) — e.g. an OOS-gated dead-end re-opens the day the program adds that asset.
- `when_status` — the program status now equals the value (e.g. `Open`).

Scan this after any recon pass **or program-updates fetch**: an `ARMED` line is a free
re-hunt of a bug you already scoped. `pihunt-gadgets check` (exit 10 on any ARMED) is
run by the recon stage and surfaced in the session brief.

---

## The decision flow (rank → gap → instruction)

1. **Top actionable row in `rank`.** Highest tier, `ACTIONABLE`, most chains. That's
   the capability to go get.
2. **Find its resource cell in `gaps`.** Prefer `[SPLIT]` over `[COLD]`; a `[SPLIT]`
   hands you the precise untested verb(s).
3. **Read the exact endpoint + verb** off the `!! LEAK` / `. test` line. That string
   is your target.
4. **Phrase the launch/steer instruction** around it, as an authz-differential
   (A→B / B→A / unauth across the identity rig — the default posture for BOLA/BFLA):
   > `Hunt digitalocean in Intigriti for CRITICAL. Start on <endpoint>: authz-`
   > `differential across both teams — A reads/writes B's object by id, B→A, and`
   > `unauth. Confirm or kill, write the node to gadget-graph.jsonl.`
5. **Pull the chaining pattern** with `pihunt-gadgets patterns` for that chain: it
   names the predicted next link(s) and the hunter whose work they come from, so once
   the probe confirms you already know the follow-on moves (leak id → sibling write/
   state verbs → escalate) instead of stopping at first blood.
6. **Record the outcome** so the next `rank` sharpens: confirm/kill → `gadget-graph.jsonl`
   node, then submit by hand, then `pihunt-triage record/verdict/sync` (see
   OPERATOR-GUIDE §5).

**Worked example (snapshot of 2026-10-28).** Top actionable-critical row is
`probe.genai_byok_crossaccount` → `chains` shows `F_genai_byok [critical] untested` →
`gaps` `[COLD] genai` names `byok-provider-keys: GET /v2/gen-ai/{openai,anthropic}/keys/<uuid>/agents`
(cross-account stored-credential listing) + the `[COLD] genai` BOLA siblings on
`/v2/gen-ai/agents/<uuid>/api_keys{,/regenerate}`. So the instruction is: point the
fleet at the GenAI BYOK key endpoints, cross-account, with the A/B PAT rig.
(`probe.microvm_cross_id` and `probe.harness_transfer_crosssession` tie at critical —
pick by youngest frontier / whichever primitive your rig can exercise today.)

---

## Graph hygiene — why a stale node poisons the ranking
The ranking is only as honest as the graph. The compounding failure mode: a probe runs
and **kills** a surface, but the result is recorded in only one place, so the rest of
the tooling keeps offering the dead surface as live. Keep three things in lockstep when
a probe comes back negative:

1. **The negative gadget node** (`gadget-graph.jsonl`): record the absent capability in
   the node's `grants` (e.g. a node `id: probe.microvm_cross_id` with
   `grants: ["probe.microvm_cross_id"]`, `status: negative`). The loader harvests both
   the `id` (if it looks like a capability — has a `.`) and `grants` into the negative
   set, so either convention reconciles — but fill `grants` so sibling tools see it too.
2. **The chain** that needed it: flip its `status` to `dead` (or let it derive — a chain
   whose only missing need is probed-negative prints `DEAD` in `chains` and drops to the
   dead-end trailer in `rank`). Add a re-arm trigger if it's "dead *for now*".
3. **The authz differential** (`authz-differential.jsonl`): set the swept verbs
   `enforced: true` (or `"blocked"` for a gated one) with the evidence path, so
   `pihunt-authz` re-classifies the resource (a fully-enforced one becomes `CLEAR` and
   leaves the `gaps` list). A gated-but-untested sibling stays visible as a re-arm.

Symptom you've skipped one: a `KILLED` capability showing in the live `rank` table, or a
resource you already swept still listed `[COLD]`/`[SPLIT]` in `gaps`. (This is exactly
what happened to `microvm` — probed negative Oct 27, but left `untested` in both files
until reconciled.)

## Guardrails that override the ranking
The rank optimizes for leverage; it does **not** encode ROE. Before you point the fleet
at a row, re-check the hard limits (full list in the session handoff / CLAUDE.md):
- Own tokens/account and the **two own teams only** (do1 `afa0ac`, do2 `d9c570`) — the
  authz-differential is A↔B between *your* tenants, never another customer's.
- SSRF (`F_kb_ssrf`) is proof-only via the approved **`ssrf-sheriff`**; no DoS; no AES
  forgery; `*.digitaloceanspaces.com` is **out of scope** (this is why the transfer
  BOLA capped at HIGH, not CRITICAL).
- Header `X-BBP-Researcher: onoffgrid`, ≤10 req/s across all traffic.

A row that can only be proven by crossing one of these is not actionable no matter how
high it ranks — leave it `untested` with a note rather than chase it out of scope.
