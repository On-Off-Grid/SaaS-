/**
 * Pure classification helpers for the human-alert extension.
 *
 * Kept separate from index.ts so the fixture self-test can run without pi.
 * The heuristic is deliberately browser-only and high-confidence: a normal
 * `read`/`bash` result mentioning "2FA", "rate limit", or "access denied"
 * must never ring the operator's desk.
 */

export const NEED_HUMAN_RE = /NEED[_ ]HUMAN[:\s-]*([^\n]*)/i;

// CAPTCHA / Cloudflare / bot-wall signatures.
const CAPTCHA_RE =
  /(?:\b(?:captcha|recaptcha|hcaptcha|turnstile|cf[- ]challenge|cloudflare challenge|human verification|are you a robot|checking your browser|enable javascript and cookies to continue)\b|\bverify (?:that )?you(?:'re| are) (?:a )?human\b|\bcomplete (?:the )?(?:security check|captcha)\b|just a moment\.{0,3})/i;

// OTP / code-entry signals. Bare "2fa" is intentionally NOT matched.
const OTP_RE =
  /\b(?:one[- ]time (?:code|password)|otp|verification code|security code|authentication code|passcode|code (?:was )?sent to|two[- ]factor (?:code|authentication)|2fa code|two[- ]step verification)\b|\benter (?:the )?(?:code|otp)\b/i;

// Explicit manual browser handoff, not a generic form field.
const MANUAL_RE =
  /\b(?:manual (?:verification|review) (?:required|needed)|operator (?:must|needs to) (?:enter|fill|complete)|complete the (?:required )?(?:form|fields) manually)\b/i;

// Reasons that are clearly not a live-browser handoff. This is a safety net
// for a model that disobeys the steering and emits NEED_HUMAN after browsing.
const NON_BROWSER_RE =
  /\b(?:api[\s_-]?key|quota|credentials?|rate[\s-]?limit|legal|scope|billing|payment|subscription|proxy|ip[\s-]?(?:block|ban)|network|token)\b/i;

export function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b && (b.type === "text" || typeof b.text === "string"))
      .map((b: any) => b.text || "")
      .join("\n");
  }
  return "";
}

export function isBrowserTool(name: unknown): boolean {
  return typeof name === "string" && name.startsWith("browser_live_");
}

export function detectBrowserWall(text: string): string | null {
  if (!text) return null;
  for (const re of [CAPTCHA_RE, OTP_RE, MANUAL_RE]) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

export function extractNeedHuman(text: string): string | null {
  const m = (text || "").match(NEED_HUMAN_RE);
  if (!m) return null;
  return (m[1] || "").trim();
}

/**
 * Explicit NEED_HUMAN is only actionable when it came from a live-browser
 * flow. A browser tool in the same turn or a recent browser result counts;
 * a reason that itself names a high-confidence browser wall also counts so a
 * coordinator can surface a subagent's browser blocker.
 */
export function shouldAlertNeedHuman(
  reason: string,
  browserInTurn: boolean,
  lastBrowserAt: number,
  now: number,
  windowMs: number,
): boolean {
  // A named browser wall is always actionable, even if the browser tool result
  // happened in an earlier turn/process.
  if (detectBrowserWall(reason) !== null) return true;
  // Obvious non-browser blockers stay silent even if a browser was touched.
  if (NON_BROWSER_RE.test(reason)) return false;
  if (browserInTurn) return true;
  if (lastBrowserAt > 0 && now - lastBrowserAt <= windowMs) return true;
  return false;
}
