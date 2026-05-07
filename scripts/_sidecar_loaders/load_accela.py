"""
Generic Accela ACA (Accela Citizen Access) scraper — Phase 4 of
nationwide coverage.

Accela is the dominant permit-management SaaS for large US cities.
Their public Citizen Access portal (ACA) is built on ASP.NET WebForms
which means:

  - Pagination requires round-tripping __VIEWSTATE + __EVENTVALIDATION
    tokens through every POST.
  - "Click Search" is actually a __doPostBack() that calls a hidden
    LinkButton; the response is the next page rendered server-side.
  - Date-range search must be POSTed with the form's exact field names
    (which Accela templates per-tenant — they shift between releases).

This loader uses Camoufox + Scrapling's DynamicFetcher to get a real
browser instance, drive the search form, scrape the results table,
and walk pagination until the date range is exhausted. Slower than
REST (~2-5 minutes per tenant per run) but it's the ONLY path for
Accela jurisdictions.

Verified during 2026-05-06 research as Accela tenants without REST:
  - Clark County NV (`/clarkco/`) — ~80-120k/yr, the highest-leverage
    permit jurisdiction in NV by far. Strip megaprojects + booming
    residential solar.
  - Las Vegas NV (`/lasvegas/`) — ~30-40k/yr.
  - Reno NV (`/RENO/`)
  - Washoe County NV (`/ONE/`) — covers unincorporated Reno+Sparks
  - North Las Vegas NV (`/cityofnorthlasvegas/`)
  - Sparks NV (`/SPARKS/`)
  - Salt Lake City UT (`/SLCREF/`) — replaces the frozen Socrata feed
  - Missoula MT (`/MISSOULA/`)
  - Oklahoma City OK (`access.okc.gov/aca/`) — also has Incapsula
    bot wall, may need extra evasion

Each YAML config:
  loader: accela
  name: CLARK-COUNTY-NV
  city: Clark County
  state: NV
  base_url: https://aca-prod.accela.com/clarkco
  module: Building              # Accela "module" parameter — Building / Planning / etc.
  search_path: /Cap/CapHome.aspx?module=Building
  date_range_days: 7            # how far back to search
  result_table_selector: '#ctl00_PlaceHolderMain_dgvPermitList'  # default; tenants shift
  fields:                       # column position map (0-indexed visible columns)
    permit_no:        0
    issued_date:      2
    record_type:      3
    description:      4
    address:          5
    status:           6

PHASE 4 STARTER — needs probe-and-iterate on Hetzner. The selectors
above are based on the dominant Accela template (~70% of tenants);
specific tenants may shift column ordering or use different DOM IDs.
First production run for each new tenant should set
   DEBUG_HTML_DUMP=1
in env, which writes the post-search HTML to ~/scrapling-loaders.log
so the operator can verify selectors.
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
    import yaml  # PyYAML
except ImportError:
    print("Missing PyYAML. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

# Camoufox + Scrapling dynamic fetcher — required for ASP.NET ViewState.
# DynamicFetcher launches a real browser; Fetcher (basic HTTP) cannot
# drive the search form because the postback chain depends on JS-rendered
# event tokens.
try:
    from scrapling.fetchers import DynamicFetcher  # type: ignore
except ImportError:
    print(
        "Missing Scrapling. Already installed in ~/scrapling-env on "
        "the Hetzner box; run with that venv activated.",
        file=sys.stderr,
    )
    sys.exit(2)

# ── env ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

CONFIG_DIR = Path(
    os.environ.get(
        "SCRAPLING_CONFIG_DIR",
        str(Path.home() / "scrapling_loaders" / "configs"),
    )
)

DEBUG_HTML_DUMP = os.environ.get("DEBUG_HTML_DUMP") == "1"


# ── enum mappers ──────────────────────────────────────────────────────
def map_permit_type(record_type: str, description: str) -> str:
    rt = (record_type or "").lower()
    desc = (description or "").lower()
    blob = " ".join([rt, desc])
    if "demolition" in blob:
        return "demolition"
    if "addition" in blob:
        return "addition"
    if "new" in rt and ("residential" in rt or "construction" in rt or "commercial" in rt):
        return "new_construction"
    if "remodel" in blob or "renovat" in blob or "alteration" in blob or "tenant improv" in blob:
        return "renovation"
    if "repair" in blob or "replac" in blob:
        return "repair"
    if "commercial" in rt:
        return "commercial"
    if "residential" in rt or "single family" in rt or "sfr" in rt:
        return "residential"
    return "other"


def map_status(value: Optional[str]) -> str:
    s = (value or "").lower()
    if "final" in s or "closed" in s or "completed" in s or "co issued" in s:
        return "final"
    if "issued" in s or "active" in s or "in progress" in s:
        return "issued"
    if "approved" in s:
        return "approved"
    if "expired" in s:
        return "expired"
    if "void" in s or "revoked" in s or "withdraw" in s:
        return "revoked"
    return "submitted"


def coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    s = re.sub(r"[^\d.]", "", str(v))
    if not s:
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


# ── config loading ────────────────────────────────────────────────────
def load_configs(target: str) -> List[Dict[str, Any]]:
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-accela":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [
            c for c in configs
            if c
            and c.get("loader") == "accela"
            and c.get("status") in (None, "verified")
        ]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(
        CONFIG_DIR.glob(f"{target}.yaml")
    )
    if not files:
        raise FileNotFoundError(f"No config matched '{target}' in {CONFIG_DIR}")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


# ── core scrape ──────────────────────────────────────────────────────
def scrape_tenant(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Drive the Accela search form, walk pagination, return parsed rows."""
    base = cfg["base_url"].rstrip("/")
    search_url = f"{base}{cfg.get('search_path', '/Cap/CapHome.aspx?module=Building')}"
    days_back = int(cfg.get("date_range_days", 7))
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days_back)
    from_str = cutoff_dt.strftime("%m/%d/%Y")
    to_str = datetime.now(timezone.utc).strftime("%m/%d/%Y")

    print(f"[{cfg['name']}] GET {search_url}  (from {from_str} → {to_str})")

    rows: List[Dict[str, Any]] = []
    extra_settings = cfg.get("camoufox", {})

    # Kick off Camoufox session. solve_cloudflare is harmless if not needed.
    page = DynamicFetcher.fetch(
        search_url,
        headless=True,
        humanize=True,
        solve_cloudflare=cfg.get("cloudflare", False),
        block_images=True,
        wait=2000,  # ms
    )

    if page.status != 200:
        raise RuntimeError(f"{cfg['name']} initial GET {page.status}: {page.body[:200]}")

    # Inject the search criteria + click the submit button. Accela's
    # form fields differ per tenant. The selectors below are the
    # dominant pattern; tenant-specific overrides come from the YAML.
    fld_from = cfg.get("field_from", "ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate")
    fld_to = cfg.get("field_to", "ctl00_PlaceHolderMain_generalSearchForm_txtGSEndDate")
    fld_submit = cfg.get(
        "field_submit",
        "ctl00_PlaceHolderMain_btnNewSearch",  # falls back to Search-records button
    )

    # Use Scrapling's page-driving methods. Note: Scrapling DynamicFetcher
    # exposes a .browser handle when needed; for simple form fill we use
    # the page object's methods directly.
    try:
        # Fill date range
        page.locator(f"#{fld_from}").type(from_str, delay=20)
        page.locator(f"#{fld_to}").type(to_str, delay=20)
        # Click Search (varies; sometimes it's the LinkButton, sometimes a Button)
        submit = page.locator(f"#{fld_submit}")
        submit.click()
        page.wait_for_load_state("networkidle", timeout=30_000)
    except Exception as e:
        # If the dominant selectors don't match, dump HTML so the
        # operator can fix the YAML on the next run.
        if DEBUG_HTML_DUMP:
            dump = Path.home() / f"accela-debug-{cfg['name']}.html"
            dump.write_text(page.body, encoding="utf-8")
            print(f"[{cfg['name']}] DEBUG: dumped HTML to {dump}", file=sys.stderr)
        raise RuntimeError(f"{cfg['name']} form-fill failed: {e}")

    # ── walk results pagination ──────────────────────────────────────
    table_sel = cfg.get(
        "result_table_selector",
        "#ctl00_PlaceHolderMain_dgvPermitList",
    )
    next_sel = cfg.get(
        "next_page_selector",
        "a.aca_next, a[id$='lnkNext'], a[title='Next']",
    )

    page_num = 1
    while True:
        # Parse current page
        for tr in page.locator(f"{table_sel} tr").all():
            cells = [c.inner_text().strip() for c in tr.locator("td").all()]
            if len(cells) < 5:
                continue  # header row or empty
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

        # Try to advance
        try:
            next_link = page.locator(next_sel).first
            if not next_link.is_visible() or "disabled" in (next_link.get_attribute("class") or ""):
                break
            next_link.click()
            page.wait_for_load_state("networkidle", timeout=30_000)
            page_num += 1
            if page_num > int(cfg.get("max_pages", 50)):
                print(f"[{cfg['name']}] hit max_pages cap ({cfg.get('max_pages', 50)})")
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
        "zip": None,  # Accela results table rarely shows ZIP; enricher pass populates
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
    parser = argparse.ArgumentParser(description="Generic Accela ACA scraper for Henri sidecar.")
    parser.add_argument(
        "target",
        help="Config slug (e.g. clark-county-nv) or '--all-accela' for every accela config.",
    )
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} accela config(s) from {CONFIG_DIR}")
    results = []
    for cfg in configs:
        results.append(run_one(cfg))
        time.sleep(2)  # be polite — Accela tenants share infrastructure
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(f"\n[loader] TOTAL inserted: {total} across {len(results)} tenants; {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
