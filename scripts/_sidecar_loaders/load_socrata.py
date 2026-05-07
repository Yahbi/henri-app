"""
Generic Socrata permit loader — Phase 1 of nationwide coverage.

How it works:
  1. Reads a YAML config from ~/scrapling_loaders/configs/<slug>.yml that
     describes one city's Socrata endpoint and column-name mappings.
  2. Pulls N most-recent permits via Scrapling's basic Fetcher.
  3. Maps free-text permit type / status to Henri's strict enums.
  4. Upserts into Supabase via PostgREST with conflict resolution on
     (source_city, source_id) — idempotent re-runs.

Run modes:
  python load_socrata.py austin           # one city
  python load_socrata.py --all            # every config in configs/

Each YAML config supports:
  name:                # source_city value, e.g. AUSTIN-TX
  city: Austin         # populates permits.city
  state: TX            # populates permits.state
  url:                 # Socrata JSON resource URL (no $limit/$order)
  limit: 50            # optional, default 50
  order_field:         # optional Socrata column to sort DESC by
  fields:              # column-name mapping (city's name → Henri field)
    permit_no:        permit_number     # required
    issued_date:      issue_date        # required
    address:          original_address1
    zip:              original_zip
    description:      description
    estimated_value:  declared_valuation
    applicant:        applicant_full_name
    contractor:       contractor_company_name
    permit_class:     permit_class      # for residential/commercial heuristic
    work_class:       work_class        # for renovation/addition heuristic
    permit_type_desc: permit_type_desc  # free-text fallback
    status:           status_current

The mapping lets us add a new city with ~10 lines of YAML and zero code.
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

try:
    import yaml  # PyYAML
except ImportError:
    print("Missing PyYAML. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

from scrapling.fetchers import Fetcher

# ── env ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

CONFIG_DIR = Path(os.environ.get("SCRAPLING_CONFIG_DIR", str(Path.home() / "scrapling_loaders" / "configs")))


# ── enum mappers (shared across all cities) ───────────────────────────
def map_permit_type(row: Dict[str, Any], fields: Dict[str, str]) -> str:
    """Map free-text city values to Henri's permit_type enum."""
    permit_class = (row.get(fields.get("permit_class", "")) or "").lower()
    work_class = (row.get(fields.get("work_class", "")) or "").lower()
    desc = (row.get(fields.get("permit_type_desc", "")) or "").lower()

    if "demolition" in desc or "demolition" in work_class:
        return "demolition"
    if "addition" in work_class or "addition" in desc:
        return "addition"
    if "new" in work_class or "new construction" in desc:
        return "new_construction"
    if "remodel" in work_class or "renovat" in desc or "remodel" in desc:
        return "renovation"
    if "repair" in work_class or "repair" in desc:
        return "repair"
    if "commercial" in permit_class:
        return "commercial"
    if "residential" in permit_class:
        return "residential"
    return "other"


def map_status(value: Optional[str]) -> str:
    """Map free-text city values to Henri's permit_status enum."""
    s = (value or "").lower()
    if "final" in s or "completed" in s:
        return "final"
    if "issued" in s or "active" in s:
        return "issued"
    if "approved" in s:
        return "approved"
    if "expired" in s:
        return "expired"
    if "revoked" in s or "void" in s:
        return "revoked"
    return "submitted"


def coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ── core ──────────────────────────────────────────────────────────────
def load_configs(target: str) -> List[Dict[str, Any]]:
    """Resolve `target` (slug or '--all') into a list of config dicts.

    `--all` mode applies two filters:
      1. Only Socrata configs (loader: socrata or unset legacy default)
         — energov / arcgis / ckan configs are excluded so each loader
         only sees its own kind.
      2. Only `status: verified` configs. `unverified` and
         `historical_only` markers are skipped to keep the cron from
         hammering frozen or unprobed endpoints. Run those manually
         by slug if you want them.
    """
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [
            c for c in configs
            if c
            and (c.get("loader") in (None, "socrata"))
            and (c.get("status") in (None, "verified"))
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(CONFIG_DIR.glob(f"{target}.yaml"))
    if not files:
        raise FileNotFoundError(f"No config matched '{target}' in {CONFIG_DIR}")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def build_url(cfg: Dict[str, Any]) -> str:
    base = cfg["url"].rstrip("?&")
    sep = "?" if "?" not in base else "&"
    parts = [f"$limit={cfg.get('limit', 50)}"]
    order_field = cfg.get("order_field")
    if order_field:
        parts.append(f"$order={order_field}%20DESC")
    return f"{base}{sep}{'&'.join(parts)}"


def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    url = build_url(cfg)
    print(f"[{cfg['name']}] GET {url}")
    page = Fetcher.get(url, stealthy_headers=True)
    if page.status != 200:
        raise RuntimeError(f"{cfg['name']} returned {page.status}: {page.body[:300]}")
    rows = json.loads(page.body)
    print(f"[{cfg['name']}] {len(rows)} rows from upstream")
    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    f = cfg["fields"]
    permit_no = (row.get(f["permit_no"]) or "").strip()
    if not permit_no:
        return None
    return {
        "source_city": cfg["name"],
        "source_id": permit_no,
        "permit_number": permit_no,
        "address": (row.get(f.get("address", "")) or "").strip() or None,
        "city": cfg["city"],
        "state": cfg["state"],
        "zip": (row.get(f.get("zip", "")) or "").strip() or None,
        "permit_type": map_permit_type(row, f),
        "status": map_status(row.get(f.get("status", ""))),
        "description": (row.get(f.get("description", "")) or "")[:1000] or None,
        "estimated_value": coerce_int(row.get(f.get("estimated_value", ""))),
        "issued_date": row.get(f.get("issued_date", "")) or None,
        "applicant_name": (row.get(f.get("applicant", "")) or "").strip()[:200] or None,
        "contractor_name": (row.get(f.get("contractor", "")) or "").strip()[:200] or None,
        "raw_json": row,
    }


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
    counts: Dict[str, int] = {}
    for n in normalized:
        counts[n["permit_type"]] = counts.get(n["permit_type"], 0) + 1
    if counts:
        print(f"[{slug}] permit_type breakdown: {counts}")
    inserted = upsert(normalized, slug)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {"name": slug, "ok": True, "inserted": inserted, "elapsed_s": round(elapsed, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Generic Socrata permit loader for Henri sidecar.")
    parser.add_argument("target", help="Config slug (e.g. austin) or '--all' for every config in the configs dir.")
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} config(s) from {CONFIG_DIR}")
    results = []
    for cfg in configs:
        results.append(run_one(cfg))
        time.sleep(0.5)  # be polite to upstream Socrata hosts
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total} across {len(results)} cities; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
