"""
Generic Tyler EnerGov permit loader — Phase 2 of nationwide coverage.

Tyler Technologies' EnerGov platform is the dominant permit-management
SaaS for Texas, Georgia, North Carolina, Florida, and parts of the
Midwest. Most cities expose a public Citizen Self-Service (CSS) portal
at one of these URL patterns (verified against ~10 cities, 2026-05):

    https://<jurisdiction>.tylerportico.com/css/                 ← portal
    https://<jurisdiction>.tylerportico.com/api/<some-prefix>    ← public REST
    https://<jurisdiction>.energov.com/EnerGovProd/SelfService   ← legacy

Tyler's REST-ish endpoints aren't formally documented for citizens but
DO follow a consistent shape — `/api/v2/Records/Search` returns JSON
with a `data` array of permit records. This loader is a thin parameterized
wrapper over that pattern, mirroring the load_socrata.py shape so a new
city is ~10 lines of YAML, no code.

How it works:
  1. Reads ~/scrapling_loaders/configs/<slug>.yml describing the city's
     EnerGov endpoint, search payload, and column-name mapping.
  2. POSTs the search payload (date-range + record-type filter).
  3. Maps free-text record types → Henri's permit_type enum.
  4. Upserts via PostgREST on (source_city, source_id) — idempotent.

Run modes:
  python load_energov.py austin-energov           # one city
  python load_energov.py --all-energov            # every *_energov*.yml in configs/

Each YAML config:
  loader: energov                       # required — disambiguates from load_socrata
  name: ATLANTA-GA                      # source_city value
  city: Atlanta
  state: GA
  base_url: https://atlantaga.tylerportico.com
  search_path: /api/v2/Records/Search   # POST endpoint
  payload:                              # raw JSON body sent to upstream
    moduleId: 1                          # "Building" — EnerGov-specific
    fromDate: '{{NOW_MINUS_DAYS:7}}'    # template — substituted at runtime
    toDate:   '{{NOW}}'
    pageSize: 100
  data_path: data                       # JSON path to the array of records
  fields:
    permit_no:        recordNumber
    issued_date:      issuedDate
    address:          address
    zip:              postalCode
    description:      description
    estimated_value:  jobValue
    applicant:        applicantName
    contractor:       contractorName
    record_type:      recordType
    status:           status

The mapping lets us add a new city with zero code. Same as Socrata.

If a city sits behind Cloudflare (most don't, but Tyler-hosted
subdomains sometimes do), set `cloudflare: true` in the YAML and the
loader will swap Fetcher → DynamicFetcher with `solve_cloudflare=True`.
That's why this lives on the Hetzner box — Vercel cron can't run a
headless Chromium with Camoufox stealth.
"""
from __future__ import annotations

import argparse
import json
import os
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

# Scrapling fetchers — Fetcher for plain HTTP, DynamicFetcher for the
# rare Cloudflare-fronted subdomain.
from scrapling.fetchers import Fetcher

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


# ── enum mappers (shared with load_socrata.py shape, but Tyler uses
#    different free-text labels so we re-implement) ──────────────────
def map_permit_type(record_type: str, description: str) -> str:
    rt = (record_type or "").lower()
    desc = (description or "").lower()
    if "demolition" in rt or "demolition" in desc:
        return "demolition"
    if "addition" in rt or "addition" in desc:
        return "addition"
    if "new" in rt and ("residential" in rt or "construction" in rt):
        return "new_construction"
    if "remodel" in rt or "renovat" in desc or "alteration" in rt:
        return "renovation"
    if "repair" in rt or "repair" in desc:
        return "repair"
    if "commercial" in rt:
        return "commercial"
    if "residential" in rt or "single family" in rt or "sfr" in rt:
        return "residential"
    return "other"


