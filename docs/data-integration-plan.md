# Data integration plan — three external folders → Henri App

> Generated 2026-04-27. Inputs:
> - `C:\Users\yabis\Desktop\Data for Onsite\` (~5.1 GB)
> - `C:\Users\yabis\Desktop\Data Henri 3\` (~150 MB)
> - `C:\Users\yabis\Desktop\henry-2.1-extracted\` (3 HTML files)
>
> Output target: `C:\Users\yabis\Desktop\Henri App\` (live Next.js + Supabase project, 932k permits, 133.7k leads).

---

## Context

The user has accumulated three pools of source material from prior research/scraping efforts and an older Henri 2.1 static prototype. Most of it has a real home in the running Next.js app — but only some of it is actually new. The plan's job is to triage every artifact: **import**, **archive**, **discard**, or **reference-only**.

Three foundational truths from CLAUDE.md and today's audit shape every routing decision:

1. **Existing scrapers + source registry already ship.** `src/lib/scrapers/{arcgis,socrata,normalizer}.ts` + `sources.ts` are the canonical ingest path. New endpoints from external CSVs land there, not in a parallel system.
2. **Migrations are additive-only.** The proposed schema in `Data for Onsite/Data/02_database_schema.sql` is structurally similar to Henri's but NOT identical — borrow column ideas, never replace the live schema.
3. **Henri 2.1 used `#E8916A`.** That is the explicitly forbidden old terracotta. Extract layout/UX patterns from the 2.1 HTML; never copy styles or color tokens.

---

## Inventory at a glance

### `Data for Onsite/` (~5.1 GB)

| Path | Type | Volume | Verdict |
|---|---|---|---|
| `*_datasets.csv` (13 state files + Nationwide) | Permit-source catalog (City/County, dataset, API portal, frequency, notes) | 1.5–4 KB each | **Import → source registry seed** |
| `onsite-public-apis.csv` | Federal API master (Census BPS, FEMA NFIP, NOAA, etc.) | 11 entries | **Import → federal-source seed** |
| `API2.0/*.md` (21 docs) | Markdown research bibles per state/region | 50+ files | **Reference → `docs/data-research/api20/`** |
| `API2.0/MASTER_US_FREE_APIS.csv,.json` | Master nationwide source catalog | dual-format | **Import → use as primary seed** |
| `Data/01–07_*.{md,py,sql}` | Proposed pipeline architecture (Python + SQL) | 7 files | **Reference → `docs/data-research/proposed-arch/`** |
| `Data/02_database_schema.sql` | PostgreSQL schema proposal | 600+ lines | **Reference only** — cherry-pick column ideas, never replace |
| `Onsite data/` | Near-duplicate of `Data/` with permit-specific spin | overlap | **Dedupe → keep `Data/` only** |
| `permit_records/*.csv.gz` (200+ files) | **REAL permit data** — 16-col schema by state, all 50 states | **5.1 GB compressed** | **Import → batch loader → `permits` table** (gated on migrations) |
| `zip_code_database.xls` | ZIP code reference dataset | 1 file | **Import → `zip_lookup` table OR keep file-based** |
| `._*` files | macOS resource forks | many | **Discard** |

### `Data Henri 3/` (~150 MB)

