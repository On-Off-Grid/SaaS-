/**
 * confirmed.ts — pure parsing for the continuous-learning "confirmed finding"
 * path. No SDK / fs / network imports, so it is unit-testable standalone
 * (see confirmed.test.mjs). index.ts imports these; keeping them here means the
 * regex logic — the part most likely to drift — can be tested without pi.
 */
import * as crypto from "node:crypto";

export function norm(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").replace(/[`'".]+/g, "").trim();
}

const VULN_CLASSES: [RegExp, string][] = [
  [/\bbfla\b/i, "BFLA"], [/\bbola\b/i, "BOLA"], [/\bidor\b/i, "IDOR"],
  [/\bssrf\b/i, "SSRF"], [/\bstored xss|reflected xss|dom xss|\bxss\b/i, "XSS"],
  [/\bsqli\b|sql injection/i, "SQLi"], [/\brce\b|remote code|command injection/i, "RCE"],
  [/\bssti\b|template injection/i, "SSTI"], [/\bxxe\b/i, "XXE"],
  [/\blfi\b|local file|path traversal|directory traversal/i, "PathTraversal"],
  [/request smuggling|desync/i, "RequestSmuggling"], [/cache poisoning|web cache/i, "CachePoisoning"],
  [/\brace condition|toctou\b/i, "RaceCondition"], [/\boauth\b|\bsaml\b|\bjwt\b/i, "AuthN/Token"],
  [/open redirect/i, "OpenRedirect"], [/\bcsrf\b/i, "CSRF"],
  [/account takeover|\bato\b/i, "ATO"], [/deserialization/i, "Deserialization"],
  [/prototype pollution/i, "PrototypePollution"], [/\bgraphql\b/i, "GraphQL"],
  [/mass assignment/i, "MassAssignment"],
];

export function classify(text: string): string {
  for (const [re, label] of VULN_CLASSES) if (re.test(text)) return label;
  const cwe = text.match(/\bCWE-\d+\b/i);
  return cwe ? cwe[0].toUpperCase() : "logic/other";
}

export function severityOf(text: string): string {
  // Pick by PRECEDENCE, not first-occurrence: a "high confidence" column must
  // not shadow a CRITICAL severity cell on the same line.
  let label = "UNRATED";
  for (const s of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    if (new RegExp(`\\b${s}\\b`, "i").test(text)) { label = s; break; }
  }
  // Only trust a CVSS number when it is explicit ("CVSS 9.1") or parenthesised
  // ("(9.1)"), so a stray version like 2.4 is not mistaken for a score.
  const cvss = text.match(/\bCVSS[:\s]*(\d{1,2}\.\d)\b/i) || text.match(/\((\d{1,2}\.\d)\)/);
  const num = cvss ? (cvss[1] || cvss[2]) : null;
  return label + (num ? ` (${num})` : "");
}

/** Require BOTH a triage signature and a VALID marker — keeps false positives
 *  (e.g. a hunter merely mentioning "valid") out. */
export function looksConfirmed(text: string): boolean {
  if (!text) return false;
  const isTriage = /\bVERDICT\b/i.test(text) || /triage (report|notes|summary|results)/i.test(text)
    || /triager replay/i.test(text) || /\bstrict[-\s]?triager\b/i.test(text);
  const hasValid = /\bVALID\b/.test(text) || /\bvalidated\b/i.test(text) || /verdict:\s*valid/i.test(text);
  return isTriage && hasValid;
}

export type Confirmed = { title: string; klass: string; severity: string; chain: boolean; excerpt: string };

/** Extract confirmed findings: table rows with a VALID cell first, else a single
 *  summary-level finding. Conservative: a miss is fine, a false positive is not. */
export function extractConfirmed(text: string): Confirmed[] {
  const out: Confirmed[] = [];
  const seen = new Set<string>();
  const push = (title: string, context: string) => {
    title = title.replace(/\s{2,}/g, " ").trim().slice(0, 120);
    if (title.length < 4) return;
    const key = norm(title);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title, klass: classify(context), severity: severityOf(context),
      chain: /\bchain\b|leads to|->|→|pivot/i.test(context),
      excerpt: context.replace(/\s{2,}/g, " ").trim().slice(0, 360),
    });
  };
  for (const line of text.split("\n")) {
    if (!/\|/.test(line) || !/\bVALID\b/.test(line)) continue;
    if (/verdict/i.test(line) && /---/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const title = cells.find((c) => c.length > 4 && !/^\d+$/.test(c)
      && !/^(VALID|HIGH|LOW|MEDIUM|CRITICAL|\d\.\d)$/i.test(c)) || cells[0];
    push(title, line);
  }
  if (out.length === 0 && looksConfirmed(text)) {
    const head = (text.match(/^#{1,3}\s*(.+)$/m)?.[1]
      || text.match(/(?:finding|title)\s*[:\-]\s*(.+)/i)?.[1]
      || text.split("\n").find((l) => l.trim().length > 8) || "confirmed finding").trim();
    push(head, text.slice(0, 1200));
  }
  return out;
}

export function confirmedId(program: string, c: Confirmed): string {
  return crypto.createHash("sha1").update(`${program}|${norm(c.title)}|${c.klass}|${norm(c.severity)}`)
    .digest("hex").slice(0, 16);
}
