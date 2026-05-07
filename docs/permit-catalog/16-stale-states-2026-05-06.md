# 16 stale-state permit research (2026-05-06)

Research mission: find live permit-data API endpoints for the 16 states
that were configured in `permit_sources` but not producing fresh data:
**ME · MI · MN · MS · MT · NV · NH · NJ · ND · OK · RI · TN · UT · VT · WV · WY**.

Scope filter (per Henri wedge): construction permits only — residential
remodel, ADU, HVAC, electrical, plumbing, solar, demolition, new
construction, additions. Business licenses, street/right-of-way
permits, well permits, and sign permits explicitly out of scope.

Methodology: 4 parallel research agents, each covering 3-5 states.
Every reported URL was probed with a live HTTP request before being
listed; sample row keys + record counts captured for verified
endpoints. Total runtime ~10 min wall-clock, ~110k tokens, ~340 tool
calls across the 4 agents.

---

## TL;DR

| Outcome | States | Count |
|---|---|---|
| **At least one verified live endpoint** | NJ, MI, MN, NH, VT, UT (historical), TN, MT | 8 |
| **Zero viable APIs (scrape territory)** | ME, MS, NV, ND, OK, RI, WV, WY | 8 |

**The single highest-value finding:** **NJ DCA Socrata aggregator** —
one endpoint covers every NJ municipality (legally mandated by N.J.A.C.
5:23-4.5(d)), 2.7M permits, 600-700k/year, with separate fee fields
per trade (electrical / plumbing / HVAC / fire / elevator).

**The single highest-quality finding:** **Bozeman MT** — small
volume (~1.5k/yr) but the public REST response includes
`CONTRACTOR_EMAIL` and `CONTRACTOR_PHONE_1` for every record. Direct
fix for Henri's 1%-phone-fill ceiling within MT territory.

---

## Verified live endpoints (10 total)

All probed 2026-05-06. Configs written to
`scripts/_sidecar_loaders/configs/`.

### NJ — New Jersey (statewide, the prize)
- **Endpoint**: `https://data.nj.gov/resource/w9se-dmra.json` (Socrata)
- **Records**: 2,744,640 (60-month rolling window, ~600-700k/yr)
- **Authority**: NJ Dept. of Community Affairs (DCA). N.J.A.C.
  5:23-4.5(d) requires every NJ municipality to report monthly.
- **Trade coverage**: separate fee fields `buildfee`, `plumbfee`,
  `electfee`, `firefee`, `elevfee` per record. Trade attribution by
  fee delta is reliable.
- **Type breakdown**: Alteration 2.4M, New 115k, Demolition 114k,
  Addition 66k.
- **Verified municipalities**: Toms River 35,957; Edison 33,685;
  Jersey City 21,942; Newark 21,003; Paterson 9,545; Elizabeth 8,699.
- **Caveat**: DCA notes "data collected from MOST municipalities" —
  not all. Run a coverage spot-check post-ingest.
- **Config**: `nj-dca-statewide.yml`

### MI — Detroit
- **Endpoint**: `https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits_Applications_view/FeatureServer/0/query`
- **Records**: 95,035
- **Trade coverage**: PermitType separates Electrical / Mechanical /
  Plumbing / Building / Demolition.
- **Owner BSEED**. Old `data.detroitmi.gov` Socrata domain decommissioned.
- **Config**: `detroit-mi.yml`

### MN — Minneapolis
- **Endpoint**: `https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0/query`
- **Records**: 391,904 (~20-30k/yr)
- **Trade coverage**: Mechanical 85k records, Plumbing 155k records,
  plus Electrical / solar / demo.
- **Config**: `minneapolis-mn.yml`

### MN — St. Paul
- **Endpoint**: `https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Approved_Building_Permits/FeatureServer/0/query`
- **Records**: 317,968
- **Trade coverage**: FOLDER_TYPE separates Plumbing/Gasfitting/Inside
  Water Piping, etc.
- **Includes contractor name + address**.
- **Config**: `st-paul-mn.yml`

