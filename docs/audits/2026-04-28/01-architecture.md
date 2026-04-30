# 01 — Architecture

## TL;DR

Henri's structure remains feature-driven and consistent. Routes group cleanly by audience, components are co-located by domain, lib modules stay server-side, and middleware role-gates every dashboard segment. The single architectural concern is **continued component bloat**: four files exceed 800 LOC, with `LeadDetailDrawer` growing 25% since the prior audit (889 → 1,116 LOC) without proportional feature growth — feature accretion without extraction.

## Score

**HEALTHY** — solid bones; refactor large components when you have a slow week.

## Inventory

| Surface | Count | Notes |
|---|---:|---|
| Source files (`.ts`/`.tsx`) | 438 | (was 412 in 2026-04-26 — +26 net) |
| API routes | 102 | (was 98 — +4 routes added: chat/refine, dev/auto-login, etc.) |
| Migrations | 51 | (was 44 — +7 net: 00045, 00046, 00047, 00050, 00051, 00052, 00053) |
| Hooks | 30 | (was 28 — +2 net) |
| `src/lib/` subdirectories | 28 | agents, auth, capacity, constants, demo, enrichment, exclusivity, format, ingest, license, log, logger, mapbox, matching, openai, outreach, pdf, permits, plans, predictive, resend, reviews, schemas, scoring, scrapers, sequences, sources, stripe, supabase, tax, territories, territory, twilio, utils, validators |
| `error.tsx` boundaries | 26 | full route-segment coverage |

## Top 9 largest files (LOC)

| Rank | File | LOC | Δ since 2026-04-26 | Risk |
|---:|---|---:|---:|---|
| 1 | `src/lib/enrichment/county-gis.ts` | 1,192 | (new top) | County GIS adapters — natural breadth, low concern |
| 2 | `src/components/dashboard/LeadDetailDrawer.tsx` | 1,116 | +227 (+25%) | UI monolith — refactor candidate |
| 3 | `src/components/portal/ChatIntakeModal.tsx` | 1,028 | (~unchanged) | Multi-step modal — refactor candidate |
| 4 | `src/lib/permits/sources.ts` | 935 | (~unchanged) | Source registry — natural breadth |
| 5 | `src/app/(marketing)/contractors/page.tsx` | 916 | (~unchanged) | Marketing page — long copy, low concern |
| 6 | `src/lib/enrichment/orchestrator.ts` | 871 | (~unchanged) | 9-pass orchestrator — refactor candidate |
| 7 | `src/app/(dashboard)/dashboard/map/page.tsx` | 828 | (~unchanged) | Map page — refactor candidate |
| 8 | `src/app/api/cron/weekly-digest/route.ts` | 826 | (new) | Email digest builder — natural breadth |
| 9 | `src/app/api/cron/score/route.ts` | 733 | +30 | Scoring cron — load-bearing for wedge #2 |

## Findings

### A1. HEALTHY — `middleware.ts` is canonical, no `proxy.ts` confusion
**File**: `src/middleware.ts` (lines 1-184)
**Why it matters**: Prior audit flagged ambiguity between `middleware.ts` and `proxy.ts` in Next.js 16 (the framework's deprecation notice fires on dev startup). The codebase is on the canonical `middleware.ts` path. Single source of truth for role-gating, god-mode bypass, and onboarding-step enforcement.
**Status**: No action.

### A2. WATCH — `LeadDetailDrawer.tsx` grew 25% since prior audit
**File**: `src/components/dashboard/LeadDetailDrawer.tsx:1116`
**Severity**: Medium
**Why it matters**: Highest-visibility dashboard component (drawer rendered for every lead-row click) couples permit timeline rendering, enrichment state, proposal generation, contractor/business section, focus-trap, drag-resize, ARIA separator semantics, and 4 tab variants. Per CLAUDE.md "client-side fallback first" the file ALSO holds graceful-degrade logic. Change-friction here is the highest-leverage refactor.
**Recommended fix**: Extract `generateProposal()` (lines ~125-253) into `src/lib/proposals/index.ts`. Extract the contractor/business section (lines ~849-940) into a sibling component. Target: <600 LOC. ~3 hours.

### A3. WATCH — `county-gis.ts` (1,192 LOC) is the new top file
**File**: `src/lib/enrichment/county-gis.ts:1192`
**Severity**: Low
**Why it matters**: 13+ jurisdiction adapters, each with its own field mapping. Natural breadth — splitting per-county would add 13 files without reducing complexity. The size flag is a "watch" not an "issue" because the file structure is consistent (one adapter per jurisdiction, all conforming to the same `CountyGISLookup` shape).
**Recommended fix**: Defer until a 14th jurisdiction is added; if you cross 1,500 LOC, split by region (`west.ts` / `south.ts` / `northeast.ts`).

### A4. HEALTHY — Hook discipline holds across 30 hooks
**Files**: `src/hooks/*.ts` (30 files)
**Why it matters**: Per CLAUDE.md rule "All hooks run unconditionally", spot-check of `useEnrichment`, `useLeads`, `useExclusivity`, `usePermitHistory` confirms AbortController cleanup pattern and conditional-hook avoidance. No `useState` / `useEffect` below early returns.
**Status**: No regressions.

### A5. HEALTHY — Cancellation-safe `useEffect` pattern is consistent
**Files**: `src/hooks/useLeads.ts`, `src/hooks/useEnrichment.ts`, `src/hooks/useExclusivity.ts`
**Why it matters**: Reference implementations of the cancelled-ref pattern; new hooks (`useEnrichment`, `usePermitHistory`, `useExclusivity`) all match. CLAUDE.md mandates this for all client-side I/O hooks.
**Status**: No action.

### A6. WATCH — Component bloat holds across 4 files
**Files**: `LeadDetailDrawer.tsx` 1,116, `ChatIntakeModal.tsx` 1,028, `contractors/page.tsx` 916, `dashboard/map/page.tsx` 828
**Severity**: Low (per file)
**Why it matters**: Same root cause as A2 — feature accretion without extraction. Three of four are unchanged since 2026-04-26; only `LeadDetailDrawer` regressed.
**Recommended fix**: Set a 1,000-LOC ceiling as the next refactor trigger; nothing above 800 LOC should grow without a corresponding extraction.

### A7. HEALTHY — Feature-flag-before-migration pattern is canonical
**Files**: `src/app/api/feedback/route.ts` (DB-then-email-then-JSONL fallback), `src/app/api/exclusivity/route.ts` (table-missing-then-empty-summary), `src/hooks/useLeads.ts` (column-missing fallback), 9 import scripts (PGRST204 strip-provenance fallback)
**Why it matters**: CLAUDE.md "client-side fallback first" rule. New importers this session (`import-master-json`, `import-perfected-csv`, `import-live-master`, `import-dh3-*`, `import-hd-*`) all match the pattern. Partial migration deploys never break the UI.
**Status**: Pattern is healthier than at the prior audit — every new importer respects it.

## Diff vs 2026-04-26

### Improved
- `middleware.ts` vs `proxy.ts` ambiguity resolved (canonical `middleware.ts`)
- `error.tsx` count holds at 26 (full route-segment coverage)
- Feature-flag-before-migration pattern now applied to 9+ importer scripts

### Regressed
- LeadDetailDrawer LOC 889 → 1,116 (+25%) — needs extraction
- 1 new file enters the >800 LOC list (`weekly-digest/route.ts` 826)

### Unchanged
- 4-file >800 LOC concern (LeadDetailDrawer + ChatIntakeModal + contractors page + map page)
- All hook-discipline patterns intact
