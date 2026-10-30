#!/usr/bin/env node
// browser-live-targets.mjs — thin CDP shim for account-aware tab tracking.
//
// bin/hunt-browser (tabs / open-account / whose-tab) calls this to read and
// shape the browser-live Brave's targets by *browserContextId*, which the HTTP
// /json endpoint does NOT reliably carry — only a CDP WebSocket call to
// Target.getTargets returns it. We connect to the browser-level debug socket
// (webSocketDebuggerUrl from http://HOST:PORT/json/version) and drive raw CDP.
//
// Uses Node's built-in global WebSocket (Node 18+/stable in 22+); no npm deps,
// so it runs the same from the repo clone or the deployed ~/.claude/mcp copy.
//
// Operations (all print a single JSON object/array to stdout):
//   list            --port N          -> { browserWsUrl, createdContextIds, targets:[...] }
//                                        each target: {targetId, browserContextId, url,
//                                        title, type, isDefaultContext}
//   create-context  --port N [--url U] -> { browserContextId, targetId, url }
//                                        (Target.createBrowserContext + createTarget;
//                                         the incognito/do2 context)
//   detect-created  --port N          -> { createdContextIds:[...] }  (fallback path:
//                                        operator opened incognito by hand)
//
// Exit codes: 0 ok · 2 usage · 3 cannot reach browser · 4 CDP op failed.

const HOST = process.env.BROWSER_LIVE_HOST || '127.0.0.1';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else out._.push(a);
  }
  return out;
}

function die(code, msg) {
  process.stderr.write(`browser-live-targets: ${msg}\n`);
  process.exit(code);
}

async function browserWsUrl(host, port) {
  let res;
  try {
    res = await fetch(`http://${host}:${port}/json/version`, {
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {
    die(3, `cannot reach browser-live CDP at ${host}:${port} (${e.message}). Is browser-live up?`);
  }
  if (!res.ok) die(3, `GET /json/version -> HTTP ${res.status}`);
  const j = await res.json();
  if (!j.webSocketDebuggerUrl) die(3, 'no webSocketDebuggerUrl in /json/version');
  return j.webSocketDebuggerUrl;
}

// Minimal CDP-over-WebSocket client against the browser-level endpoint.
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error('CDP connect timeout')), 5000);
      ws.addEventListener('open', () => { clearTimeout(to); resolve(); });
      ws.addEventListener('error', (ev) => { clearTimeout(to); reject(new Error('CDP socket error')); });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: j } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) j(new Error(msg.error.message || JSON.stringify(msg.error)));
          else r(msg.result);
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 8000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function withCDP(host, port, fn) {
  const wsUrl = await browserWsUrl(host, port);
  const cdp = new CDP(wsUrl);
  try {
    await cdp.connect();
    return await fn(cdp, wsUrl);
  } finally {
    cdp.close();
  }
}

async function getCreatedContextIds(cdp) {
  // Target.getBrowserContexts returns ONLY explicitly-created (incognito)
  // contexts — the default/initial context is never listed. That absence is
  // exactly how we tell the default context (do1) apart from a created one (do2).
  try {
    const r = await cdp.send('Target.getBrowserContexts');
    return r.browserContextIds || [];
  } catch {
    return [];
  }
}

async function opList(host, port) {
  return withCDP(host, port, async (cdp, wsUrl) => {
    const created = new Set(await getCreatedContextIds(cdp));
    const r = await cdp.send('Target.getTargets');
    const targets = (r.targetInfos || []).map((t) => ({
      targetId: t.targetId,
      browserContextId: t.browserContextId || null,
      url: t.url || '',
      title: t.title || '',
      type: t.type || '',
      isDefaultContext: t.browserContextId ? !created.has(t.browserContextId) : false,
    }));
    return { browserWsUrl: wsUrl, createdContextIds: [...created], targets };
  });
}

async function opCreateContext(host, port, url) {
  return withCDP(host, port, async (cdp) => {
    let browserContextId;
    try {
      const c = await cdp.send('Target.createBrowserContext', { disposeOnDetach: false });
      browserContextId = c.browserContextId;
    } catch (e) {
      die(4, `Target.createBrowserContext failed (${e.message}). Fall back to manual incognito + detect-created.`);
    }
    const target = url || 'about:blank';
    let targetId;
    try {
      const t = await cdp.send('Target.createTarget', { url: target, browserContextId });
      targetId = t.targetId;
    } catch (e) {
      die(4, `Target.createTarget failed (${e.message}).`);
    }
    return { browserContextId, targetId, url: target };
  });
}

async function opDetectCreated(host, port) {
  return withCDP(host, port, async (cdp) => {
    const created = await getCreatedContextIds(cdp);
    return { createdContextIds: created };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const op = args._[0];
  const host = args.host || HOST;
  const port = args.port || process.env.BROWSER_LIVE_PORT;
  if (!op) die(2, 'usage: browser-live-targets.mjs <list|create-context|detect-created> --port N [--url U]');
  if (!port) die(2, 'missing --port (or BROWSER_LIVE_PORT)');

  let result;
  if (op === 'list') result = await opList(host, port);
  else if (op === 'create-context') result = await opCreateContext(host, port, args.url);
  else if (op === 'detect-created') result = await opDetectCreated(host, port);
  else die(2, `unknown op '${op}'`);

  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch((e) => die(4, e && e.message ? e.message : String(e)));