| Path | Type | Volume | Verdict |
|---|---|---|---|
| `US_PERMIT_DATABASE_COMPLETE.csv` | Real permit rows (137k records) | 33 MB | **Import → `permits` table batch loader** |
| `US_Permit_APIs_Complete_Master_Final.csv` | Endpoint catalog (104k entries) | 24 MB | **Import → source registry, dedupe with Data for Onsite** |
| `US_Permit_APIs_FINAL_v2.csv` | Older snapshot of same | 17 MB | **Discard** (superseded by `Final`) |
| `US_Permit_APIs_Master.csv` | Earliest snapshot | 27 KB | **Discard** |
| `US_Permit_APIs_Complete_Master.csv,Clean.csv` | Intermediate | 1.4 MB each | **Discard** |
| `Massive_US_Permit_Mapping.csv` | ZIP → source mapping (33k rows) | 5.7 MB | **Import → `zip_to_source_map` table** for capacity filter |
| `accela_portals.csv` | Accela portals (auth-required) | 12 KB | **Reference → flag as `requires_auth=true` in source registry** |
| `arcgis_*.csv` (15+ files) | ArcGIS source-discovery sweeps | 14 MB total | **Merge → dedupe into one canonical file → import** |
| `add_*.py` / `audit_*.py` (83 Python scripts) | Discovery scripts | scripts | **Archive → `scripts/_archive/data-henri-3/`** |
| `*.md` (7 docs) | Research summaries | docs | **Reference → `docs/data-research/henri-3/`** |
| `Data_Henri_3_Archive.zip` | Snapshot bundle | 22 MB | **Discard** (extract first if needed; otherwise redundant) |

### `henry-2.1-extracted/`

| Path | Type | Verdict |
|---|---|---|
| `henri-portal.html` (1,154 LOC) | Old portal mockup with `#E8916A` | **Reference only** — extract any UX patterns missing from current `/portal` |
| `henri-contractors.html` (1,013 LOC) | Old contractors landing | **Reference only** — diff against `(marketing)/contractors/page.tsx` |
| `henri-dashboard.html` (2,940 LOC) | Old dashboard mockup | **Reference only** — biggest pattern source; diff against current `(dashboard)/dashboard/` |
| `.claude/launch.json` | Old launch config | **Discard** — current `.claude/launch.json` already correct |

---

## Where each thing belongs (the routing table)

### A. Permit source endpoints → `src/lib/scrapers/sources-imported.ts`

**Inputs that land here:**
- `Data for Onsite/API2.0/MASTER_US_FREE_APIS.csv` (canonical)
- `Data Henri 3/US_Permit_APIs_Complete_Master_Final.csv` (104k entries)
- `Data Henri 3/arcgis_*.csv` merged
- All 13 state `*_datasets.csv` files
- `Data for Onsite/onsite-public-apis.csv`
- `Data Henri 3/accela_portals.csv` (with `requires_auth: true`)

**How:**
- New file `src/lib/scrapers/sources-imported.ts` — array typed against the existing `PermitSource` interface from `sources.ts` (extend it with optional `requires_auth`, `categories`, `coverage_level`, `update_freq` for the new dimensions).
- One-time `scripts/import-source-catalog.ts` that ingests all the CSVs, dedupes by `(state, jurisdiction, endpoint)`, classifies as `socrata | arcgis | accela | hud | other`, and writes the typed array.
- `sources.ts` keeps its hand-curated list. `sources-imported.ts` is the bulk catalog. Loader merges both (hand-curated wins on conflict).

**Why split:** the hand-curated list has 12 carefully-tuned field mappings (idField, descField, etc. per city). The imported catalog has 100k+ endpoints with no field mapping — most rows just say "this URL exists". The scraper falls back to convention for un-mapped sources. Two separate exports keeps both tractable.

### B. Real permit records → `permits` table via batch loader

**Inputs:**
- `Data for Onsite/permit_records/*.csv.gz` (5.1 GB, all 50 states)
- `Data Henri 3/US_PERMIT_DATABASE_COMPLETE.csv` (137k rows)

**How:**
- New `scripts/import-permit-archive.ts` (`pnpm import:permits`):
  - Walks `permit_records/`, decompresses each gz file to a stream
  - Maps source-CSV columns to Henri's `permits` schema (16 → ~30 columns; missing ones default to NULL)
  - Idempotent: ON CONFLICT (source_url, permit_number) DO UPDATE
  - Batches of 500 inserts via service-role client
  - Per-state checkpoint file in `.import-state.json` so resumption works
  - Time budget: ~4 hours for 5 GB on a contractor laptop (single-threaded; multi-thread version optional)
