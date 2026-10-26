/**
 * continuous-learning — turn CONFIRMED findings into reusable, searchable
 * knowledge, and keep a light manual instinct path.
 * ---------------------------------------------------------------------------
 * TARGETED REPAIR (2026-10-26). The previous version had two auto-signals; one
 * (repeated security-tool command shapes) only ever captured noise
 * (`httpx --help`, `httpx -version`) that never deduped, never crossed the
 * promotion threshold, and raced on an unlocked whole-file write. It produced 0
 * promotions in its lifetime. That signal is removed.
 *
 * The value this extension now delivers is the ONE high-signal, reliable path:
 *   strict-triager CONFIRMED a finding  ->  promote it to the RAG as a reusable
 *   technique (program, class, severity, whether it was a multi-step CHAIN, and
 *   a compact reusable pattern), deduped and written under a file lock.
 * This fires in the COORDINATOR process, where the `subagent` tool's result
 * (the triager's verdict) actually lands — so unlike the old tag-scanning it
 * does not depend on the delegating coordinator narrating tags itself.
 *
 * Retained, low-cost:
 *   - Signal (1): tagged lines in turn text (INSTINCT:/LESSON:/HEURISTIC: ->
 *     "do"; DEADEND:/FALSE-POSITIVE:/ANTI: -> "avoid"), confidence-scored and
 *     promoted at threshold. Useful when an agent DOES narrate a lesson.
 *   - The /instinct, /instinct-status, /instinct-promote commands.
 * Both now write atomically (tmp+rename) so a concurrent writer can't corrupt
 * the store; the confirmed-promotion ledger uses the SDK file-mutation queue.
 *
 * Toggle:    PIHUNT_LEARNING=0 to disable.
 * Tunables:  PIHUNT_LEARNING_THRESHOLD (default 0.70)
 *            PIHUNT_LEARNING_STORE      (default $RAG_HOME/data/instincts.jsonl)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { norm, looksConfirmed, extractConfirmed, confirmedId, type Confirmed } from "./confirmed.ts";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

const enabled = () => process.env.PIHUNT_LEARNING !== "0";
const RAG_HOME = process.env.PIHUNT_RAG_HOME || path.join(os.homedir(), ".pi-hunt-rag");
const RAG_PY = path.join(RAG_HOME, ".venv", "bin", "python");
// Prefer the installed wrapper: it sets PIHUNT_RAG_HOME/HF_HOME/PYTHONPATH itself,
// so promotion works even when PIHUNT_RAG_REPO is unset in the coordinator env
// (the old hard-coded fallback paths were wrong for this box and no-op'd silently).
const RAG_WRAPPER = path.join(os.homedir(), ".local", "bin", "pihunt-rag");
const RAG_REPO =
  process.env.PIHUNT_RAG_REPO ||
  firstDir([
    path.join(os.homedir(), "Desktop/Desktop/harness/rag"),
    path.join(os.homedir(), "pi-hunt/rag"),
    path.join(os.homedir(), "tools/pi-hunt/rag"),
    path.join(os.homedir(), "Documents/ai/pi-Hunt/pi-hunt-restore/rag"),
  ]);
const STORE =
  process.env.PIHUNT_LEARNING_STORE || path.join(RAG_HOME, "data", "instincts.jsonl");
// Ledger of findings already promoted, so we never double-record the same one.
const PROMOTED = path.join(RAG_HOME, "data", "confirmed-promotions.jsonl");
const THRESHOLD = clamp(parseFloat(process.env.PIHUNT_LEARNING_THRESHOLD || "0.7") || 0.7, 0.3, 0.95);

function firstDir(cands: string[]): string {
  for (const c of cands) { try { if (fs.existsSync(path.join(c, "pihunt_rag"))) return c; } catch {} }
  return cands[0];
}
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function ragAvailable(): boolean {
  try {
    if (fs.existsSync(RAG_WRAPPER)) return true;
    return fs.existsSync(RAG_PY) && fs.existsSync(path.join(RAG_REPO, "pihunt_rag"));
  } catch { return false; }
}
function runRag(args: string[]): { ok: boolean; out: string } {
  try {
    const useWrapper = fs.existsSync(RAG_WRAPPER);
    const cmd = useWrapper ? RAG_WRAPPER : RAG_PY;
    const argv = useWrapper ? args : ["-m", "pihunt_rag.cli", ...args];
    const r = spawnSync(cmd, argv, {
      env: { ...process.env, PIHUNT_RAG_HOME: RAG_HOME, PYTHONPATH: RAG_REPO,
             HF_HOME: path.join(RAG_HOME, "data", "hf") },
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60000,
    });
    return { ok: r.status === 0, out: (r.stdout || "").trim() };
  } catch { return { ok: false, out: "" }; }
}

function projectKey(cwd: string): string {
  const base = path.basename(cwd || process.cwd() || "default").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return base || "default";
}

function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => (typeof b === "string" ? b : b?.text || b?.content || "")).join("\n");
  }
  if (content && typeof content === "object") return content.text || content.output || "";
  return "";
}

// ---------------------------------------------------------------------------
// Instinct store (signal 1 + manual commands) — atomic writes.
// ---------------------------------------------------------------------------
type Instinct = {
  id: string; scope: "project" | "global"; project: string | null;
  kind: "do" | "avoid"; trigger: string; action: string; domain: string;
  confidence: number; count: number; evidence: string[]; promoted: boolean;
  created: string; updated: string;
};

function instinctId(scope: string, project: string | null, kind: string, action: string): string {
  return crypto.createHash("sha1").update(`${scope}|${project || ""}|${kind}|${norm(action)}`).digest("hex").slice(0, 16);
}
function loadStore(): Instinct[] {
  try {
    if (!fs.existsSync(STORE)) return [];
    return fs.readFileSync(STORE, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Instinct; } catch { return null; } })
      .filter((x): x is Instinct => !!x && !!x.id);
  } catch { return []; }
}
function writeAtomic(file: string, data: string) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file); // atomic on same fs — a concurrent reader never sees a torn file
}
function saveStore(items: Instinct[]) {
  try { writeAtomic(STORE, items.map((i) => JSON.stringify(i)).join("\n") + "\n"); } catch {}
}

function promoteInstinct(it: Instinct): boolean {
  if (it.promoted || !ragAvailable()) return false;
  const verb = it.kind === "avoid" ? "Avoid" : "Instinct";
  const title = `## ${verb} [${it.domain}]: ${it.action.slice(0, 90)}`;
  const body =
    `${it.kind === "avoid" ? "AVOID/DEAD-END" : "Learned behavior"} ` +
    `(confidence ${it.confidence.toFixed(2)}, seen ${it.count}x, scope ${it.scope}` +
    `${it.project ? `/${it.project}` : ""}).\n` +
    `Trigger: ${it.trigger || "(general)"}\nAction: ${it.action}\n` +
    (it.evidence.length ? `Evidence: ${it.evidence.slice(0, 4).join(" | ")}\n` : "");
  return runRag(["record", title, body]).ok;
}

function reinforce(opts: {
  action: string; trigger?: string; domain?: string; kind?: "do" | "avoid";
  scope?: "project" | "global"; project: string | null; evidence?: string; bump?: number;
}): Instinct | null {
  const action = (opts.action || "").trim();
  if (action.length < 4) return null;
  const kind = opts.kind || "do";
  const scope = opts.scope || (kind === "avoid" ? "global" : "project");
  const proj = scope === "global" ? null : opts.project;
  const id = instinctId(scope, proj, kind, action);
  const items = loadStore();
  const now = new Date().toISOString();

  const twinKind = kind === "do" ? "avoid" : "do";
  const twin = items.find((x) => x.id === instinctId(scope, proj, twinKind, action));
  if (twin) { twin.confidence = clamp(twin.confidence - 0.2, 0.1, 0.95); twin.updated = now; }

  let it = items.find((x) => x.id === id);
  if (!it) {
    it = {
      id, scope, project: proj, kind, trigger: (opts.trigger || "").trim(),
      action, domain: (opts.domain || "general").toLowerCase(),
      confidence: clamp(0.4 + (opts.bump || 0), 0.1, 0.95),
      count: 1, evidence: opts.evidence ? [opts.evidence.slice(0, 200)] : [],
      promoted: false, created: now, updated: now,
    };
    items.push(it);
  } else {
    it.confidence = clamp(it.confidence + (opts.bump ?? 0.1), 0.1, 0.95);
    it.count += 1; it.updated = now;
    if (opts.trigger && !it.trigger) it.trigger = opts.trigger.trim();
    if (opts.domain && it.domain === "general") it.domain = opts.domain.toLowerCase();
    if (opts.evidence && it.evidence.length < 6) it.evidence.push(opts.evidence.slice(0, 200));
  }
  if (!it.promoted && it.confidence >= THRESHOLD) { if (promoteInstinct(it)) it.promoted = true; }
  saveStore(items);
  return it;
}

function parseHints(text: string): { action: string; domain?: string; trigger?: string } {
  let action = text.trim(); let domain: string | undefined; let trigger: string | undefined;
  const dm = action.match(/#([a-z0-9_-]{2,20})\b/i);
  if (dm) { domain = dm[1].toLowerCase(); action = action.replace(dm[0], "").trim(); }
  const wm = action.match(/\bwhen\b\s+(.+?)(?:[,;]|->|$)/i);
  if (wm) { trigger = wm[1].trim(); action = action.replace(wm[0], "").trim(); }
  return { action: action.replace(/\s{2,}/g, " ").replace(/[\s,;]+$/, "").trim(), domain, trigger };
}

const POS = /^\s*(?:INSTINCT|LESSON|HEURISTIC)\s*:\s*(.+)$/gim;
const NEG = /^\s*(?:DEADEND|DEAD-END|FALSE[-\s]?POSITIVE|ANTI)\s*:\s*(.+)$/gim;

// ---------------------------------------------------------------------------
// Confirmed-finding promotion (the repaired, high-value path).
// ---------------------------------------------------------------------------
function alreadyPromoted(id: string): boolean {
  try {
    if (!fs.existsSync(PROMOTED)) return false;
    return fs.readFileSync(PROMOTED, "utf8").split("\n").some((l) => l.includes(`"id":"${id}"`));
  } catch { return false; }
}

/** Promote one confirmed finding into the RAG as a reusable technique, once. */
async function promoteConfirmed(program: string, c: Confirmed): Promise<boolean> {
  if (!ragAvailable()) return false;
  const id = confirmedId(program, c);
  if (alreadyPromoted(id)) return false;
  const title = `## Confirmed ${c.severity}${c.chain ? " chain" : ""} [${c.klass}]: ${c.title.slice(0, 80)}`;
  const body =
    `CONFIRMED by strict-triager${c.chain ? " (multi-step chain)" : ""} on ${new Date().toISOString().slice(0, 10)}.\n` +
    `Program: ${program}\nClass: ${c.klass}\nSeverity: ${c.severity}\n` +
    `Reusable pattern: ${c.excerpt}\n` +
    `(Validated finding — try this primitive/approach on similar stacks; always replay before reporting.)`;
  if (!runRag(["record", title, body]).ok) return false;
  // record in the dedup ledger under a file lock (no torn/racy appends)
  await withFileMutationQueue(PROMOTED, async () => {
    const row = JSON.stringify({ id, program, title: c.title, klass: c.klass,
      severity: c.severity, chain: c.chain, ts: new Date().toISOString() });
    fs.mkdirSync(path.dirname(PROMOTED), { recursive: true });
    fs.appendFileSync(PROMOTED, row + "\n");
  });
  return true;
}

