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

## Account-aware tab tracking — do1 / do2 double-profiling

Two-account authz testing needs **two logged-in accounts in the same Brave window**,
with cookies that never bleed into each other, and the cockpit must always know which
account owns the tab it is about to act on. The harness models this as two CDP
**browser contexts** inside the one browser-live window:

| Account | Team | Context | Lifetime |
|---|---|---|---|
| **do1** | `afa0ac` | the **default** context — the existing persistent per-program profile | survives across sessions |
| **do2** | `d9c570` | an **ephemeral incognito** context created in the same window | own cookie jar; wiped on close; re-auth each session |

The two contexts have **true cookie isolation** (separate jars), so do1 and do2 can be
logged into the same site at once without one clobbering the other.

The account↔context map is the only state this adds, a per-program registry:
`reports/<program>/live-intel/browser-accounts.json` — `browserContextId → {account, team}`.
The default context is recorded as do1 the first time it is seen; `open-account`
records the incognito context as do2.

```bash
hunt-browser tabs                    # every open tab labeled do1 / do2 / UNKNOWN + url
hunt-browser open-account do2 [url]  # create the incognito do2 context + a tab, register it
hunt-browser whose-tab <targetId>    # print "do1 afa0ac <url>" / "do2 d9c570 <url>", else UNKNOWN
```

**How a tab is resolved to an account** (the detection keys on the CDP
`browserContextId`, which the HTTP `/json` endpoint does NOT carry — only a
`Target.getTargets` call over the CDP WebSocket returns it; the small
`mcp-servers/browser-live/browser-live-targets.mjs` shim makes that call):

1. If the tab's `browserContextId` is in the registry → that account.
2. Else if it is the **default** context (never listed by `Target.getBrowserContexts`,
   which only returns created/incognito contexts) → **do1**.
3. Otherwise → **UNKNOWN**.

### Fail-closed rule (safety-critical)

Acting as the wrong account is a ROE violation. `whose-tab` therefore **never guesses**:
when a tab's account can't be confidently determined (an unregistered incognito
context, or a target that no longer exists) it prints `UNKNOWN` and **exits non-zero**
(`4` for an unresolved context, `2` for a missing/absent targetId). The cockpit must
treat a non-zero `whose-tab` as "do not act" — register the context first
(`open-account do2`), then re-check.

### Typical flow

```bash
hunt-browser open-account do2 https://target.example/login   # spawns + registers do2
# → switch to the new tab in the on-screen Brave window and log in as do2
hunt-browser tabs                                            # confirm do1 + do2 are labeled
hunt-browser whose-tab <targetId>                            # gate before acting as an account
```

If `Target.createBrowserContext` ever isn't drivable on the deployed stack,
`open-account do2` prints a fallback: open a private window by hand
(Ctrl+Shift+N) in the browser-live Brave, then run `hunt-browser open-account do2
--detect` to auto-detect that first non-default context and register it as do2.
(Verified drivable against Brave 154 — the direct path is the default.)

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

### "Installation is not enabled" when adding the extension

That error means extensions are OFF in the window you're installing into. The agents'
**browser-live runs with `--disable-extensions`** (determinism for the hunters), so you
cannot install there — and while the agents hold a profile you can't open a second
window on it either. Options:

- **Install in a window that allows extensions:** your everyday Brave, or a dedicated
  operator profile (`hunt-browser open operator`). The Claude Code link works against
  any Brave the extension is connected to. (The "Google recommends using Chrome" line
  on the Web Store is a cosmetic nag — click "Add to Brave".)
- **Drive the agents' own logged-in browser:** set `BROWSER_LIVE_ALLOW_EXTENSIONS=1`
  (in `mcp-config/mcp.json`'s browser-live env, or the launch shell) and restart `pi`.
  browser-live then keeps extensions enabled, so you install Browser MCP directly in
  its visible window and `mcp__browsermcp` drives the browser the hunters use. Off by
  default.

## Switching the browser binary

`BROWSER_LIVE_CHROME_BIN` (set in `mcp-config/mcp.json`, default `/usr/bin/brave-browser`)
pins the browser-live binary. If unset, the launcher auto-detects the first installed
of Brave → Chrome → Chromium. `hunt-browser` honours the same variable.
