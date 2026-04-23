---
description: Print the current phase status against the active plan. Phase 0a → Phase E readout.
---

Re-read `~/.claude/plans/distributed-growing-quiche.md` and produce a crisp phase-by-phase status.

## Steps
1. Read the plan file in full.
2. For each Phase (0a, 0b, A, B, C, D, E), walk the deliverables and mark each:
   - `✓` — code merged, wired, verified in preview
   - `◐` — code merged but DB/env/keys pending (graceful-degrade active)
   - `○` — not started
3. Cross-reference actual state:
   - Migrations: list files in `supabase/migrations/` numbered ≥ 00031
   - Hooks: `ls src/hooks/use{Jobs,Invoices,ChangeOrders,Inventory,Checklists,Crew,Exclusivity,CapacityPrefs,MarketIntel,PermitHistory}.ts`
   - Components: `ls src/components/dashboard/{Exclusivity,ScoreSignal,Capacity,MarketIntel,Competitive}*.tsx`
   - API routes: `ls src/app/api/{jobs,invoices,change-orders,inventory,checklists,crew,exclusivity,capacity,market-intel}/route.ts`

## Report format
```
=== Henri roadmap — <today> ===

Phase 0a — Wedge foundations (week 1)
  ✓ Migration 00031 authored
  ◐ score_signals writer (pending migration apply)
  ✓ Score breakdown UI
  ✓ Exclusivity lock lib + API + badge
  ◐ Exclusivity badge on Kanban cards (skeleton code, pending)
  ✓ Capacity prefs full stack
  ○ Outreach template seeds
  ◐ Billing no-lock-in footer
  ○ Validation-interview CRM

Phase 0b — Pre-permit + market intel (week 2)
  ○ …

Phase A — Jobs first-class (1 week)
  ○ …

...

Next concrete action: <one line — the cheapest thing that moves the most glyphs from ◐ to ✓>
```

Keep the whole report under 60 lines. Surface the single next action, not a novel.
