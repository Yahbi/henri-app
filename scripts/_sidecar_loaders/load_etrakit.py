"""
Tyler eTRAKiT scraper — Phase 4 platform adapter.

eTRAKiT is Tyler's older citizen-permit portal (predecessor to the
modern Tyler EnerGov / Civic Access lineup). Still active for many
mid-size US cities including Portland ME and Fargo ND. Like Accela,
it's an ASP.NET WebForms app with __VIEWSTATE pagination.

Key differences from Accela:
  - URL pattern is `/etrakit3/` or `/etrakit/`, often hosted on a
    municipal subdomain (etrakit.portlandmaine.gov, not the prod
    SaaS hostname).
  - Search form lives at `/Search/permit.aspx` (not /Cap/CapHome.aspx).
  - Pagination uses LinkButtons in a different control hierarchy.
  - Many tenants restrict bulk listing — the search form requires
    SOMETHING (date range, permit type, status) before returning rows.

Verified Phase 4 candidates:
  - Portland ME (`https://www.portlandmaine.gov/1080/Permit-Search`
    backed by an ASP form)
  - Fargo ND (`https://permits.fargond.gov/Dashboard.aspx`) — hybrid
    eTRAKiT with HTML-only dashboards; `/PrmtView.aspx?ref=<id>` for
    individual permits

PHASE 4 STARTER. Selectors based on the dominant Tyler eTRAKiT
template. Smoke-test on Hetzner with DEBUG_HTML_DUMP=1 first.
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
    print("Missing PyYAML.", file=sys.stderr)
    sys.exit(2)

try:
    from scrapling.fetchers import DynamicFetcher  # type: ignore
except ImportError:
    print("Missing Scrapling. Activate ~/scrapling-env on the box.", file=sys.stderr)
    sys.exit(2)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
    sys.exit(2)

CONFIG_DIR = Path(
    os.environ.get(
        "SCRAPLING_CONFIG_DIR",
        str(Path.home() / "scrapling_loaders" / "configs"),
    )
)
DEBUG_HTML_DUMP = os.environ.get("DEBUG_HTML_DUMP") == "1"


def map_permit_type(record_type: str, description: str) -> str:
    blob = " ".join([record_type or "", description or ""]).lower()
    if "demolition" in blob:
        return "demolition"
    if "addition" in blob:
        return "addition"
    if "new" in blob and ("residential" in blob or "construction" in blob):
        return "new_construction"
    if "remodel" in blob or "renovat" in blob or "alteration" in blob:
        return "renovation"
    if "repair" in blob:
        return "repair"
    if "commercial" in blob:
        return "commercial"
    if "residential" in blob or "single family" in blob:
        return "residential"
    return "other"


def map_status(value: Optional[str]) -> str:
    s = (value or "").lower()
    if "final" in s or "closed" in s or "completed" in s:
        return "final"
    if "issued" in s or "active" in s or "open" in s:
        return "issued"
    if "approved" in s:
        return "approved"
    if "expired" in s:
        return "expired"
    if "void" in s or "revoked" in s:
        return "revoked"
    return "submitted"


def coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    s = re.sub(r"[^\d.]", "", str(v))
    try:
        return int(float(s)) if s else None
    except (TypeError, ValueError):
        return None


def load_configs(target: str) -> List[Dict[str, Any]]:
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-etrakit":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [
            c for c in configs
            if c
            and c.get("loader") == "etrakit"
            and c.get("status") in (None, "verified")
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(CONFIG_DIR.glob(f"{target}.yaml"))
    if not files:
        raise FileNotFoundError(f"No config matched '{target}'")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def scrape_tenant(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    base = cfg["base_url"].rstrip("/")
    search_url = f"{base}{cfg.get('search_path', '/Search/permit.aspx')}"
    days_back = int(cfg.get("date_range_days", 7))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    from_str = cutoff.strftime("%m/%d/%Y")
    to_str = datetime.now(timezone.utc).strftime("%m/%d/%Y")

    print(f"[{cfg['name']}] GET {search_url}  (from {from_str} → {to_str})")

    page = DynamicFetcher.fetch(
        search_url,
        headless=True,
        humanize=True,
        solve_cloudflare=cfg.get("cloudflare", False),
        block_images=True,
        wait=2000,
    )
    if page.status != 200:
        raise RuntimeError(f"{cfg['name']} initial GET {page.status}")

    fld_from = cfg.get("field_from", "cplMain_txtIssuedFrom")
    fld_to = cfg.get("field_to", "cplMain_txtIssuedTo")
    fld_submit = cfg.get("field_submit", "cplMain_btnSearch")

    try:
        page.locator(f"#{fld_from}").type(from_str, delay=20)
        page.locator(f"#{fld_to}").type(to_str, delay=20)
        page.locator(f"#{fld_submit}").click()
        page.wait_for_load_state("networkidle", timeout=30_000)
    except Exception as e:
        if DEBUG_HTML_DUMP:
            (Path.home() / f"etrakit-debug-{cfg['name']}.html").write_text(
                page.body, encoding="utf-8"
            )
        raise RuntimeError(f"{cfg['name']} form-fill failed: {e}")

    rows: List[Dict[str, Any]] = []
    table_sel = cfg.get("result_table_selector", "#cplMain_grdPermits")
    next_sel = cfg.get("next_page_selector", "a[id$='lnkNext']")
    page_num = 1

    while True:
        for tr in page.locator(f"{table_sel} tr").all():
            cells = [c.inner_text().strip() for c in tr.locator("td").all()]
            if len(cells) < 4:
                continue
            f = cfg["fields"]
            row = {
                "permit_no": cells[f["permit_no"]] if f.get("permit_no") is not None and f["permit_no"] < len(cells) else None,
                "issued_date": cells[f["issued_date"]] if f.get("issued_date") is not None and f["issued_date"] < len(cells) else None,
                "record_type": cells[f["record_type"]] if f.get("record_type") is not None and f["record_type"] < len(cells) else None,
                "description": cells[f["description"]] if f.get("description") is not None and f["description"] < len(cells) else None,
                "address": cells[f["address"]] if f.get("address") is not None and f["address"] < len(cells) else None,
                "status": cells[f["status"]] if f.get("status") is not None and f["status"] < len(cells) else None,
            }
            if row["permit_no"]:
                rows.append(row)

        try:
            next_link = page.locator(next_sel).first
            if not next_link.is_visible():
                break
            next_link.click()
            page.wait_for_load_state("networkidle", timeout=30_000)
            page_num += 1
            if page_num > int(cfg.get("max_pages", 30)):
                break
            time.sleep(0.5)
        except Exception:
            break

    print(f"[{cfg['name']}] scraped {len(rows)} rows across {page_num} page(s)")
    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    permit_no = (row.get("permit_no") or "").strip()
    if not permit_no:
        return None
    return {
        "source_city": cfg["name"],
        "source_id": permit_no,
        "permit_number": permit_no,
        "address": (row.get("address") or "").strip() or None,
        "city": cfg["city"],
        "state": cfg["state"],
        "zip": None,
        "permit_type": map_permit_type(row.get("record_type", ""), row.get("description", "")),
        "status": map_status(row.get("status")),
        "description": (row.get("description") or "")[:1000] or None,
        "estimated_value": None,
        "issued_date": row.get("issued_date") or None,
        "applicant_name": None,
        "contractor_name": None,
        "raw_json": row,
    }


def upsert(rows: List[Dict[str, Any]], slug: str) -> int:
    if not rows:
        return 0
    url = SUPABASE_URL + "/rest/v1/permits?on_conflict=source_city,source_id"
    body = json.dumps(rows).encode("utf-8")
    req = Request(
        url, data=body, method="POST",
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
        raw = scrape_tenant(cfg)
    except Exception as e:
        print(f"[{slug}] scrape failed: {e}", file=sys.stderr)
        return {"name": slug, "ok": False, "error": str(e), "inserted": 0}
    normalized = [n for n in (normalize(r, cfg) for r in raw) if n]
    print(f"[{slug}] normalized: {len(normalized)} rows")
    inserted = upsert(normalized, slug)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {"name": slug, "ok": True, "inserted": inserted, "elapsed_s": round(elapsed, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Tyler eTRAKiT scraper for Henri sidecar.")
    parser.add_argument("target", help="Slug or '--all-etrakit'.")
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} etrakit config(s)")
    results = [run_one(c) for c in configs]
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total}; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
