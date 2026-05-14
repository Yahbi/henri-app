"""
Generic county-recorder lien loader — Tier 6 of the data-gap brief.

Mechanic's liens are RECORDED INSTRUMENTS at county recorders of deeds,
NOT court filings — CourtListener only catches the ~5-15% that escalate
to foreclosure. This loader hits state-level recorder aggregators (where
they exist) and per-county recorder portals (everywhere else).

The first verified-live aggregator is Georgia's gsccca.org Lien Index —
the single best statewide mechanic's-lien data source in the US (free,
statewide, dedicated lien filter, name + county searchable).

Run modes:
  python load_lien_recorder.py ga-gsccca        # one source
  python load_lien_recorder.py --all-recorder   # every recorder config

Each YAML config supports:
  loader: lien_recorder            # required; filters --all-recorder
  name: GA-GSCCCA                  # source name
  state: GA
  source_id: gsccca                # short slug for `source` column
  base_url: https://search.gsccca.org/lien/lienindex.asp
  search_path: /lien/lienindex.asp
  date_range_days: 14
  result_table_selector: '#tblResults'   # CSS for the results table
  cloudflare: false                       # use DynamicFetcher anti-bot if true
  fields:                                  # 0-indexed column positions
    recording_id:    0
    recording_date:  1
    debtor_name:     2
    claimant_name:   3
    instrument_type: 4
    property_address: 5
    lien_amount:     6

This is a Phase-4-style loader (HTML scrape with form-state) not a Socrata
drop-in, so it ships as DynamicFetcher when cloudflare:true and Fetcher
otherwise. See research/tier4_owner_occupied_AND_tier6_lien_portals.md
for the full per-state catalog of recorder sources.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import yaml
except ImportError:
    print("Missing PyYAML. pip install pyyaml", file=sys.stderr)
    sys.exit(2)

from scrapling.fetchers import Fetcher, DynamicFetcher

# ── env ────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

CONFIG_DIR = Path(os.environ.get(
    "SCRAPLING_CONFIG_DIR",
    str(Path.home() / "scrapling_loaders" / "configs"),
))


# ── helpers ────────────────────────────────────────────────────────────
def load_configs(target: str) -> List[Dict[str, Any]]:
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-recorder":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        # Only this loader's configs, only verified.
        return [
            c for c in configs
            if c
            and c.get("loader") == "lien_recorder"
            and c.get("status") in (None, "verified")
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(CONFIG_DIR.glob(f"{target}.yaml"))
    if not files:
        raise FileNotFoundError(f"No config matched '{target}' in {CONFIG_DIR}")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


_AMOUNT_RE = re.compile(r"[\d,.]+")


def parse_amount(text: Any) -> Optional[float]:
    if not text:
        return None
    m = _AMOUNT_RE.search(str(text))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def parse_date(text: Any) -> Optional[str]:
    """Accept MM/DD/YYYY or YYYY-MM-DD. Returns ISO YYYY-MM-DD or None."""
    if not text:
        return None
    s = str(text).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ── core ───────────────────────────────────────────────────────────────
def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Drive the recorder's search form and harvest the results table."""
    url = cfg["base_url"].rstrip("/") + cfg.get("search_path", "")
    use_dynamic = bool(cfg.get("cloudflare"))
    days = cfg.get("date_range_days", 14)
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    print(f"[{cfg['name']}] fetching {start} … {end}  via {'DynamicFetcher' if use_dynamic else 'Fetcher'}")

    if use_dynamic:
        page = DynamicFetcher.fetch(
            url,
            headless=True,
            disable_resources=False,
            timeout=60000,
            wait=2,
            wait_selector=cfg.get("result_table_selector"),
            wait_selector_state="visible",
        )
    else:
        page = Fetcher.get(url, stealthy_headers=True)

    if not page or getattr(page, "status", 0) != 200:
        body_preview = (getattr(page, "body", "") or b"")[:200] if page else "no page"
        raise RuntimeError(f"{cfg['name']} returned {getattr(page, 'status', '?')}: {body_preview!r}")

    rows = page.css(f"{cfg['result_table_selector']} tr") or []
    if len(rows) <= 1:
        return []

    # Column-index → field-name mapping from YAML.
    fmap = cfg.get("fields", {})
    out: List[Dict[str, Any]] = []
    for tr in rows[1:]:
        cells = tr.css("td")
        if not cells:
            continue
        rec: Dict[str, Any] = {}
        for fname, idx in fmap.items():
            if idx < len(cells):
                rec[fname] = cells[idx].text.strip()
        out.append(rec)
    print(f"[{cfg['name']}] parsed {len(out)} rows")
    return out


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rid = (row.get("recording_id") or "").strip()
    if not rid:
        return None
    return {
        "recording_id":     rid,
        "recording_state":  cfg["state"],
        "recording_county": row.get("recording_county") or cfg.get("county"),
        "recording_date":   parse_date(row.get("recording_date")),
        "claimant_name":    (row.get("claimant_name") or "").strip()[:300] or None,
        "debtor_name":      (row.get("debtor_name") or "").strip()[:300] or None,
        "property_address": (row.get("property_address") or "").strip()[:500] or None,
        "property_city":    row.get("property_city"),
        "property_zip":     row.get("property_zip"),
        "lien_amount":      parse_amount(row.get("lien_amount")),
        "instrument_type":  (row.get("instrument_type") or "").strip()[:100] or None,
        "source":           cfg["source_id"],
        "source_url":       row.get("source_url"),
        "raw_json":         row,
    }


def upsert(rows: List[Dict[str, Any]], slug: str) -> int:
    if not rows:
        return 0
    # Conflict on (recording_state, recording_id) — composite uniqueness
    # from migration 00084.
    url = SUPABASE_URL + "/rest/v1/liens_county_recorder?on_conflict=recording_state,recording_id"
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
    print(f"[{slug}] normalized {len(normalized)} liens")
    inserted = upsert(normalized, slug)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {"name": slug, "ok": True, "inserted": inserted, "elapsed_s": round(elapsed, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description="County-recorder mechanic's-lien loader.")
    parser.add_argument("target", help="Slug (e.g. ga-gsccca) or '--all-recorder'.")
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} config(s) from {CONFIG_DIR}")
    results = []
    for cfg in configs:
        results.append(run_one(cfg))
        time.sleep(1.0)
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total} across {len(results)}; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
