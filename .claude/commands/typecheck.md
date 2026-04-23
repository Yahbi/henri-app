---
description: Run `pnpm tsc --noEmit` + surface a concise error summary grouped by file.
---

Fast static-check gate. Run before commits, after big refactors, and any time a feature feels done.

## Steps
1. `cd "C:/Users/yabis/Desktop/Henri App"`
2. `pnpm tsc --noEmit 2>&1 | tee /tmp/tsc.log`
3. If exit code 0: print `TYPECHECK_OK` and stop.
4. Otherwise:
   - Count errors per file: `grep -E "^.*\\.tsx?\\([0-9]+,[0-9]+\\):" /tmp/tsc.log | awk -F'(' '{print $1}' | sort | uniq -c | sort -rn | head -20`
   - Print the top 20 files by error count
   - Print the first error in each of those files (1 line each)
   - Offer to either:
     a) Fix forward — diagnose + patch the errors
     b) Revert the last chunk of edits if the errors cluster in recently-touched files

Never suppress errors with `@ts-ignore` or `@ts-expect-error` to pass the gate unless the user explicitly asks — those get caught in code review.
