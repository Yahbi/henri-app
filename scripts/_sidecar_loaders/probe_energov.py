"""
Quick probe for an unknown Tyler EnerGov permit endpoint.

Given a base URL + search path + payload (matching the YAML config
shape used by load_energov.py), POSTs the search and prints all
column names plus the values of the most-likely-relevant fields.
Use this to build a config without trial-and-error or DevTools.

Run:
    python probe_energov.py \\
      "https://<jurisdiction>.tylerportico.com" \\
      "/api/v2/Records/Search"

A default last-7-days payload is used unless --payload <json-file>
is passed. For most Tyler tenants the defaults work; if a city's
endpoint requires extra fields (some need `clientId`, `agencyCode`,
or non-standard moduleId values), copy the curl from the browser
DevTools Network tab and pass it as --payload.

The output is the standard EnerGov keys + values for the first
record. Use the keys to fill the `fields:` block in the YAML.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

LIKELY_FIELDS = [
    # Tyler EnerGov canonical names — verified against ~5 tenants
    "recordNumber", "recordId", "permitNumber",
    "issuedDate", "issueDate", "appliedDate", "openedDate",
    "recordType", "recordTypeName", "permitType",
    "status", "statusName",
    "address", "fullAddress", "siteAddress",
    "postalCode", "zip", "zipCode",
    "description", "shortDescription",
    "jobValue", "valuation", "estimatedValue",
    "applicantName", "applicant",
    "contractorName", "contractor", "primaryContractorName",
    "city", "state",
]


def default_payload() -> dict:
    now = datetime.now(timezone.utc)
    return {
        "moduleId": 1,
        "fromDate": (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S"),
        "toDate": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "pageSize": 1,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Probe a Tyler EnerGov endpoint.")
    ap.add_argument("base_url", help="e.g. https://city.tylerportico.com")
    ap.add_argument("search_path", help="e.g. /api/v2/Records/Search")
    ap.add_argument(
        "--payload",
        help="Path to a JSON file with the POST body. Default: last 7 days, "
        "moduleId=1, pageSize=1.",
        default=None,
    )
    args = ap.parse_args()

    if args.payload:
        try:
            with open(args.payload, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            print(f"Failed to read payload file: {e}", file=sys.stderr)
            return 2
    else:
        payload = default_payload()

    url = args.base_url.rstrip("/") + args.search_path
    body = json.dumps(payload).encode("utf-8")
    print(f"POST {url}")
    print(f"payload: {json.dumps(payload)}")

    req = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "henri-probe/1.0",
        },
    )
    try:
        resp = urlopen(req, timeout=30).read()
    except HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
        return 1

    parsed = json.loads(resp)

    rows = None
    for path_guess in ("data", "results", "records", "items"):
        candidate = parsed.get(path_guess) if isinstance(parsed, dict) else None
        if isinstance(candidate, list):
            rows = candidate
            print(f"\n[probe] resolved data_path = '{path_guess}' "
                  f"(found {len(candidate)} rows)")
            break
    if rows is None and isinstance(parsed, list):
        rows = parsed
        print("\n[probe] response is a top-level array; data_path not needed")
    if rows is None:
        print("\nCould not auto-locate the records array. Top-level keys:")
        if isinstance(parsed, dict):
            for k in parsed.keys():
                print(f"  {k}")
        return 1

    if not rows:
        print("Empty result. Try --payload with a wider date range.")
        return 0

    row = rows[0]
    print(f"\nAll {len(row)} keys (alphabetized):")
    for k in sorted(row.keys()):
        v = row[k]
        if isinstance(v, dict):
            v = "<dict>"
        elif isinstance(v, list):
            v = f"<list[{len(v)}]>"
        sv = str(v)[:80]
        print(f"  {k:<35} = {sv}")

    print("\nLikely-Henri-relevant fields present:")
    for k in LIKELY_FIELDS:
        if k in row:
            v = str(row[k])[:60]
            print(f"  YES  {k:<35} = {v}")
    print("\nUse the keys above to fill the `fields:` block of "
          "configs/<slug>-energov.yml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
