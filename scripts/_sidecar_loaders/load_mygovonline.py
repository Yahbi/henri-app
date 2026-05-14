"""
MyGovernmentOnline permit loader — Tier 5 stale-state unlock.

Per Tier-2 research (research/tier2_platform_inventory.md), MyGovernmentOnline
(MGO) is the dominant permit-portal vendor across Mississippi Gulf-Coast
cities and chunks of Louisiana, Texas, and Alabama. Tenants share a
common URL template:

    https://www.mygovernmentonline.org/<juris-slug>

The result UI is a JS-rendered SPA backed by an internal JSON API at
/api/permits/search. The API requires a session cookie obtained on first
SPA load — Scrapling's DynamicFetcher solves both in one shot.

Run modes:
  python load_mygovonline.py gulfport-ms   # one tenant
  python load_mygovonline.py --all-mgo     # every status:verified MGO config

Each YAML config supports:
  loader: mgo                    # required for --all-mgo filter
  name: GULFPORT-MS
  city: Gulfport
  state: MS
  juris_slug: gulfport-ms        # path component after /Portal/
  date_range_days: 14
  status: unverified             # flip to 'verified' after smoke-test
  fields:                        # internal-API JSON keys → Henri schema
    permit_no:        permit_number
    issued_date:      issue_date
    address:          site_address
    description:      project_description
    permit_type:      permit_type_name
    status:           status

The internal API URL is reverse-engineered per tenant; unverified configs
ship with placeholder selectors that need first-run verification (see the
DEBUG_HTML_DUMP=1 workflow in UPLOAD.md §11).
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
from urllib.request import Request, urlopen

try:
    import yaml
except ImportError:
    print("Missing PyYAML. pip install pyyaml", file=sys.stderr)
    sys.exit(2)

from scrapling.fetchers import DynamicFetcher

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


def load_configs(target: str) -> List[Dict[str, Any]]:
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-mgo":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        cfgs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [
            c for c in cfgs
            if c
            and c.get("loader") == "mgo"
            and c.get("status") in (None, "verified")
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(CONFIG_DIR.glob(f"{target}.yaml"))
    if not files:
        raise FileNotFoundError(f"No config matched '{target}' in {CONFIG_DIR}")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    base = f"https://www.mygovernmentonline.org/{cfg['juris_slug']}"
    print(f"[{cfg['name']}] DynamicFetcher {base}")
    page = DynamicFetcher.fetch(
        base,
        headless=True,
        timeout=60000,
        wait=3,
        # SPA-only; wait for the permit-results table to appear.
        wait_selector=cfg.get("result_table_selector", 'table[id*="permit"], div.permit-list'),
        wait_selector_state="visible",
    )
    if not page or getattr(page, "status", 0) != 200:
        raise RuntimeError(f"{cfg['name']} returned {getattr(page, 'status', '?')}")

    # Two extraction strategies — try the JSON API first (faster, cleaner),
    # fall back to scraping the rendered table.
    rows = []
    # Strategy 1: look for inline JSON in a <script> tag (common SPA pattern).
    for s in (page.css("script") or []):
        text = s.text or ""
        if '"permits"' in text or '"records"' in text:
            try:
                # Find the first JSON object in the script.
                start = text.find("{")
                end = text.rfind("}")
                if start >= 0 and end > start:
                    obj = json.loads(text[start : end + 1])
                    candidates = obj.get("permits") or obj.get("records") or obj.get("data") or []
                    if isinstance(candidates, list) and candidates:
                        rows = candidates
                        break
            except (ValueError, KeyError):
                continue

    # Strategy 2: scrape the rendered table.
    if not rows:
        sel = cfg.get("result_table_selector", "table tr")
        trs = page.css(f"{sel} tr") or []
        if len(trs) > 1:
            header_cells = trs[0].css("th") or trs[0].css("td")
            headers = [h.text.strip().lower().replace(" ", "_") for h in header_cells]
            for tr in trs[1:]:
                cells = tr.css("td")
                if not cells:
                    continue
                rows.append({headers[i]: cells[i].text.strip() for i in range(min(len(headers), len(cells)))})

    print(f"[{cfg['name']}] extracted {len(rows)} rows")
    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    f = cfg.get("fields", {})
    pno = (row.get(f.get("permit_no", "")) or row.get("permit_number") or "").strip()
    if not pno:
        return None
    addr = (row.get(f.get("address", "")) or row.get("address") or "").strip()
    issued = row.get(f.get("issued_date", "")) or row.get("issue_date")
    return {
        "source_city": cfg["name"],
        "source_id": pno[:80],
        "permit_number": pno[:80],
        "address": addr[:300] or None,
        "city": cfg["city"],
        "state": cfg["state"],
        "permit_type": "other",  # downstream classifier handles
        "status": _map_status(row.get(f.get("status", "")) or row.get("status")),
        "description": (row.get(f.get("description", "")) or "")[:1000] or None,
        "issued_date": _coerce_date(issued),
        "raw_json": row,
    }


def _map_status(s: Any) -> str:
    s = (str(s or "")).lower()
    if "final" in s or "complete" in s:
        return "final"
    if "issued" in s or "active" in s:
        return "issued"
    if "expired" in s:
        return "expired"
    if "approve" in s:
        return "approved"
    if "void" in s or "revoked" in s:
        return "revoked"
    return "submitted"


def _coerce_date(s: Any) -> Optional[str]:
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def upsert(rows: List[Dict[str, Any]], slug: str) -> int:
    if not rows:
        return 0
    url = SUPABASE_URL + "/rest/v1/permits?on_conflict=source_city,source_id"
    req = Request(
        url,
        data=json.dumps(rows).encode("utf-8"),
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
    inserted = upsert(normalized, slug)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {"name": slug, "ok": True, "inserted": inserted, "elapsed_s": round(elapsed, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description="MyGovernmentOnline (MGO) permit loader.")
    parser.add_argument("target", help="Slug (e.g. gulfport-ms) or '--all-mgo'.")
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} MGO config(s) from {CONFIG_DIR}")
    results = []
    for cfg in configs:
        results.append(run_one(cfg))
        time.sleep(1.0)
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL: {total} across {len(results)}; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
