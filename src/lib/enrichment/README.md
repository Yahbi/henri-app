# Enrichment

How we turn a bare permit row into a full lead with owner name, phone, email, mailing address, property data, employer, and occupation — all from free public sources.

## Entry points

- **`orchestrator.ts`** — the unified `enrichLead(context)` function. Composes every source module below in priority order. Used by `/api/cron/enrich/route.ts`.
- **`extract-contact.ts`** — raw-JSON extractor used at ingest time in `/api/cron/permits/route.ts`. Pulls owner/phone/email from the Socrata/ArcGIS payload before anything else.

## Source modules (all free)

The orchestrator now composes **13 sources**. Five run without any API key or database ingest; the remaining eight activate when their credential or one-time data ingest lands.

| Module | What it returns | Cost / gate |
|---|---|---|
| `extract-contact.ts` | owner, phone, email from `permits.raw_json` | zero — DB read, always on |
| `description-miner.ts` | phones + emails regex-mined from free-text permit descriptions | zero — pure in-memory, always on |
| same-address lookup _(inline in orchestrator)_ | owner from sibling permits at same address | 1 REST call, always on |
| `voter-file.ts` (+ Soundex phonetic fallback) | owner + phone + mailing from ingested FL/NC/OH voter files | SQL only, post-ingest |
| `ppp-loan.ts` | LLC owner + business phone + employer + NAICS for every SBA-PPP recipient | SQL only, post-ingest (~11M records) |
| `county-gis.ts` | year_built, sqft, assessed_value, owner | 22 public endpoints, no key |
| `osm-contact.ts` | contact:phone / contact:email / website / operator + year_built (commercial buildings) | 1 req/s Nominatim, no key |
| `regrid-parcel.ts` | nationwide parcel data fallback | gated on `REGRID_API_KEY` |
| `contractor-license.ts` | business phone + license-holder name | CA CSLB live, TX/FL scaffolded |
| `google-places.ts` | business phone + address + website + status | gated on `GOOGLE_PLACES_API_KEY`, 5k/mo |
| `yelp-fusion.ts` | business phone + address + categories | gated on `YELP_API_KEY`, 5k/day |
| `opencorporates.ts` | LLC → principal | gated on `OPENCORPORATES_API_KEY`, 500/day |
| `fec-contributor.ts` | confirmed address + employer + occupation (4 election cycles) | gated on `FEC_API_KEY`, 1k/hr |
| `voter-registration.ts` | phone via vendor API scaffold (not live) | gated on `VOTER_REG_ENABLED` |
| `hunter-email.ts` | email by business-name domain pattern | gated on `HUNTER_API_KEY`, 50/mo |
| `usps-normalize.ts` | canonical address + ZIP+4 | gated on `USPS_USER_ID` |

## Source order in `enrichLead()`

Four phases. Phase A is sequential DB/in-memory (cheap, dependent). Phase B runs 7 independent external calls in parallel. Phase C (FEC) depends on Phase B's `owner_first/last`. Phase D runs voter-reg + Hunter in parallel.

```
Phase A (sequential, in-DB)
  0. Upstream seed (raw_json from ingest)
  0. Description miner (regex on permit text, in-memory)
  1. Same-address sibling permits
  2. Local voter file (FL/NC/OH) with Soundex phonetic fallback
  3. PPP loan database (name-match + address-match)

Phase B (parallel, external)
  4. County GIS
  5. Regrid (gated)
  6. Contractor license board (CSLB etc.)
  7. OpenCorporates (gated)
  8. Google Places (gated)
  9. Yelp Fusion (gated)
 10. OSM contact metadata

Phase C (sequential, depends on Phase B output)
 11. FEC contributor (4-cycle: 2018, 2020, 2022, 2024)

Phase D (parallel)
 12. Voter-reg vendor scaffold (disabled)
 13. Hunter.io email inference (gated)
```

Each pass runs ONLY when earlier passes didn't already populate what it provides. County/Regrid are skipped when we already have year_built + owner; Hunter skipped when we already have email; etc.

## Performance

- **Cache**: per-address + zip + state, 6-hour TTL, in-memory (per-lambda). Re-enrichments of the same address hit cache in <1ms.
- **Telemetry**: `getTelemetry()` returns per-source call count, hit count, and total latency. Helps answer "is OpenCorporates actually contributing?"
- **Parallelism**: Phase B's 7 independent sources fire concurrently via `Promise.all`. Typical latency went from sum-of-sources (~8s) to max-of-sources (~2-3s).

## Provenance

Every field written to `leads` carries a source tag on `leads.contact_source` + confidence on `leads.contact_confidence` + timestamp on `leads.contact_extracted_at`. Requires **migration 00039**. Writes are gated on `WRITE_PROVENANCE=1` env var so unmigrated DBs don't fail the whole update.

