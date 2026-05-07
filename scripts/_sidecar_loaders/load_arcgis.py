"""
Generic ArcGIS REST permit loader — Phase 3 of nationwide coverage.

ArcGIS Open Data / ArcGIS Hub is the second-most-common permit-platform
after Socrata. Cities running on Esri's stack expose FeatureServer
endpoints with a uniform query contract:

    GET <feature-server>/<layer>/query?where=1=1&outFields=*&f=json
        &resultRecordCount=N&resultOffset=M&orderByFields=<field> DESC

Verified during 2026-05-06 research:
  - Detroit MI: 95k Building_Permits_Applications_view records
  - Minneapolis MN: 391k CCS_Permits records
  - St. Paul MN: 318k Approved_Building_Permits records (with contractor name)
  - Many UT/WY/MT jurisdictions confirmed ArcGIS-Hub-based (pending
    other research-agent completion)

How it works:
  1. Reads ~/scrapling_loaders/configs/<slug>.yml describing the layer's
     FeatureServer URL and column-name mapping.
  2. Pulls the most-recent N permits (ordered by issue date DESC).
  3. Maps free-text record types -> Henri's permit_type enum.
  4. Upserts via PostgREST on (source_city, source_id) — idempotent.

Run modes:
  python load_arcgis.py detroit-mi              # one city
  python load_arcgis.py --all-arcgis            # every ArcGIS config

Each YAML config:
  loader: arcgis                # required — disambiguates from socrata/energov
  name: DETROIT-MI              # source_city value
  city: Detroit
  state: MI
  url: https://services2.arcgis.com/.../FeatureServer/0/query
  limit: 100                    # default 100; ArcGIS server cap usually 2000
  where: '1=1'                  # filter clause (default '1=1')
  order_field: IssueDate        # ArcGIS orderByFields, DESC implied
  fields:
    permit_no:        PermitNumber
    issued_date:      IssueDate
    address:          StreetAddress
    zip:              Zip
    description:      WorkDesc
    estimated_value:  EstimatedCost
    applicant:        Applicant
    contractor:       ContractorName
    record_type:      PermitType
    status:           Status

The mapping shape mirrors load_socrata.py and load_energov.py — adding
a new ArcGIS city is ~10 lines of YAML.
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
from urllib.parse import urlencode
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

CONFIG_DIR = Path(
    os.environ.get(
        "SCRAPLING_CONFIG_DIR",
        str(Path.home() / "scrapling_loaders" / "configs"),
    )
)


# ── enum mappers (ArcGIS-flavored — same logic shape as Socrata, but
#    most ArcGIS-hosted cities use PermitType="Electrical" vs Socrata's
#    permit_class/work_class double-key approach) ──────────────────
def map_permit_type(record_type: str, description: str, work_type: str = "") -> str:
    """Map free-text ArcGIS record types to Henri's permit_type enum."""
    rt = (record_type or "").lower()
    desc = (description or "").lower()
    wt = (work_type or "").lower()
    blob = " ".join([rt, desc, wt])

    if "demolition" in blob or "demo " in blob:
        return "demolition"
    if "addition" in blob:
        return "addition"
    if "new construction" in blob or "new building" in blob or (
        "new" in rt and ("residential" in rt or "commercial" in rt)
    ):
        return "new_construction"
    if "remodel" in blob or "renovat" in blob or "alteration" in blob:
        return "renovation"
    if "repair" in blob or "replac" in blob:
        return "repair"
    # Trade-specific record types map to "other" for now — Henri's
    # enum doesn't have a dedicated electrical/plumbing/HVAC value.
    # The trade is preserved in raw_json + description for downstream
    # filtering by the lead-classifier.
    if "commercial" in rt:
        return "commercial"
    if "residential" in rt or "single family" in rt or "sfr" in rt:
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
    if "void" in s or "revoked" in s or "withdraw" in s:
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
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-arcgis":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [c for c in configs if (c or {}).get("loader") == "arcgis"]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(
        CONFIG_DIR.glob(f"{target}.yaml")
    )
    if not files:
        raise FileNotFoundError(f"No config matched '{target}' in {CONFIG_DIR}")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def build_url(cfg: Dict[str, Any]) -> str:
    """Build the ArcGIS query URL with Henri's standard params."""
    base = cfg["url"]
    params: Dict[str, str] = {
        "where": cfg.get("where", "1=1"),
        "outFields": "*",
        "f": "json",
        "resultRecordCount": str(cfg.get("limit", 100)),
        "resultOffset": "0",
        "returnGeometry": "false",  # we don't need geom; smaller payload
    }
    if cfg.get("order_field"):
        params["orderByFields"] = f"{cfg['order_field']} DESC"
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{urlencode(params)}"


