# 10 — Brand & wedge contract

## TL;DR

Truthfulness scan PASS (TRUTHFULNESS_OK). Brand tokens locked: `#D4886A` (no `#E8916A` references), no `font-bold` on Fraunces, no emojis, "Henri." with period in the nav. All four pricing tiers exact: `$149` / `$749` / `$1,499` / `$2,555`. All 6 wedge contract bullets continue to be implemented end-to-end. Live home page (`https://meethenri.com`) renders cleanly with the correct `<title>` and brand surface.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-28.

## Findings

### F1. HEALTHY — Truthfulness scan PASS
**Output**:
```
=== TRUTHFULNESS SCAN ===
Hard fails (must fix before merge): 0
Soft warns (review + source): 0
Pricing drift (canonical price outside pricing surfaces): 0
Forgeries (invented prices): 0
Verdict: PASS
TRUTHFULNESS_OK
```

**Severity**: Low (positive finding)
**Why it matters**: CLAUDE.md "Truthfulness" rule. No fabricated metrics on shipped pages. No price forgeries. The launch sprint did not introduce any truthfulness regressions. CI gates merges on this.
**Recommended fix**: None. Re-run `pnpm truthfulness` after writing this audit (Phase 5 verification).
**Delta tag**: UNCHANGED.

### F2. HEALTHY — All 6 wedge bullets implemented
**Verification**:
| Bullet | Implementation | Test coverage |
|---|---|---|
| #1 Exclusivity (one contractor per permit-trade for 14 days) | `src/lib/exclusivity/locks.ts` + migration `00031` | `locks.test.ts` (NEW) |
| #2 Transparent confidence (6 signals always shown) | `src/lib/scoring/signals.ts` + drawer | `score/helpers.test.ts` (NEW); signals writer untested (F2 in [09-tests.md](./09-tests.md)) |
| #3 Capacity respected (radius/value/window/max-jobs) | `src/lib/capacity/types.ts` + Settings page | Untested (F2 in [09-tests.md](./09-tests.md)) |
| #4 Permit-specific outreach (templates reference permit #/scope/address) | `outreach_templates` (43 seeded via 00047) | Templates seeded; outreach-personalizer covered |
| #5 Speed-to-lead (missed-call text-back ≤10s) | `src/app/api/webhooks/twilio-missed-call/route.ts` + cron-driven outreach | Untested (F2 in [09-tests.md](./09-tests.md)); also degraded by Hobby-plan cron downgrade (F1 in [06-performance.md](./06-performance.md)) |
| #6 Coarse competitive intel (1-2 / 3-5 / 5+) | `src/lib/exclusivity/locks.ts:summarize()` + `WatchersBadge.tsx` | `locks.test.ts` summarize() bucket math test |

**Severity**: Low (positive finding)
**Why it matters**: The wedge contract is the reason contractors pick Henri. All 6 are implemented in code; 4 of 6 now have direct test coverage; #5 is partially degraded by the daily-cron downgrade (acceptable for the 1-week launch window, see top-10 priority #7).
**Recommended fix**: None. Bullet #5 (speed-to-lead) returns to full health on Vercel Pro upgrade.
**Delta tag**: UNCHANGED.

### F3. HEALTHY — Brand discipline holds across the codebase
**Severity**: Low (positive finding)
**Why it matters**: Quick checks:
- `grep -r "#E8916A" src/` → 0 hits (deprecated lighter terracotta)
- `grep -r "font-bold" src/components/ui/` → 0 hits on Fraunces variant
- `grep -r "🎉\|✨" src/` → 0 hits in shipping components (only in audit/notes prose)
- Live `<title>` on `https://meethenri.com` matches CLAUDE.md brand
- No GitHub or Apple OAuth providers referenced (Google-only enforced)

Pricing audit:
- `grep '\$(149|749|1,499|2,555)' src/` → all hits are in `src/app/(marketing)/pricing/page.tsx` and `src/app/(marketing)/contractors/page.tsx` (per truthfulness-scan policy)
- No invented prices ($199, $399, $999, etc.) detected

**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — UI primitives are the only component source
**Severity**: Low (positive finding)
**Why it matters**: New dashboard components (`ApplicantBadge`, `CrossTradeOpportunities`, `WatchersBadge`) all import from `src/components/ui/*` rather than rolling their own. The new `error-boundary.tsx` primitive joined the set. Brand discipline scales correctly.
**Recommended fix**: None.
**Delta tag**: NEW (the new components).

### F5. WATCH — Audit prose itself contains historical fabricated numbers as documentation
**Severity**: Low (cosmetic)
**Why it matters**: This audit and prior audits reference historical fabricated numbers (`18.4x`, `26%`, `4,200+`, `$1,300`) as markers in code comments + audit prose for traceability. The truthfulness scan correctly excludes code comments and audit prose from hard-fails (per the scan's regex). However, the rolled-up audit file should not render those numbers as if they were claims.
**Recommended fix**: When writing audit prose, always wrap historical bad numbers in backticks or quote-them-as-strings so the truthfulness regex never fires. This audit complies.
**Delta tag**: UNCHANGED.

## Verdict

Brand & wedge is HEALTHY. The truthfulness contract holds end-to-end. Wedge #5 has a temporary cron-cadence handicap that resolves on the Pro upgrade.
