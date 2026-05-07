---
name: truthfulness-scan
description: Scan the codebase for fabricated stats, fake testimonials, hardcoded marketing numbers. Fail if any render.
---

# Truthfulness contract scan

The truthfulness contract in `CLAUDE.md` says: no invented metrics, no unsourced ROI claims, no fake testimonials or homeowner counts. Historical fake numbers (`18.4x`, `26%`, `4,200+`, `$8,300`) live in code comments as markers but must NOT render.

## Run the automated scan

```bash
pnpm truthfulness
```

This invokes `scripts/truthfulness-scan.ts` which:

1. Greps for hard-fail patterns outside `//` comments
2. Greps for forged plan prices (`$299|$399|$499|$599|...`)
3. Cross-checks canonical pricing (`$149`/`$749`/`$1,499`/`$2,555`) against allow-listed pricing pages
4. Soft-warns on unsourced marketing-page counts

Exits non-zero on hard fails or forgeries. Wired into `.github/workflows/ci.yml` so PRs are blocked on red.

## Manual deep dive

### Hard-fail patterns (these MUST NOT exist in rendered code)

```
grep -rEn --include="*.tsx" --include="*.ts" \
  "\b(18\.4x|26%\s*avg|4,?200\+|\$8,?300|94%\s*(contact|rate)|4\.9\s*/\s*5)\b" \
  src/app src/components
```

Lines in JSX/strings are failures. Lines inside `//` or `/* */` comments are tolerated (they document where the lie used to live).

### Soft-warn patterns

Hardcoded stats on marketing pages:

```
grep -rEn --include="*.tsx" \
  "(\b\d+[KMk]\+\b|\b\d+\s*(states|contractors|homeowners|permits)\b)" \
  src/app/\(marketing\) src/components/landing
```

Cross-check each hit against `supabase/migrations/*.sql` + the plan. Stale → fail.

### Pricing drift

Every `$149`/`$749`/`$1,499`/`$2,555` must be:

- In `src/lib/plans/constants.ts` or
- In `src/app/(marketing)/{pricing,contractors,terms}/page.tsx` or
- In `src/app/(dashboard)/{settings/billing,dashboard/roi,dashboard/settings}/page.tsx`

```
grep -rEn '\$(149|749|1,499|2,555)\b' src/app src/components
```

### Pricing forgeries

Any plan price NOT in the official list is a red flag:

```
grep -rEn '\$(299|399|499|599|699|899|999|1,199|1,999|3,?000|5,?000)\b' src/app src/components
```

## Report format

```
=== TRUTHFULNESS SCAN ===

Hard fails (must fix before merge): N
  src/.../page.tsx:LINE  "...snippet..."

Soft warns: N

Pricing drift: N

Forgeries: N

Verdict: PASS | FAIL
```

If PASS, prints `TRUTHFULNESS_OK`.
