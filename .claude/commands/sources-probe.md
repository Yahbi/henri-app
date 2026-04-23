---
description: Run the permit-source catalog probe. Re-qualifies enabled sources against the current heuristics.
argument-hint: [--limit=N] [--only-reachable] [--requalify]
---

The permit-source catalog has ~20,568 rows; ~1,861 are currently enabled after the Phase-5 topical-gate tightening. This command re-runs the probe / re-qualifier to keep the enabled set honest as we refine the heuristics.

## Steps

### Mode A — probe new candidates (`/sources-probe --limit=300`)
```
cd "C:/Users/yabis/Desktop/Henri App"
PROBE_LIMIT=${LIMIT:-300} npx tsx scripts/bulk-probe-sources.ts
```
Pick the 300 oldest-unprobed rows, run the field-inference + topical gate, flip `enabled=true` on any that pass. Typical yield: ~15% enable rate post-gate tightening.

### Mode B — requalify existing enabled sources (`/sources-probe --requalify`)
```
npx tsx scripts/requalify-enabled-sources.ts
```
Re-probes every currently-enabled row. Demotes off-topic ones (water boundaries, parks, air districts) to `enabled=false, error_count=50`. Keeps the set trustworthy as `lib/sources/probe.ts` heuristics evolve.

### Mode C — full audit (`/sources-probe --audit`)
```
npx tsx scripts/audit-desktop-sync.ts
```
Reports `permit_sources: total / enabled / unprobeable / quarantined` — the canonical health snapshot.

## Report
```
Probed: N sources
  enabled:            +K (total now: E)
  reachable-no-mapping: R
  unreachable:         U

Requalify: demoted D sources (off-topic)
Audit:     total=T  enabled=E  unprobeable=U  quarantined=Q
```

## When to run
- After editing `src/lib/sources/probe.ts` — always requalify.
- Weekly against a batch of unprobed rows to grow the enabled set.
- After pasting a new batch of catalog rows (e.g. from a state-level dump).