export default function (pi: ExtensionAPI) {
  if (!pi || typeof (pi as any).on !== "function") return;
  if (!enabled()) return;

  const proj = projectKey(process.cwd());

  // ---- signal (1): tagged lines in the model's turn text (manual narration)
  pi.on("turn_end", async (event: any) => {
    try {
      const text = textOf(event?.message?.content ?? event?.message);
      if (!text) return;
      let m: RegExpExecArray | null;
      POS.lastIndex = 0;
      while ((m = POS.exec(text))) {
        const h = parseHints(m[1]);
        if (h.action) reinforce({ ...h, kind: "do", scope: "project", project: proj, evidence: `turn @ ${proj}` });
      }
      NEG.lastIndex = 0;
      while ((m = NEG.exec(text))) {
        const h = parseHints(m[1]);
        if (h.action) reinforce({ ...h, kind: "avoid", scope: "global", project: null, evidence: `dead-end @ ${proj}` });
      }
    } catch {}
  });

  // ---- the repaired path: strict-triager CONFIRMED -> RAG technique
  pi.on("tool_result", async (event: any) => {
    try {
      const tool = String(event?.toolName || event?.tool || event?.name || "");
      if (!/subagent/i.test(tool)) return;
      const text = textOf(event?.content ?? event?.result ?? event?.output);
      if (!looksConfirmed(text)) return;
      const program = (text.match(/\/reports\/([^/\s]+)\//)?.[1]
        || text.match(/program\s*[:\-]\s*([^\s,|]+)/i)?.[1] || proj).toLowerCase();
      for (const c of extractConfirmed(text)) {
        await promoteConfirmed(program, c);
      }
    } catch {}
  });

  // ---- commands
  const add = (pi as any).addCommand?.bind(pi);
  if (typeof add === "function") {
    add({
      name: "instinct",
      description: 'Record a learned behavior: /instinct "<action>" [--domain d] [--when ctx] [--global]',
      handler: async (args: string, ctx: any) => {
        const global = /--global\b/.test(args);
        const dom = args.match(/--domain\s+(\S+)/)?.[1];
        const when = args.match(/--when\s+([^-].*?)(?:\s--|$)/)?.[1]?.trim();
        const action = (args.match(/"([^"]+)"/)?.[1] || args.replace(/--\w+(\s+\S+)?/g, "").trim());
        const it = reinforce({ action, domain: dom, trigger: when, kind: "do",
          scope: global ? "global" : "project", project: global ? null : proj, bump: 0.15, evidence: "manual" });
        const msg = it
          ? `recorded instinct [${it.domain}] conf ${it.confidence.toFixed(2)} (${it.promoted ? "promoted to RAG" : "not yet promoted"})`
          : "nothing recorded (action too short)";
        ctx?.ui?.info ? ctx.ui.info(msg) : console.log(msg);
      },
    });
    add({
      name: "instinct-status",
      description: "Show learned instincts (+ global) and recently promoted confirmed findings. --all for every project.",
      handler: async (args: string, ctx: any) => {
        const all = /--all\b/.test(args);
        const items = loadStore()
          .filter((i) => all || i.scope === "global" || i.project === proj)
          .sort((a, b) => b.confidence - a.confidence).slice(0, 30);
        const lines = items.length
          ? items.map((i) => `${i.promoted ? "★" : " "} ${i.confidence.toFixed(2)} [${i.scope === "global" ? "global" : i.project}/${i.domain}] ${i.kind === "avoid" ? "AVOID " : ""}${i.action}`)
          : ["(no instincts yet)"];
        let confirmed: string[] = [];
        try {
          if (fs.existsSync(PROMOTED)) {
            confirmed = fs.readFileSync(PROMOTED, "utf8").split("\n").filter(Boolean).slice(-10)
              .map((l) => { try { const o = JSON.parse(l); return `✓ [${o.program}/${o.klass}] ${o.severity}${o.chain ? " chain" : ""}: ${o.title}`; } catch { return ""; } })
              .filter(Boolean);
          }
        } catch {}
        const out = lines.join("\n") + (confirmed.length ? `\n\nConfirmed findings promoted to RAG:\n${confirmed.join("\n")}` : "");
        ctx?.ui?.info ? ctx.ui.info(out.slice(0, 6000)) : console.log(out);
      },
    });
    add({
      name: "instinct-promote",
      description: "Force-promote pending instincts into the RAG: /instinct-promote [<id>|all]",
      handler: async (args: string, ctx: any) => {
        const target = args.trim();
        const items = loadStore();
        let n = 0;
        for (const it of items) {
          if (it.promoted) continue;
          if (target && target !== "all" && !it.id.startsWith(target)) continue;
          if (!target && it.confidence < THRESHOLD) continue;
          if (promoteInstinct(it)) { it.promoted = true; n += 1; }
        }
        saveStore(items);
        const msg = `promoted ${n} instinct(s) to the RAG`;
        ctx?.ui?.info ? ctx.ui.info(msg) : console.log(msg);
      },
    });
  }
}
