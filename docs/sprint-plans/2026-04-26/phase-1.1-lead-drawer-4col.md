# Phase 1.1 — Lead Drawer 4-column redesign

**Effort**: 1.5d
**Status**: Pending

## Context

The user's audit feedback: "redesign the pop up banner with permit details, all data, all permit descriptions, permits history needs to be a separate column. and enhance dramatically property information and mostly owners personal information. the history of permit is relevant, but are a data point. lets highlight more the current permit/ latest permit."

Current drawer (`src/components/dashboard/LeadDetailDrawer.tsx`, 889 LOC) has 3 columns: Score (100px) / Permit + proposal + history (flex-1) / Owner + Property (220px). Property gates were removed 2026-04-26; the structural redesign is still needed.

## Foundation already shipping

- The 5 height-gates are removed (audit fix)
- `ApplicantBadge` already renders the DIY/pro/spec chip (Phase 1.3)
- `CrossTradeOpportunities` already renders the predictive cards (Phase 1.2)
- `PermitHistorySection` already exists with `expandedDescriptions` prop
- `useEnrichment` + `usePermitHistory` hooks already cancellation-safe

## Recommended layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HEADER (sticky)                                                              │
│  Score(100) │ Address + city/state + DIY/pro/spec chip + close button         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Score(100) │ Current Permit hero (flex-1)        │ Owner + Property (300)    │
│  (always   │  • Permit # + applied date          │  • Owner name + co-owner  │
│  visible)  │  • Scope of work (full description, │  • Phone + email          │
│            │    NOT truncated, NOT in tooltip)   │  • Mailing address        │
│            │  • Value chip + Trade chip          │  • Owner since            │
│            │  • Cross-trade opportunities        │  • Year built             │
│            │  • Recommended actions              │  • Property + assessed $$  │
│            │  • Score signal breakdown           │  • Sqft (home + lot)      │
│            │  • Permit timeline (bar chart)      │  • Contractor / Business  │
│            │                                     │    (employer, license,    │
│            │                                     │    NAICS, business phone) │
├──────────────────────────────────────────────────────────────────────────────┤
│ Permit History at this Property (240px lane, sticky-bottom)                  │
│  [permit #1: 2024-06 — $42K — Roofing]   [permit #2: 2018-03 — $8K — HVAC]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Mobile: stack columns vertically. Min drawer width 600px desktop, full-bleed mobile.

## Scope

1. Extract proposal logic into `src/lib/proposals/generate.ts` (pure function, unit-testable)
2. Extract Current Permit hero into `src/components/dashboard/CurrentPermitHero.tsx`
3. Extract Property + Owner panel into `src/components/dashboard/PropertyOwnerPanel.tsx`
4. Compress `PermitHistorySection` for the bottom-lane layout (per-permit chip, hover for details)
5. Restructure `LeadDetailDrawer.tsx` to a 4-area grid (header / score-col / permit-col / owner-col / history-lane)
6. Owner section: if `voter_file` data present (from `voter_fl/nc/oh` tables), show age band ("45-54") and party affiliation NOT shown (per CLAUDE.md privacy)

## Files

**New**:
- `src/lib/proposals/generate.ts` (extracted from drawer)
- `src/components/dashboard/CurrentPermitHero.tsx`
- `src/components/dashboard/PropertyOwnerPanel.tsx`

**Modified**:
- `src/components/dashboard/LeadDetailDrawer.tsx` — restructure to 4-area grid, target ~500 LOC post-refactor (down from 889)
- `src/components/dashboard/PermitHistorySection.tsx` — compress for bottom lane

## Verification

- tsc + eslint + vitest clean
- Manual: open the drawer at minimum height — all 4 areas visible, permit description NOT truncated
- Manual: open at full height — same areas, no information added (no height-gate regression)
- Lighthouse mobile score: drawer renders below 1.5s on simulated 3G

## Out of scope

- Designer review pass — engineer-driven layout will work but designer iteration recommended before launch
- Tab navigation between areas — sticking with scroll for v1
- "Compact" toggle to switch back to old layout — no fallback; the new layout IS better
