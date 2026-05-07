"""
Generic Citizenserve permit loader — Tier 5 cheap-win adapter.

Per Tier-2 research (research/tier2_platform_inventory.md), Citizenserve's
URL template is dead-uniform:

    https://www.citizenserve.com/Portal/?installationID=<N>

where <N> is a sequential integer. One scraper sweeps all ~400 active IDs
without per-tenant configuration. The trade-off: long-tail coverage of
small jurisdictions, mostly individual-municipal customers in MO/AR/MS/AL.

Phase 4 stealth-tier loader. Citizenserve uses a JS-driven SPA, so
Scrapling's DynamicFetcher (Camoufox) is required; basic Fetcher gets a
mostly-empty <noscript> shell.

Run modes:
  python load_citizenserve.py 47                 # one installation ID
  python load_citizenserve.py --sweep            # walk 1..MAX
  python load_citizenserve.py --sweep --max=600  # walk 1..600

Sweep mode politely waits 2s between IDs (so a full 600-ID sweep runs
~20 minutes). Each successful tenant is upserted to permits with
source_city = 'CITIZENSERVE-<N>'. Rows where the page doesn't render a
permit table (most IDs) are silently skipped — that's expected.

Gotchas:
  - Some installation IDs are inactive / private / building-only (no
    permit module). The loader logs them as `no_results` not `error`.
  - First-visit cookie consent banners may block selector matching; the
    DynamicFetcher click-dismiss runs on every fetch.
  - Result tables often paginate; we capture only page 1 (most-recent).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from scrapling.fetchers import DynamicFetcher

# ── env ────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

PORTAL_URL = "https://www.citizenserve.com/Portal/?installationID={id}"
TABLE_SELECTORS = [
    # Common Citizenserve result-table classes seen in tier2_platform_inventory.md
    'table.results-table',
    'table.permit-results',
    'table[id*="grdResults"]',
    'div.results-grid table',
]
COOKIE_DISMISS_SELECTORS = [
    'button:has-text("Accept")',
    'button:has-text("OK")',
    '#cookieAccept',
]


def fetch_tenant(installation_id: int) -> Dict[str, Any]:
    url = PORTAL_URL.format(id=installation_id)
    print(f"[citizenserve] {installation_id}: GET {url}")
    page = DynamicFetcher.fetch(
        url,
        headless=True,
        timeout=45000,
        wait=2,
        # We don't know which table-selector this tenant uses; let the
        # SPA finish loading then inspect the DOM.
    )
    if not page or getattr(page, "status", 0) != 200:
        return {"id": installation_id, "ok": False, "reason": f"http={getattr(page,'status','?')}", "rows": []}

    # Try to dismiss any cookie banners (best-effort; ignore errors).
    for sel in COOKIE_DISMISS_SELECTORS:
        try:
            page.css(sel)  # pylint: disable=expression-not-assigned
        except Exception:
            continue

    # Try each known result-table selector in order.
    rows: List[Dict[str, Any]] = []
    for sel in TABLE_SELECTORS:
        trs = page.css(f"{sel} tr") or []
        if len(trs) <= 1:
            continue
        # Read header row for field names.
        header_cells = trs[0].css("th") or trs[0].css("td")
        headers = [h.text.strip().lower().replace(" ", "_") for h in header_cells]
        for tr in trs[1:]:
            cells = tr.css("td")
            if not cells:
                continue
            row = {headers[i]: cells[i].text.strip() for i in range(min(len(headers), len(cells)))}
            rows.append(row)
        if rows:
            break

    # Try to extract a tenant name from the page title for source_city.
    title_el = page.css("title")
    tenant_name = title_el[0].text.strip()[:60] if title_el else f"INSTALLATION-{installation_id}"
    return {"id": installation_id, "ok": True, "tenant_name": tenant_name, "rows": rows}


def normalize(rec: Dict[str, Any], installation_id: int, tenant_name: str) -> Optional[Dict[str, Any]]:
    """Best-effort field mapping. Citizenserve tenants ship inconsistent
    column headers; this maps the most common ones to Henri's permits
    schema. Unmapped fields land in raw_json for later post-processing.
    """
    # Find a permit-number-ish field.
    pno_keys = ["permit_number", "permit_no", "permit", "case_number", "case_no", "application_number", "application_no"]
    pno = next((rec[k] for k in pno_keys if k in rec and rec[k]), None)
    if not pno:
        return None
    # Address
    addr_keys = ["address", "site_address", "street_address", "project_address", "location"]
    addr = next((rec[k] for k in addr_keys if k in rec and rec[k]), None)
    # Issued date
    date_keys = ["issue_date", "issued_date", "date_issued", "date", "applied_date", "application_date"]
    issued = next((rec[k] for k in date_keys if k in rec and rec[k]), None)
    # Status
    status = next((rec[k] for k in ["status", "permit_status", "case_status"] if k in rec and rec[k]), None)
    # Description
    desc = next((rec[k] for k in ["description", "scope", "scope_of_work", "work_description"] if k in rec and rec[k]), None)

    return {
        "source_city": f"CITIZENSERVE-{installation_id:04d}",
        "source_id": str(pno).strip()[:80],
        "permit_number": str(pno).strip()[:80],
        "address": (addr or "").strip()[:300] or None,
        "city": tenant_name[:80],
        "state": None,                 # not always exposed in the table
        "permit_type": "other",        # let downstream classifier handle it
        "status": _map_status(status),
        "description": (desc or "")[:1000] or None,
        "issued_date": _coerce_date(issued),
        "raw_json": rec,
    }


def _map_status(s: Optional[str]) -> str:
    s = (s or "").lower()
    if "final" in s or "complete" in s:
        return "final"
    if "issued" in s or "active" in s:
        return "issued"
    if "expired" in s:
        return "expired"
    if "approve" in s:
        return "approved"
    if "void" in s or "revoked" in s:
        return "revoked"
    return "submitted"


def _coerce_date(s: Any) -> Optional[str]:
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def upsert(rows: List[Dict[str, Any]], slug: str) -> int:
    if not rows:
        return 0
    url = SUPABASE_URL + "/rest/v1/permits?on_conflict=source_city,source_id"
    body = json.dumps(rows).encode("utf-8")
    req = Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        r = urlopen(req, timeout=60)
        print(f"[{slug}] Supabase {r.status} ({len(rows)} posted)")
        return len(rows)
    except HTTPError as e:
        print(f"[{slug}] HTTPError {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
    except URLError as e:
        print(f"[{slug}] URLError: {e}", file=sys.stderr)
    return 0


def run_one(installation_id: int) -> Dict[str, Any]:
    started = datetime.now(timezone.utc)
    try:
        result = fetch_tenant(installation_id)
    except Exception as e:
        return {"id": installation_id, "ok": False, "error": str(e), "inserted": 0}
    if not result.get("ok") or not result.get("rows"):
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        print(f"[citizenserve {installation_id}] no_results in {elapsed:.1f}s")
        return {"id": installation_id, "ok": True, "inserted": 0, "rows": 0, "elapsed_s": round(elapsed, 1)}
    tenant = result["tenant_name"]
    normalized = [n for n in (normalize(r, installation_id, tenant) for r in result["rows"]) if n]
    inserted = upsert(normalized, f"citizenserve-{installation_id}")
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[citizenserve {installation_id}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {"id": installation_id, "ok": True, "inserted": inserted, "rows": len(result["rows"]), "elapsed_s": round(elapsed, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Citizenserve sweeper.")
    parser.add_argument("target", nargs="?", help="Single installation ID, or '--sweep'.")
    parser.add_argument("--sweep", action="store_true", help="Walk all IDs from 1..MAX.")
    parser.add_argument("--max", type=int, default=500, help="Max ID for --sweep (default 500).")
    parser.add_argument("--start", type=int, default=1, help="Starting ID for --sweep (default 1).")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds between requests in sweep mode.")
    args = parser.parse_args()

    if args.sweep or args.target == "--sweep":
        ids = range(args.start, args.max + 1)
        print(f"[citizenserve] sweep {args.start}..{args.max} (delay={args.delay}s)")
    elif args.target:
        ids = [int(args.target)]
    else:
        parser.error("Provide an installation ID or use --sweep.")

    results = []
    for iid in ids:
        results.append(run_one(iid))
        time.sleep(args.delay)
    total = sum(r.get("inserted", 0) for r in results)
    hits = [r for r in results if r.get("inserted", 0) > 0]
    print(f"\n[citizenserve] TOTAL: {total} permits inserted across {len(hits)} active tenants (out of {len(results)} probed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