### NH — Nashua
- **Endpoint**: `https://services1.arcgis.com/WwJAqA4K2ienzdKW/arcgis/rest/services/Building_Permits_June_2025/FeatureServer/0/query`
- **Records**: 8,792 (~2.2k/yr)
- **Trade coverage**: PermitType "Commercial Electrical Only" 788,
  "Residential Mechanical Only" 3,446, separate Demolition. Plumbing
  + solar surfaced via Description text.
- **Caveat**: layer name `Building_Permits_June_2025` may rotate —
  re-discover via FeatureServer root if it 404s.
- **Config**: `nashua-nh.yml`

### VT — Act 250 statewide (new construction only)
- **Endpoint**: `https://anrmaps.vermont.gov/arcgis/rest/services/Open_Data/OPENDATA_ANR_ENVIRON_SP_NOCACHE_v2/MapServer/166/query`
- **Records**: 8,272 since 1970 (~150-200/yr)
- **Trade coverage**: NEW CONSTRUCTION ONLY. Act 250 only triggers on
  large projects (subdivisions ≥10 lots, commercial construction,
  >2,500 ft elevation). Misses ~95% of trade volume.
- **Use case**: builder/general-contractor leads, NOT trade-specific.
- **Config**: `vt-act250-statewide.yml`

### UT — Salt Lake City (HISTORICAL ONLY)
- **Endpoint**: `https://opendata.utah.gov/resource/3eji-gn2j.json` (Socrata)
- **Records**: 22,859 — **frozen 2023-10-26**
- **Migration**: SLC moved to Accela ACA at
  `aca-prod.accela.com/SLCREF`. Socrata feed is no longer updated.
- **Use case**: historical backfill only — never fresh leads.
- **Config**: `salt-lake-city-ut.yml` (status: `historical_only` —
  excluded from `--all` cron rotation by load_socrata.py filter).

### TN — Nashville
- **Endpoint**: `https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0/query`
- **Records**: 29,197 issued (~10k/yr)
- **Trade coverage**: top-level only — Residential New, Addition,
  Rehab, Commercial New, Demolition, Storm Damage. Trade permits
  (E/P/M) are issued separately and NOT exposed.
- **Config**: `nashville-tn.yml`

### TN — Knoxville-Knox County
- **Endpoint**: `https://services8.arcgis.com/Ty9G85JMF2cDHlRt/arcgis/rest/services/BuildingPermits/FeatureServer/0/query`
- **Records**: 13,034 + 95,035 applications view
- **Trade coverage**: PermitType field categorizes; full coverage in
  applications view via WorkType.
- **Includes OWNER + CONTRACTOR + PARCELID** — strong lead-gen payload.
- **Config**: `knoxville-tn.yml`

### MT — Bozeman (the unicorn)
- **Endpoint**: `https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/1/query`
- **Records**: ~720 active (rolling 6mo); ~1.5-2k/yr
- **Trade coverage**: PERMIT_TYPE field; not as granular as DCA
  fee-field approach.
- **THE FINDING**: response includes `CONTRACTOR_EMAIL` and
  `CONTRACTOR_PHONE_1` for every record. Direct fix for Henri's
  contact-completeness ceiling within MT territory.
- **Config**: `bozeman-mt.yml`

---

## Dead-end states (no API; scrape or skip)

### ME — Maine
| City | Pop | Verdict |
|---|---:|---|
| Portland | 68k | Tyler eTRAKiT — HTML-only, no JSON. Scrape-only. |
| Lewiston, Bangor, S. Portland, Auburn, Augusta | <40k | Cloudpermit (auth-gated) or no portal |
| State maine.hub.arcgis.com | — | DCAT returned 0 datasets |

**Verdict**: Skip API ingestion. Scrape Portland eTRAKiT or partner
with Cloudpermit if ME coverage matters.

### NH — New Hampshire (Nashua only viable)
| City | Pop | Verdict |
|---|---:|---|
| Manchester | 115k | Municipal-custom, no public API |
| Concord, Dover, Rochester | <50k | Cloudpermit (auth-gated) |
| NH state Socrata | — | Akamai 403 on /api/catalog/v1 |

