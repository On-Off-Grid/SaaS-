/**
 * Human-Alert — pings the operator only when a live-browser run needs a human.
 * -------------------------------------------------------------------------
 * The hunt should not ring the desk for ordinary text that happens to mention
 * "2FA", "rate limit", or "access denied" in a file or shell result. This
 * extension therefore has two narrow triggers:
 *
 *   1. Explicit: assistant text containing `NEED_HUMAN: <reason>` while a
 *      `browser_live_*` tool was used recently (or the reason itself names a
 *      high-confidence browser wall).
 *   2. Heuristic: a `browser_live_*` tool result containing a CAPTCHA /
 *      Cloudflare challenge, an OTP/code-entry prompt, or an explicit manual
 *      browser handoff.
 *
 * Non-browser operator blockers (API quota, missing credentials, legal/scope
 * calls) should use `[[HUNT_BLOCKED: ...]]` in the coordinator prompt. That
 * stops the hunt without sounding the alarm.
 *
 * Safety / quiet:
 *   - PIHUNT_ALERT=0 disables everything.
 *   - Cross-process cooldown (PIHUNT_ALERT_COOLDOWN_MS, default 60000) so eight
 *     browser workers cannot ring the desk for the same CAPTCHA.
 *   - PIHUNT_ALERT_DRY_RUN=1 logs instead of spawning notify-send/paplay/spd-say.
 *   - Non-blocking: spawn() fire-and-forget; errors are swallowed.
 *
 * Tunables (env): PIHUNT_ALERT, PIHUNT_ALERT_COOLDOWN_MS,
 * PIHUNT_ALERT_BROWSER_CONTEXT_MS, PIHUNT_ALERT_DRY_RUN,
 * PIHUNT_ALERT_STATE_DIR, PIHUNT_ALERT_VOICE.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { claimAlert } from "./cooldown.ts";
import {
  detectBrowserWall,
  extractNeedHuman,
  isBrowserTool,
  shouldAlertNeedHuman,
  textOf,
} from "./classify.ts";

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const enabled = () => process.env.PIHUNT_ALERT !== "0";
const COOLDOWN_MS = envMs("PIHUNT_ALERT_COOLDOWN_MS", 60_000);
const BROWSER_CONTEXT_MS = envMs("PIHUNT_ALERT_BROWSER_CONTEXT_MS", 120_000);
const DRY_RUN = process.env.PIHUNT_ALERT_DRY_RUN === "1";
const VOICE = process.env.PIHUNT_ALERT_VOICE || "Human intervention needed, the bug bounty hunt is waiting on you.";
const SOUND = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga";

let lastBrowserAt = 0;

function run(cmd: string, args: string[]): void {
  try {
    const p = spawn(cmd, args, {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" },
    });
    p.on("error", () => {}); // never throw into the agent loop
    p.unref();
  } catch {
    /* swallowed — an alarm must never break the hunt */
  }
}

function alarm(reason: string, key = reason): void {
  const why = (reason || "human needed").trim().replace(/\s+/g, " ").slice(0, 140);
  if (!claimAlert(key, COOLDOWN_MS)) return; // same problem, still cooling down

  if (DRY_RUN) {
    console.error(`[human-alert] dry-run: ${why}`);
    return;
  }

  run("notify-send", [
    "-u", "critical",
    "-t", "0",
    "--expire-time", "0",
    "pi-hunt: HUMAN NEEDED",
    why,
  ]);
  for (let i = 0; i < 3; i++) run("paplay", [SOUND]);
  run("spd-say", [VOICE]);
  console.error(`[human-alert] ${why}`);
}

export default function humanAlert(pi: ExtensionAPI) {
  // 1) Explicit marker in assistant text, but only in a browser context.
  pi.on("turn_end", async (event: any) => {
    try {
      if (!enabled()) return;
      const reason = extractNeedHuman(textOf(event?.message?.content));
      if (!reason) return;

      const toolResults = Array.isArray(event?.toolResults) ? event.toolResults : [];
      const browserInTurn = toolResults.some((r: any) => isBrowserTool(r?.toolName));
      if (browserInTurn) lastBrowserAt = Date.now();

      if (!shouldAlertNeedHuman(reason, browserInTurn, lastBrowserAt, Date.now(), BROWSER_CONTEXT_MS)) return;
      alarm(reason || "human needed in live browser", `need-human:${reason.toLowerCase()}`);
    } catch {
      /* never break the loop */
    }
  });

  // 2) Heuristic: browser-only bot/auth walls.
  pi.on("tool_result", async (event: any) => {
    try {
      if (!enabled()) return;
      const tool = event?.toolName || "tool";
      if (!isBrowserTool(tool)) return;

      lastBrowserAt = Date.now();
      const wall = detectBrowserWall(textOf(event?.content));
      if (!wall) return;
      alarm(`${tool} hit a wall: ${wall}`, `browser-wall:${wall.toLowerCase()}`);
    } catch {
      /* never break the loop */
    }
  });
}
