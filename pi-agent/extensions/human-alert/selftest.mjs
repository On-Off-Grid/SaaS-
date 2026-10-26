/**
 * Offline fixture tests for the human-alert extension.
 *
 *   node --experimental-strip-types pi-agent/extensions/human-alert/selftest.mjs
 *
 * No model calls, no notifications, no spawned processes.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const chk = (label, cond) => {
  if (!cond) {
    fail++;
    console.log("  FAIL " + label);
  } else {
    console.log("  ok   " + label);
  }
};

const {
  detectBrowserWall,
  extractNeedHuman,
  isBrowserTool,
  shouldAlertNeedHuman,
} = await import(path.join(here, "classify.ts"));
const { alertKey, claimAlert } = await import(path.join(here, "cooldown.ts"));

console.log("\n[1] browser-only gating");
chk("browser_live_take_snapshot is browser", isBrowserTool("browser_live_take_snapshot"));
chk("browser_live_fill is browser", isBrowserTool("browser_live_fill"));
chk("read is not browser", !isBrowserTool("read"));
chk("bash is not browser", !isBrowserTool("bash"));
chk("empty tool name is not browser", !isBrowserTool(""));

console.log("\n[2] high-confidence browser walls");
chk(
  "cloudflare just-a-moment snapshot",
  detectBrowserWall(
    'RootWebArea "Just a moment..." url="https://example.com"\nIframe "challenge"\nStaticText "Verify you are human"',
  ) !== null,
);
chk("recaptcha", detectBrowserWall('StaticText "Please complete the reCAPTCHA"') !== null);
chk("turnstile", detectBrowserWall('StaticText "Turnstile verification"') !== null);
chk("otp code entry", detectBrowserWall('textbox "Enter the code sent to your email"') !== null);
chk("2fa code", detectBrowserWall('StaticText "2FA code required"') !== null);
chk("manual verification", detectBrowserWall('StaticText "Manual verification required"') !== null);

console.log("\n[3] old false positives stay silent");
chk("bare 2fa", detectBrowserWall("2FA is enabled on the account") === null);
chk("rate limit", detectBrowserWall("429 rate limit exceeded") === null);
chk("access denied", detectBrowserWall("403 access denied") === null);
chk("api quota", detectBrowserWall("api key quota exceeded") === null);
chk("payment wall", detectBrowserWall("payment required") === null);
chk("banned", detectBrowserWall("account banned") === null);

console.log("\n[4] explicit NEED_HUMAN extraction");
chk("reason extracted", extractNeedHuman("Blocked. NEED_HUMAN: solve the CAPTCHA") === "solve the CAPTCHA");
chk("no marker", extractNeedHuman("ordinary summary") === null);
chk("empty marker still recognized", extractNeedHuman("NEED_HUMAN:") === "");

console.log("\n[5] explicit marker is browser-gated");
{
  const now = Date.now();
  chk("non-browser reason, no browser context", !shouldAlertNeedHuman("missing API key", false, 0, now, 120000));
  chk("non-browser reason with browser in turn", !shouldAlertNeedHuman("missing API key", true, 0, now, 120000));
  chk("non-browser reason with recent context", !shouldAlertNeedHuman("missing API key", false, now - 1000, now, 120000));
  chk("browser handoff in turn", shouldAlertNeedHuman("manual verification required", true, 0, now, 120000));
  chk("recent browser context", shouldAlertNeedHuman("please take over the browser", false, now - 1000, now, 120000));
  chk("stale browser context", !shouldAlertNeedHuman("please take over the browser", false, now - 600000, now, 120000));
  chk("reason names CAPTCHA", shouldAlertNeedHuman("solve CAPTCHA", false, 0, now, 120000));
  chk("reason names code entry", shouldAlertNeedHuman("enter the code sent to me", false, 0, now, 120000));
  chk("rate limit with browser in turn", !shouldAlertNeedHuman("rate limit exceeded", true, 0, now, 120000));
  chk("legal scope with browser in turn", !shouldAlertNeedHuman("legal scope call", true, 0, now, 120000));
}

console.log("\n[6] cross-process cooldown");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "human-alert-test-"));
  try {
    chk("first claim wins", claimAlert("same-wall", 60000, dir) === true);
    chk("second claim suppressed", claimAlert("same-wall", 60000, dir) === false);
    chk("different key wins", claimAlert("other-wall", 60000, dir) === true);

    const file = path.join(dir, alertKey("same-wall") + ".lock");
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(file, old, old);
    chk("expired claim wins again", claimAlert("same-wall", 60000, dir) === true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n" + (fail === 0 ? "✅ HUMAN-ALERT SELF-TEST: ALL PASS" : `❌ ${fail} CHECK(S) FAILED`));
process.exit(fail === 0 ? 0 : 1);
