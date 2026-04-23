#!/usr/bin/env python3
"""
ingest_historical_permits.py
────────────────────────────
One-time bulk loader: reads all permit_records/*.csv.gz files and upserts
them into the Supabase `permits` table using the service-role key.

Usage:
    pip install supabase tqdm
    python scripts/ingest_historical_permits.py

Set these env vars (or edit the CONFIG section below):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

Filters applied at ingest time to keep DB size manageable:
  - issue_date >= 2022-01-01  (last 3 years of permits)
  - latitude/longitude must be WGS84 (abs(lat) <= 90, abs(lng) <= 180)
  - permit_number must not be empty

Upsert conflict key: (source_city, source_id)  — safe to re-run at any time.
"""

import csv
import gzip
import hashlib
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL  = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

PERMIT_DIR    = Path(r"C:\Users\yabis\Desktop\Data for Onsite\permit_records")
BATCH_SIZE    = 500          # rows per upsert call
MIN_DATE      = datetime(2022, 1, 1, tzinfo=timezone.utc)
MAX_ERRORS    = 50           # abort a file after this many consecutive errors

# ── HELPERS ───────────────────────────────────────────────────────────────────

PERMIT_TYPE_MAP = {
    "residential": ["residential", "single family", "sfr", "duplex", "townhouse"],
    "commercial":  ["commercial", "retail", "office", "industrial", "warehouse"],
    "renovation":  ["renovation", "remodel", "alteration", "interior", "tenant improvement"],
    "new_construction": ["new construction", "new build", "ground up"],
    "addition":    ["addition", "adu", "accessory dwelling", "room add"],
    "demolition":  ["demolition", "demo"],
    "repair":      ["repair", "replace", "reroof", "roof replace", "window", "hvac", "plumbing", "electrical"],
}

def classify_type(raw: str) -> str:
    raw_lower = raw.lower()
    for permit_type, keywords in PERMIT_TYPE_MAP.items():
        if any(kw in raw_lower for kw in keywords):
            return permit_type
    return "other"

STATUS_MAP = {
    "submitted":    ["submitted", "filed", "applied", "application"],
    "approved":     ["approved", "granted"],
    "issued":       ["issued", "active", "open", "permitted"],
    "final":        ["final", "closed", "complete", "finaled"],
    "expired":      ["expired", "lapsed"],
    "revoked":      ["revoked", "cancelled", "withdrawn", "void"],
}

def normalize_status(raw: str) -> str:
    raw_lower = raw.lower()
    for status, keywords in STATUS_MAP.items():
        if any(kw in raw_lower for kw in keywords):
            return status
    return "submitted"

