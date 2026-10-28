# pi-hunt — Operator Guide

The single entry point for running the harness. Config + management routine
**before / during / after** a hunt, and how to get the most out of it. Deep
dives are linked at the end; this page is the routine.

> Runtime: coordinator + 16 hunters on `amd-radeon/DeepSeek-V4.1-Flash`, 8
> mechanical on `mistral-direct/codestral-latest`, 2 elite (strict-triager +
> hypothesis-redteam) on `kimi-coding/k3.1-pro`. Everything writes to
> `reports/<program>/…`; **pi-hunt never submits to a platform** — you do.

---

## 0. TL;DR routine

> One-shot wrapper: `hunt-session preflight | up | steer | status | down` runs this
> whole routine quota-aware (`up` = the BEFORE block, `steer` = §6 snapshot,
> `down` = teardown). Evidence screenshots for a submission: `submission-shots
> <replay-dir>`. The explicit commands:

```bash
# BEFORE
pi-tier on                                  # apply model tiering
pi-tier concurrency once                    # size PI_SUBAGENT_MAX_CONCURRENCY to providers up
pi-tier hybrid watch 300 &  pi-tier amd-fallback watch 300 & \
  pi-tier coord-health watch 120 &  pi-tier stall-watch watch 120 &   # safety watchers
bin/pihunt-gadgets rank && bin/pihunt-authz gaps                      # where to spend budget
#   source ~/.pi/secrets/pihunt-tuning.env ; open a fresh shell so concurrency applies

# LAUNCH
pi-hunt
> Hunt <program> in <HackerOne|Intigriti> for <CRITICAL|HIGH|CRITICAL/EXCEPTIONAL>

# AFTER (per confirmed finding)
#   update gadget-graph.jsonl (confirm/kill) → submit by hand → record the outcome:
bin/pihunt-triage record <case> --severity <s> --gadget <g> ; # … submit …
bin/pihunt-triage verdict <case> <accepted|duplicate|…> [--bounty N] ; bin/pihunt-triage sync
```

---

## 1. The stack at a glance

- **Coordinator + 26 subagents** (16 hunters, 8 mechanical, 2 elite). The
  coordinator model is `~/.pi/agent/.coordinator-model`; agents live in
  `~/.pi/agent/agents/` (repo mirror `pi-agent/agents/`).
- **Launchers (`bin/`, deployed to `~/.local/bin`):** `pi-hunt` (entry),
  `pi-tier` (provider/model orchestration), `pihunt-gadgets` + `pihunt-authz`
  (recon synthesis), `pihunt-triage` (submission→verdict loop). `pi-4.8` and
  `pi-kiro` are legacy.
- **Secrets:** `~/.pi/secrets/{openrouter,amd,kimi}.env` (keys),
  `~/.pi/secrets/pihunt-tuning.env` (concurrency/RAM knobs). Never printed/committed.
- **State (per program, under `reports/<prog>/`, gitignored):**
  `structured-recon/scope.md`, `…/authz-matrix.json` **(live creds — never
  print/commit)**, `…/gadget-graph.jsonl`, `…/rearm-triggers.jsonl`,
  `…/authz-differential.jsonl`, `…/submissions.jsonl`; `.pi/casefile.jsonl`
  (event ledger, last-wins by id); `.pi/report/` CaseReports; finding folders
  `reports/<prog>/<ts>-<slug>/`.

---

## 2. BEFORE the hunt — configure & aim

1. **Providers up?** Keys in the three `*.env`; `pi-tier status` shows per-agent
   models + which refs resolve. `pi-tier coord-health status` probes the
   coordinator's provider (its being down is the classic silent freeze).
2. **Apply tiering & concurrency:**
   ```bash
   pi-tier on                     # mechanical/hunters/elite mapping
   pi-tier concurrency once       # 3 providers→6, 2→4, OpenRouter-only→3
   ```
   Concurrency applies at **next launch** (pi reads env at start) — re-source
   `pihunt-tuning.env` or open a new shell, then launch. `pi-tier concurrency
   status` shows live (running pi) vs file value.
