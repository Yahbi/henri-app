# 03 — Types & hooks

## TL;DR

30 custom React hooks, all with clean unmount cleanup; the `useLeads.ts` retry-on-missing-column pattern is the canonical query template. Type safety has gaps: **53 `as unknown as` casts** trace to hand-written DB types drifting from migrations. Auto-generating types via `supabase gen types` would close ~80%. No leaked subscriptions or timers detected.

## Score

**WATCH** — hooks clean; types need auto-generation to reduce casts.

## Inventory

| Aspect | Count |
|---|---|
| Custom hooks | 30 |
| `as unknown as` casts (src/) | 53 |
| `Record<string,unknown>` casts (src/) | 1 (deliberate fallback mock in `supabase/client.ts:23`) |
| Hand-written DB types | 100% |
| Auto-generated types | 0 (no `src/types/database.ts`) |

## Findings

### F1 — 53 `as unknown as` casts; root cause is type drift from schema

- **Severity**: MEDIUM
- **Files**: scattered; concentrations in `src/lib/enrichment/orchestrator.ts`, `src/app/api/cron/re-enrich/route.ts:141-144`, `src/hooks/useLeads.ts`
- **Why**: When migrations add columns (e.g., 00044 adds `voter_file_id`, `ppp_loan_id`), the hand-written `Lead` interface doesn't pick them up. Casts suppress the type error.
- **Recommendation**: After migrations apply (see 02 F1), run `supabase gen types`. Then audit each cast site.

### F2 — Single `Record<string,unknown>` cast is a deliberate fallback mock

- **Severity**: LOW
- **File**: `src/lib/supabase/client.ts:23`
- **Status**: Acceptable; document with a top-of-line comment.

### F3 — All 30 hooks clean up on unmount (positive)

- **Severity**: HEALTHY
- **Examples**:
  - `useNotifications`: `clearInterval()` in `useEffect` cleanup
  - `useLeads`: React Query handles via `staleTime` + invalidation
  - `useRealtimeLeads` / `useRealtimeNotifications`: Supabase channels unsubscribed
- **Status**: No memory leaks detected.

### F4 — `useLeads` is the canonical lead-query pattern (positive)

- **Severity**: HEALTHY
- **File**: `src/hooks/useLeads.ts`
- **Pattern**: tries SELECT_WIDE → on column-missing error caches the fact and retries with SELECT_NARROW → paginates → memoizes filters. Allows ship-before-migrations-land.
- **Status**: Exemplary. Use as template.

### F5 — Hook dependencies correctly wired (positive)

- **Severity**: HEALTHY
- **Status**: No stale-closure bugs detected.

### F6 — Realtime subscription cleanup is consistent (positive)

- **Severity**: HEALTHY
- **Status**: Supabase `on()` channel + `onAuthStateChange()` both unsubscribed in `useEffect` returns.

### F7 — Type coverage: `src/types/lead.ts` drifts from 00041/00042/00044 columns

- **Severity**: MEDIUM (tied to F1)
- **Recommendation**: Auto-generate per 02 F6.

## Recommendations summary

| Finding | Action | Effort | Blocker |
|---|---|---|---|
| F1 | Auto-generate DB types, refactor casts | 3-4 h | No |
| F2 | Document fallback-mock cast | 5 min | No |
