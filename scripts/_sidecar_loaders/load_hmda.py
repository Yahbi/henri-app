"""
HMDA loan-level loader — pre-permit demand signal.

Fetches HMDA (Home Mortgage Disclosure Act) loan-level records from the
CFPB Data Browser API and upserts them into `mortgage_originations`.

Why this matters: a homeowner who took a cash-out refinance (loan_purpose=32)
or home-improvement loan (loan_purpose=2) has a 30-60% probability of
pulling a permit within 6 months. This is the single highest-leverage
pre-permit demand signal available on free national data.

Endpoint:
  https://ffiec.cfpb.gov/v2/data-browser-api/view/nationwide/csv

Filters to home-improvement / refi / cash-out + originated loans only
(action_taken=1). Records returned at census-tract grain.

Usage:
  # Pull a single state-year for incremental updates
  python load_hmda.py --year=2023 --state=TX

  # Pull every state for one year (annual bulk, slow ~30-60 min)
  python load_hmda.py --year=2023 --all-states

Cron schedule (Hetzner):
  0 5 1 * * load_hmda.py --year=$(date +%Y) --all-states
  # Monthly on the 1st at 05:00 UTC, picks up current-year deltas
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

API_BASE = "https://ffiec.cfpb.gov/v2/data-browser-api/view/nationwide/csv"

# Henri-relevant loan purposes:
#   1  = Home purchase
#   2  = Home improvement
#   31 = Refinancing
#   32 = Cash-out refinancing
RELEVANT_PURPOSES = {"2", "31", "32"}

# action_taken=1 → loan was originated (vs. denied/withdrawn/etc.)
RELEVANT_ACTIONS = {"1"}

US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC"
]


def fetch_state_year(state: str, year: int) -> List[Dict[str, str]]:
    """Stream the CFPB nationwide CSV filtered to one state-year."""
    url = (
        f"{API_BASE}?years={year}&states={state}"
        f"&actions_taken=1"  # originated only
        f"&loan_purposes=2,31,32"  # home-improvement + refi + cash-out
    )
    print(f"[hmda] GET {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Henri-Loader/1.0"})
    rows: List[Dict[str, str]] = []
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"[hmda] HTTP {e.code} on {state}/{year} — skipping", file=sys.stderr)
        return []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        if row.get("loan_purpose") in RELEVANT_PURPOSES and row.get("action_taken") in RELEVANT_ACTIONS:
            rows.append(row)
    print(f"[hmda] {state}/{year}: {len(rows)} relevant rows")
    return rows


def normalize(row: Dict[str, str], year: int) -> Optional[Dict[str, Any]]:
    """Map HMDA CSV row to mortgage_originations canonical schema."""
    def i(key: str) -> Optional[int]:
        v = row.get(key)
        if v in (None, "", "Exempt", "NA"):
            return None
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return None

    def s(key: str) -> Optional[str]:
        v = row.get(key)
        return v if v not in (None, "", "Exempt", "NA") else None

    return {
        "activity_year": year,
        "lei": s("lei"),
        "loan_type": i("loan_type"),
        "loan_purpose": i("loan_purpose"),
        "loan_amount": i("loan_amount"),
        "property_value": i("property_value"),
        "state_code": s("state_code"),
        "county_code": s("county_code"),
        "census_tract": s("census_tract"),
        "msa_md": s("derived_msa_md"),
        "applicant_income": i("income"),
        "action_taken": i("action_taken"),
        "denial_reason_1": s("denial_reason_1"),
        "raw_json": row,
    }


def upsert_batch(rows: List[Dict[str, Any]], batch_size: int = 500) -> int:
    """Bulk INSERT to mortgage_originations via PostgREST."""
    if not rows:
        return 0
    inserted = 0
    url = f"{SUPABASE_URL}/rest/v1/mortgage_originations"
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        body = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status in (201, 204, 200):
                    inserted += len(chunk)
                else:
                    print(f"[hmda] insert batch returned status {r.status}", file=sys.stderr)
        except urllib.error.HTTPError as e:
            print(f"[hmda] insert batch failed: HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        time.sleep(0.2)
    return inserted


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--state", type=str, help="Single state (e.g. TX)")
    ap.add_argument("--all-states", action="store_true")
    args = ap.parse_args()

    if not args.state and not args.all_states:
        print("Pass --state=XX or --all-states", file=sys.stderr)
        return 2

    targets = US_STATES if args.all_states else [args.state.upper()]
    total_pulled = 0
    total_inserted = 0
    for state in targets:
        rows = fetch_state_year(state, args.year)
        total_pulled += len(rows)
        normalized = [r for r in (normalize(r, args.year) for r in rows) if r]
        total_inserted += upsert_batch(normalized)
        time.sleep(0.5)

    print(f"[hmda] DONE — pulled {total_pulled} / inserted {total_inserted} across {len(targets)} state(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
