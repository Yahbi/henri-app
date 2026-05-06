"""Permit sources health report — counts, live endpoint sampling, error audit, state distribution."""
import json
import os
import ssl
import sys
import urllib.request
import urllib.error
from urllib.parse import urlencode
from collections import Counter

SUPABASE_URL = "https://ivfxylgoxgrxttknewsf.supabase.co"
KEY = os.environ.get("SRK", "")

HDR = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Accept": "application/json",
}

def get(path, params=None, timeout=10):
    qs = ("?" + urlencode(params, doseq=True)) if params else ""
    url = f"{SUPABASE_URL}/rest/v1/{path}{qs}"
    req = urllib.request.Request(url, headers=HDR)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")), r.status, r.headers
    except urllib.error.HTTPError as e:
        return None, e.code, None
    except Exception as e:
        return None, 0, str(e)

def live_probe(src):
    """Probe an endpoint like the catalog would, quickly."""
    t = (src.get("source_type") or "").lower()
    ep = src.get("endpoint") or ""
    if not ep:
        return "NO_URL", "", "", False
    url = ep
    hdrs = {"Accept": "application/json", "User-Agent": "Henri-HealthCheck/1.0"}
    method = "GET"
    if t == "socrata":
        # normalize and attach $limit=1
        try:
            from urllib.parse import urlparse
            u = urlparse(ep)
            p = u.path
            # catalog sometimes stores /d/{id}
            import re
            m = re.match(r"^/d/([a-z0-9-]+)", p, re.I)
            if m:
                url = f"{u.scheme}://{u.netloc}/resource/{m.group(1)}.json"
            m2 = re.match(r"^/api/views/([a-z0-9-]+)", p, re.I)
            if m2:
                url = f"{u.scheme}://{u.netloc}/resource/{m2.group(1)}.json"
        except Exception:
            pass
        url = url + ("&" if "?" in url else "?") + "$limit=1"
    elif t == "arcgis":
        url = ep.rstrip("/") + "?f=json"
    elif t == "ckan":
        # just try the URL; most CKANs are HTML landings
        pass
    elif t == "csv":
        hdrs["Range"] = "bytes=0-4096"
    try:
        req = urllib.request.Request(url, headers=hdrs, method=method)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            body = r.read(16384)
            ct = r.headers.get("Content-Type", "")
            status = r.status
            text = body.decode("utf-8", errors="replace")[:4096]
            has_fields = any(
                kw in text.lower()
                for kw in ["permit", "address", "issue", "applicat", "status", "objectid", "license", "inspec", "violation", "case_"]
            )
            return status, ct[:50], "data" if has_fields else "no-match", has_fields
    except urllib.error.HTTPError as e:
        return e.code, "", f"http-err:{e.code}", False
    except Exception as e:
        msg = str(e)[:60]
        return "ERR", "", msg, False


def main():
    print("=== ENABLED BY PLATFORM ===")
    platforms = ["socrata", "arcgis", "ckan", "csv"]
    counts = {}
    for pt in platforms:
        rows, status, _ = get("permit_sources", {
            "enabled": "eq.true",
            "source_type": f"eq.{pt}",
            "select": "id",
            "limit": "5000",
        })
        counts[pt] = len(rows) if rows else 0
    # other: enabled true, source_type not in the 4
    all_enabled, _, _ = get("permit_sources", {"enabled": "eq.true", "select": "source_type", "limit": "20000"})
    other_counter = Counter()
    total_enabled = 0
    if all_enabled:
        total_enabled = len(all_enabled)
        for r in all_enabled:
            st = (r.get("source_type") or "unknown").lower()
            if st not in platforms:
                other_counter[st] += 1
    print(f"socrata: {counts['socrata']}")
    print(f"arcgis:  {counts['arcgis']}")
    print(f"ckan:    {counts['ckan']}")
    print(f"csv:     {counts['csv']}")
    other_total = sum(other_counter.values())
    print(f"other:   {other_total}  ({', '.join(f'{k}={v}' for k,v in other_counter.most_common(5))})")
    print(f"TOTAL enabled: {total_enabled}")
    print()

    print("=== LIVE ENDPOINT HEALTH (20 sampled) ===")
    for pt in platforms:
        rows, _, _ = get("permit_sources", {
            "enabled": "eq.true",
            "source_type": f"eq.{pt}",
            "select": "id,name,endpoint,source_type,state",
            "limit": "5",
            "order": "id.asc",
        })
        if not rows:
            print(f"[{pt}] no enabled rows")
            continue
        for src in rows:
            status, ct, note, ok = live_probe(src)
            label = (src.get("name") or "")[:40]
            ep = (src.get("endpoint") or "")[:60]
            st_tag = "OK " if ok else "  "
            print(f"[{pt:7}][{st_tag}] {label:40} {status!s:4} {ct:30} {note}")
    print()

    print("=== SUSPICIOUS: enabled=true AND error_count>0 ===")
    susp, _, _ = get("permit_sources", {
        "enabled": "eq.true",
        "error_count": "gt.0",
        "select": "id,name,source_type,error_count,last_error,last_successful_sync",
        "order": "error_count.desc",
        "limit": "5",
    })
    susp_all_count, _, _ = get("permit_sources", {
        "enabled": "eq.true",
        "error_count": "gt.0",
        "select": "id",
        "limit": "5000",
    })
    count_susp = len(susp_all_count) if susp_all_count else 0
    print(f"Count: {count_susp}")
    if susp:
        for r in susp:
            print(f"  {r.get('name','?')[:40]:40} type={r.get('source_type','?'):8} errs={r.get('error_count')} last_err={(r.get('last_error') or '')[:60]}")
    print()

    print("=== TOP 10 STATES ===")
    state_rows, _, _ = get("permit_sources", {"enabled": "eq.true", "select": "state", "limit": "20000"})
    if state_rows:
        sc = Counter((r.get("state") or "??") for r in state_rows)
        top = sc.most_common(10)
        print(", ".join(f"{k}={v}" for k, v in top))

if __name__ == "__main__":
    if not KEY:
        print("ERR: SRK env not set", file=sys.stderr)
        sys.exit(1)
    main()
