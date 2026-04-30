/**
 * Truthfulness scan — automated CI gate for the CLAUDE.md truthfulness contract.
 *
 * Replaces the manual grep loop the user previously had to run by hand.
 * Companion to `.claude/commands/truthfulness-scan.md` (slash-command form).
 *
 * Run:
 *   pnpm truthfulness            # scans `src/`
 *   pnpm truthfulness docs/...   # scans an arbitrary path
 *
 * CI integration:
 *   - Wired into `.github/workflows/ci.yml` (exits non-zero on hard fails or forgeries).
 *   - The slash command `/truthfulness-scan` invokes the same logic conceptually
 *     but stays human-readable.
 *
 * What "truthfulness" means here (per CLAUDE.md):
 *   - No invented metrics in rendered code/UI: 18.4x ROI, 26% close rate,
 *     4,200+ homeowners, 94% contact rate, 4.9/5, $8,300 LTV.
 *     Historical fakes are tolerated only inside `//` or `/_*_/` comments
 *     so the next version knows where the lie used to live.
 *   - Pricing canonical: $149 / $749 / $1,499 / $2,555 only — no other
 *     plan prices ($299/$399/$499/$599/$699/$899/$999/$1,199/$1,999).
 *   - Soft-warn on hardcoded population stats (\bN+ states/contractors/permits\b)
 *     that drift fast and need a citation.
 *
 * Zero deps. Reads files via Node fs. Returns a 4-section report.
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const HARD_FAIL_PATTERN =
  /\b(18\.4x|26%\s*(close|avg)|4,?200\+|\$8,?300|94%\s*(contact|rate)|4\.9\s*\/\s*5)\b/i;

const SOFT_WARN_PATTERN =
  /\b(\d+[KMk]\+)\b|\b(\d+)\s*(states|contractors|homeowners|permits)\b/i;

const PRICING_CANONICAL_PATTERN = /\$(149|749|1,499|2,555)\b/;

const PRICING_FORGERY_PATTERN =
  /\$(299|399|499|599|699|899|999|1,199|1,999|3,000|5,000)\b/;

/* Files where canonical pricing is allowed (everywhere else is a soft warn) */
const PRICING_ALLOWED_PATHS = [
  "src/lib/plans/constants.ts",
  "src/app/(marketing)/pricing/page.tsx",
  "src/app/(marketing)/contractors/page.tsx",
  "src/app/(marketing)/terms/page.tsx",
  "src/components/landing/PricingSection.tsx",
  "src/app/(dashboard)/settings/billing/page.tsx",
  "src/app/(dashboard)/dashboard/roi/page.tsx",
  "src/app/(dashboard)/dashboard/settings/page.tsx",
  "src/app/(marketing)/contractors/layout.tsx",
];

interface Hit {
  file: string;
  line: number;
  text: string;
  pattern: string;
  inComment: boolean;
}

const HARD_FAILS: Hit[] = [];
const SOFT_WARNS: Hit[] = [];
const PRICING_DRIFTS: Hit[] = [];
const FORGERIES: Hit[] = [];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "_archive",
  "__tests__",
  "test",
  "tests",
  "coverage",
  "docs", // audit + battlecard reference these patterns descriptively
]);

const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function isLineInComment(line: string): boolean {
  // Trim leading whitespace + check for `//` or `*` (block-comment continuation).
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function walkDir(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (entry.endsWith(".stories.ts") || entry.endsWith(".stories.tsx")) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(full, files);
    } else if (stat.isFile()) {
      const dot = entry.lastIndexOf(".");
      const ext = dot >= 0 ? entry.slice(dot) : "";
      if (SCAN_EXTS.has(ext)) files.push(full);
    }
  }
  return files;
}

