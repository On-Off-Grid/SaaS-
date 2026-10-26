# pi-hunt → SaaS: decision-ready plan (working name "Signal")

**Prepared:** 2026-10-26. **Author role:** pragmatic SaaS CTO / security-product strategist / unit-economics analyst.
**Status:** planning only. Nothing here authorizes implementation, provisioning, credential use, or scanning.

**Evidence legend** — every claim is tagged:
`[REPO]` verified in this repository (path cited) · `[EXT …, 2026-10-26]` verified against an external primary source (URL + access date) · `[REC]` my recommendation/judgement · `[ASSUMPTION]` needs validation · `[UNVERIFIED]` could not be confirmed from a primary source.

Illustrative numbers are labelled. No market-size, customer-count, or demand figure is asserted — none could be verified, so none is invented.

---

## 1. Executive decision: NARROW, and validate before building

**Verdict: narrow the concept and prove demand with a small paid pilot before building the control plane. Do not proceed straight to a full SaaS build.**

Why:
- **The headline the current plan leans toward — "continuous change monitoring" — is commoditized.** A free MIT dataset refreshes program scope sub-hourly (`bounty-targets-data`), a free CLI aggregates authenticated scopes (`bbscope`), a free/freemium product already pushes multi-platform scope-change alerts (`bbradar.io`), an $8/mo tool diffs program pages including private ones (`PageCrawl`), and HackerOne/Bugcrowd/Intigriti ship native change notifications for free. [EXT, github.com/arkadiyt/bounty-targets-data; github.com/sw33tLie/bbscope; github.com/bbradar-io; pagecrawl.io; bugcrowd.com/blog/feature-update-program-updates; hackerone.com/blog/introducing-policy-change-notifications, 2026-10-26]
- **There is a genuine but narrow seam:** nobody combines (a) privacy-first collection that never sends target traffic from a vendor cloud, (b) bug-bounty-program-scope awareness, and (c) CVE-*applicability candidates* surfaced for manual validation. The tools that do CVE work (ProjectDiscovery/Nuclei, Detectify, Shodan) are not program-scope-aware and operate as cloud scanners. [EXT, docs.projectdiscovery.io; 2026-10-26]
- **But the moat is thin.** The CVE corpus (Nuclei templates, NVD/OSV/GHSA) is open; the differentiation reduces to privacy posture + scope-awareness + provenance/UX. Each is imitable. Bugcrowd is already shipping "Savant Vista," an attack-surface-plus-offensive feature in public beta. [EXT, bugcrowd.com/blog/introducing-savant-vista, 2026-10-26]
- **The economics are not the risk; demand is.** The control-plane cost floor is roughly $7–15/mo plus usage [EXT, render.com/pricing; neon.com/pricing; developers.cloudflare.com/r2/pricing, 2026-10-26], and the correct design needs no platform-funded AI at all. The only hard question is whether price-sensitive solo researchers will pay a subscription when free substitutes exist. That must be tested, not assumed.

**So:** keep the BYO-runner, monitoring-only, solo-first direction (all sound), but (1) re-point the headline from "change monitoring" to "a privacy-first research-prioritization inbox," (2) make CVE-applicability the core value, (3) run the smallest paid pilot (Section 13) as a go/no-go gate before building.

---

## 2. Repository reality check

**What exists and is reusable, what must be adapted, what must be removed, what is missing.**