3. **Start the safety watchers** (run alongside a long hunt):
   ```bash
   pi-tier hybrid watch 300 &        # elite pair Kimi↔AMD on Kimi's 5h quota
   pi-tier amd-fallback watch 300 &  # AMD $1/day cap → OpenRouter, back on reset
   pi-tier coord-health watch 120 &  # coordinator provider down → stage healthy fallback
   pi-tier stall-watch watch 120 &   # ring the desk if the hunt goes idle/hung
   ```
4. **Aim the fleet with the recon synthesis** (the habit that avoids re-hunting
   the hardened core):
   ```bash
   bin/pihunt-gadgets rank      # the single missing primitive that unblocks the most chains
   bin/pihunt-authz gaps        # SPLIT resources: boundary proven on one verb, siblings UNTESTED
   bin/pihunt-gadgets triggers  # which re-arm triggers are ARMED (a killed case is reopenable)
   ```
5. **Scope + identities:** confirm `scope.md` is current; for API criticals build
   the A/B identity rig into `authz-matrix.json` (two tenants, low vs admin).

---

## 3. LAUNCH — trigger grammar

```
Hunt <PROGRAM> [in HackerOne|in Intigriti] [for <FLOOR>]
```
- **Platform:** default Intigriti. The handle is passed verbatim (handle-lock).
- **Floor:** `for CRITICAL` | `for HIGH` | `for CRITICAL/EXCEPTIONAL`. With a floor
  set the coordinator keeps hunting high-value branches until a finding **at/above**
  the floor is validated by `strict-triager`, or they're exhausted/blocked with
  evidence — it won't stop on low/medium noise.

---

## 4. DURING the hunt — drive & protect

**The phases** (let it run end-to-end, or steer each): scope → recon → creative
seeding (`hypothesis-redteam`) → specialist fan-out → chaining (`security-analyzer`)
→ triage (`strict-triager`) → report folder. Chaining is never skipped: a chain
reaching Tier-1 impact **is** a Tier-1 finding.

**Delegation shapes** (ask for the fit):
| Shape | When | Example |
|---|---|---|
| single / parallel | a few independent leads | "Test the cart API for BOLA and login for OAuth in parallel." |
| ensemble | one high-value surface, max yield | "Ensemble the OAuth login, 6 passes, different angle each." |
| swarm | exhaustive surface×class matrix | "Swarm every endpoint in js_assets.txt: idor + sqli, one cell each." |

**Authz-differential is the default posture for BOLA/BFLA/tenancy** — A→B / B→A /
unauth on every object reference, across the identity rig.

**High-leverage steering moves** (type plain instructions any time):
- Refocus scope / kill a negative-swept branch / escalate a low finding to chaining.
- **Disconfirm every wall:** a 429/403/"not exploitable" is a hypothesis, not a
  conclusion — "prove 429 is rate-limit vs path-signature WAF; try encoded path + rotated egress."
- **Restart empties:** a specialist returning "No result" is a delivery failure, not
  a clean surface — re-run with a narrower objective.
- **Checkpoint before big context:** "Checkpoint findings to reports/ and memory before the swarm."

**Alerts & intervention:**
- `human-alert` rings the desk only for a genuine live-browser wall (captcha with a
  real challenge marker, OTP/2FA, manual handoff) — tuned to not fire on transient
  Cloudflare interstitials or editorial keyword mentions.
- `stall-watch` rings when `pi` is alive but transcripts/casefile stop advancing
  (wedged coordinator / "(running)"-but-idle subagent) — your cue to relaunch/steer.
- A live frozen hunt still needs a **manual relaunch**; `coord-health` guarantees it
  comes back up on a healthy provider.

**The one habit that caps throughput:** treat every subagent as if it will be killed
mid-sentence — its result is its final plain-text message. Checkpoint to `reports/`
continuously; lost-work delivery failures cost more than model quality.