def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    url = build_url(cfg)
    print(f"[{cfg['name']}] GET {url}")
    page = Fetcher.get(url, stealthy_headers=True)
    if page.status != 200:
        raise RuntimeError(
            f"{cfg['name']} returned {page.status}: {page.body[:300]}"
        )
    parsed = json.loads(page.body)

    if "error" in parsed:
        raise RuntimeError(
            f"{cfg['name']} ArcGIS error: {parsed['error']!r}"
        )

    features = parsed.get("features", [])
    rows = [f.get("attributes", {}) for f in features if isinstance(f, dict)]
    print(f"[{cfg['name']}] {len(rows)} rows from upstream")
    if parsed.get("exceededTransferLimit"):
        print(
            f"[{cfg['name']}] NOTE: exceededTransferLimit=true — pagination "
            f"would return more. Increase limit or run multiple offsets."
        )
    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    f = cfg["fields"]
    permit_no = (str(row.get(f["permit_no"]) or "")).strip()
    if not permit_no:
        return None

    # ArcGIS commonly returns timestamps as epoch-millis. Convert if so.
    raw_issued = row.get(f.get("issued_date", ""))
    issued_date = None
    if isinstance(raw_issued, (int, float)) and raw_issued > 10**11:
        issued_date = datetime.fromtimestamp(
            raw_issued / 1000, tz=timezone.utc
        ).date().isoformat()
    elif raw_issued:
        issued_date = str(raw_issued)

    return {
        "source_city": cfg["name"],
        "source_id": permit_no,
        "permit_number": permit_no,
        "address": (str(row.get(f.get("address", "")) or "")).strip() or None,
        "city": cfg["city"],
        "state": cfg["state"],
        "zip": (str(row.get(f.get("zip", "")) or "")).strip()[:5] or None,
        "permit_type": map_permit_type(
            row.get(f.get("record_type", "")) or "",
            row.get(f.get("description", "")) or "",
            row.get(f.get("work_type", "")) or "",
        ),
        "status": map_status(row.get(f.get("status", ""))),
        "description": (str(row.get(f.get("description", "")) or ""))[:1000] or None,
        "estimated_value": coerce_int(row.get(f.get("estimated_value", ""))),
        "issued_date": issued_date,
        "applicant_name": (str(row.get(f.get("applicant", "")) or "")).strip()[:200]
        or None,
        "contractor_name": (str(row.get(f.get("contractor", "")) or "")).strip()[:200]
        or None,
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
    return {
        "name": slug,
        "ok": True,
        "inserted": inserted,
        "elapsed_s": round(elapsed, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generic ArcGIS REST permit loader for Henri sidecar."
    )
    parser.add_argument(
        "target",
        help="Config slug (e.g. detroit-mi) or '--all-arcgis' for every "
        "arcgis config in the configs dir.",
    )
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} arcgis config(s) from {CONFIG_DIR}")
    results = []
    for cfg in configs:
        results.append(run_one(cfg))
        time.sleep(0.5)
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(
        f"\n[loader] TOTAL inserted: {total} across {len(results)} cities; "
        f"{len(failures)} failures"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
