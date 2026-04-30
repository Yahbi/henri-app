# 01 — Architecture (2026-04-30)

## TL;DR

467 source files (was 438), ~81.8k LOC (was ~68k), 103 API routes (was 98+), 34 hooks (was 30+), 58 migrations (was 54), 11 UI primitives, 5 route groups. **LeadDetailDrawer refactor is complete**: 1031 → 374 LOC (−63%). **ChatIntakeModal split** into shell (581 LOC) + steps (545 LOC) with BackLink component added today. No new structural patterns; this is feature accretion done well.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-29.

## Layer summary

| Layer | Count | Notes |
|---|---:|---|
| Marketing route groups | `(marketing)`, `(auth)`, `(dashboard)`, `(homeowner)`, portal, onboarding | 5 top-level groups + portal/onboarding standalone |
| API routes | 103 | +5 since 04-29 |
| Hooks | 34 | All run unconditionally; cancellation-safe pattern in I/O hooks |
| Lib subdirectories | `agents/` `auth/` `capacity/` `constants/` `demo/` `enrichment/` `enrichment/derived/` `exclusivity/` `format/` `ingest/` `license/` `mapbox/` `matching/` `openai/` `outreach/` `pdf/` `permits/` `plans/` `predictive/` `proposals/` `scoring/` `sequences/` `sources/` `supabase/` `tax/` `webhooks/` | 26 subtrees, each cohesive |
| Migrations | 58 (gaps at 00037→00039 + 00047→00050) | See [02-data-layer.md](./02-data-layer.md) |
| UI primitives | `src/components/ui/*` | 11 components — Button, Card, Dialog, Input, Select, Badge, Skeleton, Toast, FocusTrap, ExpandableBanner, ErrorBoundary |

## Top 11 largest source files (by LOC)

| File | LOC | Notes |
|---|---:|---|
| `src/app/(marketing)/contractors/page.tsx` | 916 | Marketing page; load-testing candidate but not yet decomposable |
| `src/app/(dashboard)/dashboard/map/page.tsx` | 828 | Map viz; specialized MapLibre integration |
| `src/app/(dashboard)/dashboard/outreach/page.tsx` | 699 | CRM pane; column-based UI |
| `src/app/(dashboard)/dashboard/page.tsx` | 666 | Lead list + filters; **18× `as unknown as` casts** (highest cluster) |
| `src/app/(marketing)/contractors/[id]/page.tsx` | 649 | Contractor detail; API-driven |
| `src/app/(dashboard)/dashboard/settings/interviews/page.tsx` | 635 | Interview scheduler widget |
| `src/app/(dashboard)/dashboard/compliance/page.tsx` | 632 | Permit audit view |
| `src/app/onboarding/territory/page.tsx` | 618 | Territory picker; form-heavy |
| `src/app/(dashboard)/dashboard/estimate/page.tsx` | 589 | Pricing modal |
| `src/components/portal/ChatIntakeModal.tsx` | 581 | Modal shell (state machine + header); steps extracted to `.steps.tsx` |
| `src/components/portal/ChatIntakeModal.steps.tsx` | 545 | 8-step input UI dispatcher (Step0-Step7 + BackLink) |

## Refactoring progress (04-29 → 04-30)

- ✓ **`LeadDetailDrawer`**: 1031 LOC → 374 LOC (−63%) — refactor complete; minimal `as unknown as` casts remaining (3, all justified)
- ✓ **`ChatIntakeModal`**: previously 1028 LOC → 581 (modal shell) + 545 (steps UI) — split complete; BackLink component reused in Steps 1-6
- ✓ **`KanbanBoard.tsx`**: +50 LOC for the dataTransfer fallback (drag-drop fix); structurally clean

## Findings

**F1** | **Medium** | `src/app/(dashboard)/dashboard/page.tsx:81-138` and elsewhere
- **Issue**: 18 `as unknown as Record<string, unknown>` casts in nested permit + enrichment field-access chains
- **Why it matters**: Type casting masks structural issues in the `Lead` union; future column additions require defensive cast updates. Wedge bullet #2 (transparent confidence) depends on every signal field being read correctly.
- **Recommended fix**: Run `mcp__supabase__generate_typescript_types` → `src/types/database.ts`, refactor `useLeads.helpers.ts` + `dashboard/page.tsx` to read typed columns. Closes ~50% of the codebase's 58-cast count.

**F2** | **Low** | `src/app/(marketing)/contractors/page.tsx:1` (916 LOC)
- **Issue**: Single marketing page; not decomposed despite `src/components/landing/*` having dedicated subcomponents available
- **Why it matters**: SSR perf candidate if traffic spikes. Not blocking today.
- **Recommended fix**: Backlog candidate for Q3 2026 if marketing-page TTFB regresses.

**F3** | **Low** | `src/app/(dashboard)/dashboard/map/page.tsx:1` (828 LOC)
- **Issue**: Map dashboard is monolithic; 10 overlay layers + state machine + zoom logic in one file
- **Why it matters**: Hard to test individual overlays in isolation; tree-shaking can't split lazy overlay code paths
- **Recommended fix**: Extract each overlay (Storm, Weather, Permits, Census, FEMA, NOAA Radar, etc.) to its own component file. Map dashboard becomes a thin layout with overlay composition. ~1 day.

**F4** | **Nitpick** | `src/components/portal/ChatIntakeModal.steps.tsx:128-138` (BackLink) — NEW today
- **Issue**: BackLink uses `text-xs underline underline-offset-2` styling; visible but small. UX feedback may surface this.
- **Why it matters**: User-facing affordance for revising prior answers; if homeowners can't find it, the back-nav fix doesn't help.
- **Recommended fix**: Live-monitor the back-nav usage rate post-deploy. If <5% of users discover it, bump to `text-sm` or add a chevron icon.

## Closing

Architecture is healthy and growing through legitimate feature accretion. The two hot files from prior audits (LeadDetailDrawer + ChatIntakeModal) are both refactored. The map dashboard remains a candidate for next-quarter splitting. The dashboard/page.tsx file is the only structural concern, and it'll resolve itself once auto-generated DB types land.
