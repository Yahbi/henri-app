"""
NYC ACRIS Real Property Master loader — recorder events.

Fetches NYC ACRIS Socrata records (DEED, MTGE, SAT, LP/NLP, FORECLOSURE)
and upserts them into `recorder_events`. Pattern replicates to King County
WA Socrata foreclosures via --source=king-wa.

Why this matters:
  - DEED: new owner, will likely renovate within 18 months
  - MTGE: new mortgage / HELOC / cash-out → remodel funding signal
  - SAT: mortgage payoff → likely refi or sale within 60 days
  - LP / NLP: Lis Pendens = pre-foreclosure distress (~6-9mo lead time)

Endpoint:
  https://data.cityofnewyork.us/resource/bnx9-e6tj.json

Daily refresh. ~10M+ records total; we paginate by recorded_date for
incremental sync.

Usage:
  python load_acris.py --since=2026-04-01           # since date
  python load_acris.py --days-back=7                # last 7 days
  python load_acris.py --doc-types=DEED,SAT,LP      # filter to types

Cron schedule (Hetzner):
  0 7 * * * load_acris.py --days-back=3
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

SOURCES = {
    "nyc-acris": {
        "url": "https://data.cityofnewyork.us/resource/bnx9-e6tj.json",
        "source_key": "NY-NYC-ACRIS",
        "state": "NY",
        "county": "NYC",
        "date_field": "recorded_filed",
    },
    "king-wa": {
        "url": "https://data.kingcounty.gov/resource/nx4x-daw6.json",
        "source_key": "WA-KING-COUNTY",
        "state": "WA",
        "county": "King",
        "date_field": "filing_date",
    },
}

BATCH_LIMIT = 1000


def fetch_page(source: Dict[str, Any], since: str, offset: int) -> List[Dict[str, Any]]:
    where = f"{source['date_field']} >= '{since}'"
    params = {
        "$limit": str(BATCH_LIMIT),
        "$offset": str(offset),
        "$where": where,
        "$order": f"{source['date_field']} DESC",
    }
    url = f"{source['url']}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Henri-Loader/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"[acris] HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        return []


def normalize_nyc(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    doc_id = row.get("document_id")
    if not doc_id:
        return None
    return {
        "source_key": "NY-NYC-ACRIS",
        "document_id": str(doc_id),
        "doc_type": (row.get("doc_type") or "MISC").upper(),
        "doc_date": _date(row.get("document_date")),
        "doc_amount": _num(row.get("document_amt")),
        "recorded_date": _date(row.get("recorded_filed")),
        "state_code": "NY",
        "county": "NYC",
        "city": _borough(row.get("borough")),
        "parcel_id": row.get("bbl") or _bbl(row),
        "raw_json": row,
    }


def normalize_king_wa(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    doc_id = row.get("excise_number") or row.get("instrument_number")
    if not doc_id:
        return None
    return {
        "source_key": "WA-KING-COUNTY",
        "document_id": str(doc_id),
        "doc_type": "FORECLOSURE",
        "doc_date": _date(row.get("filing_date")),
        "doc_amount": _num(row.get("amount")),
        "recorded_date": _date(row.get("filing_date")),
        "state_code": "WA",
        "county": "King",
        "parcel_id": row.get("apn") or row.get("parcel_id"),
        "address": row.get("situs_address"),
        "raw_json": row,
    }


def _date(v: Any) -> Optional[str]:
    if not v:
        return None
    try:
        return str(v)[:10]
    except Exception:
        return None


def _num(v: Any) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


_BOROUGH_MAP = {"1": "Manhattan", "2": "Bronx", "3": "Brooklyn", "4": "Queens", "5": "Staten Island"}
def _borough(v: Any) -> Optional[str]:
    if not v:
        return None
    return _BOROUGH_MAP.get(str(v), str(v))


def _bbl(row: Dict[str, Any]) -> Optional[str]:
    b, block, lot = row.get("borough"), row.get("block"), row.get("lot")
    if b and block and lot:
        return f"{b}{int(block):05d}{int(lot):04d}"
    return None


def upsert(rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/recorder_events?on_conflict=source_key,document_id"
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
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
        with urllib.request.urlopen(req, timeout=60) as r:
            return len(rows) if r.status in (200, 201, 204) else 0
    except urllib.error.HTTPError as e:
        print(f"[acris] upsert failed HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="nyc-acris", choices=list(SOURCES.keys()))
    ap.add_argument("--since", type=str, help="ISO date (YYYY-MM-DD)")
    ap.add_argument("--days-back", type=int, default=7)
    ap.add_argument("--doc-types", type=str, default="", help="Comma-separated filter (NYC only)")
    args = ap.parse_args()

    source = SOURCES[args.source]
    since = args.since or (date.today() - timedelta(days=args.days_back)).isoformat()
    doc_types_filter = {t.strip().upper() for t in args.doc_types.split(",") if t.strip()}

    normalize = normalize_nyc if args.source == "nyc-acris" else normalize_king_wa

    total_pulled = 0
    total_inserted = 0
    offset = 0
    while True:
        page = fetch_page(source, since, offset)
        if not page:
            break
        total_pulled += len(page)
        rows = []
        for raw in page:
            r = normalize(raw)
            if r and (not doc_types_filter or r["doc_type"] in doc_types_filter):
                rows.append(r)
        total_inserted += upsert(rows)
        if len(page) < BATCH_LIMIT:
            break
        offset += BATCH_LIMIT
        time.sleep(0.3)

    print(f"[acris/{args.source}] DONE — pulled {total_pulled} / inserted {total_inserted} since {since}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
