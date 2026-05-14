"""
CFPB Consumer Complaint Database loader — enforcement signals.

Fetches CFPB consumer complaints REST API and upserts them into
`enforcement_actions` filtered to contractor-adjacent categories.

Why this matters: financial-products complaints often catch contractors
that state license boards haven't disciplined yet. PACE-financed
renovation fraud, mortgage-fraud-adjacent contractor scams, etc.

1,085,449 confirmed records as of 2026-05-12 per v2 audit.

Endpoint:
  https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/

Usage:
  python load_cfpb_complaints.py --since=2026-01-01
  python load_cfpb_complaints.py --days-back=30

Cron schedule (Hetzner):
  0 6 * * * load_cfpb_complaints.py --days-back=2
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
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

API_BASE = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"

# CFPB product categories with high contractor-adjacency
RELEVANT_PRODUCTS = [
    "Mortgage",
    "Debt collection",
    "Credit card or prepaid card",
    "Consumer Loan",
    "Payday loan, title loan, or personal loan",
]

PAGE_SIZE = 1000


def fetch_page(since: str, frm: int) -> List[Dict[str, Any]]:
    params = {
        "date_received_min": since,
        "size": str(PAGE_SIZE),
        "frm": str(frm),
        "product": RELEVANT_PRODUCTS,
        "format": "json",
    }
    url = f"{API_BASE}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Henri-Loader/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"[cfpb] HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        return []
    hits = body.get("hits", {}).get("hits", [])
    return [h.get("_source", {}) for h in hits]


def normalize(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    case_number = row.get("complaint_id")
    if not case_number:
        return None
    return {
        "source": "cfpb",
        "action_date": _date(row.get("date_received")),
        "defendant_name": row.get("company"),
        "case_number": str(case_number),
        "enforcement_type": row.get("product") or "complaint",
        "statute": row.get("issue"),
        "jurisdiction": row.get("state") or "US",
        "industry_category": "financial",
        "summary": (row.get("complaint_what_happened") or row.get("sub_issue") or "")[:1000] or None,
        "source_url": f"https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/{case_number}",
        "raw_json": row,
    }


def _date(v: Any) -> Optional[str]:
    if not v:
        return None
    return str(v)[:10]


def upsert(rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/enforcement_actions?on_conflict=source,case_number"
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
        print(f"[cfpb] upsert failed HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=str, help="ISO date YYYY-MM-DD")
    ap.add_argument("--days-back", type=int, default=30)
    args = ap.parse_args()

    since = args.since or (date.today() - timedelta(days=args.days_back)).isoformat()

    total_pulled = 0
    total_inserted = 0
    frm = 0
    while True:
        page = fetch_page(since, frm)
        if not page:
            break
        total_pulled += len(page)
        rows = [r for r in (normalize(r) for r in page) if r]
        total_inserted += upsert(rows)
        if len(page) < PAGE_SIZE:
            break
        frm += PAGE_SIZE
        time.sleep(0.5)

    print(f"[cfpb] DONE — pulled {total_pulled} / inserted {total_inserted} since {since}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
