"""Accurate counts using Supabase count=exact and state distribution."""
import json, os, urllib.request, urllib.error
from urllib.parse import urlencode
from collections import Counter

SUPABASE_URL = "https://ivfxylgoxgrxttknewsf.supabase.co"
KEY = os.environ["SRK"]

def count(params):
    hdrs = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=exact", "Range": "0-0"}
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/permit_sources?{urlencode(params)}", headers=hdrs)
    with urllib.request.urlopen(req, timeout=15) as r:
        cr = r.headers.get("Content-Range", "")
        return int(cr.split("/")[-1]) if "/" in cr else -1

def fetch_all(params, page=1000):
    hdrs = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Accept": "application/json"}
    out = []
    offset = 0
    while True:
        p = dict(params); p["offset"] = str(offset); p["limit"] = str(page)
        req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/permit_sources?{urlencode(p)}", headers=hdrs)
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read().decode("utf-8"))
        if not rows: break
        out.extend(rows)
        if len(rows) < page: break
        offset += page
    return out

print("=== ENABLED BY PLATFORM (exact counts) ===")
for pt in ["socrata", "arcgis", "ckan", "csv"]:
    n = count({"enabled":"eq.true","source_type":f"eq.{pt}","select":"id"})
    print(f"{pt:7} {n}")

# other
all_en = fetch_all({"enabled":"eq.true","select":"source_type,state"})
total = len(all_en)
print(f"TOTAL enabled (all types): {total}")
other = Counter()
for r in all_en:
    st = (r.get("source_type") or "unknown").lower()
    if st not in ("socrata","arcgis","ckan","csv"):
        other[st]+=1
print(f"other: {sum(other.values())}  breakdown={dict(other.most_common(10))}")

# suspicious
susp_n = count({"enabled":"eq.true","error_count":"gt.0","select":"id"})
print(f"\nSUSPICIOUS count (enabled+errors>0): {susp_n}")

# top 10 states
sc = Counter((r.get("state") or "??") for r in all_en)
print("\nTOP 10 STATES:")
print(", ".join(f"{k}={v}" for k,v in sc.most_common(10)))

# total sources in table (any enabled)
n_all = count({"select":"id"})
print(f"\nTOTAL rows in permit_sources: {n_all}")
n_dis = count({"enabled":"eq.false","select":"id"})
print(f"TOTAL disabled: {n_dis}")