- For `US_PERMIT_DATABASE_COMPLETE.csv`: same loader, just point at one file.

**Gates (BLOCKERS):**
- Migration 00039 (`contact_provenance`) MUST be applied first — today's audit found inserts fail with "contact_confidence column missing" until 00039 lands. This is the same blocker that prevents `/api/cron/permits` from inserting.
- Migration 00043 (partial indexes) recommended before bulk insert so the existing `year_built IS NULL` cron can keep up with the inflow.

**Truthfulness:** the real-data audit shows 932k permits today. Adding 137k from `US_PERMIT_DATABASE_COMPLETE.csv` plus the gz archive could roughly double the corpus to 1.5–2M. Mark the corresponding marketing copy with the new floor only AFTER the import completes — until then, "900k+ permits" stays.

### C. ZIP → source mapping → `zip_source_map` table

**Input:** `Data Henri 3/Massive_US_Permit_Mapping.csv` (33k rows, columns: Zip, City, County, State, API_Available, Vendor, Portal_URL).

**How:**
- New migration `00052_zip_source_map.sql` — additive-only table:
  ```sql
  CREATE TABLE IF NOT EXISTS zip_source_map (
    zip varchar(10) NOT NULL,
    city text,
    county text,
    state varchar(2) NOT NULL,
    api_available text,         -- "Yes (County-level: HUD)", "No (Requires Auth)", etc.
    vendor text,                -- "ArcGIS", "Socrata", "accela", "HUD"
    portal_url text,
    requires_auth boolean DEFAULT false,
    PRIMARY KEY (zip, vendor)
  );
  CREATE INDEX zip_source_map_state_idx ON zip_source_map(state);
  ```
