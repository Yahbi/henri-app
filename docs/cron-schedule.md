# Cron schedule — rationale and revert plan

Companion to `vercel.json`. That file **cannot carry comments** — Vercel's schema
validation rejects unknown keys, including `$comment`, and the deployment fails
before the build starts with:

```
The `vercel.json` schema validation failed with the following message:
should NOT have additional property `$comment`
```

So the reasoning lives here instead. If you change the schedule, update this file
in the same commit.

## Why these exist

The pipeline was **dead for 29 days** (2026-07-06 → 2026-08-04, zero permits
ingested). Only two crons were scheduled in `vercel.json` because the Hobby plan
capped it at two; every other cron depended on an external scheduler (GitHub
Actions / a Hetzner box) that had stopped and that nothing alerted on. On a paid
plan the fleet is scheduled natively and no longer depends on an outside trigger.

## Cadence reasoning

| Cron | Schedule | Why |
|---|---|---|
| `score` | every 30 min | Drains the ~83k unscored-permit backlog at 1000/run (~2 days), then keeps pace with ingest. |
| `enrich` | hourly | ~1200 leads/run at ~290s. A 274k backlog needs ~57 days at 4 runs/day but ~10 days at 24. This is the single highest-leverage cadence in the file. |
| `re-enrich` | daily | Fills owner/phone/email on leads that already have `year_built` — rows the main enrich pass skips by design (it selects `year_built IS NULL`). |
| `permits` | every 4h | General ingest. |
| `nj-statewide-permits` | every 2h | Paged backfill of ~2.7M NJ rows; the cursor persists in `cron_runs.summary.nextOffset` and wraps at the end of the feed. |
| `catchup` | hourly at :50 | Self-heals any tracked data cron that missed its slot. |
| everything else | daily / weekly | Sidecar data that changes slowly. Staggered by UTC slot so heavy jobs never overlap. |

Times are UTC.

## Revert plan

Restore the two-entry array and the app returns to its prior behaviour:

```json
{
  "crons": [
    { "path": "/api/cron/refresh-zip-aggregates", "schedule": "0 3 * * 0" },
    { "path": "/api/cron/synthesize-pre-intent", "schedule": "0 4 * * 0" }
  ]
}
```

Every cron is idempotent and additive, so removing a schedule only stops new data
arriving — it never corrupts or deletes existing rows.

## Constraints to remember

- **Cron count is plan-limited.** Hobby allows 2 (once-daily); paid plans allow
  many more. Exceeding the allowance fails the deployment at config validation,
  not at runtime.
- **`vercel.json` accepts no comments and no unknown keys.** Validation happens
  before the build, so a bad key produces an `ERROR` deployment with *no build
  logs at all* — which looks alarming but simply means it never got to building.
- Route `maxDuration` caps how long each cron may run; the ingest routes are
  written with their own deadline guards well inside that budget.
