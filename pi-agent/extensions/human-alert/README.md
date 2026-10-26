# human-alert

Rings the operator's desk only for **blocking live-browser actions**.

## What fires

1. A `browser_live_*` tool result containing a high-confidence CAPTCHA /
   Cloudflare / OTP / manual-browser-handoff signal.
2. An assistant `NEED_HUMAN: <reason>` marker while a `browser_live_*` tool was
   used in that turn or within the browser-context window. A reason that names
   a high-confidence browser wall also fires, so a coordinator can surface a
   subagent's browser blocker.

Everything else is silent. In particular, `read`/`bash` output mentioning
`2FA`, rate limits, quotas, access denied, payments, or bans does not ring.

Non-browser operator blockers use the coordinator's `[[HUNT_BLOCKED: ...]]`
marker instead; it stops the hunt without sounding the alarm.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PIHUNT_ALERT` | `1` | `0` disables all alerts |
| `PIHUNT_ALERT_COOLDOWN_MS` | `60000` | Cross-process per-issue cooldown |
| `PIHUNT_ALERT_BROWSER_CONTEXT_MS` | `120000` | How long a browser result makes `NEED_HUMAN` actionable |
| `PIHUNT_ALERT_DRY_RUN` | unset | `1` logs instead of spawning notify/audio |
| `PIHUNT_ALERT_STATE_DIR` | `$TMPDIR/pi-human-alert` | Shared lock directory |
| `PIHUNT_ALERT_VOICE` | built-in | Spoken line via `spd-say` |

## Test

```bash
node --experimental-strip-types pi-agent/extensions/human-alert/selftest.mjs
node --experimental-strip-types --check pi-agent/extensions/human-alert/index.ts
```

The live copy lives at `~/.pi/agent/extensions/human-alert/`. Deploy only this
extension directory; do not run `install.sh` just to update it. If you back up
the old extension, move the backup **outside** `~/.pi/agent/extensions/` — pi
loads every subdirectory there, so a `human-alert.bak-*` copy would keep the
old behavior alive.
