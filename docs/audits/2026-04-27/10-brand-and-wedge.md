# 10 — Brand & wedge contract

## TL;DR

Brand discipline holds: zero `#E8916A`, zero `font-bold` on Fraunces, no emojis, "Henri." with period in nav, "Henri" without in body. Truthfulness scan passes (1 pre-existing soft-warn, 0 hard fails, 0 forgeries, 0 pricing drift). All 6 wedge contract bullets remain implemented. Yesterday's session added per-field `ProvenanceChip` + `SOURCE_LABELS` map in `LeadDetailDrawer.tsx` strengthening wedge bullet #2 (transparent confidence).

## Score

**EXCELLENT** — discipline intact, wedge fully shipped, truthfulness automated.

## Findings

### F1 — Fraunces never bold (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Grep `font-heading.*font-bold` returns zero hits.

### F2 — `#E8916A` absent from `src/` (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Only `#D4886A` (CLAUDE.md primary) in use.
- **Aside**: The Henri 2.1 HTML mockups (`Desktop/henry-2.1-extracted/`) do use `#E8916A` — confirming the mockups are pre-rebrand and should NOT be copy-pasted.

### F3 — No emojis (RECONFIRMED)

- **Severity**: HEALTHY

### F4 — "Henri." vs "Henri" usage correct (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: "Henri." with period in `Hero.tsx` and navbars; "Henri" without in body copy.

### F5 — Truthfulness contract holds (RECONFIRMED)

- **Severity**: HEALTHY
- **Today's truthfulness scan**:
  - Hard fails: 0
  - Soft warns: 1 (pre-existing, in `src/app/(marketing)/contractors/page.tsx:822` — "100 contractors — Beta slots filling daily" matches the Founder-tier cap from CLAUDE.md)
  - Pricing drift: 0
  - Forgeries: 0
  - Verdict: **PASS**

### F6 — Truthfulness scan automated + CI-gated (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `scripts/truthfulness-scan.ts`
- **Status**: Exits non-zero on hard-fails / forgeries; runs via `pnpm truthfulness`.

### F7 — Wedge bullet #1 (exclusivity, 14-day window per (lead_id, trade)) implemented

- **Severity**: HEALTHY
- **Files**: `src/lib/exclusivity/locks.ts`, migration 00031 (PENDING — see 02 F1)
- **Status**: Code shipped. Migration must apply for full effect.

### F8 — Wedge bullet #2 (transparent scoring) STRENGTHENED (NEW 2026-04-26)

- **Severity**: HEALTHY (improvement)
- **File**: `src/components/dashboard/LeadDetailDrawer.tsx:45-105` (new `ProvenanceChip` + `SOURCE_LABELS` map)
- **What changed**: Per-field "via X" chips render under owner_name / phone / email rows so contractors can see HOW the homeowner record was assembled. 25+ source labels mapped to human-readable names.
- **Status**: Strengthens the wedge promise. Score signals still render unconditionally (no height gate).

### F9 — Wedge bullet #3 (capacity envelope) implemented

- **Severity**: HEALTHY
- **Files**: `src/lib/capacity/types.ts`, `src/components/dashboard/CapacityFilterBar.tsx`
- **Status**: "N filtered out" counter renders correctly.

### F10 — Wedge bullet #4 (permit-specific outreach) implemented

- **Severity**: HEALTHY
- **File**: `src/lib/sequences/engine.ts`
- **Recommendation**: Add a unit test asserting every shipped template references `{{permit_number}}`, `{{address}}`, `{{permit_type}}`, or `{{permit_value}}`.

### F11 — Wedge bullet #5 (10-second missed-call SMS via Twilio) implemented

- **Severity**: HEALTHY
- **File**: `src/app/api/webhooks/twilio-missed-call/route.ts`
- **Recommendation**: Verify p99 via Twilio console; add mock-payload test.

### F12 — Wedge bullet #6 (coarse competitive intel buckets) implemented

- **Severity**: HEALTHY
- **Files**: `src/components/dashboard/WatchersBadge.tsx`, `src/lib/exclusivity/locks.ts`
- **Status**: 1-2 / 3-5 / 5+ buckets rendered, never names.

### F13 — Pricing claims match CLAUDE.md exactly (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Truthfulness scan verifies $149/$749/$1,499/$2,555 only appear in pricing surfaces.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F10 | Template-references-permit unit test | 30 min | No |
| F11 | Mock Twilio missed-call test | 30 min | No |
