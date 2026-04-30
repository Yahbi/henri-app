# 01 — Architecture

## TL;DR

438 source files, ~68k LOC, 17-cron production schedule, route groups under control. The 1,116-LOC `LeadDetailDrawer` from yesterday pruned to **1,031 LOC** (−85, −7.6%). Three new dashboard components shipped clean (Applicant/CrossTrade/Watchers Badge — each <120 LOC, properly typed). No structural-shape changes since 2026-04-28; this is feature accretion done well.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-28.

## Layer summary

| Layer | Count | Notes |
|---|---:|---|
| Marketing route groups | `(marketing)` + `(auth)` + `(dashboard)` + portal + onboarding | 5 top-level groups |
| API routes | 98+ | Includes 5 new since prior audit |
| Hooks | 30+ | All run unconditionally; cancellation-safe pattern in I/O hooks |
| Lib subdirectories | `agents/` `auth/` `capacity/` `constants/` `enrichment/` `exclusivity/` `intake/` `license/` `logger.ts` `outreach/` `pdf/` `permits/` `predictive/` `proposals/` `scoring/` `sequences/` `sources/` `supabase/` `tax/` `webhooks/` | 20 subtrees, each cohesive |
| Migrations | 54 (gap at 48–49) | See [02-data-layer.md](./02-data-layer.md) |
| UI primitives | `src/components/ui/*` | 11 components — Button, Card, Dialog, Input, Select, Badge, Skeleton, Toast, FocusTrap, ExpandableBanner, ErrorBoundary |

## Findings

### F1. HEALTHY — LeadDetailDrawer pruned 1,116 → 1,031 LOC (UNCHANGED zone)
**File**: `src/components/dashboard/LeadDetailDrawer.tsx`
**Severity**: Low
**Why it matters**: 2026-04-28 audit's #9 priority was a refactor of this drawer. Net `−85` LOC over 24 hours suggests partial extraction has happened (likely `generateProposal()` factored out per the prior recommendation). Still over the 600-LOC target, so partial progress, not closed.
**Recommended fix**: Continue the extraction — pull contractor/business section into `LeadDetailContractorCard.tsx` (~200 LOC) and the score-breakdown section into `LeadDetailScoreSignals.tsx` (~150 LOC). Target <600 LOC for the drawer shell.
**Delta tag**: IMPROVED.

### F2. HEALTHY — 3 new dashboard components shipped clean
**Files**:
- `src/components/dashboard/ApplicantBadge.tsx` (~65 LOC)
- `src/components/dashboard/CrossTradeOpportunities.tsx` (~116 LOC)
- `src/components/dashboard/WatchersBadge.tsx` (~64 LOC)

**Severity**: Low (positive finding)
**Why it matters**: All three follow CLAUDE.md discipline: typed props, hooks-run-unconditionally, no inline secret/env access, terse JSX. `WatchersBadge` correctly buckets the count to `1-2` / `3-5` / `5+` per wedge bullet #6 (coarse competitive intel — never names). `CrossTradeOpportunities` reads `cross_trade_suggestions` jsonb (migration 00045) with `unknown[]`-typed array narrowing.
**Recommended fix**: None. Reference these as templates for future dashboard widgets.
**Delta tag**: NEW.

### F3. WATCH — `ChatIntakeModal` LOC stable but still over target
**File**: `src/components/intake/ChatIntakeModal.tsx`
**Severity**: Low
**Why it matters**: 1,028 LOC at last measurement. The 2026-04-28 audit flagged it alongside LeadDetailDrawer. No measurable change in 24 hours. Refactor candidate when LeadDetailDrawer extraction is done — same patterns apply (extract question-bank rendering, state-machine into reducer).
**Recommended fix**: Schedule alongside #9 from the top-10 priorities. ~3 hours.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Middleware role-gating intact
**File**: `src/middleware.ts` (184 LOC)
**Severity**: Low (positive finding)
**Why it matters**: Re-read confirms the per-step onboarding gating ladder (license → plan → payment → territory) and the god-mode audit log (line 66 `console.warn` is intentional — Edge runtime cannot import `@/lib/logger`, the comment block at lines 60–65 documents this). Public-route fast-path skips DB roundtrip on every page nav. CLAUDE.md "files not to touch without explicit approval" includes this file; no changes since prior audit.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — UI primitives still the only component source for shipped surfaces
**Severity**: Low (positive finding)
**Why it matters**: `src/components/ui/*` has 11 primitives. New dashboard components (F2) all import from this set rather than re-implementing. Brand discipline holds.
**Delta tag**: UNCHANGED.

## Verdict

Architecture is HEALTHY and stable. Only outstanding architectural work is the LeadDetailDrawer + ChatIntakeModal extraction, which is sequenced behind the higher-leverage type-system + security work in the top-10. No new structural-shape concerns introduced by the launch sprint.