### RI — Rhode Island (entirely walled)
| City | Pop | Verdict |
|---|---:|---|
| Providence | 190k | OpenGov ViewPoint — OAuth-gated GraphQL |
| Warwick, Cranston, Pawtucket, E. Providence | <85k | ViewPoint or CivicPlus — no public API |
| RIGIS state hub | — | 382 datasets, ZERO permit datasets |

**Verdict**: Worst of the 16. Every meaningful jurisdiction is locked
behind ViewPoint Cloud auth. SKIP or pursue OpenGov data partnership.

### VT — Vermont (Act 250 statewide is the only API)
| City | Pop | Verdict |
|---|---:|---|
| Burlington | 45k | Tyler EnerGov — no public API |
| S. Burlington, Rutland, Montpelier | <20k | ViewPoint or Tyler |

### MS — Mississippi (zero APIs)
| City | Pop | Verdict |
|---|---:|---|
| Jackson | 144k | CKAN portal — no permits, only social/health |
| Gulfport | 71k | BS&A Online (vendor SaaS) |
| Southaven, Hattiesburg, Biloxi | <60k | Tyler EnerGov / login-walled / no portal |

**Verdict**: ENTIRE STATE is API-dead. Skip MS. Or use HUD county-
level construction-permit aggregate at `hudgis-hud.opendata.arcgis.com`
as a proxy.

### OK — Oklahoma (mostly walled)
| City | Pop | Verdict |
|---|---:|---|
| Oklahoma City | 700k | Incapsula bot wall on gis.okc.gov; Accela login-walled |
| Tulsa | 411k | Hub holds zoning ordinances only — no permits |
| Norman, Edmond, Broken Arrow | <130k | SmartGov / login-walled |

**Verdict**: OKC's Incapsula wall *might* yield to proper
browser-emulation headers (Camoufox + 1-hour spike). Otherwise SKIP.

### NV — Nevada (frozen or stripped)
| City | Pop | Verdict |
|---|---:|---|
| Las Vegas | 660k | Open Data ArcGIS frozen 2020-07-09 OR field-stripped to ObjectID |
| Clark County | 2.3M | No API. Accela ACA only. **HIGHEST-LEVERAGE in state, blocked**. |
| Henderson | 330k | EnerGov internal API (no public bulk) |
| Reno, Sparks, NLV, Carson City | <660k | Accela ACA login-walled |

**Verdict**: NV is all-in on Accela. The Hetzner Camoufox stack
*can* scrape Accela ACA, but it's Phase 4 work (~1 week per Accela
tenant). Defer.

### ND — North Dakota (no APIs)
| City | Pop | Verdict |
|---|---:|---|
| Fargo | 134k | Accela HTML dashboard, no JSON |
| Bismarck | 75k | Custom portal, PDF/HTML reports |
| Grand Forks | 60k | Tyler eSuite (session-gated) |

**Verdict**: SKIP. No state-level permit aggregator exists.

### WV — West Virginia (no APIs)
| City | Pop | Verdict |
|---|---:|---|
| Charleston, Huntington | <50k | No online portal beyond contact info |
| Morgantown | 30k | Cityworks PLL, no API |
| Wheeling, Parkersburg | <30k | No portal |

**Verdict**: SKIP entirely. Smallest state on the list, lowest data
maturity.

### WY — Wyoming (small + walled)
| City | Pop | Verdict |
|---|---:|---|
| Cheyenne | 65k | OpenGov ViewPoint (June 2025), no public bulk API |
| Casper | 58k | civiclive, no API |
| Jackson/Teton Co | 24k | SmartGov — high $-value but no API |

**Verdict**: Henri's existing Cheyenne + Casper "stopgap" entries are
justified; no better source exists. Jackson SmartGov scrape (Phase 4)
worth considering for luxury-second-home market.

---

## Phase 4 scrape candidates (post-launch, when revenue funds them)

Ranked by leverage (records per scraping engineer-week):

1. **Clark County NV — Accela ACA** (`aca-prod.accela.com/clarkco`)
   ~80-120k/yr, includes Strip megaprojects + booming residential
   solar. Highest single-jurisdiction value among scrape candidates.
2. **Las Vegas NV — Accela ACA** (`aca-prod.accela.com/lasvegas`)
   ~30-40k/yr.
