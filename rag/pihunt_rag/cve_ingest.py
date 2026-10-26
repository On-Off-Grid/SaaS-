"""
cve_ingest.py — keep the pi-hunt RAG current with recent + known-exploited CVEs
and (optionally) nuclei attack-pattern templates.

This is the "freshness" source the rest of the RAG lacked: the static
techniques.yaml froze CVE knowledge at author time, and deep-research's per-hunt
intel was never retained. This module pulls, on demand or on a timer, from three
free / public-domain feeds and indexes them as searchable chunks so any agent
can `rag_search` e.g. "known-exploited RCE in a Spring stack" and hit current
intel keyed to the fingerprints recon actually found.

Feeds (all free; see docs/harness-hardening-plan.md for license notes):
  * CISA KEV   — known-exploited catalog (CC0, no key).            source="cve", metadata.kev=true
  * NVD 2.0    — recently published/modified CVEs (public-domain). source="cve"
  * EPSS       — exploit-prediction score per CVE (FIRST.org).     enriches the above
  * nuclei     — local template metadata as attack patterns.       source="attack-pattern"

Design (matches store.py / ingest.py conventions):
  * stdlib-only networking (urllib); numpy/sqlite come via the store. No new deps.
  * OFFLINE-FIRST: every fetch is wrapped; a failed/truncated feed is skipped,
    never fatal, and existing chunks are NOT wiped on failure. Only a feed that
    returned fresh rows prunes its own stale rows.
  * Stable chunk ids (`_sid("cve", CVE-ID)`) => re-ingest updates in place.
  * Global knowledge => program=None (not tenant/program scoped).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

from .store import VectorStore
from .ingest import _sid

KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
EPSS_URL = "https://api.first.org/data/v1/epss"

USER_AGENT = "pi-hunt-rag-cve-ingest/1.0 (authorized bug-bounty research; single-operator)"
DEFAULT_CAP = int(os.environ.get("PIHUNT_CVE_CAP", "6000"))  # max non-KEV cve chunks retained


# ---- tiny stdlib HTTP helper (offline-tolerant) ---------------------------
def _get_json(url: str, timeout: int = 30, headers: dict | None = None):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except Exception as e:  # noqa: BLE001 — offline-first: never fatal
        print(f"[cve] fetch failed {url.split('?')[0]}: {type(e).__name__}: {str(e)[:120]}")
        return None
    try:
        return json.loads(raw)
    except Exception as e:  # noqa: BLE001 — truncated/partial payload
        print(f"[cve] parse failed {url.split('?')[0]}: {type(e).__name__} "
              f"(got {len(raw)} bytes; feed may be truncated by an egress cap)")
        return None


# ---- feed: CISA KEV (known-exploited) -------------------------------------
def fetch_kev() -> dict[str, dict]:
    """Return {CVE-ID: kev_record}. Empty dict on any failure."""
    data = _get_json(KEV_URL, timeout=40)
    if not data:
        return {}
    out = {}
    for v in data.get("vulnerabilities", []):
        cid = (v.get("cveID") or "").strip().upper()
        if not cid:
            continue
        out[cid] = {
            "vendor": v.get("vendorProject", ""),
            "product": v.get("product", ""),
            "name": v.get("vulnerabilityName", ""),
            "dateAdded": v.get("dateAdded", ""),
            "shortDescription": v.get("shortDescription", ""),
            "requiredAction": v.get("requiredAction", ""),
            "dueDate": v.get("dueDate", ""),
            "ransomware": v.get("knownRansomwareCampaignUse", ""),
            "notes": v.get("notes", ""),
        }
    print(f"[cve] KEV: {len(out)} known-exploited CVEs")
    return out


# ---- feed: NVD 2.0 (recent window) ----------------------------------------
def _nvd_window(days: int):
    now = time.gmtime()
    end = time.strftime("%Y-%m-%dT%H:%M:%S.000", now)
    start = time.strftime("%Y-%m-%dT%H:%M:%S.000", time.gmtime(time.time() - days * 86400))
    return start, end


def _parse_nvd_cve(cve: dict) -> dict:
    cid = (cve.get("id") or "").upper()
    desc = ""
    for d in cve.get("descriptions", []):
        if d.get("lang") == "en":
            desc = d.get("value", ""); break
    # CVSS: prefer v4, then v3.1, then v3.0
    sev = score = vector = ""
    metrics = cve.get("metrics", {})
    for key in ("cvssMetricV40", "cvssMetricV31", "cvssMetricV30"):
        arr = metrics.get(key) or []
        if arr:
            cd = arr[0].get("cvssData", {})
            score = cd.get("baseScore", "")
            sev = (cd.get("baseSeverity") or arr[0].get("baseSeverity") or "").upper()
            vector = cd.get("vectorString", "")
            break
    cwes = []
    for w in cve.get("weaknesses", []):
        for d in w.get("description", []):
            val = d.get("value", "")
            if val.startswith("CWE-") and val not in cwes:
                cwes.append(val)
    # affected products from CPE match criteria
    products, versions = [], []
    for conf in cve.get("configurations", []):
        for node in conf.get("nodes", []):
            for m in node.get("cpeMatch", []):
                crit = m.get("criteria", "")  # cpe:2.3:a:vendor:product:version:...
                parts = crit.split(":")
                if len(parts) >= 6:
                    vp = f"{parts[3]} {parts[4]}".replace("_", " ").replace("*", "").strip()
                    if vp and vp not in products:
                        products.append(vp)
                vr = []
                if m.get("versionStartIncluding"): vr.append(f">={m['versionStartIncluding']}")
                if m.get("versionStartExcluding"): vr.append(f">{m['versionStartExcluding']}")
                if m.get("versionEndIncluding"): vr.append(f"<={m['versionEndIncluding']}")
                if m.get("versionEndExcluding"): vr.append(f"<{m['versionEndExcluding']}")
                if vr:
                    versions.append(" ".join(vr))
    refs = [r.get("url", "") for r in cve.get("references", []) if r.get("url")][:8]
    return {
        "id": cid, "published": cve.get("published", ""),
        "lastModified": cve.get("lastModified", ""),
        "description": desc, "severity": sev, "cvss": score, "vector": vector,
        "cwes": cwes, "products": products[:20], "versions": versions[:20], "refs": refs,
    }


def fetch_nvd_recent(days: int = 30, api_key: str | None = None,
                     max_pages: int = 40) -> dict[str, dict]:
    """Return {CVE-ID: nvd_record} for CVEs modified in the last `days`.
    NVD caps a window at 120 days; `days` is clamped. Paginates 2000/page."""
    days = max(1, min(days, 120))
    start, end = _nvd_window(days)
    api_key = api_key or os.environ.get("NVD_API_KEY")
    headers = {"apiKey": api_key} if api_key else {}
    sleep_s = 0.7 if api_key else 6.0  # NVD: ~50 req/30s with key, ~5/30s without
    out: dict[str, dict] = {}
    idx, per = 0, 2000
    for page in range(max_pages):
        q = urllib.parse.urlencode({
            "lastModStartDate": start, "lastModEndDate": end,
            "resultsPerPage": per, "startIndex": idx,
        })
        data = _get_json(f"{NVD_URL}?{q}", timeout=40, headers=headers)
        if not data:
            break
        vulns = data.get("vulnerabilities", [])
        for v in vulns:
            rec = _parse_nvd_cve(v.get("cve", {}))
            if rec["id"]:
                out[rec["id"]] = rec
        total = int(data.get("totalResults", 0))
        idx += per
        if idx >= total or not vulns:
            break
        time.sleep(sleep_s)
    print(f"[cve] NVD: {len(out)} CVEs modified in last {days}d")
    return out


# ---- feed: EPSS enrichment -------------------------------------------------
def fetch_epss(cve_ids: list[str]) -> dict[str, dict]:
    """Return {CVE-ID: {epss, percentile}}. Batched; empty on failure."""
    out: dict[str, dict] = {}
    ids = [c for c in cve_ids if c]
    for i in range(0, len(ids), 100):
        batch = ids[i:i + 100]
        q = urllib.parse.urlencode({"cve": ",".join(batch)})
        data = _get_json(f"{EPSS_URL}?{q}", timeout=30)
        if not data:
            continue
        for row in data.get("data", []):
            cid = (row.get("cve") or "").upper()
            if cid:
                out[cid] = {"epss": row.get("epss", ""), "percentile": row.get("percentile", "")}
        time.sleep(0.3)
    if out:
        print(f"[cve] EPSS: scored {len(out)} CVEs")
    return out


# ---- merge feeds into searchable chunks -----------------------------------
def _build_cve_chunks(kev: dict, nvd: dict, epss: dict) -> list[dict]:
    ids = set(kev) | set(nvd)
    chunks = []
    for cid in ids:
        k = kev.get(cid)
        n = nvd.get(cid, {})
        e = epss.get(cid, {})
        sev = n.get("severity") or ("KNOWN-EXPLOITED" if k else "")
        products = n.get("products") or ([f"{k['vendor']} {k['product']}".strip()] if k else [])
        desc = n.get("description") or (k.get("shortDescription") if k else "")
        lines = [f"{cid}" + (f"  [{sev}]" if sev else "")]
        if n.get("cvss"):
            lines.append(f"CVSS: {n['cvss']} {n.get('vector','')}")
        if e.get("epss"):
            lines.append(f"EPSS: {e['epss']} (percentile {e.get('percentile','')})")
        if k:
            lines.append("KNOWN-EXPLOITED (CISA KEV)"
                         + (f"; ransomware-linked" if str(k.get("ransomware","")).lower().startswith("known") else "")
                         + (f"; added {k['dateAdded']}" if k.get("dateAdded") else ""))
            if k.get("name"):
                lines.append(f"KEV name: {k['name']}")
        if n.get("cwes"):
            lines.append(f"CWE: {', '.join(n['cwes'])}")
        if products:
            lines.append(f"Affected: {', '.join(products[:12])}")
        if n.get("versions"):
            lines.append(f"Versions: {'; '.join(n['versions'][:12])}")
        if desc:
            lines.append(f"\n{desc}")
        if n.get("refs"):
            lines.append("Refs: " + ", ".join(n["refs"][:6]))
        text = "\n".join(lines)[:8000]
        # kind biases retrieval: exploited > critical/high > other
        if k:
            kind = "cve-kev"
        elif sev in ("CRITICAL", "HIGH"):
            kind = f"cve-{sev.lower()}"
        else:
            kind = "cve"
        chunks.append({
            "id": _sid("cve", cid),
            "source": "cve", "kind": kind, "ref": cid, "program": None,
            "title": f"{cid} {sev}".strip(),
            "text": text,
            "metadata": {
                "cve": cid, "severity": sev, "cvss": n.get("cvss", ""),
                "epss": e.get("epss", ""), "percentile": e.get("percentile", ""),
                "kev": bool(k), "ransomware": bool(k and str(k.get("ransomware","")).lower().startswith("known")),
                "cwes": n.get("cwes", []), "products": products[:20],
                "versions": n.get("versions", []), "published": n.get("published", ""),
                "dateAdded": (k or {}).get("dateAdded", ""), "refs": n.get("refs", []),
            },
        })
    return chunks


def _prune_cve(store: VectorStore, cap: int) -> int:
    """Keep all KEV-flagged cve chunks; cap the rest to the newest `cap` by updated."""
    rows = store.db.execute(
        "SELECT id, metadata, updated FROM chunks WHERE source='cve'"
    ).fetchall()
    non_kev = []
    for cid, meta, updated in rows:
        try:
            is_kev = bool(json.loads(meta or "{}").get("kev"))
        except Exception:
            is_kev = False
        if not is_kev:
            non_kev.append((updated, cid))
    if len(non_kev) <= cap:
        return 0
    non_kev.sort(reverse=True)  # newest first
    drop = [cid for _, cid in non_kev[cap:]]
    store.db.executemany("DELETE FROM chunks WHERE id=?", [(c,) for c in drop])
    store.db.commit(); store._cache = None
    return len(drop)


def ingest_cve(store: VectorStore | None = None, days: int = 30,
               api_key: str | None = None, kev_only: bool = False,
               cap: int = DEFAULT_CAP) -> dict:
    store = store or VectorStore()
    kev = fetch_kev()
    nvd = {} if kev_only else fetch_nvd_recent(days, api_key=api_key)
    if not kev and not nvd:
        return {"cve_chunks": 0, "skipped": "all feeds failed (offline?); existing index kept"}
    ids = list(set(kev) | set(nvd))
    epss = fetch_epss(ids)
    chunks = _build_cve_chunks(kev, nvd, epss)
    n = store.upsert(chunks)  # INSERT OR REPLACE by stable id — incremental, non-destructive
    pruned = _prune_cve(store, cap)
    return {"cve_chunks": n, "kev": len(kev), "nvd": len(nvd), "epss": len(epss), "pruned": pruned}


# ---- optional: nuclei templates as attack patterns ------------------------
def _nuclei_dir(explicit: str | None) -> Path | None:
    for cand in [explicit, os.environ.get("NUCLEI_TEMPLATES"),
                 str(Path.home() / "nuclei-templates"),
                 str(Path.home() / ".nuclei-templates")]:
        if cand and Path(cand).is_dir():
            return Path(cand)
    return None


def ingest_nuclei(store: VectorStore | None = None, templates_dir: str | None = None,
                  max_templates: int = 20000) -> dict:
    """Index nuclei template METADATA (id/name/severity/tags/description/cve/cwe) as
    attack-pattern chunks. Skips cleanly if no templates dir (run `nuclei
    -update-templates` first). Does not execute anything."""
    import yaml  # already a dep
    store = store or VectorStore()
    d = _nuclei_dir(templates_dir)
    if not d:
        return {"attack_patterns": 0, "skipped": "no nuclei-templates dir (run: nuclei -update-templates)"}
    chunks = []
    count = 0
    for f in d.rglob("*.yaml"):
        if count >= max_templates:
            break
        try:
            doc = yaml.safe_load(f.read_text(errors="replace"))
        except Exception:
            continue
        if not isinstance(doc, dict):
            continue
        info = doc.get("info") or {}
        tid = doc.get("id") or f.stem
        name = info.get("name", "")
        sev = (info.get("severity") or "").lower()
        if sev in ("info", "unknown", ""):
            continue  # keep the index focused on actionable attack patterns
        tags = info.get("tags", "")
        if isinstance(tags, list):
            tags = ", ".join(tags)
        classification = info.get("classification") or {}
        cves = classification.get("cve-id") or classification.get("cve_id") or []
        if isinstance(cves, str):
            cves = [cves]
        cwes = classification.get("cwe-id") or classification.get("cwe_id") or []
        if isinstance(cwes, str):
            cwes = [cwes]
        desc = (info.get("description") or "").strip()
        text = (f"ATTACK PATTERN (nuclei): {name}\nTemplate: {tid}  Severity: {sev}\n"
                f"Tags: {tags}\n"
                + (f"CVE: {', '.join(map(str, cves))}\n" if cves else "")
                + (f"CWE: {', '.join(map(str, cwes))}\n" if cwes else "")
                + (f"\n{desc}" if desc else ""))
        chunks.append({
            "id": _sid("attack-pattern", tid),
            "source": "attack-pattern", "kind": f"nuclei-{sev}", "ref": tid, "program": None,
            "title": name or tid,
            "text": text[:6000],
            "metadata": {"template": tid, "severity": sev, "tags": tags,
                         "cves": [str(c) for c in cves], "cwes": [str(c) for c in cwes]},
        })
        count += 1
    if not chunks:
        return {"attack_patterns": 0, "skipped": f"no actionable templates under {d}"}
    store.delete_source("attack-pattern")
    n = store.upsert(chunks)
    return {"attack_patterns": n, "dir": str(d)}


def refresh(days: int = 30, api_key: str | None = None, kev_only: bool = False,
            with_nuclei: bool = True, nuclei_dir: str | None = None,
            cap: int = DEFAULT_CAP) -> dict:
    store = VectorStore()
    res = {"cve": ingest_cve(store, days=days, api_key=api_key, kev_only=kev_only, cap=cap)}
    if with_nuclei:
        res["nuclei"] = ingest_nuclei(store, templates_dir=nuclei_dir)
    res["stats"] = store.stats()
    return res


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(prog="pihunt_rag.cve_ingest",
                                description="refresh CVE + attack-pattern knowledge in the RAG")
    p.add_argument("--days", type=int, default=30, help="NVD recency window (1-120)")
    p.add_argument("--nvd-key", default=None, help="NVD API key (or set NVD_API_KEY)")
    p.add_argument("--kev-only", action="store_true", help="skip NVD; refresh KEV + EPSS only (fast)")
    p.add_argument("--no-nuclei", action="store_true", help="skip nuclei attack-pattern ingest")
    p.add_argument("--nuclei-dir", default=None, help="path to nuclei-templates")
    p.add_argument("--cap", type=int, default=DEFAULT_CAP, help="max non-KEV cve chunks to retain")
    a = p.parse_args()
    print(json.dumps(refresh(days=a.days, api_key=a.nvd_key, kev_only=a.kev_only,
                             with_nuclei=not a.no_nuclei, nuclei_dir=a.nuclei_dir,
                             cap=a.cap), indent=2))