def map_status(value: Optional[str]) -> str:
    s = (value or "").lower()
    if "final" in s or "closed" in s or "completed" in s:
        return "final"
    if "issued" in s or "active" in s:
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
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ── template substitution for date placeholders in payload ─────────────
def render_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Replace {{NOW}} / {{NOW_MINUS_DAYS:N}} tokens in string values."""
    now = datetime.now(timezone.utc)

    def _sub(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        if value == "{{NOW}}":
            return now.strftime("%Y-%m-%dT%H:%M:%S")
        if value.startswith("{{NOW_MINUS_DAYS:") and value.endswith("}}"):
            try:
                days = int(value[len("{{NOW_MINUS_DAYS:") : -2])
                return (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
            except ValueError:
                return value
        return value

    return {k: _sub(v) for k, v in payload.items()}


# ── core ──────────────────────────────────────────────────────────────
def load_configs(target: str) -> List[Dict[str, Any]]:
    if not CONFIG_DIR.exists():
        raise FileNotFoundError(f"Config dir missing: {CONFIG_DIR}")
    if target == "--all-energov":
        files = sorted(CONFIG_DIR.glob("*.yml")) + sorted(CONFIG_DIR.glob("*.yaml"))
        # Filter to energov configs only — coexists with Socrata YAMLs.
        configs = [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]
        return [c for c in configs if (c or {}).get("loader") == "energov"]
    files = list(CONFIG_DIR.glob(f"{target}.yml")) + list(
        CONFIG_DIR.glob(f"{target}.yaml")
    )
    if not files:
        raise FileNotFoundError(f"No config matched '{target}' in {CONFIG_DIR}")
    return [yaml.safe_load(f.read_text(encoding="utf-8")) for f in files]


def fetch_rows(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    base = cfg["base_url"].rstrip("/")
    path = cfg["search_path"]
    url = f"{base}{path}"
    payload = render_payload(cfg.get("payload", {}))
    print(f"[{cfg['name']}] POST {url}  payload={json.dumps(payload)[:200]}")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = json.dumps(payload).encode("utf-8")

    if cfg.get("cloudflare"):
        # Lazy import — only the rare Cloudflare-fronted city pays the
        # Chromium-startup cost.
        from scrapling.fetchers import DynamicFetcher  # type: ignore

        page = DynamicFetcher.post(
            url,
            data=payload,
            headers=headers,
            solve_cloudflare=True,
            stealthy_headers=True,
        )
    else:
        page = Fetcher.post(url, data=body, headers=headers, stealthy_headers=True)

    if page.status != 200:
        raise RuntimeError(
            f"{cfg['name']} returned {page.status}: {page.body[:300]}"
        )

    parsed = json.loads(page.body)
    data_path = cfg.get("data_path", "data")
    rows = parsed
    for segment in data_path.split("."):
        rows = rows.get(segment, []) if isinstance(rows, dict) else rows
    if not isinstance(rows, list):
        raise RuntimeError(
            f"{cfg['name']} data_path '{data_path}' did not resolve to a list"
        )
    print(f"[{cfg['name']}] {len(rows)} rows from upstream")
    return rows


def normalize(row: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    f = cfg["fields"]
    permit_no = (row.get(f["permit_no"]) or "").strip()
    if not permit_no:
        return None
    return {
        "source_city": cfg["name"],
        "source_id": permit_no,
        "permit_number": permit_no,
        "address": (row.get(f.get("address", "")) or "").strip() or None,
        "city": cfg["city"],
        "state": cfg["state"],
        "zip": (row.get(f.get("zip", "")) or "").strip() or None,
        "permit_type": map_permit_type(
            row.get(f.get("record_type", "")) or "",
            row.get(f.get("description", "")) or "",
        ),
        "status": map_status(row.get(f.get("status", ""))),
        "description": (row.get(f.get("description", "")) or "")[:1000] or None,
        "estimated_value": coerce_int(row.get(f.get("estimated_value", ""))),
        "issued_date": row.get(f.get("issued_date", "")) or None,
        "applicant_name": (row.get(f.get("applicant", "")) or "").strip()[:200]
        or None,
        "contractor_name": (row.get(f.get("contractor", "")) or "").strip()[:200]
        or None,
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
        raw = fetch_rows(cfg)
    except Exception as e:
        print(f"[{slug}] fetch failed: {e}", file=sys.stderr)
        return {"name": slug, "ok": False, "error": str(e), "inserted": 0}
    normalized = [n for n in (normalize(r, cfg) for r in raw) if n]
    print(f"[{slug}] normalized: {len(normalized)} rows")
    counts: Dict[str, int] = {}
    for n in normalized:
        counts[n["permit_type"]] = counts.get(n["permit_type"], 0) + 1
    if counts:
        print(f"[{slug}] permit_type breakdown: {counts}")
    inserted = upsert(normalized, slug)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[{slug}] DONE — inserted {inserted} in {elapsed:.1f}s")
    return {
        "name": slug,
        "ok": True,
        "inserted": inserted,
        "elapsed_s": round(elapsed, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generic Tyler EnerGov permit loader for Henri sidecar."
    )
    parser.add_argument(
        "target",
        help="Config slug (e.g. atlanta-energov) or '--all-energov' for every "
        "energov config in the configs dir.",
    )
    args = parser.parse_args()
    configs = load_configs(args.target)
    print(f"[loader] running {len(configs)} energov config(s) from {CONFIG_DIR}")
    results = []
    for cfg in configs:
        results.append(run_one(cfg))
        time.sleep(0.5)
    total = sum(r["inserted"] for r in results)
    failures = [r for r in results if not r["ok"]]
    print(
        f"\n[loader] TOTAL inserted: {total} across {len(results)} cities; "
        f"{len(failures)} failures"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
