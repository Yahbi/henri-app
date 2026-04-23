---
description: Scan the codebase for fabricated stats, fake testimonials, hardcoded marketing numbers. Fail if any render.
---

The truthfulness contract in `CLAUDE.md` says: no invented metrics, no unsourced ROI claims, no fake testimonials or homeowner counts. Historical fake numbers (18.4x, 26%, 4,200+, $8,300) live in code comments as markers but must NOT render.

## Steps

### 1. Hard-fail patterns (these MUST NOT exist in rendered code)
```
grep -rEn --include="*.tsx" --include="*.ts" \
  "\\b(18\\.4x|26%\\s*avg|4,?200\\+|\\$8,?300|94%\\s*(contact|rate)|4\\.9\\s*/\\s*5)\\b" \
  src/app src/components
```
Lines in JSX/strings are failures. Lines inside `//` or `/* */` comments are tolerated.

### 2. Soft-warn patterns (numbers that drift fast)
Any hardcoded stat on a marketing page should be sourced from a live query or CLAUDE.md pricing table:
```
grep -rEn --include="*.tsx" \
  "(\\b\\d+[KMk]\\+\\b|\\b\\d+\\s*(states|contractors|homeowners|permits)\\b)" \
  src/app/\\(marketing\\) src/components/landing
```
Cross-check each hit against `supabase/migrations/*.sql` + the plan. If it's stale, fail.

### 3. Pricing drift
Every `$149`, `$749`, `$1,499`, `$2,555` in code must either be:
- In `src/app/(marketing)/pricing/page.tsx` or `src/app/(marketing)/contractors/page.tsx`
- Or match `CLAUDE.md` exactly (Founder $149, Starter $749, Pro $1,499, Enterprise $2,555)
```
grep -rEn '\\$(149|749|1,499|2,555)\\b' src/app src/components
```

### 4. Pricing forgeries
Any plan price NOT in the official list is a red flag:
```
grep -rEn '\\$(299|399|499|599|699|899|999|1,199|1,999|3,?000|5,?000)\\b' src/app src/components | grep -v "\\.tsx?\\.(test|stories)"
```

## Report
Output a 4-section report:
```
=== TRUTHFULNESS SCAN ===

Hard fails (must fix before merge): N
  src/…/page.tsx:LINE  "…snippet…"

Soft warns (review + source): N
  …

Pricing drift: N

Forgeries: N

Verdict: PASS | FAIL
```

If PASS, print `TRUTHFULNESS_OK`. If FAIL, list remediation — usually "replace with an honest claim from CLAUDE.md or move to a code comment with source."
