# Permit-catalog reference documents

These are authoritative reference docs for Henri's permit-source catalog and
the property/MLS/claims data landscape. Copied from the desktop sweep that
built `permit_sources` — kept in the repo so engineering + ops can reference
them without going back to the loose files.

## What's here

| Doc | Purpose |
|---|---|
| `verified_apis_only.md` | The short list of permit APIs that passed live probe. Start here when adding new coverage. |
| `free_data_sources_complete.md` | Complete free-data catalog — permits, property, weather, census. Anything marked "free tier" is candidate for wiring. |
| `free_construction_apis.md` | Construction-industry-specific APIs (housing starts, materials pricing, labor stats). Useful for analytics enrichment. |
| `property_and_claims_data_sources.md` | Property ownership + insurance-claims data sources. Drives the homeowner-side enrichment. |
| `property_claims_live_endpoints.md` | The subset of property/claims sources with reachable endpoints. |
| `solutions_sold_property_and_claims.md` | Competitive intelligence: which vendors sell what datasets. |
| `mls_new_property_access.md` | MLS (Multiple Listing Service) access routes — paid + free. Most require RESO Web API credentials. |

## What lives in the DB vs. what lives here

- **In `permit_sources` table:** every row from `US_Permit_APIs_FINAL_v2.csv`
  (19,734 rows) + agent findings + vendor portals + URL health flags.
  Queryable by the probe + scrape crons.
- **Here in `docs/permit-catalog/`:** prose explaining the landscape, ranking
  sources by reliability, noting auth requirements, documenting paid vs. free
  tiers. Read by humans; not loaded by code.

## Related

- `scripts/import-permit-catalog.ts` — initial import of the 19k-row master
- `scripts/sync-desktop-data.ts` — incremental sync of vendor portals +
  agent findings + dead-URL flags
- `scripts/bulk-probe-sources.ts` — runs the live probe to flip `enabled=true`
- `src/lib/sources/probe.ts` — probe + field-inference logic
- `src/app/api/cron/scrape/route.ts` — production ingester
