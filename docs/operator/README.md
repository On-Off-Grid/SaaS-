# pi-hunt — Operator Docs

Start here: **[OPERATOR-GUIDE.md](OPERATOR-GUIDE.md)** — the single routine for
running the harness (configure → launch → drive → triage/submit/feedback) and how
to get the most out of it.

Depth / reference:
- **[OPERATOR-GUIDE.md](OPERATOR-GUIDE.md)** — the before/during/after routine + strategy.
- **[pi-hunt-tooling-cheatsheet.md](pi-hunt-tooling-cheatsheet.md)** — full `pi-tier` /
  `pihunt-gadgets` / `pihunt-authz` / `pihunt-triage` command reference, watcher
  internals, gadget-graph node shapes, re-arm triggers.
- **[pi_hunt_cheat_sheet.md](pi_hunt_cheat_sheet.md)** — prompting & steering grammar.
- **[../provider-routing-comparison.md](../provider-routing-comparison.md)** — provider
  cost/routing comparison.

Quick start:
```bash
pi-hunt
> Hunt <program> in <HackerOne|Intigriti> for <CRITICAL|HIGH|CRITICAL/EXCEPTIONAL>
```
Everything writes to `reports/<program>/…`; pi-hunt never submits to a platform.
