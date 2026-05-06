# Archived scripts

One-off scripts that have served their purpose. Kept for history —
re-running them is not expected, and they may reference tables /
columns that have since evolved.

## Why archive instead of delete?

1. **Audit trail.** Several of these scripts were used on production —
   e.g. `wipe-null-island-coords.ts`, `cleanup-junk-permits.ts`,
   `fix-permit-address-attribution` predecessors. When a data issue
   resurfaces, knowing the exact script that ran (and its date) matters.
2. **Reference patterns.** The `probe-v2-fields`, `trace-uselead-*`,
   `check-*` scripts encode the field-mapping heuristics we learned
   during ingest development. Anyone building a new ingester can grep
   here for "how did we probe X?"
3. **Git-mv kept history.** We used `git mv` so `git log --follow`
   still traces each script to its original commit.

## Reviving an archived script

```
git mv scripts/_archive/xyz.ts scripts/xyz.ts
# Review: it may reference old columns / enums
```

Most of these expect the pre-Phase-0b schema (before migrations 00031+).
Sanity-check the SQL before running.

## What lives in the active `scripts/` dir

Only scripts that are:
- Referenced from `package.json` (the cron-equivalents)
- Referenced from a `.claude/commands/*.md` runbook
- Recent data-quality tooling that may be re-run (cleanup-data-quality,
  backfill-contact-from-raw, fix-permit-address-attribution,
  cleanup-fake-agol-subdomains, requalify-enabled-sources,
  import-catchall-catalogs, import-onsite-catalogs)
- Ad-hoc `_`-prefixed enrich/recompute scripts kept for re-triggering

Everything else lives here.
