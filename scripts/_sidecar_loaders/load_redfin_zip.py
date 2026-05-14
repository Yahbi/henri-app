"""
Redfin Data Center ZIP Tracker loader — real-estate market metrics.

Fetches Redfin's weekly ZIP-level market-tracker TSV from S3 and upserts
into `market_metrics_zip`.

Why this matters: high `new_listing_count` + `price_reduced_count` in
a ZIP signals churn. New buyers tend to renovate within 18 months.
Demand metrics also feed territory pricing for Henri's contractor tiers.

Endpoint:
  https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz

101MB gzipped, weekly refresh.

Usage:
  python load_redfin_zip.py
  python load_redfin_zip.py --since-weeks=4   # only recent windows

Cron schedule (Hetzner):
  0 9 * * 1 load_redfin_zip.py
  # Monday 09:00 UTC, after Redfin's weekly publish
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

REDFIN_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
)

BATCH_SIZE = 1000


def fetch_decompress() -> io.StringIO:
    print(f"[redfin] GET {REDFIN_URL}")
    req = urllib.request.Request(REDFIN_URL, headers={"User-Agent": "Henri-Loader/1.0"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        compressed = resp.read()
    print(f"[redfin] received {len(compressed) // 1024 // 1024} MB gzip")
    decompressed = gzip.decompress(compressed).decode("utf-8", errors="replace")
    return io.StringIO(decompressed)


def normalize(row: Dict[str, str]) -> Optional[Dict[str, Any]]:
    zip_code = (row.get("region") or "").replace("Zip Code: ", "").strip()
    if not zip_code or len(zip_code) != 5 or not zip_code.isdigit():
        return None
    period_date = _date(row.get("period_end"))
    if not period_date:
        return None
    return {
        "zip": zip_code,
        "period_date": period_date,
        "source": "redfin",
        "median_list_price": _num(row.get("median_list_price")),
        "median_sale_price": _num(row.get("median_sale_price")),
        "median_days_on_market": _int(row.get("median_dom")),
        "new_listing_count": _int(row.get("new_listings")),
        "price_reduced_count": _int(row.get("price_drops")),
        "inventory_count": _int(row.get("inventory")),
        "pending_count": _int(row.get("pending_sales")),
        "raw_json": {k: v for k, v in row.items() if v not in (None, "")},
    }


def _date(v: Any) -> Optional[str]:
    if not v:
        return None
    return str(v)[:10]


def _num(v: Any) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _int(v: Any) -> Optional[int]:
    f = _num(v)
    if f is None:
        return None
    return int(f)


def upsert(rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/market_metrics_zip?on_conflict=zip,period_date,source"
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
        with urllib.request.urlopen(req, timeout=120) as r:
            return len(rows) if r.status in (200, 201, 204) else 0
    except urllib.error.HTTPError as e:
        print(f"[redfin] upsert failed HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-weeks", type=int, default=0, help="0 = all rows in file")
    args = ap.parse_args()

    cutoff = None
    if args.since_weeks > 0:
        cutoff = (date.today() - timedelta(weeks=args.since_weeks)).isoformat()

    stream = fetch_decompress()
    reader = csv.DictReader(stream, delimiter="\t")
    total_pulled = 0
    total_inserted = 0
    batch: List[Dict[str, Any]] = []

    for raw in reader:
        total_pulled += 1
        norm = normalize(raw)
        if not norm:
            continue
        if cutoff and norm["period_date"] < cutoff:
            continue
        batch.append(norm)
        if len(batch) >= BATCH_SIZE:
            total_inserted += upsert(batch)
            batch = []
            time.sleep(0.2)

    if batch:
        total_inserted += upsert(batch)

    print(f"[redfin] DONE — pulled {total_pulled} rows / inserted {total_inserted} ZIP-period rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
