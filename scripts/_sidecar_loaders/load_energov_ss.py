"""
Tyler EnerGov SelfService scraper — Phase 4 platform adapter.

DIFFERENT from `load_energov.py`. The "SelfService" branch is Tyler's
modern citizen-facing portal (e.g. Henderson NV at
`dsconline.cityofhenderson.com/energov_prod/selfservice/`), which
exposes an undocumented internal JSON API at:
    /energov_prod/selfservice/api/permit/search

vs. the older public Tyler EnerGov that `load_energov.py` already
handles via the documented `/api/v2/Records/Search` route.

The SelfService API is reverse-engineered, undocumented, and
TENANT-LOCKED via session cookies. Each tenant must be probed
individually to discover its exact body shape.

Verified Phase 4 candidate:
  - Henderson NV (`dsconline.cityofhenderson.com`) — ~15-20k/yr.

PHASE 4 STARTER. The API call below is a best-guess pattern; the
first run on Hetzner WILL likely need a real-traffic capture from
the Network tab to fix the body keys. Set DEBUG_HTML_DUMP=1 to log
the raw response.
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
    from scrapling.fetchers import DynamicFetcher  # type: ignore
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
    if target == "--all-energov-ss":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [
            c for c in configs
            if c
            and c.get("loader") == "energov_ss"
            and c.get("status") in (None, "verified")
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(CONFIG_DIR.glob(f"{target}.yaml"))
    if not files:
        raise FileNotFoundError(f"No config matched '{target}'")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Tyler SelfService requires an established session before its
    internal API responds. We open the SPA in Camoufox to bake the
    session cookies, then issue the API call from inside the same
    browser context.
    """
    base = cfg["base_url"].rstrip("/")
    spa_path = cfg.get("spa_path", "/energov_prod/selfservice/#/search")
    api_path = cfg.get("api_path", "/energov_prod/selfservice/api/permit/search")
    days_back = int(cfg.get("date_range_days", 7))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)

    spa_url = f"{base}{spa_path}"
    api_url = f"{base}{api_path}"

    print(f"[{cfg['name']}] open SPA {spa_url} to bake session")
    page = DynamicFetcher.fetch(
        spa_url,
        headless=True,
        humanize=True,
        block_images=True,
        wait=4000,
    )
    if page.status != 200:
        raise RuntimeError(f"{cfg['name']} SPA GET {page.status}")

    # Issue the API call from inside the browser using fetch() — this
    # carries the session cookies + CSRF tokens automatically.
    body = {
        "PermitNumber": "",
        "ApplicantName": "",
        "ContractorName": "",
        "DateFrom": cutoff.strftime("%Y-%m-%dT00:00:00"),
        "DateTo": datetime.now(timezone.utc).strftime("%Y-%m-%dT23:59:59"),
        "PermitTypes": [],
        "PageSize": cfg.get("limit", 200),
        "PageNumber": 1,
    }
    body_json = json.dumps(body)

    js = (
        "fetch(arguments[0], {"
        "  method:'POST',"
        "  headers:{'Content-Type':'application/json'},"
        "  body: arguments[1]"
        "}).then(r => r.text())"
    )
    try:
        result = page.evaluate(js, [api_url, body_json])
    except Exception as e:
        raise RuntimeError(f"{cfg['name']} API call failed: {e}")

    try:
        parsed = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        raise RuntimeError(f"{cfg['name']} API returned non-JSON: {str(result)[:300]}")

    rows = parsed.get("Result") or parsed.get("data") or parsed.get("permits") or []
    if not isinstance(rows, list):
        rows = rows.get("Items", []) if isinstance(rows, dict) else []
    print(f"[{cfg['name']}] API returned {len(rows)} rows")
    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    f = cfg.get("fields", {})
    permit_no = (row.get(f.get("permit_no", "PermitNumber")) or "").strip()
    if not permit_no:
        return None
    return {
        "source_city": cfg["name"],
        "source_id": permit_no,
        "permit_number": permit_no,
        "address": (row.get(f.get("address", "Address")) or "").strip() or None,
        "city": cfg["city"],
        "state": cfg["state"],
        "zip": (row.get(f.get("zip", "Zip")) or "").strip()[:5] or None,
        "permit_type": map_permit_type(
            row.get(f.get("record_type", "PermitType")) or "",
            row.get(f.get("description", "Description")) or "",
        ),
        "status": map_status(row.get(f.get("status", "Status"))),
        "description": (row.get(f.get("description", "Description")) or "")[:1000] or None,
        "estimated_value": coerce_int(row.get(f.get("estimated_value", "TotalValuation"))),
        "issued_date": row.get(f.get("issued_date", "IssuedDate")),
        "applicant_name": (row.get(f.get("applicant", "ApplicantName")) or "").strip()[:200] or None,
        "contractor_name": (row.get(f.get("contractor", "ContractorName")) or "").strip()[:200] or None,
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
    parser = argparse.ArgumentParser(description="Tyler EnerGov SelfService scraper.")
    parser.add_argument("target", help="Slug or '--all-energov-ss'.")
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} energov-ss config(s)")
    results = [run_one(c) for c in configs]
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total}; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
