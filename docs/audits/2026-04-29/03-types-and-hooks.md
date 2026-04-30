# 03 — Types & hooks

## TL;DR

`as unknown as` count: **53 → 54** (+1, essentially flat). `Record<string, unknown>` count: **141 → 153** (+12, all from 3 new dashboard components reading nested permit/contractor data). `as any | : any`: **17 → 13** (−4, IMPROVED). All hooks run unconditionally; no rules-of-hooks violations. The auto-generated `src/types/database.ts` recommendation from yesterday is still the single best fix to close ~50% of remaining casts.

## Score

**WATCH** — UNCHANGED vs 2026-04-28. Improvement on `as any` is real but the structural fix (auto-gen types) is still pending.

## Findings

### F1. WATCH — `as unknown as` casts cluster in 4 files (root cause: untyped Supabase joins)
**Hotspots**:

| File | Casts | Root cause |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 18 | `mapLead()` reading the `permits(...)` join shape |
| `src/components/homeowner/ContractorCard.tsx` | 7 | Reading nested contractor profile children |
| `src/lib/enrichment/ppp-loan.ts` | 3 | API response shape coercion |
| `src/components/dashboard/LeadDetailDrawer.tsx` | 3 | Same as page.tsx (permits join) |
| Other | 23 | Spread across 20 files |

**Severity**: Medium
**Why it matters**: CLAUDE.md "type discipline" — every cast is a place where TypeScript doesn't help. The biggest cluster (`mapLead()`) is structural: until `permits` join shape is a proper type, every read needs the cast. The launch-sprint commits added only 1 net cast (vs the +30 Agent 3 estimated — verified via per-file count). The system is stable; it's just that the structural fix hasn't shipped.
**Recommended fix**: Run `mcp__supabase__generate_typescript_types` → write to `src/types/database.ts` → import the `Database` type → derive `LeadWithPermits = Database['public']['Views']['leads_with_permits']['Row']` (or equivalent). Refactor `mapLead()` and `ContractorCard` to read the typed shape. Target: −25 casts. ~2 hours.
**Delta tag**: UNCHANGED.

### F2. WATCH — `Record<string, unknown>` count grew 141 → 153 (+12)
**Severity**: Low
**Why it matters**: All +12 are in the 3 new dashboard components (`CrossTradeOpportunities`, `ApplicantBadge`, `WatchersBadge`) reading nested suggestion/permit data. They're not regressions — they're the natural side-effect of new components reading legacy un-typed payload shapes. Same root cause as F1; same fix.
**Recommended fix**: Same as F1.
**Delta tag**: REGRESSED (+12) but same root cause.

### F3. IMPROVED — `as any | : any` count 17 → 13 (−4)
**Severity**: Low (positive finding)
**Why it matters**: 4 fewer untyped escape hatches than yesterday. The remaining 13 are concentrated in:
- `src/hooks/useLeads.ts:7` (one `as any` for the wide → narrow fallback type-coercion in the migration-gap path; defensible)
- `src/components/map/MapStyleSwitcher.tsx`, `FEMAFloodLayer.tsx`, `CensusLayer.tsx` (MapLibre style spec types)
- `src/lib/enrichment/__tests__/orchestrator.test.ts:3` (mock typing, acceptable)
- `src/lib/pdf/proposal-renderer.tsx:1` (pdfkit types)

**Recommended fix**: None — these are pragmatic. Track the count weekly; flag if it climbs above 20.
**Delta tag**: IMPROVED.

### F4. HEALTHY — Hooks discipline holds
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked `useLeads`, `useEnrichment`, `usePermitHistory`, `useExclusivity`, `useStripeTax`, `usePermitDetail`, `useReferrals`. All run unconditionally before any conditional `return null`. All I/O hooks use the ref-cancelled pattern. New `useStripeTax` and `usePermitDetail` (added in launch sprint) follow the established conventions.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. WATCH — `useLeads` wide → narrow fallback still uses `as any`
**File**: `src/hooks/useLeads.ts` (line marked in audit search)
**Severity**: Low
**Why it matters**: The migration-gap fallback path needs to coerce the narrow-row shape into the wide type. There's no clean type for "Lead missing extended columns". Defensible but worth a comment.
**Recommended fix**: Replace with `as Lead` after annotating the narrow result type via `Pick<Lead, NarrowKeys>`. Optional polish; can wait until F1 lands and the wide type is auto-generated.
**Delta tag**: UNCHANGED.

## Verdict

Types & hooks is WATCH but trending right. The single structural fix (auto-gen `database.ts` + refactor `mapLead`) closes the dominant cluster. Everything else is acceptable noise. Hook discipline is healthy with no regressions in the launch sprint.
