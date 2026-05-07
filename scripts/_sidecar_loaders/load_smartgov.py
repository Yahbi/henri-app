"""
SmartGov scraper — Phase 4 platform adapter.

SmartGov (DataPath Inc.) is a smaller permit-management SaaS used by
high-end mountain/luxury jurisdictions. Citizen URL pattern is:
    https://<jurisdiction>.smartgovcommunity.com/PermittingPublic/Home

Verified Phase 4 candidate:
  - Jackson / Teton County WY (`co-teton-wy.smartgovcommunity.com`)
    Small volume but very high $-value (luxury second homes, multi-
    million-dollar permits). High lead-priority for any contractor
    serving Teton County.

Unlike Accela/eTRAKiT, SmartGov uses modern Angular/React-style URLs
and exposes JSON to the browser via /api/permitting/*. Each permit
has a permanent URL like /PermittingPublic/Permit/<id>. Listing is
done via GET to /api/permitting/permitsearch with JSON query params.

PHASE 4 STARTER. SmartGov endpoints aren't publicly documented; the
spec below is reverse-engineered from observed network requests. May
need adjustment per tenant.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import yaml
except ImportError:
    print("Missing PyYAML.", file=sys.stderr)
    sys.exit(2)

try:
    from scrapling.fetchers import DynamicFetcher, Fetcher  # type: ignore
except ImportError:
    print("Missing Scrapling.", file=sys.stderr)
    sys.exit(2)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
    sys.exit(2)

CONFIG_DIR = Path(
    os.environ.get(
        "SCRAPLING_CONFIG_DIR",
        str(Path.home() / "scrapling_loaders" / "configs"),
    )
)


def map_permit_type(record_type: str, description: str) -> str:
    blob = " ".join([record_type or "", description or ""]).lower()
    if "demolition" in blob:
        return "demolition"
    if "addition" in blob:
        return "addition"
    if "new" in blob and ("residential" in blob or "construction" in blob):
        return "new_construction"
    if "remodel" in blob or "renovat" in blob or "alteration" in blob:
        return "renovation"
    if "repair" in blob:
        return "repair"
    if "commercial" in blob:
        return "commercial"
    if "residential" in blob or "single family" in blob:
        return "residential"
    return "other"


def map_status(value: Optional[str]) -> str:
    s = (value or "").lower()
    if "final" in s or "closed" in s or "completed" in s:
        return "final"
    if "issued" in s or "active" in s or "open" in s:
        return "issued"
    if "approved" in s:
        return "approved"
    if "expired" in s:
        return "expired"
    if "void" in s or "revoked" in s:
        return "revoked"
    return "submitted"


def coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    s = re.sub(r"[^\d.]", "", str(v))
    try:
        return int(float(s)) if s else None
    except (TypeError, ValueError):
        return None


def load_configs(target: str) -> List[Dict[str, Any]]:
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-smartgov":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [
            c for c in configs
            if c
            and c.get("loader") == "smartgov"
            and c.get("status") in (None, "verified")
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(CONFIG_DIR.glob(f"{target}.yaml"))
    if not files:
        raise FileNotFoundError(f"No config matched '{target}'")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """SmartGov exposes a JSON search endpoint at /api/permitting/permitsearch.

    Two strategies:
      1. Direct GET to the API (no auth needed for public listings on
         most tenants). Faster, no browser overhead.
      2. Fall back to DynamicFetcher driving the SPA if the API is
         tenant-locked or returns 401.
    """
    base = cfg["base_url"].rstrip("/")
    api_path = cfg.get("api_path", "/api/permitting/permitsearch")
    days_back = int(cfg.get("date_range_days", 7))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)

    # Try direct API first.
    qs = (
        f"?issuedFrom={cutoff.strftime('%Y-%m-%d')}"
        f"&issuedTo={datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        f"&pageSize={cfg.get('limit', 200)}"
    )
    url = f"{base}{api_path}{qs}"
    print(f"[{cfg['name']}] GET {url}")

    try:
        page = Fetcher.get(
            url,
            headers={"Accept": "application/json"},
            stealthy_headers=True,
        )
        if page.status == 200:
            try:
                parsed = json.loads(page.body)
                rows = (
                    parsed.get("results")
                    or parsed.get("data")
                    or parsed.get("permits")
                    or (parsed if isinstance(parsed, list) else [])
                )
                print(f"[{cfg['name']}] API path returned {len(rows)} rows")
                return rows
            except json.JSONDecodeError:
                print(f"[{cfg['name']}] API responded but not JSON, falling back to SPA scrape")
    except Exception as e:
        print(f"[{cfg['name']}] API path failed ({e}), falling back to SPA scrape")

    # Fallback: drive the SPA with Camoufox. SmartGov SPAs render
    # results into a <table data-testid="permit-results"> that we
    # scrape after `wait_for_selector`.
    spa_url = f"{base}{cfg.get('spa_path', '/PermittingPublic/Search')}"
    page = DynamicFetcher.fetch(
        spa_url,
        headless=True,
        humanize=True,
        block_images=True,
        wait=3000,
    )
    if page.status != 200:
        raise RuntimeError(f"{cfg['name']} SPA GET {page.status}")

    rows: List[Dict[str, Any]] = []
    table_sel = cfg.get("result_table_selector", "[data-testid='permit-results']")
    try:
        for tr in page.locator(f"{table_sel} tr").all():
            cells = [c.inner_text().strip() for c in tr.locator("td").all()]
            if len(cells) < 4:
                continue
            f = cfg["fields"]
            rows.append(
                {
                    "permit_no": cells[f.get("permit_no", 0)] if f.get("permit_no") is not None and f.get("permit_no", 0) < len(cells) else None,
                    "issued_date": cells[f.get("issued_date", 1)] if f.get("issued_date") is not None and f.get("issued_date", 1) < len(cells) else None,
                    "record_type": cells[f.get("record_type", 2)] if f.get("record_type") is not None and f.get("record_type", 2) < len(cells) else None,
                    "description": cells[f.get("description", 3)] if f.get("description") is not None and f.get("description", 3) < len(cells) else None,
                    "address": cells[f.get("address", 4)] if f.get("address") is not None and f.get("address", 4) < len(cells) else None,
                    "status": cells[f.get("status", 5)] if f.get("status") is not None and f.get("status", 5) < len(cells) else None,
                }
            )
    except Exception as e:
        raise RuntimeError(f"{cfg['name']} SPA scrape failed: {e}")

    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # SmartGov API returns nested JSON. Normalize either shape.
    if isinstance(row, dict) and "permitNumber" in row:
        permit_no = (row.get("permitNumber") or "").strip()
        record_type = row.get("permitType") or row.get("recordType") or ""
        description = row.get("description") or row.get("workDescription") or ""
        address = row.get("address") or row.get("siteAddress") or ""
        applicant = row.get("applicantName") or row.get("ownerName") or ""
        contractor = row.get("contractorName") or ""
        status = row.get("status") or ""
        issued = row.get("issuedDate") or row.get("issueDate") or row.get("dateIssued")
        valuation = coerce_int(row.get("valuation") or row.get("estimatedValue"))
    else:
        # Fallback shape from SPA scrape.
        permit_no = (row.get("permit_no") or "").strip()
        record_type = row.get("record_type", "")
        description = row.get("description", "")
        address = row.get("address", "")
        applicant = ""
        contractor = ""
        status = row.get("status", "")
        issued = row.get("issued_date")
        valuation = None

    if not permit_no:
        return None
    return {
        "source_city": cfg["name"],
        "source_id": permit_no,
        "permit_number": permit_no,
        "address": address.strip() if address else None,
        "city": cfg["city"],
        "state": cfg["state"],
        "zip": None,
        "permit_type": map_permit_type(record_type, description),
        "status": map_status(status),
        "description": (description or "")[:1000] or None,
        "estimated_value": valuation,
        "issued_date": issued,
        "applicant_name": applicant.strip()[:200] if applicant else None,
        "contractor_name": contractor.strip()[:200] if contractor else None,
        "raw_json": row,
    }


def upsert(rows: List[Dict[str, Any]], slug: str) -> int:
    if not rows:
        return 0
    url = SUPABASE_URL + "/rest/v1/permits?on_conflict=source_city,source_id"
    body = json.dumps(rows).encode("utf-8")
    req = Request(
        url, data=body, method="POST",
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


def run_one(cfg: Dict[str, Any]) -> Dict[str, Any]:
    started = datetime.now(timezone.utc)
    slug = cfg["name"]
    try:
        raw = fetch_rows(cfg)
    except Exception as e:
        print(f"[{slug}] fetch failed: {e}", file=sys.stderr)
        return {"name": slug, "ok": False, "error": str(e), "inserted": 0}
    normalized = [n for n in (normalize(r, cfg) for r in raw) if n]
    print(f"[{slug}] normalized: {len(normalized)} rows")
    inserted = upsert(normalized, slug)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {"name": slug, "ok": True, "inserted": inserted, "elapsed_s": round(elapsed, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description="SmartGov scraper for Henri sidecar.")
    parser.add_argument("target", help="Slug or '--all-smartgov'.")
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} smartgov config(s)")
    results = [run_one(c) for c in configs]
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total}; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
