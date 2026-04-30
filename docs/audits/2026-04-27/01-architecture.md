# 01 — Architecture

## TL;DR

Henri's top-level structure is feature-driven and consistent: contractor dashboard at `src/app/(dashboard)`, homeowner portal at `src/app/(homeowner)`, marketing at `src/app/(marketing)`. Component organization is co-located by domain. Middleware enforces role-based redirects with onboarding-step guards. The single architectural risk from the prior audit persists: **four components exceed 800 LOC** (`LeadDetailDrawer` ~1,004, `ChatIntakeModal` ~1,028). Two routing entrypoints (`src/middleware.ts` + `src/proxy.ts`) still lack documented relationship clarity — flagged HIGH because every auth/routing change ships through one of them.

## Score

**HEALTHY** — no architectural debt blocking launch; component extraction is refactor work, not redesign work.

## Inventory (vs. 2026-04-26)

| Surface | Count | Notes |
|---|---|---|
| `(dashboard)/*` routes | 21 | Contractor-only; `requireContractor()` redundantly enforces middleware. |
| `(marketing)/*` routes | 9 | Public; session-only refresh in middleware. |
| `(homeowner)/*` routes | 3 | Authenticated homeowner-only. |
| `(auth)/*` routes | 2 | `/login`, `/signup` — middleware fast-path. |
| `src/app/api/*` route handlers | ~98 | 17 cron, ~45 business-logic, ~20 webhook, ~16 internal/dev. |
| `src/components/ui/*` primitives | 11 | shadcn-derived, consistent. |
| `src/components/dashboard/*` | 19 | 5 components > 200 LOC. |
| `src/components/map/*` | 15 | Maplibre layer + control components. |
| `src/hooks/*` | 30 | All clean cleanup, useLeads canonical. |
| `src/lib/*` modules | 87 across 28 subdirectories | Clear server/client boundary. |
| `src/types/*` | 8 hand-written | No auto-generated `database.ts` (see 02 F6). |
| Total LOC `src/` | ~68.5k | +0.5k from baseline. |

## Findings

### F1 — `ChatIntakeModal` at ~1,028 LOC couples AI orchestration with UI rendering

- **Severity**: MEDIUM
- **File**: `src/components/portal/ChatIntakeModal.tsx`
- **Why**: Prompt engineering, intake state machine, and React rendering entangled in one file. Same finding as baseline.
- **Recommendation**: Extract `src/lib/intake/{prompts,state-machine}.ts`; target ~300 LOC for the React component.

### F2 — `LeadDetailDrawer` at ~1,004 LOC owns rendering + proposal generation + provenance chips

- **Severity**: MEDIUM
- **File**: `src/components/dashboard/LeadDetailDrawer.tsx`
- **Why**: Most-frequently-opened surface; monolith concentrates regression risk. Yesterday's session added the `ProvenanceChip` + `SOURCE_LABELS` (~50 LOC) without splitting.
- **Recommendation**: Extract `generateProposal()` to `src/lib/proposals/generate.ts` with unit tests; extract contractor/business section to its own component.

### F3 — `PermitHistorySection` at ~375 LOC is dense but justified

- **Severity**: LOW
- **File**: `src/components/dashboard/PermitHistorySection.tsx`
- **Status**: Acceptable.

### F4 — `ZoningLayer` at ~401 LOC is a map-layer component, correctly scoped

- **Severity**: LOW
- **File**: `src/components/map/ZoningLayer.tsx`
- **Status**: Acceptable.

### F5 — Route groups segregate concerns correctly

- **Severity**: HEALTHY
- **Files**: `(dashboard) / (marketing) / (homeowner) / (auth)` route groups
- **Status**: Well-executed. Maintain discipline.

### F6 — Three navigation components (MarketingNav, PortalNav, ContractorNav) lack a decision tree

- **Severity**: LOW
- **Recommendation**: 3-line top-of-file comment in `MarketingNav.tsx` with the per-surface mapping.

### F7 — `src/middleware.ts` and `src/proxy.ts` are two routing entrypoints, undocumented relationship

- **Severity**: HIGH
- **Files**: `src/middleware.ts:1-167`, `src/proxy.ts` (load-bearing per CLAUDE.md)
- **Why**: Two files control routing; relationship is opaque. Every auth/routing change touches one of them — risk of silent divergence.
- **Recommendation**: BLOCKING for next routing change. Document handoff in a top-of-file comment OR consolidate into one file.

### F8 — Middleware fast-path skips auth for `/api/*` (intentional)

- **Severity**: HEALTHY
- **File**: `src/middleware.ts:12-20`
- **Status**: Correct pattern; API handlers self-authenticate.

### F9 — Onboarding step order enforced (license → plan → payment → territory)

- **Severity**: HEALTHY
- **File**: `src/middleware.ts:118-136`
- **Status**: Well-implemented; document in code as load-bearing.

## Recommendations summary

| Finding | Action | Effort | Blocker |
|---|---|---|---|
| F1: ChatIntakeModal extraction | Extract prompts + state machine | 2-3 h | No |
| F2: LeadDetailDrawer extraction | Extract proposal gen + business section | 2-3 h | No |
| F7: middleware.ts + proxy.ts undocumented | Document or consolidate | 1-2 h | Yes for next routing change |