def parse_date(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    # Millisecond UNIX timestamp
    if re.fullmatch(r"\d{13}", raw):
        try:
            dt = datetime.fromtimestamp(int(raw) / 1000, tz=timezone.utc)
            if dt >= MIN_DATE:
                return dt.date().isoformat()
            return None
        except Exception:
            return None
    # ISO / common formats
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
                "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(raw[:len(fmt.replace("%Y","0000").replace("%m","00").replace("%d","00").replace("%H","00").replace("%M","00").replace("%S","00").replace("%f","000000"))], fmt)
            return dt.date().isoformat()
        except ValueError:
            pass
    # Try just extracting YYYY-MM-DD
    m = re.search(r"(\d{4}-\d{2}-\d{2})", raw)
    if m:
        return m.group(1)
    return None

def parse_coord(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        val = float(raw.replace(",", "").strip())
        return val if val != 0.0 else None
    except (ValueError, AttributeError):
        return None

def parse_money(raw: str | None) -> int | None:
    if not raw:
        return None
    cleaned = re.sub(r"[^0-9.]", "", raw)
    try:
        val = float(cleaned)
        return int(val) if val > 0 else None
    except ValueError:
        return None

def extract_zip(address: str | None) -> str | None:
    if not address:
        return None
    m = re.search(r"\b(\d{5})(?:-\d{4})?\b", address)
    return m.group(1) if m else None

def make_source_id(jurisdiction: str, permit_number: str, address: str, date: str) -> str:
    if permit_number:
        return permit_number[:100]
    # Fallback deterministic ID when permit_number is blank
    fingerprint = f"{address}|{date}"
    return hashlib.sha256(fingerprint.encode()).hexdigest()[:16]

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars")
        sys.exit(1)

    try:
        from supabase import create_client
        from tqdm import tqdm
    except ImportError:
        print("ERROR: Run: pip install supabase tqdm")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SERVICE_KEY)

    gz_files = sorted(PERMIT_DIR.glob("*.csv.gz"))
    if not gz_files:
        print(f"No .csv.gz files found in {PERMIT_DIR}")
        sys.exit(1)

    print(f"Found {len(gz_files)} compressed permit files")
    print(f"Filter: issue_date >= {MIN_DATE.date()}, WGS84 coords required")
    print()

    total_inserted = 0
    total_skipped  = 0
    total_errors   = 0

    for gz_path in gz_files:
        state_code = gz_path.name.split("_")[0].upper()
        print(f"Processing {gz_path.name} ...", end=" ", flush=True)

        batch        = []
        file_rows    = 0
        file_skipped = 0
        consec_errors = 0

        try:
            with gzip.open(gz_path, "rt", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    file_rows += 1
                    try:
                        # ── Date filter ──────────────────────────────────────
                        raw_date = row.get("issue_date", "").strip()
                        parsed_date = parse_date(raw_date)
                        if not parsed_date:
                            file_skipped += 1
                            continue
                        try:
                            dt = datetime.fromisoformat(parsed_date)
                            if dt < MIN_DATE.replace(tzinfo=None):
                                file_skipped += 1
                                continue
                        except ValueError:
                            file_skipped += 1
                            continue

                        # ── Coordinate filter (WGS84 bounds) ─────────────────
                        lat = parse_coord(row.get("latitude"))
                        lng = parse_coord(row.get("longitude"))
                        if lat is not None and (lat < -90 or lat > 90):
                            lat = None
                        if lng is not None and (lng < -180 or lng > 180):
                            lng = None

                        # ── Build row ─────────────────────────────────────────
                        jurisdiction = row.get("jurisdiction", "").strip() or row.get("city", "").strip()
                        city         = row.get("city", "").strip() or jurisdiction
                        permit_num   = row.get("permit_number", "").strip()
                        address      = row.get("address", "").strip()
                        source_id    = make_source_id(jurisdiction, permit_num, address, parsed_date)
                        source_city  = (jurisdiction or city or state_code)[:100]

                        record = {
                            "source_city":     source_city,
                            "source_id":       f"{source_city.lower().replace(' ','_')}_{source_id}",
                            "source_type":     row.get("source_type", "csv").strip() or "csv",
                            "permit_number":   permit_num or None,
                            "permit_type":     classify_type(row.get("permit_type", "")),
                            "status":          normalize_status(row.get("status", "")),
                            "description":     row.get("description", "").strip() or None,
                            "address":         address or None,
                            "city":            city or None,
                            "state":           row.get("state", state_code).strip().upper()[:2],
                            "zip":             extract_zip(address) or row.get("zip_code", "").strip()[:5] or None,
                            "latitude":        lat,
                            "longitude":       lng,
                            "issued_date":     parsed_date,
                            "estimated_value": parse_money(row.get("estimated_value")),
                            "contractor_name": row.get("contractor", "").strip() or None,
                            "scored_at":       None,
                            "updated_at":      datetime.now(timezone.utc).isoformat(),
                        }

                        # Skip rows that are just noise
                        if not record["address"] and not record["permit_number"]:
                            file_skipped += 1
                            continue

                        batch.append(record)
                        consec_errors = 0

                    except Exception as e:
                        consec_errors += 1
                        total_errors  += 1
                        if consec_errors >= MAX_ERRORS:
                            print(f"\n  ABORT: {MAX_ERRORS} consecutive errors — {e}")
                            break
                        continue

                    # ── Flush batch ───────────────────────────────────────────
                    if len(batch) >= BATCH_SIZE:
                        try:
                            supabase.table("permits").upsert(
                                batch,
                                on_conflict="source_city,source_id"
                            ).execute()
                            total_inserted += len(batch)
                        except Exception as e:
                            print(f"\n  Upsert error: {e}")
                            total_errors += len(batch)
                        batch = []
                        time.sleep(0.05)  # gentle rate limit

        except Exception as e:
            print(f"\n  File read error: {e}")
            total_errors += 1
            continue

        # Flush remaining rows
        if batch:
            try:
                supabase.table("permits").upsert(
                    batch,
                    on_conflict="source_city,source_id"
                ).execute()
                total_inserted += len(batch)
            except Exception as e:
                print(f"\n  Final upsert error: {e}")
                total_errors += len(batch)

        total_skipped += file_skipped
        print(f"rows={file_rows:,}  kept={file_rows-file_skipped:,}  skipped={file_skipped:,}")

    print()
    print("═" * 60)
    print(f"COMPLETE")
    print(f"  Inserted/Updated : {total_inserted:,}")
    print(f"  Skipped (filters): {total_skipped:,}")
    print(f"  Errors           : {total_errors:,}")
    print()
    print("Run this SQL to verify:")
    print("  SELECT state, COUNT(*) FROM permits GROUP BY 1 ORDER BY 2 DESC LIMIT 15;")

if __name__ == "__main__":
    main()
