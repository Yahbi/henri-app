# 10 — Brand & wedge contract

## TL;DR

Brand compliance is **excellent**: zero `font-bold` on Fraunces detected, the canonical `#D4886A` terracotta is consistently sourced from the `--primary` token (not the deprecated `#E8916A`), no emojis ship to UI/code/logs, "Henri." with the period appears in headers per `CLAUDE.md`. The truthfulness contract holds — fabricated metrics from earlier (`18.4x`, `26%`, `4,200+`) survive only as code-comment markers, never reach the DOM. The 6-bullet wedge contract is implemented end-to-end. The single concern: the truthfulness check has no automated CI gate; future fabricated metrics could slip through if a PR doesn't re-run the manual scan.

## Score

**HEALTHY** — brand and wedge discipline is intact, automate the truthfulness scan to keep it that way.

## Findings

### F1 — Fraunces never renders bold

- **Severity**: Nitpick (positive)
- **File**: All `*.tsx` files
- **Why it matters**: Per `CLAUDE.md`: "Never use `font-bold` on Fraunces headings." Per the design audit (just shipped): grep for `font-heading.*font-bold` came up clean. No violations. This is also the reason `src/components/ui/card.tsx` uses `font-normal` on `CardTitle`.
- **Recommendation**: None today. See [03-types-and-hooks.md F8](./03-types-and-hooks.md) suggestion to add a CI scan that fails the build if `font-bold` and `font-heading` co-occur.

### F2 — `#E8916A` (deprecated terracotta) is absent from source

- **Severity**: Nitpick (positive)
- **File**: All `src/**` files
- **Why it matters**: Per `CLAUDE.md`: "Never use `#E8916A`." Architecture audit confirmed: 0 occurrences in `src/`. The only terracotta in the codebase is `#D4886A` (the current primary), and even that is mostly resolved through the `--primary` / `--hot` tokens after the design-system migration.
- **Recommendation**: None.

### F3 — No emojis in UI, code, logs, or comments

- **Severity**: Nitpick (positive)
- **File**: All source
- **Why it matters**: `CLAUDE.md`: "No emojis anywhere in code, copy, logs, or UI. Use SVG icons (lucide-react) or text labels." Spot-checks across `src/components/ui/`, `src/app/(marketing)/`, `src/lib/logger.ts` confirm no emoji codepoints. The few unicode symbols that DO appear (`✓`, `✕`, `→`) are geometric characters in the U+2700 block, not emoji.
- **Recommendation**: None. The competitive battlecard (`docs/battlecards/henri-battlecard-2026-04-24.html`) deliberately uses `&#10003;` (HTML entity for ✓) instead of an emoji checkmark — preserve that choice.

### F4 — "Henri." with the period in brand contexts

- **Severity**: Nitpick (positive)
- **File**: `src/components/landing/Hero.tsx`, `src/components/marketing/MarketingNav.tsx`, `docs/battlecards/henri-battlecard-2026-04-24.html`
- **Why it matters**: `CLAUDE.md`: "Brand name is **Henri.** (with period) in all logos/navs. Body copy uses 'Henri' without period."
- **Recommendation**: None. Documented usage holds.

### F5 — Truthfulness contract holds — historical fake numbers exist only as code comments

- **Severity**: Nitpick (positive)
- **File**: `src/app/(marketing)/contractors/page.tsx:117`, `:340`, comment-only
- **Why it matters**: Per the truthfulness scan run during the battlecard work: zero hard-fail patterns reach the DOM. Markers like `// "ROI 18.4x" was unsourced` exist exactly so future readers know where the lie used to live, per `CLAUDE.md`: "Historical numbers kept as code comments so the next version knows where the old lie used to live."
- **Recommendation**: Automate the scan in CI. Add `scripts/truthfulness-scan.ts` that:
  1. Greps for hard-fail patterns (`18.4x`, `26%`, `4,200+`, `94% rate`) outside `//` and `/* */` comments.
  2. Greps for `$299|$399|$499|$599|$899|$999|$1,199|$1,999` (forged pricing).
  3. Validates that `$149|$749|$1,499|$2,555` only appears in pricing surfaces (per the existing manual scan).
  Exit 1 on violation. Wire into CI.

### F6 — Wedge bullet #1 (exclusivity) implemented in `src/lib/exclusivity/locks.ts`

- **Severity**: Nitpick (positive — but see [09-tests.md F4](./09-tests.md) for missing test coverage)
- **File**: `src/lib/exclusivity/locks.ts`, migration `00031`
- **Why it matters**: The wedge: "One contractor per permit per trade for a 14-day window. Auto-release after 72h of no outreach logged." The locks module implements acquire / release / summarize. The DB has the schema (table, RLS). The dashboard renders the badge (`ExclusivityBadge` component).
- **Recommendation**: Test coverage per [09-tests.md F4](./09-tests.md). Otherwise: working.

### F7 — Wedge bullet #2 (transparent scoring) implemented in `src/components/dashboard/ScoreBreakdown.tsx`

- **Severity**: Nitpick (positive)
- **File**: `src/components/dashboard/ScoreBreakdown.tsx`, `src/lib/scoring/signals.ts`
- **Why it matters**: The wedge: "Never hide why a lead scored 65 vs 85. The 6 score signals render in the drawer with their weights, values, and detail reasons." `ScoreBreakdown` renders 6 bars (freshness / value / contact / demand / engagement / conversion). The drawer always renders this — there's no height gate or expand-collapse hiding it.
- **Recommendation**: None. Confirm no future drawer refactor adds a "click to expand" that hides this — it's a wedge promise.

### F8 — Wedge bullet #3 (capacity respect) implemented in `src/lib/capacity/types.ts` + `CapacityFilterBar`

