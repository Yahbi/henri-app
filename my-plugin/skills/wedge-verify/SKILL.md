---
name: wedge-verify
description: Verify all 6 wedge contract bullets are still implemented in code. Run before each release.
---

# Wedge contract verification

Asserts the 6 wedge bullets from `CLAUDE.md` lines 49-56 still exist in code. The wedge IS the product — if any bullet regresses, customers leave.

## What to verify

### Bullet 1 — Exclusivity (per permit, per trade, 14-day window)

```bash
# Confirm the locks module + migration exist
test -f src/lib/exclusivity/locks.ts || echo "FAIL: locks.ts missing"
grep -q "lock_acquired_at" supabase/migrations/00031_*.sql || echo "FAIL: lock schema missing"
grep -q "interval '14 days'" supabase/migrations/00031_*.sql || echo "FAIL: 14-day window missing"
```

### Bullet 2 — Transparent 6-signal scoring

```bash
# Drawer must render 6 score bars unconditionally (no height gate)
grep -q "ScoreSignalBreakdown" src/components/dashboard/LeadDetailDrawer.tsx
test -f src/components/dashboard/ScoreBreakdown.tsx
# Confirm no height gate around the score
! grep -E "localHeight\s*>\s*\d+" src/components/dashboard/LeadDetailDrawer.tsx
```

### Bullet 3 — Capacity respected

```bash
test -f src/lib/capacity/types.ts
grep -q "applyCapacityFilter" src/lib/capacity/types.ts
grep -q "filtered out" src/components/dashboard/CapacityFilterBar.tsx || echo "WARN: counter copy may have drifted"
```

### Bullet 4 — Outreach is permit-specific

```bash
# Every shipped template must reference at least one permit token
pnpm test:templates  # if this script exists; otherwise grep
grep -L "permit_number\|permit_type\|address\|permit_value" src/lib/sequences/templates.ts && echo "FAIL: generic template found"
```

### Bullet 5 — Speed-to-lead is mechanical (Twilio missed-call text-back)

```bash
test -f src/app/api/webhooks/twilio-missed-call/route.ts
# Confirm a Vercel cron fires the missed-call workflow
grep -q "twilio-missed-call" vercel.json || echo "INFO: webhook is vendor-driven, not cron-driven"
```

### Bullet 6 — Coarse competitive intel

```bash
test -f src/components/dashboard/WatchersBadge.tsx
# Confirm the bucket shape (1-2 / 3-5 / 5+), never raw count
grep -q "bucket" src/lib/exclusivity/locks.ts
# Confirm names are NEVER exposed
! grep -E "watchers.*name\|watcher_user_id" src/components/dashboard/WatchersBadge.tsx
```

## Output format

```
=== WEDGE CONTRACT VERIFICATION ===

  ✓ Bullet 1 — Exclusivity locks per (permit, trade)
  ✓ Bullet 2 — 6-signal score breakdown unconditional
  ✓ Bullet 3 — Capacity filter with "N filtered out" counter
  ✓ Bullet 4 — All templates reference permit tokens
  ✓ Bullet 5 — Missed-call text-back webhook exists
  ✓ Bullet 6 — Watchers shown as bucket, never names

Verdict: PASS
```

## When this fails

Any failure means a wedge regression. Block the release until:

1. The failing bullet's code is restored
2. A unit test pins the contract (so future refactors fail loud)
3. The PR description documents what regressed and why it's now fixed

The wedge is not negotiable per the audit's [10-brand-and-wedge.md](../../../docs/audits/2026-04-26/10-brand-and-wedge.md).
