"""One-shot: fix the ~1,001 AL permits where zip doesn't start with 35 or 36.
Track 1 audit residual. Mirrors fix-permit-address-attribution.ts pattern but
handles the 2-char multi-prefix case the .ts loop skipped."""
import os
import re
import sys
import urllib.request
import urllib.parse
import json

ENV_PATH = r"C:\Users\yabis\Desktop\Henri App\.env.local"

def load_env():
    env = {}
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = load_env()
SB_URL = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
SB_KEY = env.get("SUPABASE_SERVICE_ROLE_KEY")
if not SB_URL or not SB_KEY:
    print("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

HEADERS = {
    "apikey": SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json",
}

FILTER = "state=eq.AL&zip=not.is.null&zip=neq.00000&zip=not.like.35*&zip=not.like.36*"
ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def count_residual():
    url = f"{SB_URL}/rest/v1/permits?{FILTER}&select=id"
    req = urllib.request.Request(url, headers={**HEADERS, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                return int(cr.split("/")[-1])
    except Exception as e:
        print(f"count err: {e}")
    return -1


def fetch_page(limit=500):
    url = f"{SB_URL}/rest/v1/permits?{FILTER}&select=id,zip,address&limit={limit}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def patch(row_id, zip_value):
    url = f"{SB_URL}/rest/v1/permits?id=eq.{urllib.parse.quote(row_id)}"
    body = json.dumps({"zip": zip_value}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PATCH",
                                 headers={**HEADERS, "Prefer": "return=minimal"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print(f"  patch err {row_id}: {e}")
        return False


def extract_al_zip(address):
    if not address:
        return None
    matches = ZIP_RE.findall(address)
    if not matches:
        return None
    # Last 5-digit token is almost always the real ZIP.
    last = matches[-1]
    if last == "00000":
        return None
    if last.startswith("35") or last.startswith("36"):
        return last
    return None


start = count_residual()
print(f"start residual: {start}")

fixed = 0
nulled = 0
failed = 0
scanned = 0

for it in range(10):
    rows = fetch_page(500)
    if not rows:
        print(f"iter {it+1}: 0 rows — done")
        break
    made = 0
    for r in rows:
        scanned += 1
        addr = r.get("address") or ""
        new_zip = extract_al_zip(addr)
        if new_zip and new_zip != r.get("zip"):
            if patch(r["id"], new_zip):
                fixed += 1
                made += 1
            else:
                failed += 1
        else:
            # can't extract valid AL zip → null it so row drops from filter
            if patch(r["id"], None):
                nulled += 1
                made += 1
            else:
                failed += 1
    print(f"iter {it+1}: scanned {len(rows)}  fixed={fixed}  nulled={nulled}  failed={failed}")
    if made == 0:
        print("  no progress this iter — breaking")
        break

end = count_residual()
print(f"\nfinal residual: {end}  (start={start}, fixed={fixed}, nulled={nulled}, failed={failed}, scanned={scanned})")