function scanFile(file: string, repoRoot: string): void {
  let content: string;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    return;
  }

  const rel = relative(repoRoot, file).replace(/\\/g, "/");
  const lines = content.split("\n");
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    /* Block-comment tracker — anything inside /* ... *​/ is treated as a comment */
    const startedHere = line.includes("/*");
    const endedHere = line.includes("*/");
    const inComment =
      inBlockComment || startedHere || isLineInComment(line);
    if (startedHere && !endedHere) inBlockComment = true;
    if (endedHere) inBlockComment = false;

    /* Hard fail patterns — must NOT exist in rendered code */
    if (HARD_FAIL_PATTERN.test(line) && !inComment) {
      HARD_FAILS.push({
        file: rel,
        line: lineNum,
        text: line.trim().slice(0, 120),
        pattern: "fabricated metric",
        inComment: false,
      });
    }

    /* Forgeries — invented prices */
    if (PRICING_FORGERY_PATTERN.test(line) && !inComment) {
      FORGERIES.push({
        file: rel,
        line: lineNum,
        text: line.trim().slice(0, 120),
        pattern: "non-canonical price",
        inComment: false,
      });
    }

    /* Pricing drift — canonical price OUTSIDE the allowed pricing pages */
    if (PRICING_CANONICAL_PATTERN.test(line) && !inComment) {
      const isAllowed = PRICING_ALLOWED_PATHS.some((p) => rel.includes(p));
      if (!isAllowed) {
        PRICING_DRIFTS.push({
          file: rel,
          line: lineNum,
          text: line.trim().slice(0, 120),
          pattern: "canonical price outside pricing surfaces",
          inComment: false,
        });
      }
    }

    /* Soft warns — hardcoded population stats that need a source */
    if (
      SOFT_WARN_PATTERN.test(line) &&
      !inComment &&
      /(states|contractors|homeowners|permits)/i.test(line)
    ) {
      // Only flag when in marketing or landing surface — internal counts are fine.
      if (
        rel.includes("src/app/(marketing)") ||
        rel.includes("src/components/landing") ||
        rel.includes("src/components/marketing")
      ) {
        SOFT_WARNS.push({
          file: rel,
          line: lineNum,
          text: line.trim().slice(0, 120),
          pattern: "unsourced count on marketing surface",
          inComment: false,
        });
      }
    }
  }
}

function printSection(title: string, hits: Hit[]): void {
  console.log(`${title}: ${hits.length}`);
  for (const h of hits.slice(0, 25)) {
    console.log(`  ${h.file}:${h.line}  "${h.text}"`);
  }
  if (hits.length > 25) {
    console.log(`  … ${hits.length - 25} more`);
  }
}

function main(): void {
  const repoRoot = resolve(process.cwd());
  const targetArg = process.argv[2];
  const target = targetArg ? resolve(targetArg) : join(repoRoot, "src");

  console.log("=== TRUTHFULNESS SCAN ===\n");
  console.log(`Scanning: ${relative(repoRoot, target).replace(/\\/g, "/") || target}\n`);

  const files = walkDir(target);
  for (const f of files) {
    scanFile(f, repoRoot);
  }

  printSection("Hard fails (must fix before merge)", HARD_FAILS);
  console.log("");
  printSection("Soft warns (review + source)", SOFT_WARNS);
  console.log("");
  printSection("Pricing drift (canonical price outside pricing surfaces)", PRICING_DRIFTS);
  console.log("");
  printSection("Forgeries (invented prices)", FORGERIES);
  console.log("");

  const blocking = HARD_FAILS.length + FORGERIES.length;
  if (blocking === 0) {
    console.log("Verdict: PASS");
    console.log("TRUTHFULNESS_OK");
    process.exit(0);
  } else {
    console.log(`Verdict: FAIL (${blocking} blocking findings)`);
    console.log("");
    console.log("Remediation: replace each blocking line with an honest claim from CLAUDE.md,");
    console.log("or move the historical-marker into a // comment if it's documenting old data.");
    process.exit(1);
  }
}

main();
