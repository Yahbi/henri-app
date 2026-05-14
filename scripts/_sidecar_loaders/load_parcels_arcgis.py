"""
Generic ArcGIS parcel/assessor loader — Phase 5 substitute-layer ingest.

Reads enabled rows from the `parcel_sources` Supabase table (created in
migration 00085) and pulls statewide parcel + assessor feeds from
ArcGIS REST endpoints into `parcels_sidecar`. Targets the 7 dead-permit
states (ME / MS / NH / OK / RI / UT / WV) where Henri can't get permits
directly and substitutes parcel + recent-transfer + assessor signals.

DIFFERENT from load_arcgis.py (Phase 3):
  - Phase 3 reads filesystem YAML configs and writes to `permits` table.
  - Phase 5 reads `parcel_sources` rows from Supabase and writes to
    `parcels_sidecar`. The DB is the source of truth — operators
    enable/disable sources via SQL, no redeploy needed.

How it works:
  1. GET enabled parcel_sources rows from Supabase (REST API).
  2. For each, query the ArcGIS endpoint with ArcGIS REST conventions
     (where=1=1, outFields=*, f=json, resultRecordCount=N, paginate
     via resultOffset).
  3. Map upstream columns to canonical fields using the row's
     `field_map` jsonb.
  4. Upsert into parcels_sidecar with conflict on (state_code,
     source_parcel_id).
  5. Update parcel_sources.last_run_at + last_count + error_count.

Run modes:
  python load_parcels_arcgis.py UT-LIR-PARCELS       # one source by source_key
  python load_parcels_arcgis.py --all-enabled        # every enabled source

Pagination: ArcGIS servers cap resultRecordCount at ~2000. For statewide
feeds (UT 1.6M, WV 1.5M) we pass `--max-pages=N` to limit a single run
(default 25 pages × 2000 = 50,000 records). Quarterly refreshes mean
running once a day for 30 days catches up cleanly.

Field-map JSON shape (in parcel_sources.field_map):
  {
    "source_parcel_id": "<upstream_field>",   # required; dedup key
    "owner_name":       "<upstream_field>",   # optional but recommended
    "owner_mailing_addr":"<upstream_field>",
    "situs_addr":       "<upstream_field>",
    "situs_city":       "<upstream_field>",
    "situs_zip":        "<upstream_field>",
    "total_appraisal":  "<upstream_field>",
    "building_appraisal":"<upstream_field>",
    "land_appraisal":   "<upstream_field>",
    "built_year":       "<upstream_field>",
    "building_sqft":    "<upstream_field>",
    "land_use":         "<upstream_field>",
    "occupancy_desc":   "<upstream_field>",
    "resident_phone":   "<upstream_field>"    # rare; WV Site Addresses
  }

Smoke-test individual source first:
  DEBUG_HTML_DUMP=1 python load_parcels_arcgis.py UT-LIR-PARCELS
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ── env ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

DEBUG_HTML_DUMP = os.environ.get("DEBUG_HTML_DUMP") == "1"


# ── supabase REST helpers ────────────────────────────────────────────
def supabase_get(path: str, params: Dict[str, str]) -> Any:
    qs = urlencode(params)
    url = f"{SUPABASE_URL}/rest/v1{path}?{qs}"
    req = Request(
        url,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Accept": "application/json",
        },
    )
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def supabase_post(path: str, body: Any, prefer: str = "resolution=merge-duplicates,return=minimal") -> int:
    url = f"{SUPABASE_URL}/rest/v1{path}"
    req = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    with urlopen(req, timeout=60) as r:
        return r.status


def supabase_patch(path: str, body: Dict[str, Any], filter_qs: str) -> int:
    url = f"{SUPABASE_URL}/rest/v1{path}?{filter_qs}"
    req = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="PATCH",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    with urlopen(req, timeout=30) as r:
        return r.status


# ── source loading ───────────────────────────────────────────────────
def fetch_sources(target: str) -> List[Dict[str, Any]]:
    """Resolve `target` (source_key or '--all-enabled') to source rows."""
    if target == "--all-enabled":
        return supabase_get(
            "/parcel_sources",
            {"select": "*", "enabled": "eq.true", "order": "last_run_at.asc.nullsfirst"},
        )
    rows = supabase_get(
        "/parcel_sources",
        {"select": "*", "source_key": f"eq.{target}"},
    )
    if not rows:
        print(f"No parcel_sources row matched source_key={target}", file=sys.stderr)
        sys.exit(1)
    return rows


# ── ArcGIS query builder ─────────────────────────────────────────────
def build_query_url(base_url: str, offset: int, limit: int) -> str:
    """ArcGIS REST query with our standard params."""
    params = {
        "where": "1=1",
        "outFields": "*",
        "f": "json",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
        "returnGeometry": "false",
    }
    sep = "&" if "?" in base_url else "?"
    return f"{base_url}{sep}{urlencode(params)}"


def fetch_page(base_url: str, offset: int, limit: int, slug: str) -> Optional[Dict[str, Any]]:
    url = build_query_url(base_url, offset, limit)
    print(f"[{slug}] GET {url[:200]}")
    req = Request(
        url,
        headers={"User-Agent": "Henri-Parcels-Loader/1.0", "Accept": "application/json"},
    )
    try:
        with urlopen(req, timeout=60) as r:
            if r.status != 200:
                print(f"[{slug}] HTTP {r.status}", file=sys.stderr)
                return None
            body = r.read()
    except (HTTPError, URLError) as e:
        print(f"[{slug}] network error: {e}", file=sys.stderr)
        return None
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[{slug}] not JSON: {e}", file=sys.stderr)
        if DEBUG_HTML_DUMP:
            from pathlib import Path
            (Path.home() / f"parcels-debug-{slug}.html").write_bytes(body)
        return None
    if "error" in parsed:
        print(f"[{slug}] ArcGIS error: {parsed['error']}", file=sys.stderr)
        return None
    return parsed


# ── normalize ────────────────────────────────────────────────────────
def coerce_int(v: Any) -> Optional[int]:
    if v in (None, ""):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def coerce_date(v: Any) -> Optional[str]:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)) and v > 10**11:
        # ArcGIS epoch-millis
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).date().isoformat()
    s = str(v).strip()
    return s[:10] if s else None


def normalize(row: Dict[str, Any], src: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fm = src.get("field_map") or {}
    if not fm:
        return None  # field_map empty — skip this source until operator populates
    parcel_id_field = fm.get("source_parcel_id")
    if not parcel_id_field:
        return None
    pid = str(row.get(parcel_id_field) or "").strip()
    if not pid:
        return None
    out = {
        "source_key": src["source_key"],
        "state_code": src["state_code"],
        "source_parcel_id": pid,
        "owner_name": (str(row.get(fm.get("owner_name", "")) or "")).strip()[:200] or None,
        "owner_mailing_addr": (str(row.get(fm.get("owner_mailing_addr", "")) or "")).strip()[:300] or None,
        "situs_addr": (str(row.get(fm.get("situs_addr", "")) or "")).strip()[:300] or None,
        "situs_city": (str(row.get(fm.get("situs_city", "")) or "")).strip()[:100] or None,
        "situs_zip": (str(row.get(fm.get("situs_zip", "")) or "")).strip()[:5] or None,
        "total_appraisal": coerce_int(row.get(fm.get("total_appraisal", ""))),
        "building_appraisal": coerce_int(row.get(fm.get("building_appraisal", ""))),
        "land_appraisal": coerce_int(row.get(fm.get("land_appraisal", ""))),
        "built_year": coerce_int(row.get(fm.get("built_year", ""))),
        "building_sqft": coerce_int(row.get(fm.get("building_sqft", ""))),
        "land_use": (str(row.get(fm.get("land_use", "")) or "")).strip()[:100] or None,
        "occupancy_desc": (str(row.get(fm.get("occupancy_desc", "")) or "")).strip()[:100] or None,
        "resident_phone": (str(row.get(fm.get("resident_phone", "")) or "")).strip()[:30] or None,
        "raw_json": row,
    }
    # NewOwner flag (WV ParcelSummary) → recent_transfer_at hint.
    new_owner = row.get("NewOwner")
    if new_owner and str(new_owner).strip().lower() not in ("", "none", "null"):
        out["recent_transfer_at"] = datetime.now(timezone.utc).date().isoformat()
    return out


# ── per-source runner ────────────────────────────────────────────────
def run_one(src: Dict[str, Any], max_pages: int, page_size: int) -> Dict[str, Any]:
    started = datetime.now(timezone.utc)
    slug = src["source_key"]
    if src.get("source_kind") != "arcgis":
        print(f"[{slug}] non-ArcGIS source_kind '{src.get('source_kind')}' — skipping (use a different loader)")
        return {"slug": slug, "ok": False, "error": "non_arcgis", "inserted": 0}
    base_url = src["endpoint_url"]
    if not src.get("field_map"):
        print(f"[{slug}] empty field_map — skipping (operator must populate first)")
        return {"slug": slug, "ok": False, "error": "empty_field_map", "inserted": 0}

    total_inserted = 0
    for page in range(max_pages):
        offset = page * page_size
        parsed = fetch_page(base_url, offset, page_size, slug)
        if parsed is None:
            return {"slug": slug, "ok": False, "error": "fetch_failed", "inserted": total_inserted}
        features = parsed.get("features", [])
        rows = [f.get("attributes", {}) for f in features if isinstance(f, dict)]
        if not rows:
            print(f"[{slug}] page {page+1} empty — done")
            break
        normalized = [n for n in (normalize(r, src) for r in rows) if n]
        if normalized:
            try:
                supabase_post("/parcels_sidecar?on_conflict=state_code,source_parcel_id", normalized)
                total_inserted += len(normalized)
            except (HTTPError, URLError) as e:
                print(f"[{slug}] upsert failed page {page+1}: {e}", file=sys.stderr)
                return {"slug": slug, "ok": False, "error": "upsert_failed", "inserted": total_inserted}
        print(f"[{slug}] page {page+1}: {len(rows)} fetched, {len(normalized)} normalized, {total_inserted} total inserted")
        if not parsed.get("exceededTransferLimit") and len(rows) < page_size:
            print(f"[{slug}] last page (no exceededTransferLimit, partial page)")
            break
        time.sleep(0.5)

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {total_inserted} in {elapsed:.1f}s")

    # Update parcel_sources bookkeeping.
    try:
        supabase_patch(
            "/parcel_sources",
            {
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "last_count": total_inserted,
                "error_count": 0,
            },
            f"source_key=eq.{slug}",
        )
    except (HTTPError, URLError) as e:
        print(f"[{slug}] bookkeeping update failed: {e}", file=sys.stderr)

    return {"slug": slug, "ok": True, "inserted": total_inserted, "elapsed_s": round(elapsed, 1)}


# ── main ─────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="Phase-5 ArcGIS parcel loader for Henri sidecar.")
    parser.add_argument("target", help="source_key or '--all-enabled'.")
    parser.add_argument("--max-pages", type=int, default=25,
                        help="Max pages per source per run (default: 25).")
    parser.add_argument("--page-size", type=int, default=2000,
                        help="ArcGIS resultRecordCount per page (default: 2000).")
    args = parser.parse_args()

    sources = fetch_sources(args.target)
    print(f"[loader] running {len(sources)} parcel source(s)")
    results = []
    for src in sources:
        results.append(run_one(src, args.max_pages, args.page_size))
        time.sleep(1.0)  # be polite — ArcGIS hosts share infrastructure
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total}; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
