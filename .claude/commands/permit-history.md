---
description: Print every permit on file for a property address (or a partial match).
argument-hint: <address> [--zip=NNNNN]
---

Quick operational look-up. Uses the live `/api/permits/history` endpoint (same data the lead-detail drawer renders).

## Steps
1. Ensure `/dev-login` has run this session.
2. Hit the endpoint:
   ```
   ADDR="$1"
   ZIP="${ZIP:-}"
   curl -s -b /tmp/c.txt "http://localhost:3000/api/permits/history?$(node -e "console.log(new URLSearchParams({address: process.argv[1], zip: process.argv[2]||''}).toString())" -- "$ADDR" "$ZIP")" -o /tmp/ph.json
   ```
3. Pretty-print:
   ```
   node -e "
   const j=JSON.parse(require('fs').readFileSync('/tmp/ph.json','utf8'));
   const p=j.permits||[];
   console.log('=== ' + p.length + ' permits at ' + (p[0]?.address || process.argv[1]) + ' ===');
   for (const r of p) {
     const v = r.estimated_value ? '$' + r.estimated_value.toLocaleString() : '—';
     console.log([r.issued_date?.slice(0,10) || 'no date', r.permit_type || '—', (r.status||'—').padEnd(10), r.permit_number || '—', v, (r.description||'').slice(0,80)].join('  |  '));
   }
   " -- "$ADDR" "$ZIP"
   ```

## When to use
- Verifying the Lead detail drawer's "Permit History at this Property" matches ground truth
- Diagnosing a contractor's complaint ("why am I seeing permit X but not permit Y at the same address?")
- Spotting multi-permit cascade properties manually before the scorer's cascade flag fires

## Notes
- Zip is optional but highly recommended — without it, the endpoint falls back to a 25-row full-table ilike scan.
- Address matches on the street-portion only (everything before the first comma). `642 PARK ST` matches `642 PARK ST, HARTFORD, CT 06106`.