| Component | Status | Detail (cited) |
|---|---|---|
| Scope loaders (H1/Intigriti/YesWeHack) | **Reuse** | `pi-agent/agents/{h1,intigriti,yeswehack}-scope-loader.md`; API-first, with a prompt-level "handle lock". [REPO] Must be re-implemented as deterministic code (Section 8). |
| Passive recon stages | **Reuse (subset)** | Clean passive set in `recon/recon-engine.sh`: subfinder, assetfinder, findomain, crt.sh, amass-passive, github-subdomains, asnmap, smap (Shodan-backed, "zero target traffic"), gau, waybackurls, gungnir (CT-log stream), anew. [REPO recon-engine.sh:127-230,302-303; ct-monitor.sh:39] |
| Diff/promotion logic | **Reuse** | `anew` + `NEW_*` artifacts already compute "new since last run". [REPO recon-engine.sh:421] |
| Structured-recon output schema | **Adapt** | `reports/<program>/structured-recon/*` incl. `tech-stack.md`. [REPO recon-engine.sh:427-453] Becomes per-tenant server-side records, not flat local files. |
| Tech fingerprinting | **Adapt** | Comes from `httpx -td` (Wappalyzer-style), which is **active HTTP** and yields product reliably, version only sometimes. [REPO recon-engine.sh:237-256] For a strictly-passive MVP, prefer passive fingerprint sources; treat version as partial. |
| 26-agent coordinator + LLM fleet | **Remove from MVP** | The multi-agent hunt is the *execution* product, deferred. Monitoring needs deterministic jobs, not an agent swarm. [REPO pi-coordinator-adapter.md] |
| Active/offensive stages | **Remove / must never run** | DNS brute (stage 2), port scan masscan/nmap/naabu (stage 4), screenshots (5b), katana crawl (6), arjun (7), content brute (8), JS fetch/secret mining (9), and **all of `pihunt-vulnscan`** (nuclei/jaeles/nikto/wpscan). [REPO recon-engine.sh:167-409; vulnscan.sh:62-114] |
| `httpx` + `jsleak` in `--fast` | **Gate off** | Even the light timer profile still HTTP-probes and fetches JS. [REPO recon-engine.sh:237,384] A strictly-passive MVP must disable these two. |
| Offensive `pi` packages | **Remove** | `pi-recon-tools` (port scan), `@artale/pi-pentest` (nmap+vuln), `pi-redteam` (pentest agents), Burp MCP jar, headless-Chromium MCP. [REPO install.sh:60,84-100; README.md:254-260] None belong in monitoring. |
| Multi-tenancy, accounts, web/API, billing | **Missing — must build** | All state today is per-user `$HOME` dotfiles + a shared `reports/` tree + one `memory.jsonl`; no tenant concept anywhere. [REPO install.sh; docs/operator] |
| CVE-applicability engine | **Missing — core new build** | No fingerprint→CVE join exists today; `searchsploit` string lookup is the only adjacent piece. [REPO vulnscan.sh:121] |

**Caveat:** no external tool's license is asserted anywhere in the repo; the ProjectDiscovery/tomnomnom tools are widely MIT but must be verified upstream before redistribution. [REPO extras.sh:38-99] `[ASSUMPTION]`

---

## 3. Primary customer, subscription value, and positioning

### Primary customer (one profile)
**The repeat solo researcher who actively works 3–15 mature, frequently-updated programs** (the Yahoo/DigitalOcean tier) and whose edge is being early and well-prioritized. They already use free scope feeds and their own scripts, value privacy, and resent babysitting tooling.

