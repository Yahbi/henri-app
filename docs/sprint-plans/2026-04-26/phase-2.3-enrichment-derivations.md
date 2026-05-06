# Phase 2.3 — 6 derived enrichment sources

**Effort**: 2 weeks
**Status**: Pending

## Context

Per the audit's [02-data-layer.md](docs/audits/2026-04-26/02-data-layer.md) and the predictive engine sprint, the 13-source orchestrator covers contact + property well but misses the derived signals that drive predictive rules:

- Roof material + install date (drives `aging-roof` rule)
- HVAC age (drives `aging-hvac` rule)
- Pool presence (drives `pool-to-landscaper` rule for properties without explicit pool permit)
- Solar presence (drives `solar-to-battery` rule)
- Electrical panel age (drives `old-home-electrical` rule)
- NOAA Storm Events Database (massive wedge for roofing/storm-chaser contractors)

## Foundation already shipping

- `src/lib/enrichment/orchestrator.ts` — 4-phase pipeline, easy to add Phase B sources
- `address_permit_history` (migration 00025) — already aggregates `trades text[]` and per-permit details
- Migration 00043 — partial indexes on `leads.year_built IS NULL` etc. (still pending apply)

## Scope (one source per ~2 days)

### Day 1–2: Roof age (derived)

`src/lib/enrichment/derived/roof-age.ts`. No new API — derived from existing data:

```ts
export function deriveRoofAge(lead: Lead, history: AddressPermitHistory | null) {
  const lastRoof = history?.permits.find(p => /roof/i.test(p.trade ?? ""));
  if (lastRoof) return { last_roof_permit: lastRoof.applied_date, years_since: ... };
  if (lead.year_built) return { years_since: thisYear - lead.year_built, derived_from: "year_built" };
  return null;
}
```

Write to `leads.roof_age_estimate jsonb` (new column, additive migration 00049).

### Day 3–4: HVAC age (derived)

Same pattern as roof, looking at HVAC permits. Write to `leads.hvac_age_estimate jsonb`.

### Day 5: Pool + Solar presence (derived)

Mine `permits.description` for "pool", "spa", "solar", "photovoltaic", "PV system" via regex. Write to `leads.pool_presence boolean` and `leads.solar_presence boolean`.

### Day 6–7: Electrical panel age (derived)

Heuristic: if `year_built < 1980` AND no electrical permit in history → flag `electrical_panel_age_estimate: "likely undersized"`. Otherwise null.

### Day 8–10: NOAA Storm Events ingest (NEW)

Free API: https://www.ncdc.noaa.gov/stormevents/

- New cron `/api/cron/storm-events` (daily 5am ET)
- Pulls last 7 days of storm events nationwide via the CSV API
- Stores in new `storm_events` table (lat, lng, event_type, severity, date, narrative)
- Spatial join to leads via PostGIS or simpler bounding-box per ZIP
- New column `leads.recent_storm_event_id uuid` — when set, drawer shows a "Hail event 3 days ago" chip

This is the biggest single-feature value in this sprint — roofing contractors can finally find storm-affected homes.

### Days 11–12: orchestrator integration + tests

- Wire each derived source into `orchestrator.ts` Phase D (terminal)
- Per-source unit tests
- Telemetry: track hit rates per source

## Files

**New**:
- `src/lib/enrichment/derived/roof-age.ts`
- `src/lib/enrichment/derived/hvac-age.ts`
- `src/lib/enrichment/derived/pool-solar.ts`
- `src/lib/enrichment/derived/electrical-panel.ts`
- `src/lib/enrichment/noaa-storms.ts`
- `src/app/api/cron/storm-events/route.ts`
- `supabase/migrations/00049_derived_enrichment_columns.sql`
- `supabase/migrations/00050_storm_events.sql`

**Modified**:
- `src/lib/enrichment/orchestrator.ts`
- `vercel.json` — add `storm-events` cron schedule
- `src/components/dashboard/CurrentPermitHero.tsx` (Phase 1.1) — render storm chip

## Verification

- 6 × ~5 unit tests = 30+ new tests pass
- Manual: open a Hartford lead, verify roof_age_estimate populated
- Manual: trigger NOAA cron, verify ~50–500 storm events ingested
- Drawer: open a lead in a recently-stormed ZIP, verify chip shows

## Out of scope

- Aerial roof imagery (NearMap, EagleView) — paid, post-Phase 3
- Pre-2018 solar (Google Project Sunroof) — separate spike, separate API key
- Storm-event ML scoring (which storms predict roof claims) — needs 12+ months of close-rate data