---

## 5. AFTER the hunt — triage, graph, submit, feedback

1. **Keep the gadget graph current** (what makes the next hunt smarter): when a
   hunter confirms or kills a lead, add a node to `gadget-graph.jsonl` —
   `status:confirmed` (grants a capability) or `status:negative` (don't re-hunt).
   Then `pihunt-gadgets rank`/`triggers`/`authz` recompute.
2. **Harvest & submit (by hand):** each finding has a self-contained folder; build
   the platform submission from it (title/asset/CVSS/PoC/impact + inline screenshots
   where mandatory). pi-hunt never submits.
3. **Record the program's verdict and feed it back** — the loop that aims budget
   where findings convert:
   ```bash
   bin/pihunt-triage record  <case> --severity <s> --cvss <v> --gadget <g> --chain <c>
   bin/pihunt-triage verdict <case> <accepted|duplicate|informative|not_applicable|
                                     out_of_scope|wont_fix|resolved|spam> [--bounty N --note …]
   bin/pihunt-triage sync        # writes the verdict's directive into gadget-graph.jsonl
   bin/pihunt-triage report      # scoreboard: accept rate, dup/OOS, bounty total
   ```
   Directives: **accepted** → sweep sibling verbs of that gadget class; **duplicate**
   → pivot to a different impact of the same capability; **informative/NA/wontfix**
   → downgrade the class's expected tier (stop spending CRITICAL-floor budget);
   **out_of_scope** → `sync --apply` flips the gadget to `scope_excluded`;
   **resolved** → re-arm, re-probe after the fix.

---

## 6. Maximize the harness (the strategy that pays)

- **Hunt the youngest-surface quartile, not the hardened core.** Rank every surface
  by ship-date; aim at the newest features (multi-tenant isolation bugs live there
  before they're hardened). The fleet disproves leads excellently — don't waste that
  on API v2's fail-closed core.
- **The gadget-graph keep-current loop** is the compounding advantage: confirmed
  gadgets GRANT capabilities, chains NEED them; `rank` names the one missing primitive
  that unblocks the most/highest-tier chains. A graph only pays off if it's kept current.
- **Chase forgotten-sibling-verb bugs** (`pihunt-authz gaps`): a resource whose
  boundary is proven on one verb but whose sibling verbs are UNTESTED is the highest-ROI
  cell. (This is exactly where the Harness Runtime transfer BOLA came from.)
- **Let triage feedback recalibrate you** (§5): over a few programs, the submissions
  scoreboard tells you which gadget classes convert vs get dup'd/OOS — spend accordingly.

---

## 7. Deep dives & reference

- **[pi-hunt-tooling-cheatsheet.md](pi-hunt-tooling-cheatsheet.md)** — full `pi-tier`
  / `pihunt-gadgets` / `pihunt-authz` command reference, watcher internals, the gadget
  graph node shapes and re-arm triggers.
- **[pi_hunt_cheat_sheet.md](pi_hunt_cheat_sheet.md)** — prompting & steering grammar
  (ensemble/swarm phrasing, disconfirm, per-phase nudges).
- **[../provider-routing-comparison.md](../provider-routing-comparison.md)** — provider
  cost/routing comparison and the 8-hour-hunt budget math.

## 8. Gotchas

- **Edit-then-redeploy:** editing `bin/*` only takes effect after
  `cp -p bin/<tool> ~/.local/bin/`. Same for agents/extensions (live `~/.pi/agent/`
  vs repo `pi-agent/` mirror — edit live, sync to the mirror to version it).
- **Concurrency is launch-time:** a change to `pihunt-tuning.env` applies to the
  *next* launch, not a resuming session. Verify with `pi-tier concurrency status`
  (live vs file).
- **`reports/` is gitignored** — all hunt state (graph, triggers, authz, casefile,
  submissions, finding folders) lives only on disk. Regenerate reports with
  `pihunt-gadgets report && pihunt-authz report && pihunt-triage report`.