3. **OKC OK — gis.okc.gov / Accela ACA**. Incapsula bypass + Accela.
4. **SLC UT — Accela ACA** (`aca-prod.accela.com/SLCREF`). Replaces
   the frozen Socrata feed.
5. **Henderson NV — Tyler EnerGov SelfService**
   (`dsconline.cityofhenderson.com/energov_prod/selfservice`).
6. **Reno + Washoe NV — Accela ACA** (`/RENO`, `/ONE`).
7. **Jackson/Teton WY — SmartGov** (luxury market, low-volume but
   high $-value per lead).
8. **Cheyenne WY — OpenGov ViewPoint Cloud** (data partnership likely
   easier than scraping the ViewPoint Auth0 wall).
9. **Portland ME — Tyler eTRAKiT** (HTML scrape).
10. **Memphis TN — TBD** (mid-migration; revisit in 30-60 days).

**Total Phase 4 backlog: ~10 platforms × 1-2 weeks each.** Reasonable
2-3 quarter roadmap, NOT pre-launch work.

---

## What loaders shipped today

- `load_arcgis.py` — generic ArcGIS REST/FeatureServer/MapServer loader.
  Handles Detroit / Minneapolis / St. Paul / Nashua / VT-Act-250 /
  Nashville / Knoxville / Bozeman with one Python file + 8 YAML
  configs.
- `load_socrata.py` — patched. `--all` mode now filters to
  `loader: socrata` AND `status: verified`, so unverified or
  historical configs (like SLC) don't pollute the rotation.
- 10 new YAML configs in `scripts/_sidecar_loaders/configs/`.

## What loaders did NOT ship (and why)

- **CKAN loader**: skipped. Agent 3 confirmed Jackson MS uses CKAN
  but for population/health data, not permits. No other state had a
  viable CKAN endpoint. Don't write a loader for an empty target.
- **Tyler eTRAKiT scraper**: Phase 4. Camoufox + ASP.NET ViewState
  reverse-eng required.
- **Accela ACA scraper**: Phase 4. Multiple candidate jurisdictions
  but per-tenant work.
- **OpenGov ViewPoint scraper**: Phase 4 if ever — easier path is
  data partnership with OpenGov directly.
- **SmartGov scraper**: Phase 4.

---

## Coverage delta after this session

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| States with at least 1 active source | 38 (per CLAUDE.md) | 38 + up to 8 more = **46** | +8 (when ingest runs) |
| Configured cities | 10 (Socrata phase 1) + 1 (EnerGov starter) | 21 total | +10 |
| Verified-status configs | 1 (Austin) | 11 (Austin + 10 new) | +10 |
| Loader types | Socrata + EnerGov | Socrata + EnerGov + ArcGIS | +1 |

**Theoretical incremental annual permit volume from these 10 endpoints**:
~1.5M-2M/yr (NJ DCA alone is 600-700k; Detroit + MN twin cities ~50k;
TN ~12-15k; the rest small). After upsert dedup against existing
Henri data, expect 800k-1.2M genuinely new rows.

---

## Next-steps order (zero spend)

1. **Deploy the new bundle to Hetzner**: SCP the updated
   `_sidecar_loaders/` to the box, install nothing new (load_arcgis.py
   uses only stdlib + Scrapling which is already there).
2. **Smoke-test each new config individually** before the cron picks
   them up: `python load_arcgis.py detroit-mi`, etc. Add a separate
   crontab line for `load_arcgis.py --all-arcgis` (stagger from the
   Socrata schedule, e.g. `:15` past the hour).
3. **Run NJ DCA backfill manually**: it's 2.7M rows; the default 1000-
   row pull won't capture history. Add a second NJ config with a date
   filter to walk through 60 months in batches.
4. **Verify with `verify-coverage.ts`** after each ingest pass: confirm
   per-state row counts increased + no regression elsewhere.
5. **Ingest the SLC historical feed once** (manual run, not cron):
   `python load_socrata.py salt-lake-city-ut`. 22k rows of historical
   intel.
6. **Open an issue / next-quarter doc** for the 10 Phase 4 scrape
   candidates above. Prioritize Clark County NV when revenue starts.