**Explicitly excluded (MVP):** beginners (won't pay, need education not intelligence), small teams/agencies (collaboration deferred), program owners/enterprises (different product, sales motion, and authorization story), and "automation maximalists" who want an autonomous exploiter (out of scope and out of safety bounds).

### Value proposition (one sentence)
*A privacy-first inbox that tells a researcher which of their authorized programs just became worth looking at — and why — with the evidence to validate it themselves.*

### Why pay instead of using free tools
Free tools answer "what changed." None answers "what changed **and which recently-disclosed or known-exploited CVE plausibly now applies to that asset**, ranked, deduplicated, with provenance, without a vendor cloud touching my targets." The paid job is **prioritization + applicability + trust**, not change-detection. `[REC]`

### First-session value (no waiting for a change)
Connect one program → receive a baseline passive snapshot, plus any **currently** KEV-listed or high-EPSS CVEs that match the current fingerprints, plus the recent change history replayed from public scope history. Value in minutes, not after the first future change. `[REC]`

### Three subscription-worthy workflows (with example outputs)

**A. New scope → applicability sweep.** Program adds `*.api-v3.example.com`; the runner passively discovers hosts, fingerprints from passive sources, and the engine cross-matches KEV/EPSS/NVD.
> **Inbox card:** `example.com` · new wildcard `*.api-v3.example.com` (3 live hosts) · `api-v3.example.com` fingerprints **nginx / a PHP framework** · **candidate: CVE-20XX-NNNNN (KEV-listed, EPSS 0.86)** applies to that framework's detected major version · evidence: passive banner + CT cert + first-seen timestamp · *validate manually; in scope per policy loaded 2h ago.*

**B. Tech-stack drift → fresh-CVE window.** An already-tracked asset's server/framework fingerprint shifts, or a new CVE drops for a stack you already monitor.
> **Inbox card:** `portal.example.com` · framework version string changed last night · a CVE published 2 days ago matches the new range · EPSS rising · evidence diff attached.

**C. Cross-program morning digest.** One deduplicated daily list across all enrolled programs, ranked: KEV-listed applicability > high-EPSS > recent scope change > asset drift.
> **Digest:** 4 programs quiet · 2 items worth your time today, top = workflow A above.

### MVP essentials vs retention vs distractions
- **MVP essentials:** verified program enrollment; passive snapshot + diff; deterministic applicability (CPE/OSV match gated by KEV/EPSS/CVSS) with provenance; prioritized inbox; one alert channel (email or Telegram); one-command runner.
- **Retention features:** cross-program digest, noise/mute controls, per-asset history timeline, applicability-precision improvements, "why am I seeing this" provenance view.
- **Distractions (resist):** active scanning, exploitation, auto-submission, team features, hosted execution, a chat/agent UI, "more alerts/agents/tokens," and marketing AI as the headline.

### Customer-validation plan
- **Interviews (10–15 target-profile researchers), questions:** How many programs do you actively watch? How do you learn a program changed today, and how late are you? Walk me through the last time a program update led to a bug. What do you pay for tooling now? Would you run a local collector to keep a vendor off your targets? What would make this untrustworthy?
- **Paid pilot test:** see Section 13 — a founding cohort pays a token monthly fee.
- **Measurable go/no-go `[ASSUMPTION — founder sets thresholds]`:** e.g. ≥ 10 of 25 invited researchers pay and onboard; ≥ 60% complete a first-session "useful" action; ≥ 40% say they would keep paying at $15/mo. Miss → pivot or stop.

### Positioning & category
Occupy **"research-prioritization intelligence for authorized programs"** — not "change monitor" (commoditized) and not "AI scanner" (crowded, low-trust). Avoid sounding like a generic AI scanner by making the headline *privacy + applicability + provenance*, with AI invisible. Durability is a trust/UX story, not a technical moat — acknowledge and compete on execution and niche focus. `[REC]`

---

## 4. Multi-user architecture and orchestration

### Entities and trust boundaries
- **Tenant** = billing + isolation unit. For solo, Tenant = Account = one User.
- **Runner** = a paired executor on the customer's infra, holding a revocable token. A tenant may pair several.
- **Program** = an authorized program the tenant enrolled, with stored **enrollment proof** (their own platform token resolved it).
- **Run** = one scheduled collection of one program on one runner.
- **Observation** = a normalized fact from a run (asset added/removed, fingerprint changed).
- **Notification** = a deduplicated, prioritized item derived from observations ⋈ applicability.

**Hard boundary — shared public intelligence ≠ shared private recon.** Public vuln feeds and public CVE processing run **once globally**. Scope loading (under a tenant's own credentials), recon snapshots, observations, and notifications are **strictly per-tenant** and never reused for another researcher, even when two tenants monitor the same program. One researcher's authorization and observations are not transferable. `[REC]`

```
                 ┌────────────────────── CONTROL PLANE (cloud) ──────────────────────┐
  Public feeds → │  GLOBAL (once): NVD/OSV/GHSA/KEV/EPSS ingest · CPE/CVE normalize    │
  (no tenant     │  PER-TENANT: accounts · enrollment proof · scheduler+leases ·       │
   data)         │   snapshot store · diff engine · applicability join · inbox · billing│
                 └───────▲───────────────────────────────────────────────┬────────────┘
             lease/pull  │ heartbeat · idempotent result upload           │ alerts/UI
                 ┌───────┴───────┐                               (email/Telegram, web)
                 │   RUNNER(s)   │  ← customer infra, customer identity/creds, PASSIVE collection
                 └───────┬───────┘
                         │  passive sources only (CT, passive DNS, Wayback, Shodan API)
                 (no vendor-cloud traffic to targets; runner acts as the authorized party)
```

### Scheduling: cloud owns it; runner pulls leases (one model)
The **control plane schedules** (knows due work, quotas, fairness); the **runner leases** a job, runs it locally, uploads idempotently. This centralizes quotas/fairness/dedup and keeps the runner a dumb executor. `[REC]`

- **Multiple runners / no duplicate runs:** a job is claimed by exactly one runner via a **lease** (claim + TTL + heartbeat). One in-flight lease per (program, interval) → no double runs.
- **Heartbeat/lease/retry/cancel:** runner heartbeats every N s to renew; missed heartbeats expire the lease and re-queue. Failures retry with capped backoff. Cancellation is a job-state flag the runner honors on next heartbeat.
- **Offline + replay:** a runner may finish an in-flight run offline, buffer results, and upload later; uploads carry an **idempotency key** (run-id + content hash) so replays never double-count.
- **Fair queueing / noisy neighbor:** per-tenant concurrency cap + per-tenant rate quota; the global scheduler round-robins across tenants so one tenant can't starve the queue; backpressure lengthens intervals when runners saturate.

### Run & runner lifecycle
- **Run:** `queued → leased → running → (uploaded|failed→retry|expired→requeued|cancelled) → diffed → observations → notifications`.
- **Runner:** `registered → paired → active (heartbeating) → stale (missed heartbeats) → revoked`.

### What stays local vs cloud-managed
- **Local (runner):** raw recon responses, research notes, platform credentials/tokens (never uploaded), the actual collection.
- **Cloud:** normalized observations, diffs, applicability candidates, inbox, scheduling, billing, global vuln intel. Raw responses stay local by default; only normalized facts + minimal evidence pointers go up. `[REC]`

### Aggregate-load honesty (what the platform cannot guarantee)
Each runner is individually scoped and rate-limited, but N independent researchers monitoring the same program run on their own infra under their own identities — **the platform cannot see or control the aggregate load they collectively place on a shared target.** The only real mitigation is design: **default to passive collection that sends no target traffic at all**, so aggregate target load is near-zero by construction. State this plainly; do not claim BYO-runner eliminates it. `[REC]`

### Credential revocation and control-plane outage
- **Revocation:** revoking a runner token makes the cloud reject its leases/uploads immediately, but a *disconnected* runner holding cached scope could still run locally until it reconnects. Mitigate with short lease TTLs, a scope-freshness TTL (runner won't act on stale scope), and revocation re-checked on every heartbeat. Not instantaneous for an offline runner — say so. `[REC]`
- **Outage:** runners keep running cached schedules up to a TTL, buffer, and replay idempotently on reconnect; no increase in target traffic; UI/alerts degrade gracefully; no data loss.

---

## 5. SaaS operations and subscription lifecycle

**Account lifecycle:** signup → email verify → pair first runner → enroll first program (proof) → first-session value → trial → paid → (dunning on failure) → cancel/downgrade → export → delete.

**Auth & recovery `[REC]`:** email + password with TOTP 2FA, or magic-link; recovery via email + one-time backup codes. **Buy, don't build:** Clerk free tier (50k retained users) or Supabase Auth (bundled, GoTrue is Apache-2.0 self-hostable). [EXT, clerk.com; supabase.com/pricing, 2026-10-26]

**Entitlements ↔ quotas:** subscription tier sets `max_programs`, `max_runners`, snapshot retention, and alert channels. Entitlement checks live in the control plane, outside any model's discretion.

**Payment failure / downgrade / cancel / trial expiry:** Stripe dunning retries up to 3 days; on final failure → downgrade to read-only, then suspend collection (keep data for a grace window), then delete per retention policy. Trial expiry → read-only + prompt. [EXT, stripe.com/docs, 2026-10-26]

**Billing webhooks:** return 2xx immediately, process async on the Postgres queue; **dedupe on `event.id`** (and on `data.object` id + `event.type` for duplicate distinct events); never rely on event order or timestamps. Verify `Stripe-Signature` on the raw body. [EXT, docs.stripe.com/webhooks, 2026-10-26]

**Retention/deletion:** define snapshot retention per tier; deletion must propagate across Postgres, R2 artifacts, email logs, and the error tracker's captured payloads. `[REC]`

**Support diagnostics without exposing private data:** a redacted admin view — runner health, job states, counts, error classes — with **no raw recon, no scope contents, no credentials**. Private-program data is effectively third-party confidential; keep it out of support tooling. `[REC]`

**Abuse / compromised runner / incident / backup:** revoke token + quarantine that runner's uploads; per-tenant storage/ingest caps stop a runaway uploader; Postgres point-in-time recovery (Neon) + R2 object versioning for restore; a written incident/breach plan given the credential sensitivity. [EXT, neon.com/pricing, 2026-10-26]

**Observability (must-watch):** runner health/heartbeats, stale scope, missed/overdue runs, vuln-feed ingestion failures, notification delivery, and cost. Sentry free tier covers errors; add a log tier only if needed. [EXT, sentry.io/pricing, 2026-10-26]

**Runner releases:** signed binaries, version pinning, auto-update with rollback, and a supported-versions window. `[REC]`

**Minimal operational stack — do NOT self-build:** auth, payments, email, error tracking, Postgres, object storage. **DO build:** scheduler/lease logic, diff engine, applicability join, runner. **Do not buy a managed queue** — use a Postgres-backed worker (`pg-boss`/Graphile Worker) on the box you already pay for. [EXT, developers.cloudflare.com/r2; resend.com/pricing, 2026-10-26] `[REC]`

**Founder/location dependencies — requires professional advice, not legal certainty:** entity choice + where incorporated; VAT/sales-tax nexus and registration (Stripe Tax calculates/collects once you're registered but does not decide where you must register or file); GDPR controller/processor stance and DPAs with every subprocessor (Stripe, Neon, R2, email, Sentry); DSAR/deletion workflow; and the heightened bar from holding researchers' platform tokens and private-program data, which may conflict with platform ToS/NDAs. Engage an accountant + lawyer before taking payment or storing sensitive data. [EXT, stripe.com/tax/pricing, 2026-10-26] `[ASSUMPTION]`

---

## 6. Collector/tool inventory and cost evidence

### The smallest useful collector set (passive-only MVP)
From the repo's engine, the clean **zero-target-traffic** set: subfinder, assetfinder, findomain, crt.sh, amass (passive), github-subdomains, asnmap, smap (Shodan-backed), gau, waybackurls, gungnir (CT-log stream), anew. [REPO recon-engine.sh:127-230,302-303; ct-monitor.sh:39]

**Audit flag:** reusing `recon-engine.sh --fast` wholesale would **still** run `httpx` (active HTTP probing) and `jsleak`/curl JS fetching — both send traffic to targets and must be explicitly disabled for a strictly-passive MVP. All of `pihunt-vulnscan` (nuclei/jaeles/nikto/wpscan) is active vuln scanning and must never be invoked. [REPO recon-engine.sh:237,384; vulnscan.sh:62-114] `[REC]`

**Decision point — fingerprint quality vs passivity:** passive sources give weaker version precision than `httpx -td`. [REPO recon-engine.sh:237] Recommend passive-first with explicit "version uncertain" handling; offer *light* active HTTP fingerprinting only as an opt-in, researcher-acknowledged, rate-limited runner setting post-MVP. `[REC]`

### Five cost buckets
1. **OSS acquisition:** $0 binaries; licenses mostly MIT but **unverified in-repo** — verify upstream before redistribution. [REPO extras.sh] `[ASSUMPTION]`
2. **Paid intelligence/API:** vuln feeds are free/public-domain/CC-BY (Section 7B). Some passive sources need keys (asnmap→PD cloud, github-subdomains→GitHub token, smap→Shodan). **Customer-owned keys do not permit pooling or resale** — each runner uses the customer's own keys. `[REC]`
3. **Runner infra:** customer-paid (their box). $0 to the platform.
4. **Cloud control-plane:** ~$7–15/mo fixed floor + near-$0 usage at low scale (Section 8).
5. **Operational/support:** solo-founder time — the real scarce resource; keep the surface tiny.

---

## 7. Model strategy and AI budget

### Core principle
CVE correlation is a **data-join**, not a language problem. Keep authorization, scope enforcement, rate limiting, matching, and billing **deterministic and outside any model**. `[REC]`

### Task-to-model routing matrix

| Task | Model needed? | How |
|---|---|---|
| Scope/asset/CVE **enforcement, matching, ranking, billing** | **No** | Deterministic code (CPE/semver ranges, KEV/EPSS/CVSS gates). Must be auditable. |
| Vuln-feed ingest/join/dedup | **No** | Deterministic ETL. |
| Diff / change detection | **No** | Set diff over normalized snapshots (`anew`-style). [REPO recon-engine.sh:421] |
| Parse messy scope policy HTML → fields | **Optional, cheap** | Haiku-class / Flash-Lite / nano, BYO-key. |
| Normalize noisy banners → canonical product+version | **Optional, cheap** | Same tier; feeds the deterministic matcher. |
| Judge CVE *applicability* nuance (reachability/config) | **Optional, advisory only** | Cheap tier, over a deterministic candidate set as ground truth. |
| Write human-readable alert explanation | **Optional, low-risk** | Cheap tier. |

### Three approaches
- **A — deterministic core, no required LLM.** Cheapest, auditable, zero data egress. **Recommended as the product.**
- **B — optional customer BYO-key reasoning.** Enrichment only; cost + data governance sit with the tenant under their own provider DPA. **Recommended default for the AI layer.**
- **C — platform-funded reasoning.** Only later, capped hard, cheap tier, first-party paid API with verified no-training + ZDR terms.

### Verified economics (per 1M tokens, cheap tiers) [EXT, 2026-10-26]
| Model | Input | Output | Source |
|---|---|---|---|
| Claude Haiku 5.5 (≤100K) | $0.10 | $0.50 | platform.claude.com/docs/en/about-claude/pricing |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | ai.google.dev/gemini-api/docs/pricing |
| OpenAI gpt-5-nano | $0.05 | $0.40 | developers.openai.com/api/docs/pricing |

**Terms that gate the choice:** Anthropic API does not train on customer content; OpenAI API does not train by default (30-day abuse logs; ZDR on approval); **paid** Gemini does not train, but **free-tier Gemini is used for training and human-reviewed — disqualified for production.** Consumer subscriptions and unofficial gateways are never a legitimate production basis. [EXT, anthropic.com/legal/commercial-terms; ai.google.dev/gemini-api/terms; developers.openai.com/api/docs/guides/your-data, 2026-10-26]

### Budget controls, eval, marketing stance
- **Hard controls:** default AI off; BYO-key; if ever platform-funded, per-tenant monthly cap + cheap tier only.
- **Measure cost per useful accepted result, not per token.** `[REC]`
- **Eval set:** a labelled corpus of (fingerprint → actually-applicable CVEs) to track **precision/recall and false-positive rate** (the cancellation driver). `[REC]`
- **Marketing:** AI is an implementation detail, not the headline. The deterministic applicability engine is the product.

### 7B. Vulnerability feeds [EXT, 2026-10-26]
| Feed | License / commercial use | Note |
|---|---|---|
| NVD CVE API 2.0 | Public-domain data; ToU needs a "not endorsed by NVD" notice | Rate ~5/30s (no key), ~50/30s (free key) — `[UNVERIFIED]` exact, confirm at nvd.nist.gov/developers |
| OSV.dev | Infra Apache-2.0; per-record license varies | Cleaner than CPE for OSS deps |
| GitHub Advisory DB | **CC-BY-4.0** — commercial OK **with attribution** | github.com/github/advisory-database |
| CISA KEV | **CC0** — unrestricted, no attribution | The strongest "take this seriously" signal |
| EPSS (FIRST) | **License `[UNVERIFIED]`** — no explicit grant found | Confirm with FIRST before shipping as a feature |

**CPE reality:** product+version→CVE matching is the messiest part — inconsistent vendor/product naming, missing/incomplete CPE data, error-prone version ranges. Expect a normalization/aliasing layer and both false positives and negatives. Build precision-first. `[REC]`

---

## 8. Pricing and unit economics (auditable model, illustrative inputs)

### Cost structure [EXT, 2026-10-26 unless noted]
- **Fixed monthly `F`:** hosting (Render Starter **$7/mo** or Fly ~$2–5) + domain (~$1). Neon free→Launch, R2 (10GB free, **zero egress**), Resend free (3,000/mo), Sentry free → ~**$0** marginal. **`F ≈ $10–15/mo` at launch.** [render.com/pricing; neon.com/pricing; developers.cloudflare.com/r2/pricing; resend.com/pricing; sentry.io/pricing]
- **Global shared `G`:** vuln-feed ingestion is one platform-wide job, not per tenant; ~$0 marginal at low scale, a bigger box at high scale.
- **Per-customer variable `V_c`:** artifact storage + DB rows + a few alert emails + (platform LLM = **$0** in the recommended design). **Illustrative `V_c ≈ $0.10–0.50/mo`.** `[ASSUMPTION]`
- **Stripe per paying customer at price `P`:** `fee = 0.029·P + 0.30` (cards) `+ 0.007·P` (Billing) `+ 0.005·P` (Tax) `= 0.041·P + 0.30`. [stripe.com/pricing; /billing/pricing; /tax/pricing]

### Formulas
```
Contribution margin / customer:  CM = P − (0.041·P + 0.30) − V_c = 0.959·P − 0.30 − V_c
Monthly profit (pre-founder-pay): Π(N) = N·P − F − G(N) − N·(fee + V_c)
```
At **P = $15/mo, V_c = $0.30:** `CM ≈ 0.959·15 − 0.30 − 0.30 ≈ $13.79`.

### At 10 / 100 / 1,000 paying customers (illustrative P=$15; acquisition NOT assumed)
| N | MRR | ≈ Monthly cost | ≈ Contribution (pre-pay) |
|---|---|---|---|
| 10 | $150 | ~$24 | ~$126 |
| 100 | $1,500 | ~$140 | ~$1,360 |
| 1,000 | $15,000 | ~$1,100–1,300 (bigger box + Neon/R2) | ~$13,700 |

**The decisive finding: cost is never the binding constraint — demand and retention are.** Margins are healthy at any scale *if* customers are acquired and retained. A solo founder needs on the order of ~1,000 retained payers for a real income, against free/$8 substitutes. `[REC]`

### Recommendations
- **Billing metric:** number of **monitored programs** (understandable, value-aligned, caps heavy users). Avoid billing on alerts, scans, tokens, or "agents" — the prompt's warning is correct; those don't equal value. `[REC]`
- **Must-cap (to prevent negative margin):** programs per plan, artifact storage/ingest per tenant (abuse), and any platform-funded LLM spend (or BYO-key only). `[REC]`
- **Offer:** a single simple plan (illustratively **$12–19/mo** for up to ~10 programs, annual discount), **no perpetual free tier** (everyone would stay free given substitutes) — use a **14-day trial** as the funnel and a **paid pilot** for validation. `[REC]`
- **What the customer really pays:** subscription + their own runner box + their own API/provider keys. Keep the subscription cheap because the researcher already absorbs infra. `[REC]`
- **Invalidating evidence:** if the paid pilot shows trial→paid conversion or 4-week retention below the founder's thresholds, the idea is invalidated at that price. `[ASSUMPTION]`
- **Profitability vs founder pay:** contribution margin is strong per customer; overall profitability and founder salary depend entirely on acquisition — keep them separate in any forecast.

---

## 9. Branding and launch experiment

### "Signal" assessment
Weak as a final brand: it collides with Signal Messenger and Signal Sciences (Fastly), is a common dictionary word, and is nearly unsearchable. Keep as internal working name only. `[REC]`

### Preliminary collision checks (web only, 2026-10-26 — NOT a domain or trademark clearance)
- "Bellwether" — multiple security/IT firms use it; generic early-indicator term. **Avoid.** [EXT, securitysystemsnews.com; techtarget.com, 2026-10-26]
- "Vantage" — Nozomi Networks Vantage (OT security SaaS). **Avoid.** [EXT, nozominetworks.com, 2026-10-26]
- "Scope*" names (ScopeDrift/Driftwatch had no direct hit, but ScopeDetective, ScopeBrief, bbscope, rix4uni/scope exist) — blends into a crowded bug-bounty tool-naming space. **Weak distinctiveness.** [EXT, github.com/NImaism/ScopeDetective; github.com/rix4uni/scope, 2026-10-26]

### Five naming directions
1. **Descriptive-category** (e.g. *ScopeDrift*, *DriftFeed*) — clear, but crowded `Scope*`/`*drift` space.
2. **Early-warning metaphor** (e.g. *Bellwether*, *Harbinger*) — evocative, but generic/colliding.
3. **Coined/brandable** (e.g. *Driftline*, *Nover*, *Keel*) — most searchable and ownable; needs meaning-building.
4. **Hunt-native** (e.g. *Quarry*, *Vantage*) — resonates, but collisions.
5. **Applicability-focused** (e.g. *Overlap*, *MatchWindow*) — on-message, mixed distinctiveness.

**Recommended direction: coined/brandable (3)** for searchability and ownability. Lead example **"Driftline"** — distinctive, no direct security collision found in a preliminary check. **Domain, trademark, and repo/package clearance are NOT verified and must be done before adopting any name.** `[REC]` `[ASSUMPTION]`

- **Tagline:** *Know the moment your targets change.*
- **Landing headline:** *Early, evidence-backed signal when your authorized programs change — you verify, you decide.*
- **Three benefit statements:** (1) See scope, asset, and tech-stack changes the day they happen, across every program you work, in one inbox. (2) Each change arrives with candidate CVE applicability and the evidence to check it yourself. (3) Your runner, your credentials, your calls — nothing we run ever touches your targets.
- **Avoid** any promise of guaranteed findings, bounty income, confirmed vulnerabilities, or autonomous hacking.

### Launch experiment
- **One focused channel:** the places repeat researchers already gather — a build-in-public thread on infosec X/Twitter plus one well-known bug-bounty community (Discord/newsletter). One channel, done well. `[REC]`
- **Paid-pilot acquisition:** direct, personal outreach to ~20–30 active repeat researchers offering a discounted founding-member paid pilot in exchange for weekly feedback.

---

## 10. Prioritized milestones, dependencies, tests, and commercial exit gates

| Phase | Build | Depends on | Test | **Commercial gate (go/no-go)** |
|---|---|---|---|---|
| **G0 — Pilot (pre-build)** | Landing page + manual concierge: hand-run passive collection + applicability for a founding cohort | Section 13 | Does the output change what a researcher does next? | **≥ target paid sign-ups + "would keep paying" ≥ threshold, else stop/pivot** `[ASSUMPTION]` |
| **M0 — Foundations** | Accounts, tenancy, runner pairing, Postgres schema, R2, Postgres-queue worker | G0 passed | Two tenants fully isolated; audit log attributes every action | Isolation + auth sound |
| **M1 — Enrollment + snapshot** | Deterministic scope loader; enrollment proof; first passive snapshot | M0; platform API tokens | Valid token → enrolled; invalid/non-enrolled handle → refused (handle-lock in code) | Enrollment reliable |
| **M2 — Change detection** | Scheduled passive collection; snapshot versioning; diff engine; inbox | M1 | Seeded delta appears exactly; nothing out-of-scope probed; passive-only verified (no target traffic) | Diffs accurate, low noise |
| **M3 — Applicability (core)** | Global NVD/OSV/GHSA/KEV/EPSS ingest; CPE/OSV match; KEV/EPSS ranking; provenance | M2; feed terms verified | Known-vulnerable fixture → candidate with provenance; patched → no match; **false-positive rate ≤ threshold** | **Precision gate: FP rate acceptable** `[ASSUMPTION]` |
| **M4 — Launch** | Trial/billing (Stripe + Tax + dunning), one alert channel, signed runner installer, ToS/privacy gate, legal review | M3; accountant/lawyer | Billing webhook idempotency; deletion propagation; dunning | **Trial→paid + 4-week retention ≥ thresholds** `[ASSUMPTION]` |

**Deferred (post-MVP):** multi-tenant agent *execution*, team accounts, program-owner tier, hosted runners, optional light-active fingerprinting, BYO-key AI enrichment.

---

## 11. Ten highest risks and mitigations

1. **No willingness-to-pay vs free substitutes.** → Validate with a paid pilot (G0) *before* building; price low; headline on applicability+privacy, not change-detection.
2. **Applicability false positives erode trust.** → Precision-first; gate on KEV/EPSS/CVSS; "candidate, validate yourself" framing; eval set + FP-rate exit gate.
3. **Thin, copyable moat** (bbradar, PDCP, Bugcrowd Savant Vista). → Compete on privacy + UX + trust + niche focus; ship fast; don't over-invest in defensibility claims.
4. **Legal/ToS: storing credentials / private scope.** → Never store platform credentials; scoped tokens only; keep raw recon + notes local; legal review of platform ToS/NDAs before launch.
5. **Aggregate target load across independent users (uncontrollable).** → Passive-only default (no target traffic); per-tenant rate caps; be transparent about the limit.
6. **Runner friction undercuts "convenience."** → One-command signed installer; strong defaults; privacy is the reason researchers accept a runner; hosted-runner option only later, with controls.
7. **Platform API/token fragility** (scope loaders silently degrade on dead tokens). [REPO docs/operator] → Health checks, stale-scope + enrollment-expiry alerts, fail loud.
8. **Feed/provider terms change** (EPSS license unverified; NVD limits; Gemini free-tier training). → Verify before shipping; cache; multi-source; paid first-party API only.
9. **Solo-founder operational burden / burnout.** → Buy not build (auth/payments/email/DB/storage); tiny surface; automation; ruthless scope discipline.
10. **Compliance (GDPR/VAT/credential sensitivity).** → Professional advice; Stripe Tax; DPAs with subprocessors; data-deletion workflow; incident plan.

---

## 12. Blocking founder decisions (≤8), each with a recommended default

Format: **Decision | Alternatives | Recommendation | Rationale | Evidence/assumptions | Revisit trigger**

1. **Proceed posture** | build-first vs validate-first | **Validate-first (paid pilot gate)** | Demand is the only real risk; cost is trivial | Free substitutes exist [EXT 2026-10-26]; demand `[ASSUMPTION]` | Pilot clears thresholds.
2. **Credential handling** | store platform creds vs tokens-only, kept local | **Tokens only, never stored; raw recon stays local** | Storing creds likely breaches platform ToS/NDA and raises breach risk | `[ASSUMPTION]` legal | Lawyer clears a specific storage model.
3. **Collection posture** | passive-only vs light-active (httpx) | **Passive-only for MVP** | Near-zero aggregate target load; strongest trust story | `httpx`/`jsleak` are active [REPO] | Researchers demand version precision passivity can't give.
4. **AI posture** | deterministic+BYO-key vs platform-funded | **Deterministic core; BYO-key optional; AI not the headline** | Correlation is a data-join; keeps cost/data with tenant | Free-tier Gemini trains [EXT 2026-10-26] | A funded cheap-tier add-on shows clear accepted-result ROI.
5. **Scheduling model** | cloud-scheduled-pull vs runner-scheduled | **Cloud-scheduled, runner-pull with leases** | Central quotas/fairness/dedup; dumb runner | `[REC]` | Scale needs edge autonomy.
6. **Billing metric & price** | per-program flat vs per-asset/usage | **Per monitored program; single ~$12–19 plan; no perpetual free tier** | Understandable, value-aligned, caps heavy users; free tier would cannibalize | Stripe fees [EXT 2026-10-26]; price `[ASSUMPTION]` | Pilot reveals a better metric/price.
7. **Positioning headline** | change-monitoring vs applicability+privacy | **Applicability + privacy** | Change-monitoring is commoditized | Competitor set [EXT 2026-10-26] | A defensible change-only angle emerges.
8. **Compliance timing** | DIY vs engage accountant+lawyer pre-payment | **Engage before first paid pilot (if storing sensitive data / EU customers)** | Credential + private-scope sensitivity, VAT/GDPR | [EXT stripe.com/tax 2026-10-26] `[ASSUMPTION]` | A no-sensitive-data concierge pilot defers it.

---

## 13. The smallest paid pilot (test demand without building the SaaS)

**A manual concierge pilot — no control plane, no runner, no code shipped to customers.**

1. Put up a one-page landing describing the applicability+privacy inbox (headline from Section 9) with a "founding member — $N/mo" button (Stripe Payment Link).
2. Recruit ~20–30 target-profile repeat researchers via one channel + direct outreach.
3. For each paying pilot member, **run the passive collection + deterministic applicability by hand** on *their own* enrolled programs (or have them run a passive script locally and share only normalized output — no credentials to you), and deliver the weekly inbox manually (email/Doc).
4. Measure over 3–4 weeks: did they pay; did they open/act on items; did any item change what they worked on; would they keep paying; what caused doubt.

**Go/no-go `[ASSUMPTION — founder sets exact numbers]`:** e.g. ≥ 10 paying, ≥ 50% acting on items weekly, ≥ 40% committing to continue at the real price. Clear it → build M0–M4. Miss it → pivot the wedge or stop. This tests the only thing that can't be de-risked by engineering: that solo researchers will pay for this prioritization when free tools exist — and it costs a landing page, a Stripe link, and the founder's time.