The orchestrator's return object includes a per-field `sources` map — `{ owner_name: "same_address_permit", phone: "cslb_ca", email: "hunter_io" }` — so UI can show "contact from CSLB" etc.

## Adding a new source

1. Create `src/lib/enrichment/<source>.ts` following the module pattern:
   - Export an async `lookupX()` that takes the relevant bits of context
   - Return `null` for every failure mode (missing key, network error, empty result)
   - Gate the module on an env var if the source needs credentials
   - Include a `logger.warn` on unexpected failures (never throw)
2. Add a pass to `orchestrator.ts` in the right priority slot
3. Document the module in the table above
4. Add tests to `src/lib/enrichment/__tests__/` if the module has non-trivial parsing

## Real-time (new leads) vs batch (backlog)

- **New leads at ingest**: `/api/cron/permits/route.ts` runs `extractContactWithProvenance` inline. No external calls (ingest cron has 5 min budget, can't afford them). Owner data seeded where raw_json has it.
- **Batch backlog + new leads' external enrichment**: `/api/cron/enrich/route.ts` runs every 15 min (see `vercel.json`). Calls `enrichLead()` for every lead with `year_built IS NULL`. 4-worker concurrency, 280s deadline, resumable.

## Scripts that touch enrichment

| Script | Purpose |
|---|---|
| `backfill-contact-from-raw.ts` | Re-extracts contact from `permits.raw_json` across the whole table. Resumable via state file. |
| `correlate-enrichment.ts` | 4-pass cross-permit / LLC-principal correlation in-DB. |
| `burst-enrich.ts` | Hits `/api/cron/enrich` N times locally to drain backlog. |
| `ingest-voter-fl.ts` / `-nc.ts` / `-oh.ts` | One-time bulk-file ingest into `voter_{state}` tables. |
| `_enrich-stats.ts` | Prints non-null coverage across all enrichment fields. |

## Voter file download URLs

- **FL**: https://dos.myflorida.com/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/ (requires form)
- **NC**: https://www.ncsbe.gov/results-data/voter-registration-data (free download, zip)
- **OH**: https://www6.ohiosos.gov/ords/f?p=111:1 (free download, CSV per county or statewide)

## Coverage ceiling (free sources only)

| Field | Realistic ceiling |
|---|---|
| `owner_name` | 30–40% baseline; 60–70% after FL/NC/OH voter file ingest |
| `year_built` / `home_sqft` / `assessed_value` | 45–55% (covered metros only) |
| `phone` | 1–3% without voter files; 15–20% with FL+NC+OH ingested |
| `email` | <1% without paid, ≤5% with Hunter.io paid |
| `mailing_address` | 30–40% |
| `employer` / `occupation` | 10–20% via FEC for politically-engaged owners |

Past these ceilings requires paid vendors (Regrid paid tier, Clearbit, Apollo, L2/TargetSmart voter vendors).

## Env vars

All optional; modules graceful-degrade when missing:

```
OPENCORPORATES_API_KEY   # 500/day free tier, opencorporates.com/api_accounts/new
FEC_API_KEY              # 1k/hr free tier, api.data.gov/signup
GOOGLE_PLACES_API_KEY    # 5k/mo free Place Search + 5k/mo Details, console.cloud.google.com
YELP_API_KEY             # 5k/day free, www.yelp.com/developers
REGRID_API_KEY           # free tier metered, app.regrid.com
HUNTER_API_KEY           # 50/mo free tier, hunter.io/users/sign_up
USPS_USER_ID             # free, registration.shippingapis.com
VOTER_REG_ENABLED=1      # enables the vendor scaffold (today a no-op)
WRITE_PROVENANCE=1       # flip ON once migration 00039 lands
```

## One-time bulk ingests (post-migration)

Three free bulk datasets you download once then query forever:

| Migration | Data | Download |
|---|---|---|
| `00041_voter_files.sql` | FL/NC/OH voter rolls | See download URLs section below |
| `00042_ppp_loans.sql` | 11M+ SBA PPP loan records | https://data.sba.gov/dataset/ppp-foia → "All PPP Loans" |

Run the ingest scripts:
```bash
npx tsx scripts/ingest-voter-fl.ts  /path/to/fl_voter_file.txt
npx tsx scripts/ingest-voter-nc.ts  /path/to/ncvoter_Statewide.txt
npx tsx scripts/ingest-voter-oh.ts  /path/to/SWVF_1_22.csv
npx tsx scripts/ingest-ppp.ts       /path/to/ppp_loans.csv
```

All four are resumable (checkpoint via `scripts/.ingest-*.state.json`).
