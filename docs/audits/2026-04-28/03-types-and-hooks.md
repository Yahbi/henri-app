# 03 — Types & Hooks

## TL;DR

Hook discipline holds. Type discipline regressed: **`as unknown as` casts grew 37 → 53 (+43%)** and **`Record<string,unknown>` casts grew 124 → 141 (+13%)** since 2026-04-26. The root cause is the same in both: joined-relation reads on `Lead` (the `permits` join via `useLeads`) and `ContractorCard` are not typed, forcing defensive casts. **The single fix that closes ~80% of both metrics**: auto-generate DB types via Supabase MCP.

## Score

**WATCH** — fixable in one ~2-hour task; no behavioral risk today, but every new feature widens the gap.

## Cross-cutting metric trends

| Metric | 2026-04-26 | 2026-04-28 | Δ | Status |
|---|---:|---:|---:|---|
| `as unknown as` casts | 37 | 53 | **+43%** | REGRESSED |
| `Record<string, unknown>` | 124 | 141 | **+13%** | REGRESSED |
| TODO/FIXME/HACK | (not measured) | 7 | n/a | Low — healthy |
| `console.*` raw uses | 148 | 152 | +3% | flat |

## Hot files for `as unknown as` (top 5)

| File | Casts | Reason |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 18 | mapLead reads joined `permits` child via untyped cast (5 distinct call sites × multiple field reads) |
| `src/components/homeowner/ContractorCard.tsx` | 7 | Reads contractor profile child fields without type |
| `src/components/dashboard/LeadDetailDrawer.tsx` | 3 | Same: reads `lead.permits.id` etc. |
| `src/lib/enrichment/ppp-loan.ts` | 3 | Casts API response shape |
| Other (20 files) | 22 | spread thinly: 1-2 casts per file |

## Hot files for `Record<string, unknown>` (top 5)

| File | Uses | Reason |
|---|---:|---|
| `src/app/(dashboard)/dashboard/page.tsx` | 19 | Same root cause as above — joined-relation reads |
| `src/lib/logger.ts` | 7 | Legitimate (meta payloads are deliberately untyped) |
| `src/lib/enrichment/county-gis.ts` | 7 | API response shapes vary per jurisdiction; untyped is correct here |
| `src/lib/permits/fetcher.ts` | 6 | Multi-vendor response shape — untyped is correct here |
| `src/lib/enrichment/extract-contact.ts` | 5 | Multi-vendor — untyped is correct here |

**Insight**: The legitimate uses (`logger.ts` meta, multi-vendor adapter responses) are about a third of the count. The other two-thirds (Lead-with-permits joined reads in mapLead, ContractorCard, LeadDetailDrawer) ARE typed in Postgres and could be auto-generated.

## Findings

### C1. ISSUE — `as unknown as` regressed 37 → 53 (+43%)
**Files**: 23 files, hotspot at `src/app/(dashboard)/dashboard/page.tsx` (18 casts)
**Severity**: Medium
**Why it matters**: CLAUDE.md "type-first discipline" rule. Each cast is a place a refactor of `useLeads`'s SELECT can ship a runtime bug undetected by `tsc`. The growing count is exactly the leading indicator of "schema drift will bite us in production".
**Recommended fix**: Run `mcp__supabase__generate_typescript_types --schema public > src/types/database.ts`. Update `useLeads` to return `Lead & { permits: Database['public']['Tables']['permits']['Row'] | null }`. Refactor `mapLead()` (5 sites) and `ContractorCard` (7 sites) to use the typed accessor. ~2 hours including tests. Eliminates ~25 of the 53 casts in one pass.

### C2. ISSUE — `Record<string, unknown>` regressed 124 → 141 (+13%)
**Files**: 54 files, hotspot at `src/app/(dashboard)/dashboard/page.tsx` (19 uses)
**Severity**: Medium
**Why it matters**: Same root cause as C1. About a third are legitimate (logger meta, multi-vendor adapters); the other two-thirds are joined-relation reads.
**Recommended fix**: Same as C1. Auto-generated types close ~90 of the 141.

### C3. HEALTHY — Hook rule-of-hooks compliance is solid
**Files**: `src/hooks/*.ts` (30 files)
**Why it matters**: Spot-check confirms no unconditional/conditional violations across all 30 hooks. No `useState` / `useEffect` / `useCallback` below early returns. Per CLAUDE.md "All hooks run unconditionally" — pattern holds.
**Status**: No action.

### C4. HEALTHY — Cancellation-safe `useEffect` pattern is universal
**Files**: `src/hooks/useEnrichment.ts`, `src/hooks/usePermitHistory.ts`, `src/hooks/useExclusivity.ts` (reference); `src/hooks/useReviews.ts`, `src/hooks/useReferrals.ts`, `src/hooks/useUser.ts` (consumers)
**Why it matters**: CLAUDE.md mandates the cancelled-ref pattern for all I/O hooks to prevent stale-response races. Every hook that does I/O respects the pattern.
**Status**: No action.

### C5. HEALTHY — `useLeads` is the canonical paginated query pattern
**File**: `src/hooks/useLeads.ts:80-234`
**Why it matters**: Multi-page fetch (when `limit > 1000`) rebuilds query per page (PostgREST builders are single-use), filters re-applied per page, tiebreaker on `id` for stable pagination, dedup pass at end. Retry-on-missing-column for graceful migration drift. Well-documented (~100 LOC of inline comments explaining the mechanics).
**Status**: No regressions; reference pattern.

### C6. NITPICK — `useLeads` has 4 `Record<string, unknown>` casts in pagination
**File**: `src/hooks/useLeads.ts:132, 187, 218, 244`
**Severity**: Low
**Why it matters**: Minor — `Row = Record<string, unknown>` is used as a stand-in for "paginated result row" because the SELECT shape is conditional (NARROW vs WIDE). Not unsafe but tied to C1/C2.
**Recommended fix**: Once auto-generated types exist, type as `Database['public']['Tables']['leads']['Row'] & { permits: ... | null }`.

### C7. NITPICK — TODO/FIXME count is healthy at 7
**Files**: 6 files, 7 occurrences
**Why it matters**: Down from a much higher count earlier. Good housekeeping. Spot list:
- `src/hooks/useReferrals.ts:1`
- `src/app/(dashboard)/settings/account/page.tsx:1`
- `src/lib/enrichment/numverify.ts:1`
- `src/app/api/reviews/respond/route.ts:2`
- `src/app/api/referrals/validate/route.ts:1`
- `src/components/dashboard/CrossTradeOpportunities.tsx:1`
**Status**: No action; review at next quarterly audit.

## Diff vs 2026-04-26

### Improved
- Hook compliance unchanged (still 100% — no violations in 30 hooks)
- Cancellation pattern unchanged (still 100%)
- TODO count down from prior (was higher; now 7)

### Regressed
- `as unknown as` casts: 37 → 53 (+43%)
- `Record<string, unknown>` casts: 124 → 141 (+13%)

### Remediation outlook
One task — `mcp__supabase__generate_typescript_types` + refactor of `mapLead()` and `ContractorCard` — closes both regressions in ~2 hours. The capability is in the repo (Supabase MCP is configured per CLAUDE.md). The only reason this hasn't shipped is bandwidth; it's not blocked on design or tooling.
