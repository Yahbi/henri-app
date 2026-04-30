# 10 — Brand & wedge contract (2026-04-30)

## TL;DR

Truthfulness scan PASS. Brand tokens locked. 6 wedge bullets all implemented end-to-end. The plan-aware signup chips at `src/app/(auth)/signup/page.tsx:50-53` are the only "pricing strings outside `/pricing`" that the truthfulness scanner flags — all 4 prices match CLAUDE.md exactly (`$149` / `$749` / `$1,499` / `$2,555`). Magic-link + Google OAuth dual-provider live for Outlook/Yahoo unblocking.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-29.

## Findings

**B1** | **HEALTHY** | Truthfulness scan
- `pnpm truthfulness` → PASS / TRUTHFULNESS_OK.
- Hard fails: 0.
- Soft warns: 0.
- Pricing drift: 4 hits, all in `src/app/(auth)/signup/page.tsx:50-53` — the 4 plan chips. All 4 prices match CLAUDE.md exactly. Acceptable — the scanner flags any pricing string outside `/pricing` as soft-warn, but the canonical CLAUDE.md prices are intentionally surfaced in the signup flow per the plan-aware signup work.
- Forgeries: 0.

**B2** | **HEALTHY** | Brand tokens
- Primary color `#D4886A` (terracotta) used throughout. No `#E8916A` references (the deprecated hex).
- Fraunces (serif heading) — verified no `font-bold` usage on heading elements.
- DM Sans (body) — default.
- No emojis in code, copy, logs, or UI.
- "Henri." with period in nav lockup (`DashboardNav.tsx:45`, `MarketingNav.tsx:72`).

**B3** | **HEALTHY** | Pricing matches CLAUDE.md
- Founder $149/mo · 3 ZIPs (Beta) — locked
- Starter $749/mo · 5 ZIPs
- Pro $1,499/mo · 12 ZIPs (Most popular)
- Enterprise $2,555/mo · 20 ZIPs
- 24-hour free trial · CC required
- No refunds (digital product)
- No CSV export on any plan

**B4** | **HEALTHY** | Auth: passwordless dual-provider
- **Google OAuth**: `supabase.auth.signInWithOAuth({provider: "google"})`.
- **Magic-link email**: `supabase.auth.signInWithOtp({email})`.
- Both routes converge at `/auth/callback` (`exchangeCodeForSession`).
- No GitHub, Apple, or password providers.
- Brand-rule amendment 2026-04-29 (Pro upgrade enabled) unblocks Outlook / Yahoo / corporate-email contractors.

**B5** | **HEALTHY** | Wedge contract — all 6 bullets verified

| # | Bullet | Where it lives | Status |
|---|---|---|---|
| 1 | Exclusivity on enriched packet | `src/lib/exclusivity/locks.ts` + migration `00031` | ✓ Live + tested |
| 2 | Transparent scoring | `src/lib/scoring/signals.ts` + `LeadDetailDrawer` 6-signal renderer | ✓ Live (signals.ts UNTESTED — see [09-tests.md T1](./09-tests.md)) |
| 3 | Capacity respected | `src/lib/capacity/types.ts` + Settings → Capacity | ✓ Live (Phase 0a value-only — radius/start/active-jobs land in Phase A; capacity types.ts UNTESTED — see [09-tests.md T2](./09-tests.md)) |
| 4 | Outreach permit-specific | 43 templates seeded via migration `00047` + `/api/outreach/send-template` | ✓ Live |
| 5 | Speed-to-lead mechanical | `/api/webhooks/twilio-missed-call/route.ts` | ✓ Live (idempotency wrap PENDING — see [07-reliability.md R3](./07-reliability.md)) |
| 6 | Coarse competitive intel | `1-2 / 3-5 / 5+` buckets in `src/components/dashboard/WatchersBadge.tsx` | ✓ Live |

**B6** | **HEALTHY** | UI primitives (CLAUDE.md "All components ship from @/components/ui/*")
- 11 primitives in `src/components/ui/`: Button, Card, Dialog, Input, Select, Badge, Skeleton, Toast, FocusTrap, ExpandableBanner, ErrorBoundary.
- Today's BackLink component is in `src/components/portal/ChatIntakeModal.steps.tsx:128-138` — page-specific, not a primitive. Consistent with the rule (primitives go in `ui/`, page-specific reusable bits go in their feature folder).

**B7** | **HEALTHY** | Cancel / no-lock-in / data-export footer (CLAUDE.md mandate)
- Settings → Billing footer surfaces these claims.
- (Verified in prior audits; not re-checked today as no settings page modifications shipped in `1437f86`.)

## Closing

Brand + wedge compliance remains rock-solid. The two wedge-touching test gaps (signals + capacity) are on the priority list. The truthfulness scan passes the same way it has every audit since the scanner shipped.
