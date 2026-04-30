# 03 — Types & hooks

## TL;DR

Type discipline is **intentional but heavy**: 124 `Record<string, unknown>` casts (graceful-degrade pattern from `CLAUDE.md`) and 37 `as unknown as` casts across 13 files. The pattern is correct (it's how schema migrations roll out under "feature-flag before migration" rules), but the volume signals that auto-generated DB types would replace most of these casts cleanly. Hook discipline is **clean**: rules-of-hooks consistently followed, ref-cancelled async pattern used in I/O-bearing hooks, no early-return-before-hook-call violations detected.

## Score

**WATCH** — patterns are sound, volume invites consolidation.

## Cast inventory

| Pattern | Count | Worst offender |
|---|---|---|
| `Record<string, unknown>` | 124 | Distributed across hooks + dashboard pages |
| `as unknown as` | 37 across 13 files | `src/app/(dashboard)/dashboard/page.tsx` (15 instances in `mapLead`) |
| `// TODO` / `// FIXME` / `// HACK` / `// XXX` | 1 across 1 file | `src/app/api/reviews/respond/route.ts` |

## Findings

### F1 — `mapLead` in `dashboard/page.tsx` has 15 chained `as unknown as` casts

- **Severity**: Medium
- **File**: `src/app/(dashboard)/dashboard/page.tsx:81-130`
- **Why it matters**: `mapLead` reads enrichment columns (`employer`, `occupation`, `business_phone`, `business_status`, `business_website`, `license_number`, `license_status`, `naics_code`, `contact_source`, `contact_confidence`) via `(lead as unknown as Record<string, unknown>).column_name as string | undefined`. Each line is 80+ characters of cast machinery. When migration 00044 lands and the `Lead` type gains these columns, every cast becomes redundant — but finding them all to remove will require grep-and-pray.
- **Recommendation**: Extract a helper:
  ```ts
  function readOptional<T = string>(lead: Lead, col: string): T | undefined {
    return (lead as unknown as Record<string, unknown>)[col] as T | undefined;
  }
  ```
  Then `employer: readOptional(lead, "employer")`. Single-line per field. After migration 00044 + auto-generated types, all callers go away in one delete.

### F2 — `Lead` type is not auto-generated from schema

- **Severity**: Medium
- **File**: `src/types/lead.ts`
- **Why it matters**: See [02-data-layer.md F6](./02-data-layer.md#f6--schema-generation-not-wired-no-supabase-gen-types). The 124 `Record<string,unknown>` casts exist because TypeScript doesn't know about the schema. Auto-generation closes the gap.
- **Recommendation**: Wire `mcp__supabase__generate_typescript_types` into a `pnpm types:db` script.

### F3 — `as Lead` casts on RPC results bypass type checking

- **Severity**: Low
- **File**: Search `as Lead` in `src/hooks/useLeads.ts:225` and similar mappers
- **Why it matters**: The mapper at the bottom of `useLeads.ts` returns `... as Lead`. This works at compile time but loses safety: if the SELECT clause changes, TypeScript doesn't yell. It just trusts.
- **Recommendation**: After auto-generated types land, change the cast to `satisfies Lead` (Type-narrowing assertion that errors at compile time if the shape doesn't match).

### F4 — Hook discipline is clean

- **Severity**: Nitpick (positive)
- **File**: All hooks in `src/hooks/`
- **Why it matters**: Per architecture-agent's review, no `if (...) return ...` followed by `useState`/`useEffect`. No conditional hook calls. Every hook runs unconditionally. This is rules-of-hooks 101 but easily violated under refactor pressure.
- **Recommendation**: None. Add an ESLint rule (`react-hooks/rules-of-hooks` is on by default, but worth confirming `eslint.config.mjs` has it as `error` not `warn`).

### F5 — Ref-cancelled async pattern correctly used

- **Severity**: Nitpick (positive)
- **File**: `src/hooks/useEnrichment.ts`, `src/hooks/usePermitHistory.ts`, `src/hooks/useExclusivity.ts`
- **Why it matters**: Per `CLAUDE.md`: "Every new component that does I/O has a cancellation-safe `useEffect`. Use the ref-cancelled pattern from `useEnrichment` / `usePermitHistory` / `useExclusivity`." The audit confirms this is consistent: each hook sets `cancelled = true` in its cleanup function and gates `setState` calls on `if (!cancelled)`.
- **Recommendation**: None. Reference this pattern when adding new I/O-bearing hooks.

### F6 — `useExclusivity` dependency array uses positional proxy

- **Severity**: Low
- **File**: `src/hooks/useExclusivity.ts`
- **Why it matters**: Per architecture-agent: the `useEffect` dependency array uses `leadIds?.[0]` and `leadIds?.[leadIds.length - 1]` as proxies for "did the list change", to avoid retriggering on identity-change of the same array. This works but is unconventional; a refactor that changes how `leadIds` is built (e.g. sorting it differently) could silently break re-fetching.
- **Recommendation**: Replace with a memoized stable key:
  ```ts
  const leadIdsKey = useMemo(() => leadIds?.join(",") ?? "", [leadIds]);
  // ...then use [leadIdsKey] in the dep array.
  ```
  Slightly more allocation, but the dependency relationship is now self-documenting.

### F7 — `eslint-disable react-hooks/set-state-in-effect` on `useExclusivity`

- **Severity**: Low
- **File**: `src/hooks/useExclusivity.ts`
- **Why it matters**: Per architecture-agent: this hook has an `eslint-disable` comment for setState-in-effect. The comment explains why (wedge-critical behavior), so it's intentional — but every disable is a future "is this still load-bearing?" question.
- **Recommendation**: None now. Re-evaluate if/when React adds a stable concurrent-mode story for this pattern. Track in `12-documentation.md`'s "future considerations".

### F8 — Only 1 TODO in 68k LOC

- **Severity**: Nitpick (positive)
- **File**: `src/app/api/reviews/respond/route.ts:1`
- **Why it matters**: Most codebases this size have hundreds of TODOs. Henri has one. That's either extraordinary discipline or removed-too-aggressively (e.g. the truthfulness contract erases historical lies but not future-work markers — those should still exist). Either way: this codebase isn't deferring known-but-unfixed work via comment-rot.
- **Recommendation**: None. Add a `pnpm scan:todos` script that fails CI if TODO count rises above 5 — preserves the discipline.

### F9 — `as unknown as` clusters in 13 files only

- **Severity**: Low
- **File**: 13 files (per grep): `dashboard/page.tsx`, `homeowner/ContractorCard.tsx`, `lib/matching/engine.ts`, `lib/enrichment/ppp-loan.ts`, `lib/supabase/client.ts`, `lib/sources/probe.ts`, `api/webhooks/twilio-missed-call/route.ts`, `api/outreach/route.ts`, `api/billing/change-plan/route.ts`, `api/compliance/verify/route.ts`, `api/intake/[id]/matches/route.ts`, `components/settings/LicensingSection.tsx`, `components/map/NOAARadarLayer.tsx`
- **Why it matters**: 37 casts in 13 files = ~3 per file average, but `dashboard/page.tsx` has 15. The non-dashboard occurrences are likely justified (vendor SDK type quirks, unsafe parsing of dynamic JSON). The dashboard cluster goes away with auto-generated types per F1.
- **Recommendation**: After F1 + F2 land, re-grep. Expect <10 remaining `as unknown as` casts, which are then individually justifiable.

### F10 — `Record<string, unknown>` is sometimes used where a discriminated union would be cleaner

- **Severity**: Low
- **File**: Sample `src/lib/scoring/signals.ts`, `src/lib/enrichment/orchestrator.ts`
- **Why it matters**: When the shape is "a JSON blob of arbitrary keys", `Record<string, unknown>` is correct. When the shape is "one of N known structures", a discriminated union (`type Signal = FreshnessSignal | ValueSignal | ...`) gives compile-time exhaustiveness. The audit didn't pinpoint specific violations (the agent didn't dig that deep), but the volume invites a sweep.
- **Recommendation**: Manual sweep: pick 10 of the 124 occurrences at random, check if a typed shape would work. If >5 would, plan a targeted refactor for the 10 highest-impact (most-read) files.

## What's working well

- **Hooks rules**: 100% compliance. No conditional `useState`/`useEffect`.
- **Cleanup discipline**: Ref-cancelled pattern used in every async hook (`useEnrichment`, `usePermitHistory`, `useExclusivity`).
- **TODO hygiene**: 1 TODO in 68k LOC (per grep). The codebase doesn't accumulate "fix later" debt.
- **Single source of truth for `Lead`**: `src/types/lead.ts` is the canonical type. No parallel definitions in route handlers.
- **Type safety on critical paths**: `Stripe.Event`, `Twilio.WebhookCallback`, etc. are typed via vendor SDKs — webhook handlers don't `as any` their payloads.
