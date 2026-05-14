"""
WA L&I Debarred Contractors loader — contractor-trust signal.

Scrapes the WA Department of Labor & Industries' debarred-contractors
HTML page and upserts records into `discipline_actions` with
is_active_bar=true.

Why this matters: WA publishes a small (<500 row) but high-signal list
of currently-barred contractors. The pattern explicitly replicates to
CSLB CA Disciplinary Actions Library + OR CCB final orders + TDLR TX
Enforcement Monthly PDFs.

Endpoint:
  https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx

Usage:
  python load_wa_li_debar.py

Cron schedule (Hetzner):
  0 10 * * 1 load_wa_li_debar.py
  # Weekly Monday 10:00 UTC
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

DEBAR_URL = "https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx"


class DebarTableParser(HTMLParser):
    """Minimal table-row extractor — pulls (contractor_name, license_number,
    debar_date, expiration_date) tuples from the debar list HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.current_row: List[str] = []
        self.current_cell: str = ""
        self.rows: List[List[str]] = []

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "table":
            attr_dict = dict(attrs)
            cls = attr_dict.get("class") or attr_dict.get("id") or ""
            if "debar" in cls.lower() or "contractor" in cls.lower() or self.in_table is False:
                self.in_table = True
        elif tag == "tr" and self.in_table:
            self.in_row = True
            self.current_row = []
        elif tag in ("td", "th") and self.in_row:
            self.in_cell = True
            self.current_cell = ""

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self.in_cell:
            self.current_row.append(self.current_cell.strip())
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            if self.current_row:
                self.rows.append(self.current_row)
            self.in_row = False
        elif tag == "table":
            self.in_table = False

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_cell += data


def fetch_html() -> str:
    print(f"[wa-li-debar] GET {DEBAR_URL}")
    req = urllib.request.Request(
        DEBAR_URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


# Heuristic header patterns — the page columns we want to map onto
HEADER_HINTS = {
    "contractor": "contractor_name",
    "business": "business_name",
    "license": "license_number",
    "registration": "license_number",
    "debar": "action_date",
    "effective": "action_date",
    "expir": "expiration_date",
    "reason": "description",
    "violation": "description",
}


def parse_rows(html: str) -> List[Dict[str, str]]:
    p = DebarTableParser()
    p.feed(html)
    if not p.rows:
        return []
    # First row should be headers; if it isn't, the table won't map cleanly
    headers = p.rows[0]
    field_idx: Dict[str, int] = {}
    for i, h in enumerate(headers):
        h_lower = h.lower()
        for hint, canon in HEADER_HINTS.items():
            if hint in h_lower and canon not in field_idx:
                field_idx[canon] = i
                break

    if not field_idx.get("contractor_name") and not field_idx.get("business_name"):
        # Page schema shifted; bail rather than write garbage
        print(f"[wa-li-debar] WARN: could not map columns; headers were {headers}", file=sys.stderr)
        return []

    out: List[Dict[str, str]] = []
    for row in p.rows[1:]:
        if len(row) < max(field_idx.values()) + 1:
            continue
        rec: Dict[str, str] = {}
        for canon, idx in field_idx.items():
            rec[canon] = row[idx]
        out.append(rec)
    return out


def normalize(row: Dict[str, str]) -> Optional[Dict[str, Any]]:
    name = (row.get("contractor_name") or row.get("business_name") or "").strip()
    if not name:
        return None
    license_num = (row.get("license_number") or "").strip() or None
    action_date = _parse_date(row.get("action_date"))
    return {
        "state_code": "WA",
        "source_key": "WA-LI-DEBAR",
        "license_number": license_num,
        "contractor_name": name,
        "business_name": (row.get("business_name") or name) if "business_name" in row else None,
        "action_date": action_date,
        "action_type": "debarment",
        "description": row.get("description") or "Contractor debarred by WA L&I",
        "is_active_bar": True,
        "source_url": DEBAR_URL,
        "raw_json": row,
    }


_DATE_PATTERN = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")


def _parse_date(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    m = _DATE_PATTERN.search(v)
    if not m:
        return None
    mm, dd, yy = m.group(1), m.group(2), m.group(3)
    if len(yy) == 2:
        yy = ("20" if int(yy) < 50 else "19") + yy
    try:
        return f"{int(yy):04d}-{int(mm):02d}-{int(dd):02d}"
    except ValueError:
        return None


def upsert(rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/discipline_actions"
    body = json.dumps(rows).encode("utf-8")
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
            return len(rows) if r.status in (200, 201, 204) else 0
    except urllib.error.HTTPError as e:
        print(f"[wa-li-debar] upsert failed HTTP {e.code} — {e.read()[:300].decode('utf-8','replace')}", file=sys.stderr)
        return 0


def main() -> int:
    html = fetch_html()
    rows = parse_rows(html)
    print(f"[wa-li-debar] parsed {len(rows)} rows from HTML table")
    normalized = [r for r in (normalize(r) for r in rows) if r]
    inserted = upsert(normalized)
    print(f"[wa-li-debar] DONE — inserted {inserted} debarments")
    return 0


if __name__ == "__main__":
    sys.exit(main())
