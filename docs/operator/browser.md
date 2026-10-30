# Browser: per-program profiles + the Claude Code link

Two separate browser paths serve the hunt. Keep them straight:

| Path | Who drives it | What it is |
|---|---|---|
| **browser-live** | the **pi** agents | a Brave instance the hunters automate (CDP over a local debug port) |
| **Browser MCP / claude-in-chrome** | **you**, from Claude Code | the operator cockpit driving your own Brave via a browser extension |

Both now use **Brave** (Chromium-based; takes the Browser MCP extension). Chromium/Chrome still work via `BROWSER_LIVE_CHROME_BIN`.

## Per-program profiles (browser-live)

Each engagement gets its **own persistent Brave profile** (`--user-data-dir`), so a
long-term program's logins/cookies/credentials survive across sessions and never
bleed between programs.

- Layout: `<workspace>/.browser-live/profiles/<profile>/chrome-profile`
- Profile selection (first match wins):
  1. `BROWSER_LIVE_PROFILE=<name>` — an explicit named profile
  2. `$PIHUNT_PROGRAM` — the active engagement
  3. the `program` field of `config/engagement.{local.}toml`
  4. `default`
- Each profile gets its own debug port (9300–9399, hashed from workspace+profile), so
  two programs' browsers can run side by side without colliding.

The profile is **non-headless**, so when the agents are driving it you can watch and
take over the on-screen window directly (e.g. to finish a consent/connect flow).

## Intervening by hand — `hunt-browser`

Work a program's stored profile yourself (set up or inspect an account's login so the
agents inherit that state next session):

```bash
hunt-browser list                 # all profiles: size, last used, and whether agents are attached
hunt-browser path [program]       # print a profile's user-data-dir
hunt-browser open [program] [url] # open that profile in Brave for you to drive
```

A Chrome user-data-dir can be held by **one** process at a time. If the agents'
browser-live Brave is live on a profile, `open` refuses (exit 3) — interact with the
on-screen window, or stop the agents' browser first.

## Linking Claude Code to your Brave (Browser MCP)

The `mcp__browsermcp__*` server is already available in Claude Code. To connect it to
your Brave (one-time, manual — a browser extension can't be installed by the agent):

1. Install the **Browser MCP** extension in Brave (Chrome Web Store — Brave supports it).
2. Pin it, open the tab you want to drive, click the extension, and **Connect**.
3. From Claude Code, `mcp__browsermcp__browser` now drives that Brave tab — use
   `snapshot -i` / `find "<text>"` to look, and act in batches (see the server's own
   usage note). Re-snapshot after navigating.

`claude-in-chrome` is the alternative Claude Code → browser path (its own extension +
site permissions); use whichever you have connected.

## Switching the browser binary

`BROWSER_LIVE_CHROME_BIN` (set in `mcp-config/mcp.json`, default `/usr/bin/brave-browser`)
pins the browser-live binary. If unset, the launcher auto-detects the first installed
of Brave → Chrome → Chromium. `hunt-browser` honours the same variable.
