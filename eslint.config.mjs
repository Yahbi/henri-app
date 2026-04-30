import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // TS-ESLint convention: `_`-prefixed identifiers are intentionally unused.
      // Applies to args, catch blocks, destructures, and locals.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Archived scripts — kept for git history, not production code.
    "scripts/_archive/**",
    // Diagnostic / audit scripts (Henri convention: `_`-prefixed scripts
    // are one-shot diagnostics, not part of the runtime). They include
    // intentionally-unused probe variables for debugging. CLAUDE.md
    // documents this convention. Operational scripts (no underscore
    // prefix) like backfill-permit-value.ts continue to be linted.
    "scripts/_*.ts",
    "scripts/_*.mjs",
    "scripts/probe_*.mjs",
    "scripts/sources_health_*.py",
    "scripts/fix_al_zips.py",
    "scripts/audit-desktop-sync.ts",
    "scripts/bulk-probe-sources.ts",
    "scripts/fix-permit-address-attribution.ts",
    "scripts/import-permits-from-csv.ts",
  ]),
]);

export default eslintConfig;