- Loader `scripts/import-zip-source-map.ts` — single-pass insert; idempotent via `ON CONFLICT DO UPDATE`.
- Wedge link: this table feeds the **Capacity envelope** (wedge bullet #3). When a contractor sets a 25-mile radius around their HQ, we can answer "do we have any sources for the ZIPs you cover?" without having to probe each one live.
- New endpoint `/api/territory/coverage?zip=...` reads this table; existing `/api/capacity` route gets a `coverage_quality` field added.

### D. ZIP code reference data → either table or static asset

**Input:** `Data for Onsite/zip_code_database.xls`.

**Options:**
- **Static** (recommended): convert to JSON once, ship in `src/lib/zip-data/zip-database.json` (gzipped). Importable from any module, zero DB cost.
- **Table**: only if Henri starts doing zip-level joins in SQL, which it doesn't today.

Action: convert with `xlsx` lib in a one-shot `scripts/convert-zip-xls.ts`, output JSON, drop the .xls.

### E. Federal/national APIs → existing enrichment modules

**Input:** `Data for Onsite/onsite-public-apis.csv`.

These are NOT permit sources — they're enrichment/context APIs (Census Building Permits Survey, FEMA NFIP, NOAA Storm Events). Map them:

| API | Already wired? | Action |
|---|---|---|
| Census Building Permits Survey | No | Add `src/lib/enrichment/census-bps.ts` (free, monthly, macro context) |
| FEMA NFIP Redacted Claims | No | Add `src/lib/enrichment/fema-nfip.ts` (flood-zone risk → roofing/foundation upsell) |
| NOAA Storm Events | YES — `00050_storm_events.sql` + cron | No-op (pending migration) |
| NOAA Climate Data Online | No | Optional — add only if storm context proves valuable |
| FEMA Public Assistance Funded Projects | No | Optional — disaster-prone ZIP signal |
| Federal Procurement Data System (FPDS) | No | Out of scope (federal contractors, not residential) |

Each new module follows the existing pattern: env-var-gated, in-memory cache, `null` on error, never throws.

### F. Architecture / research docs → `docs/data-research/`

**Inputs:** `Data for Onsite/{API2.0,Data,Onsite data}/*.md`, `Data Henri 3/*.md`.

**How:** create `docs/data-research/` with three subfolders:
- `api20/` — original API2.0 master docs
- `proposed-arch/` — `Data/01–07_*.{md,py,sql}` (the alternate pipeline proposal)
- `henri-3/` — `Data Henri 3/*.md`

Add a `docs/data-research/README.md` that explains "this is reference material, not the source of truth — `CLAUDE.md` and `src/` are." This prevents future engineers from "porting" the proposed schema without knowing it's been weighed and rejected.

### G. Python discovery scripts → archive

**Inputs:** 83 `.py` files across `Data Henri 3/` and `Data for Onsite/Data/`, `Onsite data/`.

These are one-off discovery tools (`add_arcgis_socrata_sweep.py`, `add_40_cities_and_update_zips.py`, etc.). They produced the CSVs we're importing. Once the CSVs are in, the scripts are historical artifacts.

**How:** copy under `scripts/_archive/data-henri-3/` with a top-level `README.md` that records:
- Why they exist (one-time scrapes from 2026-04-19 → 2026-04-26)
- What CSVs each produced
- That they should NOT be re-run without an explicit decision (some hammer free APIs that have since changed quotas)

### H. Henri 2.1 HTML → UX-pattern audit, then archive

**Inputs:** `henry-2.1-extracted/henri-{portal,contractors,dashboard}.html`.

**Process:**
1. Read the dashboard HTML once with an eye to UX patterns we may have lost in the Next.js rewrite (e.g., a panel layout, an onboarding step, a microinteraction).
2. Each found pattern → file an issue / TODO in `docs/data-research/henri-2.1-uxnotes.md` with:
   - Pattern name
   - Where it lived in 2.1
   - Whether the current Next.js implementation has it (yes / no / partial)
   - Recommendation
3. After the audit, move the HTML files into `docs/data-research/henri-2.1/` for posterity.

**Hard rule:** NEVER copy CSS variables, color tokens, or brand styling from these files. They use `#E8916A` (the forbidden old color), use `font-bold` on Fraunces (forbidden), and predate the design-system audit. Pattern extraction only.

---

## Critical files to create / modify

### New
- `scripts/import-source-catalog.ts` — merges/dedupes 8+ CSVs into typed source registry
- `scripts/import-permit-archive.ts` — bulk-loads `permit_records/*.csv.gz` + `US_PERMIT_DATABASE_COMPLETE.csv`
- `scripts/import-zip-source-map.ts` — loads `Massive_US_Permit_Mapping.csv` into new table
- `scripts/convert-zip-xls.ts` — one-shot .xls → .json
- `src/lib/scrapers/sources-imported.ts` — typed bulk catalog
- `src/lib/zip-data/zip-database.json` — converted ZIP reference
- `src/lib/enrichment/census-bps.ts` — Census BPS enrichment module
- `src/lib/enrichment/fema-nfip.ts` — FEMA flood-claim enrichment module
- `supabase/migrations/00052_zip_source_map.sql` — additive table for capacity filter
- `docs/data-research/README.md` — index + read-only banner
- `docs/data-research/api20/` (mirrored from API2.0)
- `docs/data-research/proposed-arch/` (mirrored from Data/)
- `docs/data-research/henri-3/` (mirrored from Data Henri 3/*.md)
- `docs/data-research/henri-2.1/` (mirrored HTML, archive only)
- `docs/data-research/henri-2.1-uxnotes.md` (audit findings)
- `scripts/_archive/data-henri-3/README.md` (archive ledger)
- `scripts/_archive/data-henri-3/*.py` (mirrored Python scripts)

### Modified
- `src/lib/scrapers/sources.ts` — extend `PermitSource` interface with optional new dimensions; export both `PERMIT_SOURCES` (curated) and `ALL_SOURCES` (curated + imported)
- `src/lib/permits/fetcher.ts` — accept either source kind; route Accela ones through the not-yet-implemented auth path or skip with a clear log
- `src/app/api/capacity/route.ts` — surface `coverage_quality` from `zip_source_map`
- `CLAUDE.md` — add a `## Data archive sources (2026-04-27)` row pointing at the import scripts and migration 00052
- `package.json` scripts: `import:catalog`, `import:permits`, `import:zip-map`, `convert:zip-xls`

---

## Phasing

The full integration is roughly a week of focused work. Suggested order:

1. **Day 1 — apply pending migrations** (00031–00051, already bundled at `supabase/_pending-bundle.sql`). NO data import works without this. Verify with `pnpm migrate` showing all green and `npx tsx scripts/_session-data-audit.ts` confirming `last_enriched_at` exists, `contact_source` exists, etc.
2. **Day 1 — add migration 00052** (zip_source_map). Apply via the same path.
3. **Day 2 — source catalog import**. Build `sources-imported.ts` + dedup logic + first run. Verify with `pnpm tsc --noEmit` + a smoke test that fetches one socrata + one arcgis source from the imported list.
4. **Day 3 — ZIP map import + capacity wiring**. Run `import-zip-source-map.ts`, surface coverage_quality on the dashboard's capacity badge.
5. **Day 4 — federal enrichment modules** (Census BPS, FEMA NFIP). Wire into orchestrator Phase E parallel branches behind env-var gates.
6. **Day 5–6 — permit archive bulk load**. Run `import-permit-archive.ts` overnight on the 5 GB tarball; one state at a time so a failure can be resumed. Re-run truthfulness scan + audit after to confirm the marketing claim "900k+ permits" can be raised honestly.
7. **Day 7 — Henri 2.1 UX audit**. Read 3 HTML files; produce findings doc; archive originals.
8. **Day 7 — research-doc mirror + Python script archive**. Mechanical copy of the .md and .py files under `docs/data-research/` and `scripts/_archive/`.

---

## Out of scope (not now, possibly later)

- **Replacing Henri's schema** with the proposed `Data/02_database_schema.sql`. The proposal predates the current `permits/leads/profiles/territories/exclusivity_locks` design and would require a 3-month migration. Not worth it; current schema is fine.
- **Running the Python discovery scripts** in `Data Henri 3/`. They consumed free-API quota during 2026-04-19 → 04-26 and re-running could trip rate limits. Outputs (CSVs) are what we need; scripts are archive.
- **Importing all 83 ArcGIS sweep CSVs** verbatim. Many overlap; one merged + deduped output is the goal.
- **Live-fetching from accela_portals.csv** sources. They require auth; the wedge contract doesn't promise scraper-bypass capability and CLAUDE.md forbids it ("Never reveal data sourcing methods... no scraping").
- **Henri 2.1 styling**. `#E8916A` and `font-bold` Fraunces are explicitly forbidden in CLAUDE.md.

---

## Verification

After each phase:

- `pnpm tsc --noEmit` — clean
- `pnpm lint --max-warnings=0 src` — clean (note: `scripts/` lint is stale and pre-existing; ignore)
- `pnpm test` — 220+ tests still passing
- `pnpm truthfulness` — PASS, no new fakes introduced
- `npx tsx scripts/_session-data-audit.ts` — counts grow as expected (permits → ~2M after archive load; sources up from ~12 to 100k+; zip_source_map → 33k rows)
- Manual: dashboard renders, capacity badge shows coverage_quality, lead-detail drawer still loads in <2 s

End-state success criteria: every external folder is either (a) imported into the live DB, (b) sitting in `docs/data-research/` as reference, (c) archived in `scripts/_archive/`, or (d) explicitly noted in this plan as discarded. **No external folder lives untouched on the desktop.**
