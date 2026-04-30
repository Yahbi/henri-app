# 03 — Types & hooks (2026-04-30)

## TL;DR

`as unknown as` 54 → 58 (+4); `as any` 15 → 14 (−1); `Record<string, unknown>` 153 → 158 (+5). All +4 cast bumps are concentrated in `src/app/(dashboard)/dashboard/page.tsx` (now 18 casts) — the highest cluster in the codebase. Hook discipline is HEALTHY: 34 hooks total, all run unconditionally, all I/O hooks use the cancellation-safe pattern. No hook called below a conditional return.

## Score

**WATCH** — REGRESSED on cast count vs 2026-04-29 (+4). HEALTHY on hook discipline.

## Cast cluster map (≥3 `as unknown as` casts per file)

| File | Casts | Driver |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 18 | Lead-row property access via `(lead as unknown as Record<string, unknown>).fieldName` |
| `src/components/homeowner/ContractorCard.tsx` | 7 | Contractor-shape variance per API response (response_time_h, license_state, insured, etc.) |
| `src/components/dashboard/LeadDetailDrawer.tsx` | 3 | Post-refactor minimal; nested permit field access |
| `src/lib/enrichment/ppp-loan.ts` | 3 | PPP JSON parsing |

## Findings

**F1** | **High** | `src/app/(dashboard)/dashboard/page.tsx:81-138` (representative span)
- **Issue**: 18 `as unknown as Record<string, unknown>` casts in the dashboard's lead-row mapper. Pattern: `(lead as unknown as Record<string, unknown>).year_built`, `(lead as unknown as Record<string, unknown>).owner_name`, etc.
- **Why it matters**: Type casting masks structural issues in the `Lead` union. Future column additions (today: `last_sale_date`, `last_sale_price`, `claim_risk` per the Tier 4 plan in `~/.claude/plans/composed-questing-lighthouse.md`) require defensive cast updates everywhere this pattern repeats.
- **Recommended fix**: Run `mcp__supabase__generate_typescript_types` → `src/types/database.ts`, refactor `useLeads.helpers.ts:mapRowsToLeads` (3 casts) and `dashboard/page.tsx` to read typed columns. Closes ~50% of the codebase's 58-cast count. ~2 hours.

**F2** | **Medium** | `src/components/homeowner/ContractorCard.tsx` (7 casts, line cluster around field access)
- **Issue**: Contractor object field type narrowing via `(c as unknown as { fieldName?: Type }).fieldName ?? fallback`
- **Why it matters**: Acceptable for now — shape varies per API response, nullish coalescing is defensive — but if the contractor API contract were typed (Zod schema parsing on the response side), these casts would disappear.
- **Recommended fix**: Add a `ContractorCardData` Zod schema to `src/lib/schemas/api.ts`, `.parse()` the API response client-side. Eliminates all 7 casts. ~30 min.

**F3** | **Low** | `Record<string, unknown>` count 153 → 158 (+5)
- **Issue**: Increment is concentrated in the same dashboard/page.tsx area; mostly a side-effect of the type-casting style.
- **Why it matters**: Same as F1 — closes when DB types land.
- **Recommended fix**: Same as F1.

## Hook discipline

**Total hooks**: 34 (was 30+ on 04-29).

### Cancellation-safe pattern verification

Sampled the I/O hooks for the cancellation-safe `cancelled` ref pattern:

| Hook | Pattern | Status |
|---|---|---|
| `src/hooks/useLeads.ts` | React Query queryFn + optimistic updates + module-scoped `extendedColumnsMissing` flag | ✓ HEALTHY |
| `src/hooks/useEnrichment.ts` | `cancelled` ref + cleanup return | ✓ HEALTHY |
| `src/hooks/useExclusivity.ts` | `cancelled` ref + early return + graceful-degrade on endpoint failure | ✓ HEALTHY |
| `src/hooks/usePermitHistory.ts` | `cancelled` ref + finally-block safety + idempotent dedup key | ✓ HEALTHY |
| `src/hooks/useBenchmarks.ts` | Same pattern | ✓ HEALTHY |
| `src/hooks/useCapacityPrefs.ts` | Same pattern | ✓ HEALTHY |
| `src/hooks/useContractorSearch.ts` | Same pattern | ✓ HEALTHY |
| `src/hooks/useDrawerResize.ts:166` | **VIOLATION** — `setLocalHeight()` called synchronously inside `useEffect` body (lint error) | ⚠ ISSUE |

### Conditional-hook check

`grep -n "if (.*return.*;" src/hooks/*.ts -A 5 | grep -E "use(State|Effect|Memo|Callback|Ref)"` returned no matches where a hook is called below a conditional return. **All hooks run unconditionally** ✓

## Findings (continued)

**F4** | **Medium** | `src/hooks/useDrawerResize.ts:166`
- **Issue**: Lint error `react-hooks/set-state-in-effect`. Code:
  ```ts
  useEffect(() => {
    if (!dragging.current) {
      setLocalHeight(Math.max(minHeight, height || minHeight));
    }
  }, [height, minHeight]);
  ```
- **Why it matters**: Synchronous setState within useEffect causes cascading renders. React 19's tightened lint catches this. CI failing on it.
- **Recommended fix**: Lift the derivation to a `useMemo` that reads `height + minHeight` directly, eliminating the effect:
  ```ts
  const derivedHeight = useMemo(
    () => Math.max(minHeight, height || minHeight),
    [height, minHeight]
  );
  // use derivedHeight when !dragging.current, otherwise localHeight
  ```
  Or move the assignment to the dragend handler so it fires once on release. ~30 min.

## TODO/FIXME/HACK/XXX inventory

9 instances across 8 files (was similar count on 04-29). Sampled — none are code-smell flags, all are intentional reminders or migration markers. HEALTHY.

## Closing

Type discipline is regressing modestly because the auto-generated types haven't landed and the dashboard page keeps absorbing new lead fields via casts. The hook discipline remains exemplary except for the one `useDrawerResize.ts` lint error that's been pre-existing for several audits — needs fixing now that React 19's set-state-in-effect rule fires hard.