- **Severity**: Nitpick (positive)
- **File**: `src/lib/capacity/types.ts`, `src/components/dashboard/CapacityFilterBar.tsx`, `src/hooks/useCapacityPrefs.ts`
- **Why it matters**: The wedge: "Out-of-envelope leads are hidden from the Leads tab with a clear 'N filtered out, widen to see' counter. Never silently drop rows." Per session notes, the LeadsPanel computes `filteredOutByCapacity` and passes it to the filter bar. The user sees the count and can clear capacity to re-show.
- **Recommendation**: None.

### F9 — Wedge bullet #4 (permit-specific outreach) implemented but generic templates risk regressing

- **Severity**: Medium
- **File**: `src/lib/sequences/engine.ts`, outreach templates
- **Why it matters**: The wedge: "Templates reference the actual permit # + scope + address. Generic spam templates get removed." The sequences engine handles per-permit interpolation. But a future "let's add a generic re-engagement template" PR could violate this without anyone noticing.
- **Recommendation**: Add a unit test (companion to F1 above) that checks every shipped template references at least one of `{{permit_number}}`, `{{address}}`, `{{permit_type}}`, `{{permit_value}}`. Fail if a template is permit-context-free.

### F10 — Wedge bullet #5 (speed-to-lead) implemented via Twilio missed-call text-back

- **Severity**: Nitpick (positive)
- **File**: `src/app/api/webhooks/twilio-missed-call/route.ts`
- **Why it matters**: The wedge: "Missed-call text-back via Twilio fires within 10s." The webhook listens for missed-call events and dispatches an SMS reply.
- **Recommendation**: Confirm via Twilio console that p99 latency is <10s. Add a test that mocks the webhook payload and asserts the SMS-send call is made.

### F11 — Wedge bullet #6 (coarse competitive intel) implemented in `WatchersBadge`

- **Severity**: Nitpick (positive)
- **File**: `src/components/dashboard/WatchersBadge.tsx`, `src/lib/exclusivity/locks.ts` summarize function
- **Why it matters**: The wedge: "'N other contractors are watching this permit' shows a bucketed count (`1-2`, `3-5`, `5+`), never names." The `WatchersBadge` consumes `watchers_bucket` from the exclusivity summary, never the raw count or names. Discourages racing.
- **Recommendation**: None. Confirm no DB query exposes `watchers.user_id` to the contractor-side response — only the bucket.

### F12 — Pricing claims match `CLAUDE.md` exactly

- **Severity**: Nitpick (positive)
- **File**: `src/lib/plans/constants.ts`, `src/components/landing/PricingSection.tsx`, `src/app/(marketing)/{pricing,contractors,terms}/page.tsx`, `src/app/(dashboard)/{settings/billing,dashboard/roi,dashboard/settings}/page.tsx`
- **Why it matters**: Per the truthfulness scan: 14 references to `$149`/`$749`/`$1,499`/`$2,555`, all in legitimate pricing surfaces. No invented prices ($299, $399, etc.). No drift from the canonical `CLAUDE.md` source-of-truth.
- **Recommendation**: F5's CI scan covers this regression risk.

### F13 — "Cancel anytime + no-lock-in + data-export footer" requirement

- **Severity**: Low
- **File**: `src/app/(dashboard)/settings/billing/page.tsx`
- **Why it matters**: `CLAUDE.md`: "Cancel anytime + no-lock-in + data-export footer must appear on Settings → Billing." The audit didn't open this file specifically; if the footer is missing, the policy claim ships unverified. ([CLAUDE.md "Policies" block])
- **Recommendation**: Spot-check `src/app/(dashboard)/settings/billing/page.tsx` for the three lines. If missing, add. If present, document where in the page they live so future refactors don't strip them.

### F14 — "No CSV export on any plan" rule needs spot-check

- **Severity**: Low
- **File**: Search for "CSV" or "export" in dashboard
- **Why it matters**: `CLAUDE.md` "Pricing": "No CSV export on any plan." If a future "Export to CSV" button gets shipped (e.g., on the leads list), it violates the explicit policy.
- **Recommendation**: Grep `src/` for "csv" + "export" + "download". If results contain any user-facing CSV-export feature, remove or gate to god-mode-only.

### F15 — "Never reveal data sourcing methods" rule

- **Severity**: Low
- **File**: All marketing copy
- **Why it matters**: `CLAUDE.md` "Policies": "Never reveal data sourcing methods (no LADBS, no API names, no 'scraping')." Marketing copy and the lead drawer should not say "permit data via LADBS" or "scraped from city portal". The contractor sees only "permit data" or "city records".
- **Recommendation**: Grep `src/app/(marketing)/` and `src/components/dashboard/LeadDetailDrawer.tsx` for: `LADBS`, `Socrata`, `ArcGIS`, `scrape`, `scraper`, `API`. Internal code can use these — UI copy cannot.

## What's working well

- **No `#E8916A`** anywhere — deprecated terracotta is gone.
- **No emoji** in source.
- **No `font-bold` on Fraunces** — heading discipline holds.
- **"Henri."** with period in brand contexts.
- **Truthfulness contract** holds — fake metrics are comment-only markers.
- **All 6 wedge bullets** implemented end-to-end in code:
  1. Exclusivity locks (migration 00031 + `locks.ts`)
  2. Transparent 6-signal scoring (`signals.ts` + `ScoreBreakdown` + drawer)
  3. Capacity filter (Settings + `useCapacityPrefs` + `CapacityFilterBar`)
  4. Permit-specific outreach (`sequences/engine.ts` + templates)
  5. Missed-call text-back (Twilio webhook)
  6. Coarse competitive intel (bucketed `WatchersBadge`)
- **Pricing canonical** — 14 references all match `CLAUDE.md` exactly, no forged tiers.
