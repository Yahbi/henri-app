"""
Quick probe for an unknown Socrata permit endpoint.

Given a Socrata JSON URL, fetches one row and prints all column names
plus the values of the most-likely-relevant fields. Use this to build
a config for load_socrata.py without trial-and-error.

Run:
    python probe_socrata.py "https://data.someoityopendata.gov/resource/abcd-efgh.json"
"""
from __future__ import annotations

import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

LIKELY_FIELDS = [
    "permit_number", "permit_no", "permitnum", "permit_id", "permitid",
    "issued_date", "issuedate", "issue_date", "applieddate", "applied_date",
    "permit_type", "permit_type_desc", "permittype", "permit_class", "work_class",
    "status_current", "status", "current_status",
    "address", "original_address1", "site_address", "permit_location",
    "zip", "original_zip", "zipcode",
    "description", "scope_of_work", "permit_description",
    "estimated_value", "declared_valuation", "valuation", "estimated_cost",
    "applicant_full_name", "applicant", "owner_name",
    "contractor_company_name", "contractor_name", "contractor",
    "city", "state",
]


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python probe_socrata.py <socrata-json-url>", file=sys.stderr)
        return 2
    base = sys.argv[1].rstrip("?&")
    sep = "?" if "?" not in base else "&"
    url = f"{base}{sep}$limit=1"
    print(f"GET {url}")
    req = Request(url, headers={"User-Agent": "henri-probe/1.0"})
    try:
        body = urlopen(req, timeout=30).read()
    except HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
        return 1
    rows = json.loads(body)
    if not rows:
        print("Empty result.")
        return 0
    row = rows[0]
    print(f"\nAll {len(row)} keys (alphabetized):")
    for k in sorted(row.keys()):
        v = row[k]
        if isinstance(v, dict):
            v = "<dict>"
        sv = str(v)[:80]
        print(f"  {k:<35} = {sv}")

    print("\nLikely-Henri-relevant fields present:")
    for k in LIKELY_FIELDS:
        if k in row:
            v = str(row[k])[:60]
            print(f"  ✓ {k:<35} = {v}")
        # also fuzzy match
    print("\nUse the keys above to build a YAML config under configs/<slug>.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
