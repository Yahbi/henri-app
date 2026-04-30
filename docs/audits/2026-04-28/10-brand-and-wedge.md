# 10 — Brand & Wedge Contract

## TL;DR

**All 6 wedge contract bullets are implemented end-to-end.** Brand discipline holds: no `font-bold` on Fraunces, no forbidden `#E8916A`, no emojis, "Henri." with the period in logos/navs, all four pricing tiers exact ($149/$749/$1,499/$2,555). Truthfulness scan PASSes against current source tree and is now automated in CI (closes prior #5 priority).

## Score

**HEALTHY** — wedge contract holds; brand contract holds; truthfulness contract enforced by CI.

## Wedge contract status (per CLAUDE.md)

| # | Bullet | Status | Reference implementation |
|---|---|---|---|
| 1 | **Exclusivity is enforced on the enriched packet, not the data** | ✓ Live | `src/lib/exclusivity/locks.ts` (atomic upsert + retry per B4+B5 fix); migration 00031 `lead_exclusivity_locks` table; 14-day window; auto-release after 72h of no outreach |
| 2 | **Confidence is transparent** | ✓ Live | `src/lib/scoring/signals.ts` writes 6-signal jsonb breakdown; `src/components/dashboard/ScoreSignalBreakdown.tsx` always renders (height-gate removed per CLAUDE.md "Never hide why a lead scored 65 vs 85") |
| 3 | **Capacity is respected** | ✓ Live | `src/lib/capacity/types.ts` (pure client-side filter); "N filtered out, widen to see" counter in Leads panel |
| 4 | **Outreach is permit-specific** | ✓ Live | `src/lib/agents/outreach-personalizer.ts` references actual permit # + scope + address; `outreach_templates` table seeded with 50 trade-stage-channel templates (migration 00047) |
| 5 | **Speed-to-lead is mechanical** | ✓ Live | Twilio missed-call webhook fires within 10s; `profiles.twilio_tracked_number` populated from Settings → Account UI (G3 fix shipped this session); auto-fire outreach-on-lead-create is opt-in per contractor |
| 6 | **Competitive intel is coarse** | ✓ Live | `src/lib/exclusivity/locks.ts:summarize()` returns bucketed count (`1-2`, `3-5`, `5+`); never names |

## Findings

### F1. HEALTHY — Brand discipline holds
**Files**: `src/app/globals.css`, `src/components/marketing/Logo.tsx`, marketing pages
**Why it matters**: CLAUDE.md "non-negotiable" brand rules:
- "Henri." with period in logos/navs ✓
- Body copy uses "Henri" without period ✓
- Primary `#D4886A` darker terracotta, NOT `#E8916A` ✓ (verified via grep)
- Fraunces (serif, `font-heading font-normal`) for headings — no `font-bold` violations ✓
- DM Sans for body ✓
- No emojis in code, copy, logs, or UI ✓ (lucide-react SVG only)
- Google OAuth only — no GitHub, no Apple ✓
**Status**: No regressions.

### F2. HEALTHY — Pricing source-of-truth holds
**Files**: `src/app/(marketing)/pricing/page.tsx`, `src/app/(marketing)/contractors/page.tsx`, `src/lib/plans/constants.ts`
**Why it matters**: CLAUDE.md "Pricing (source of truth)" rule:
- Founder $149/mo, 3 ZIPs (Beta, limited to 100, price locked) ✓
- Starter $749/mo, 5 ZIPs ✓
- Pro $1,499/mo, 12 ZIPs (Most popular) ✓
- Enterprise $2,555/mo, 20 ZIPs ✓
- 24-hour free trial, credit card required ✓
- No refunds (digital product) ✓
- No CSV export on any plan ✓
**Status**: Confirmed via screenshot earlier this session and live render.

### F3. HEALTHY — Truthfulness scan automated in CI
**File**: `.github/workflows/ci.yml:37-40`, `scripts/truthfulness-scan.ts`
**Why it matters**: CLAUDE.md truthfulness contract — no invented metrics, no fake testimonials, no fabricated homeowner counts. Scan checks for:
- Hard-fail patterns (forbidden numbers like 18.4x, 26%, 4,200+, $11,300, 94% contact, 4.9/5)
- Soft warns (numbers that drift fast)
- Pricing drift (canonical price outside pricing surfaces)
- Forgeries (invented prices like $399, $999, $1,999)

Today's run: PASS / TRUTHFULNESS_OK. Closes prior #5 priority.
**Status**: No action.

### F4. HEALTHY — Truthful claims about coverage
**Files**: `src/app/(marketing)/contractors/page.tsx`, home page
**Why it matters**: CLAUDE.md "Size the claim to the current state" rule. Marketing claims:
- "900k+ Permits Tracked" — DB has ~1.44M permits per latest audit (true; honest)
- "45+ States Covered" — `permit_sources` has every US state + 5 territories per latest sync audit (true; conservative)
- "1 / ZIP" — exclusivity is enforced per migration 00031 + `lib/exclusivity/locks.ts` (true)
- "<30 min" — scrape cron runs every 30 min per `vercel.json` (true)
- "24 hrs" — free trial enforced via Stripe trial_period_days=1 (true)
**Status**: No regressions.

### F5. HEALTHY — Wedge bullet #2 (transparent scoring) compliance
**File**: `src/components/dashboard/ScoreSignalBreakdown.tsx` (always rendered, no height gate)
**Why it matters**: CLAUDE.md "Never hide 'why this score' behind a height gate". Earlier height-gate logic was removed; the breakdown always renders in the lead drawer regardless of drawer height. Wedge bullet is honored.
**Status**: Confirmed.

### F6. HEALTHY — `data-export` and `cancel-anytime` policies hold
**Files**: `src/app/(dashboard)/settings/billing/page.tsx`, footer
**Why it matters**: G1 fix earlier this session updated the cancel/cycle/deletion policy text per the user's spec — "cancel anytime, access until cycle end, then deleted prior to next charge". Replaces the previously broken "Settings → Export" link.
**Status**: Confirmed.

## Diff vs 2026-04-26

### Closed
- Truthfulness scan automated in CI (was prior #5 priority)
- G3 (Twilio tracked-number Settings UI) — wedge bullet #5 fully wired
- B3 (Stripe coupon flow reorder) — wedge bullet #1 invariant preserved

### Still open
- None. Wedge + brand + truthfulness contracts are healthy.
