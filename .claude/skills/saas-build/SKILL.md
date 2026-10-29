---
name: saas-build
description: >-
  Build software/SaaS features in this workspace with a consistent
  plan→implement→review→test→ship flow. Use for product development work (not the
  bug-bounty harness itself — use harness-dev for that). A thin router over the
  skills already installed, not duplicated logic.
allowed-tools: >-
  Read, Edit, Write, Grep, Glob, Bash,
  mcp__github__*
---

# saas-build — product development profile

A lightweight profile that sequences the capabilities already available in this
session rather than reinventing them. Follow the stage that fits the request.

1. **Plan.** For any multi-step feature, use `claude-mem:make-plan` to produce a
   phased plan with documentation discovery. Track work with `work_state_write`
   (the canonical to-do list), not an ad-hoc list.
2. **Implement.** Execute with `claude-mem:do` (phased, subagent-driven) for larger
   plans, or edit directly for small changes. Match surrounding code style; reuse
   existing utilities before adding new ones.
3. **Review.** Run `/code-review` on the diff before considering it done; apply
   `/simplify` for reuse/altitude cleanups. Use `mcp__github__*` (read-only) to
   check how upstream libraries are used.
4. **Test.** Follow `engineering:testing-strategy`; add/adjust tests with the
   project's existing framework and run them — report real results, including
   failures.
5. **Ship.** Walk `engineering:deploy-checklist` before any deploy or release.

## Conventions
- Confirm outward-facing or hard-to-reverse actions (deploys, deletes, external
  calls) before doing them.
- Keep secrets out of committed files; use env-var expansion.
- Prefer the dedicated file/search tools over shelling out.

> This skill intentionally stays a routing layer. If a project under this workspace
> grows its own build/test/deploy specifics, capture them in a directory-scoped
> skill (`<subdir>/.claude/skills/...`) or `.claude/rules/` with a `paths:` list.
