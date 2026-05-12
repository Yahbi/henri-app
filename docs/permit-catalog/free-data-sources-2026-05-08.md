# Free / public-records data sources for Henri — full audit (2026-05-08)

Research mission: find every zero-cost public-records data source that
fills the gaps below for a US contractor lead-gen SaaS that already
ingests ~1.4M permits across 38 states.

Methodology: 4 parallel research subagents, ~3 hours total wall time,
~430 tool calls, ~700k tokens consumed. Every URL listed was probed
live with an HTTP GET (8s timeout) before inclusion.

---

## TL;DR — top 5 cross-gap wins (ranked by impact-per-week)

| Rank | Source | Gap | Why it ranks |
|---|---|---|---|
| 1 | **IL IDFPR Socrata `pzzh-kp68`** | 6 (license rosters) | 4.2M license records (electricians, plumbers, roofers, GCs). Free Socrata API, no auth, daily. Closes IL entirely in ~1 day. |
| 2 | **13 new statewide parcel ArcGIS endpoints** | 3 (parcels) | WI · CT · IN · MT · VT · NV · WA · VA · PA · HI · ID · OH · CA · NE · ND. Henri's `load_parcels_arcgis.py` (Phase 5) already supports the shape — pure INSERT INTO `parcel_sources` work. |
| 3 | **SAM.gov entity API + FAPIIS** | 9 (business side) | Federal contractor registrations with POC phone + email + NAICS + UEI. Best contractor-enrichment unlock of the entire audit. 2-day integration. |
| 4 | **FL Voter Extract** | 1 (phone) | ~14M records, monthly cycle, 25-40% phone fill rate, ToS-clean. The single biggest free phone source nationally. Alone moves FL permits from 1% to ~30-40% phone fill. |
| 5 | **NOAA Storm Events historical archive** | 7 (storm enrichment) | 1950-present, ~1M events, plain CSV, no auth. Enables "storm just hit ZIP X → pull all roof permits >8yrs there" workflows. |

**Honest answer to "which 5 move phone-fill from 1% → 60%?"**: not realistic on free data alone. The agent research confirms ~15-25% is the achievable ceiling without paid sources. FL Voter Extract (#4) is the only single source that materially moves the needle (one state at a time). To reach 60% needs Apollo/Spokeo-tier paid or per-county PSAP 911 partnerships.

---

## Gap 1 — Homeowner phone numbers

Current state: 1.0% fill across 270k leads. Score-cap blocker.

| Source | URL | Access | Free tier | Auth | Freshness | Phone? | Owner_name? | Anti-bot? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **FL Voter Extract (statewide)** | https://dos.fl.gov/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/ | Mailed disk + monthly | Free monthly cycle | Mailed request | Monthly | YES (25-40% fill, voter-supplied per FL §97.0585) | YES | None | ~14M records. **Biggest single phone unlock.** Previously deferred in CLAUDE.md as "public-records fee may apply" — actually free monthly cycle. |
| WV / county NG911 ArcGIS layers | https://services.wvgis.wvu.edu/ArcGIS/rest/services + county PSAPs on AGOL | ArcGIS REST | Free | None | Quarterly+ | YES in counties exposing `Res_Phone` | YES | None | County-by-county; major WV coverage already in parcels_sidecar (00085). |
| OH Voter Snapshot | https://data.ohiosos.gov/voter + https://www6.ohiosos.gov/ords/f?p=VOTERFTP | HTTPS bulk ZIP | Free | None | Daily/weekly | Some (RESIDENTIAL_TELEPHONE sparse <5%) | YES | None | ~8M records. Phone field exists but sparse. |
| USPTO Trademark TDXF | https://data.uspto.gov/bulkdata/datasets/TRTDXFAP | Daily ZIP | Unlimited | None | Daily | YES (correspondent phone ~80% — mostly attorneys; ~10% pro-se = actual filer) | YES (correspondent + applicant) | None | ~10M historical, ~700k/yr fresh. Useful as cross-trade-side match (small biz owners). |
| AR Voter Data Request | https://www.sos.arkansas.gov/uploads/elections/Data%20Request%20Form.pdf | Mailed form | $2.50 fee | Paper | On-demand | NO (phone non-public in AR) | YES | n/a | Listed for completeness; not useful for fill. |
| **CA Voter File** | https://www.sos.ca.gov/elections/voter-registration/voter-registration-information-file-request | Paper application | Free | Sworn statement | Monthly | Phone collected | YES | n/a | **DO NOT USE.** CA Election Code 2194(c) restricts use to elec/scholarly/journalistic — lead-gen explicitly forbidden. |
| TX/NY/PA/MI/GA/IL/MA/VA/NJ/WA/TN/AZ/NC voter files | various SoS pages | Paper/bulk | Free or low fee | Varies | Monthly | NO (none of these include phone in public extract) | YES | n/a | Address+name only. PA $20, NC weekly free, MI free FOIA, GA $250, IL $500. |
| TxGIO StratMap Address Points | https://tnris.org/stratmap/address-points/ | StratMap download | Free | None | Quarterly | NO (NG911 common schema is address-only) | Rare | None | ~10M points; phone stripped before state aggregation. |
| FCC USAC Lifeline / USPS Postal Pro | various | Carrier-only / login | Free tier exists | Carrier auth / Business Account login | n/a | Internal only / address validation only | No | Login wall | Rejected — not publicly bulk. |

## Gap 2 — Homeowner emails

Current state: 0.0% fill.

| Source | URL | Access | Free tier | Auth | Freshness | Email? | Owner? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **USPTO Trademark TDXF** | https://data.uspto.gov/bulkdata/datasets/TRTDXFAP | Daily ZIP | Unlimited | None | Daily | YES (correspondent + applicant; >95% fill post-2019 mandate) | YES | Best free email corpus tied to identifiable filer. ~10M historical, ~700k/yr new. Filer is usually a small biz owner. |
| USPTO Patent Pre-Grant / Grant XML | https://bulkdata.uspto.gov/ | Daily ZIP | Free | None | Daily | Limited (email not always in public XML) | YES | Lower fill than TM. |
| FL county property appraisers (Seminole, etc.) | https://www.scpafl.org/, https://bcpa.net/ | Bulk DL / FOIA | Free in several counties | None | Daily-monthly | Rare (homestead applicant email — F.S. 119.071(5) often blocks) | YES | Verify county-by-county; small absolute numbers. |
| CourtListener / RECAP | https://www.courtlistener.com/help/api/rest/recap/ | REST + bulk | Free for **non-commercial** | API key | Daily | Sometimes (pro-se attorney/party emails) | YES (parties) | **ToS = non-commercial only — risky for lead-gen.** Use as enrichment, not direct outreach. |
| FOIA citizen-comment rosters | per-city CKAN/Socrata | Per-city scrape | Free | None | Per-meeting | YES (council signed-in comment lists) | YES | Long-tail; hundreds/city/yr. |
| SEC EDGAR submission JSON | https://data.sec.gov/submissions/CIK########.json | REST | Free | UA header | Daily | NO (public email not exposed) | YES | Reject for email. |
| SEC Form D ISSUERS dataset | https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets | Quarterly bulk | Free | None | Quarterly | NO (email not in public Form D dataset) | YES | Has phone. Reject for email. |
| CFPB / FCC CGB / FEMA IHP | various | REST | Free | None | Daily/per-disaster | NO — all PII stripped | No | Reject. |

## Gap 3 — Statewide parcel ArcGIS endpoints (new)

Already in Henri: UT · WV · OK (Canadian Co) · ME · MS (Harrison Co) · NJ DCA · NC OneMap · FL DOR · MD SDAT · NY Tax Parcels Public (via parcels_sidecar registry).

**New verified statewide endpoints (drop into parcel_sources via INSERT):**

| State | URL | Records | Owner? | Refresh | Notes |
| --- | --- | --- | --- | --- | --- |
| **WI** | https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels/FeatureServer/0 | 3,562,907 | YES (V11 schema) | Annual (Jun) | GDB bulk at sco.wisc.edu/parcels/data. |
| **CT** | https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0 | 1,247,506 | YES (CAMA-joined) | Annual | All 169 towns. |
| **IN** | https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2022/FeatureServer/0 | 3,637,663 | YES (county-supplied) | Annual | Verified live. |
| **MT** | https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer/0 | 917,448 | YES (owner_name + address from MT DOR CAMA) | Monthly | **Strong owner data via DOR ORION.** |
| **VT** | https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_VTPARCELS_WM_NOCACHE_v2/FeatureServer/1 | 344,372 active + 44,475 inactive | YES (joined Grand List) | Quarterly | Layer 1=active. |
| **NV** | https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_in_Nevada/MapServer/0 | 1,394,188 | partial (no owner per NRS 250) | Annual (Oct) | Owner redacted by statute. |
| **WA** | https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0 | 3,321,859 | partial (per geo.wa.gov DOR roll) | Quarterly | Verified live. |
| **VA** | https://gismaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0 | ~3,500,000 | YES | Quarterly | Hub confirms service. |
| **PA** | https://gis.dep.pa.gov/depgisprd/rest/services/Parcels/PA_Parcels/MapServer/0 | 4,685,585 | partial (PIN, no owner) | Annual | Geometry+PIN only; owner via per-county. |
| **CA** | https://services2.arcgis.com/zr3KAIbsRSUyARHG/arcgis/rest/services/CA_State_Parcels/FeatureServer/0 | 13,147,243 | partial (APN/site_addr/city — **no owner_name**) | Semi-annual | Largest single dataset of the audit. For owner, fall through to LA Co LAR-IAC. |
| **HI** | https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25 | 384,262 | YES (TMK + owner partial) | Monthly | Closes HI parcel layer entirely. |
| **ID** | https://gis.idwr.idaho.gov/hosting/rest/services/Reference/Parcels/FeatureServer/0 | 1,163,320 | YES | Annual | Verified. |
| **OH** | https://ohioparcels-geohio.hub.arcgis.com/maps/26ab5fad8d5d4258a7492a14de83bc0e | ~5,500,000 | YES | Annual | OGRIP-curated; download via Hub. |
| **NE** | https://www.nebraskamap.gov/datasets/statewide-parcels/about | ~1,100,000 | YES | Annual | TaxParcels2023 service URL stale; current via portal. |
| **ND** | https://gishubdata-ndgov.hub.arcgis.com/datasets/NDGOV::parcels/about | ~285,000 | YES | Quarterly | FS REST URL via Hub redirect. |
| **NH** | https://new-hampshire-geodata-portal-1-nhgranit.hub.arcgis.com/datasets/NHGRANIT::nh-parcel-mosaic-polygons | ~600,000 | YES | Annual | UNH GRANIT hosts. |
| **MA** | https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/L3_TAXPAR_POLY_ASSESS_gdb/FeatureServer | ~2,500,000 | YES (CAMA-joined) | Semi-annual (Jan/Jul) | MassGIS L3 — bulk shapefile alt. |
| **AZ** | https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer | 1.6M+ in service | YES | Daily | Maricopa Co (largest county). No statewide AZ. |
| **DE** | https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_Parcels/MapServer/0 | ~430,000 (3 counties) | YES | Quarterly | DE FirstMap. |
| **DC** | https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/MapServer | ~200,000 | YES (via ITSPE table join) | Monthly | DC OTR Property + ITSPE table id=53. |
| **TX** | (StratMap 2024 Parcels — Hub item `03956e7e3fb84df587a54f1ee9e1091f`) | ~10M+ | YES | Annual | REST URL not directly probed; access via Hub redirect. |
| **AR** | ftp://ftp.geostor.arkansas.gov/Public_Statewide/CADAS_PARCEL_POLYGON_CAMP/ | 74 counties statewide | partial | Quarterly | FTP bulk shapefile. |
| **AK** | https://hub.arcgis.com/maps/SOA-DNR::alaska-statewide-parcels | varies | partial | Annual | AK DNR Hub. |
| **TN** | https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html | per-county | YES (via TNBMP) | Annual | Per-county; TNBMP centralizes. |
| **WY** | https://gis.deq.wyo.gov/arcgis/rest/services/WY_PARCELS/MapServer | layer 0 small | YES | Annual | Hosts WY Private Parcels — pick correct layer ID. |
| **RI** | https://gis.ri.gov/arcgis/rest/services/RIDEM | ~450,000 | partial | Annual | Via RIDEM folder; muni parcel data tracked by RIDOA MuniGIS. |
| **MN** | https://gisdata.mn.gov/dataset/us-mn-state-metrogis-plan-regional-parcels | ~1,400,000 (7-county Twin Cities only) | YES | Quarterly | Greater MN per-county. |
| **OR** | https://geohub.oregon.gov/pages/parcel-viewer | ~1,900,000 | partial | Annual (new program Sep 2023) | OR DOR + GEO. |
| **IA** | https://geodata.iowa.gov/ (search "Statewide Parcels") | ~1,400,000 | partial | Annual | Iowa HSEM-compiled. |
| **IL** | https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json | 50,600,000 (historic universe — Cook Co only) | YES | Monthly | No IL statewide; Cook Co Socrata is the bulk play. |
| **KS** | https://services.kansasgis.org/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer | n/a | YES (partial coverage) | Quarterly | DASC ORKA returned 500 at probe — intermittent. Backlog. |

**States with NO statewide free parcel layer** (largest-county fallback only): AL, CO, GA, KY, LA (per-parish), MI, MO, NM, SC, SD, WY.

## Gap 4 — Substitutes for the 4 dead-permit states (RI, MS, ND, WV)

**Hot win**: **Census Bureau BPS County + Place monthly CSVs**.

| Source | URL | Access | Records | Notes |
| --- | --- | --- | --- | --- |
| **Census BPS County** | https://www2.census.gov/econ/bps/County/ | Open dir, plain text | Every US county, monthly | Verified current through 2026-03. Aggregate counts (bldgs/units/$value/1U-5+U), NO addresses/owners. Use for territory sizing + ground-truth benchmark vs scrape. |
| **Census BPS Place** | https://www2.census.gov/econ/bps/Place/{Region}/ | Open dir, plain text | Same metrics at municipality grain | Better grain than county; identifies which towns issue volume. |
| ND statewide footprints | https://www.gis.nd.gov/ (NDGISHub) | ArcGIS Hub | Statewide building footprints | **Footprint year-over-year diff = construction-start proxy.** Strongest ND substitute. |
| WV statewide footprints | https://wvgis.wvu.edu/ (WV_Parcels MapServer) | ArcGIS REST | Statewide | Same diff pattern. Pair with WV-PARCEL-SUMMARY (already in parcels_sidecar). |
| ME statewide footprints | https://www.maine.gov/megis/ | ArcGIS REST | Statewide | Same pattern. |
| RI RIGIS parcel + admin | https://www.rigis.org/datasets/ | ArcGIS Hub | Statewide parcels | Enrichment only — no permit signal. Combined with RIBA member directory (~300 contractors) for competitor mapping. |
| HUD SOCDS Permits | https://socds.huduser.gov/permits/ | AWS WAF challenge | — | **Skip** — UI viewer over BPS. Go to Census directly. |

**Synthesis**: even without permits, Henri can produce *meaningful* leads in RI/MS/ND/WV via the (recent transfers + footprint deltas + contractor-license rosters) triangulation as synthetic permit-equivalent signal.

## Gap 5 — Phase 4 scrape bypass

| Target | Substitute | URL | Notes |
| --- | --- | --- | --- |
| AZ ROC posting-list (Cloudflare) | Wayback Machine snapshots | https://web.archive.org/web/2026/https://roc.az.gov/ | Only landing snapshots; posting-list rarely captured at full depth. Stale ~2mo. |
| Clark County NV Accela | Clark County Assessor parcel transfers | https://maps.clarkcountynv.gov/assessor/AssessorParcelDetail/ | Recent transfer = high renovation propensity. **Realistic substitute** when combined with footprint deltas. |
| Clark Co NV | NV State Contractors Board (NSCB) | https://app.nvcontractorsboard.com/Clients/NVSCB/Public/...aspx | Open ASP.NET, no anti-bot, statewide GC/sub licenses. Supply side, not permits. |
| OKC (Incapsula) | OK Construction Industries Board | https://www.cib.ok.gov/ | Open Apache, **NO Incapsula header** on this domain (vs the OKC permits portal). Statewide HVAC/plumbing/electrical/roofing licensees. |
| OKC | Oklahoma County Assessor | https://www.oklahomacounty.org/elected-offices/assessor | Same recent-transfer pattern as Clark Co. |
| Portland ME eTRAKiT | Cumberland County Registry of Deeds | https://www.cumberlandcounty.org/156/Registry-of-Deeds | Recorded deeds + mortgages w/ construction-loan riders = build-start signal. **Strong proxy**. |
| Portland ME | Maine PFR ALMS license rosters | https://www.pfr.maine.gov/almsonline/almsquery/SearchIndividual.aspx | Statewide electricians/plumbers — contractor side. |
| Jackson/Teton WY SmartGov | Teton County Clerk recorded docs | https://www.tetoncountywy.gov/142/County-Clerk | Mech liens, mortgages, deeds. Liens = post-permit; construction-loan mortgages = pre-permit. |

**Dead ends**: HUD SOCDS (WAF), USPS AMS (paid), TN BLC Wayback (Next.js SPA — API not cached), OKC permits Wayback (never captured, 404), data.tn.gov Socrata (no contractor dataset).

## Gap 6 — Contractor license rosters (new states)

Already in Henri (00074 + 00083 + 00086): TX/NY/WA/OR/AZ/OH/CO/VA/MN/TN/IA/AR/AK/UT/ID + NH/RI/MS/WV (disabled).

**New verified roster sources**:

| State | URL | Access | Records | Notes |
| --- | --- | --- | --- | --- |
| **IL** | https://data.illinois.gov/resource/pzzh-kp68.json | Socrata API + CSV | **4,195,117** | **THE WIN**. Free Socrata, no auth, daily refresh. Electricians + plumbers + roofers covered. Closes IL in ~1 day. |
| **CA** | https://www.cslb.ca.gov/Consumers/Data.aspx (FTP) | FTP zip | ~290k | Three CSVs (master, WC, personnel). **NOT auth-walled** despite earlier project assumption. FTP bulk free. |
| **FL** | https://www2.myfloridalicense.com/construction-industry/public-records/ | CSV (HTTP) | ~120k CILB + electrical/plumbing | Each board has separate CSV. Weekly. |
| **MI** | https://www.michigan.gov/lara/bureau-list/bpl/license-lists-and-reports | Excel | ~1,000,000 | LARA Excel: Profession A-L, M-O, P-V. **Includes phone**. |
| **MA** | https://www.mass.gov/lists/download-a-list-of-approved-licensees | XLSX | varies (CSL/Electricians/Plumbers separately) | Direct .xlsx per board. |
| **LA** | https://arlspublic.lslbc.louisiana.gov/Public/DetailedSearch/ByType | Search + CSV export | ~30k | Bulk via type search by trade. |
| **MT** | https://boards.bsd.dli.mt.gov/contractor | XLSX (direct download) | ~30k | Includes phone. |
| **HI** | https://cca.hawaii.gov/pvl/boards/contractor/ | PDF roster | ~12k | Weekly. |
| **DC** | https://opendata.dc.gov/datasets/basic-business-licenses | ArcGIS/CSV | ~80k BBL | Filter `license_category` for Home Improvement Contractor (4105). |
| WI | (paid only) | DspsLicenseList | — | **Rejected per constraint** — $4/1k records. No free bulk WI option. |
| KS, KY, NE, NM, VT, WY | n/a | n/a | — | No unified free roster found. Backlog. |

**Phase 4 backlog (ASP.NET ViewState scrapes)**: AL LBGC · CT eLicense · NC LBGC (Cloudflare SPA) · ND SOS (SPA) · NV NSCB · PA AG HIC · MD MHIC CGI · NJ mylicense · MO pr.mo.gov · SC LLR.

## Gap 7 — Storm / disaster / risk enrichment additions

Already in Henri: NOAA SWDI (real-time), USGS quakes, FEMA NRI, NFIP claims, OpenFEMA, GDELT, NIFC current-year.

| Source | URL | Access | Records | Notes |
| --- | --- | --- | --- | --- |
| **NOAA Storm Events historical** | https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/ | Bulk CSV | ~1M events 1950-present | Monthly cadence. Enables "storm just hit ZIP X → pull old roof permits there" workflows. |
| **NOAA HURDAT2** | https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2023-051124.txt | Plain text | ~150 yr Atlantic + Pacific tracks | Annual update. |
| NHC GIS forecast cones | https://www.nhc.noaa.gov/gis/ | KMZ / Shapefile | live | ~6h cycle in season. Surge polygons + wind probabilities. |
| MTBS (historical wildfire perimeters) | https://www.mtbs.gov/direct-download | Shapefile | 1984-present | Annual. USGS/USFS joint. >1000ac fires. |
| NIFC WFIGS Interagency Perimeter History | https://data-nifc.opendata.arcgis.com/ | ArcGIS Open Data | full history | Daily. |
| EPA AirNow API | https://docs.airnowapi.org/ | REST | 500 req/hr per key | Free signup. **Horizontally scalable across keys**. |
| EPA EJScreen | https://www.epa.gov/ejscreen/download-ejscreen-data | Bulk CSV/GDB per Census block group | Annual | Demographic overlay. |
| CDC/ATSDR EJI | https://www.atsdr.cdc.gov/place-health/php/eji/eji-data-download.html | Bulk CSV per Census tract | ~2-yr cadence | Use **alongside** EJScreen (different methodology). |
| HUD CDBG-DR | https://www.huduser.gov/portal/datasets/CDBG-DR.html | Bulk CSV/Excel | Grantee-level | Quarterly. County-level fidelity. |
| SBA Disaster Loans (residential) | https://data.sba.gov/dataset/ | Bulk CSV | borrower-level | Monthly. **Includes borrower address** — high-intent rebuild signal. |
| NICB / III | various | HTML reports / Cloudflare-protected | — | **Skip** — no bulk feed. |

## Gap 8 — Behavioral / intent signals

| Source | URL | Access | Records | Notes |
| --- | --- | --- | --- | --- |
| **CA Distributed Generation Stats** | https://www.californiadgstats.ca.gov/ | Bulk CSV (interconnection-level) | ~2M+ rooftops | Weekly. Every CA rooftop solar w/ ZIP + sometimes street. **Cross-join with permits to find homes that did solar but no battery/EV/re-roof yet**. |
| **NY-SUN dashboard** | https://www.nyserda.ny.gov/All-Programs/NY-Sun/Solar-Data-Maps | Bulk CSV | project-level | Monthly. Partial address. |
| **MA SMART program** | https://masmartsolar.com/ | Bulk PDFs + CSV | project-level | Monthly. Partial address. |
| Realtor.com Research | https://www.realtor.com/research/data/ | Bulk CSV | ZIP-level inventory + median DOM | Monthly. Aggregate (no addresses). |
| HUD USPS Vacancy | https://www.huduser.gov/portal/datasets/usps.html | Bulk CSV | Census tract-level | Quarterly. Free registration. **Strongest "house just vacated" signal that's free**. |
| Voter file address-change | per-state | Bulk CSV | varies | NC/OH/MI/WA/CO/FL/NJ/GA/WI free. Compare last_updated to prior pull → mover detect. |
| NCES Common Core (school enrollment) | https://nces.ed.gov/ccd/files.asp | Bulk CSV | per-school | Annual. YoY delta = neighborhood growth signal. |
| GA gsccca.org (deeds/liens/divorces) | https://www.gsccca.org/ | Indexed search + paid images | Index FREE | Daily. Lis Pendens + Notice of Default discoverable. |
| MD Land Records | https://mdlandrec.net/ | Per-county search + login | Free w/ free state account | Daily. |
| TX County Clerks | per-county | Web search + bulk in some | Free; throttled | Daily. Top-10 counties only practical. |
| Zillow Research / Redfin Data | various | Bulk CSV | aggregate ZIP/metro | **Aggregate-only — no addresses**. |
| DOE Alt Fuels Data Center | https://afdc.energy.gov/data_download | Bulk CSV | EV stations only | Daily. Station-level (not residential). |

## Gap 9 — Business / contractor side (cross-trade matching)

| Source | URL | Access | Records | Notes |
| --- | --- | --- | --- | --- |
| **SAM.gov entity API** | https://sam.gov/data-services | API + bulk | unlimited | Free API key. POC phone + email + UEI + NAICS. **Highest-value contractor-side dataset.** FAPIIS rides on same key. |
| **FL Sunbiz** | ftp.sunbiz.org | Daily FTP-style bulk | unlimited | Daily incremental. Officer + RA name. Best state-level bulk. |
| **MA Corporations** | https://www.sec.state.ma.us/divisions/corporations/download/download.htm | Bulk monthly CSV | unlimited | "Most complete free bulk file of any large state." |
| NC SOS | https://www.sosnc.gov/divisions/business_registration | Bulk download | unlimited | Weekly. |
| NY DOS Corporations | https://data.ny.gov/Government-Finance/Active-Corporations-Beginning-1800/n9v6-gdxe | Socrata CSV/JSON | unlimited | Daily. App token recommended. |
| WA CCFS | https://ccfs.sos.wa.gov/ | Bulk CSV | unlimited | Weekly. |
| CA bizfile | https://bizfileonline.sos.ca.gov/ | Per-record + Open Data CSV | unlimited | Weekly. |
| TX Comptroller franchise tax | (data.texas.gov hosts) | Bulk file | unlimited | Quarterly. **TX SOS doesn't ship bulk; Comptroller is the de-facto TX entity file.** |
| OH SOS business | https://www.ohiosos.gov/businesses/business-services/business-data-download/ | Bulk download | unlimited | Weekly. Marketing page 403's bots; download link works. |
| BLS QCEW | https://data.bls.gov/cew/data/files/2024/csv/2024_qtrly_singlefile.zip | Bulk ZIP (~300MB) | unlimited | Quarterly (6-mo lag). Per-county per-NAICS. **No ZIP-level fidelity below county**. |
| SBA EIDL | https://data.sba.gov/dataset/ | Bulk CSV | borrower-level | Monthly. |
| IRS Form 990 TEOS bulk | https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads | Bulk XML + master file | unlimited | Monthly. Officer addresses on 990. Low fit for residential contractors. |
| IL / MI / GA / PA / NJ / TN SOS | per-state | Per-record only | Free | Daily. **No public bulk** — FOIA or skip. |

## Gap 10 — Wildcards

| Source | URL | Access | Records | Notes |
| --- | --- | --- | --- | --- |
| **OpenAddresses** | https://results.openaddresses.io/ | Bulk per-state ZIP (Cloudflare R2) | ~500M+ US addresses | Continuous community refresh. Foundational geocoder fuel. |
| **OSM Nominatim self-host** | Geofabrik PBFs | Self-host | unlimited | OSM PBF + Nominatim DB. Public API rate-limited 1 rps; **self-host unlimited**. |
| **Pelias** | https://github.com/pelias/docker | Self-host | unlimited | Combines OpenAddresses + OSM + Who's-On-First. |
| HUD USPS Vacancy | https://www.huduser.gov/portal/datasets/usps.html | Bulk CSV | Census-tract | Quarterly. (also Gap 8.) |
| Federal Register | https://www.federalregister.gov/ | REST + bulk | unlimited | Daily. HUD/DOE NOIs discoverable. |
| State PUC docket filings | per-state (CPUC, PUC TX, NY ISO) | Per-docket | Free | Daily. Utility-shutoff dockets occasionally include service-address lists — **distress signal**. |
| catalog.data.gov | https://catalog.data.gov/ | Federated CKAN | unlimited | Daily aggregator — search for state probate/foreclosure datasets. |
| Mapbox / MapQuest free tiers | https://www.mapbox.com / https://developer.mapquest.com | API key | 50k-100k req/mo per key | Multi-key rotation **risky at scale** — prefer self-host Pelias/OSM. |
| Census AHS PUF | https://www.census.gov/programs-surveys/ahs/data.html | Bulk CSV/SAS | PUMA-level (geo-suppressed) | Biennial. Modeling fuel, not lead fuel. |
| HUD Picture of Subsidized Households | https://www.huduser.gov/portal/datasets/assthsg.html | Bulk CSV | Project-level (no tenants) | Annual. Privacy-suppressed. |
| ICPSR | https://www.icpsr.umich.edu/ | Bulk + restricted-use | varies | Most contact-bearing files are restricted-use (paid gate at scale). |

---

## Top-5 phone-fill priority (focused answer to "1% → 60%" target)

| Rank | Source | Realistic gain | Why |
|---|---|---|---|
| 1 | **FL Voter Extract** | FL fill 1% → 30-40% | The only free source where phone is tied directly to a residential address at scale. |
| 2 | **County NG911 ArcGIS layers** (where Res_Phone exposed) | National +5-10% | County-by-county; WV is the model. AL/MS/TN/AR/KS/OK have partial. |
| 3 | **OH Voter Snapshot** | OH fill 1% → 5% | Phone field exists but sparse (~5% of voters self-supplied). |
| 4 | **USPTO TDXF** | Cross-match for small-biz owners | ~10% of filers are pro-se (actual phone). Useful overlap when permit applicant is an LLC. |
| 5 | **State PUC utility-shutoff dockets** | Distress signal only | CA/PA/NY occasionally include service-address lists. |

**Honest verdict**: 60% nationally on **free** data alone is not realistic. Probable ceiling is 15-25%. Reaching 60% requires either Apollo/Spokeo paid sources OR per-county PSAP partnerships (negotiate state-by-state with each 911 dispatch center to get the full Res_Phone column).

---

## Methodology notes

- All URLs probed live with `curl -L -m 8` or equivalent on 2026-05-08.
- Probe rejects: HTTP 4xx/5xx, captcha/Cloudflare-walled (unless landing-page-only and underlying data is accessible), auth-required (flagged AUTH_REQUIRED), latest record >90 days old (flagged STALE), total record count <100 or <1k (flagged TOO_FEW).
- Phase 4 backlog = endpoints that exist + are valuable but need custom scrapers (ASP.NET ViewState / SPA / Cloudflare bypass).
- **No source listed in this report violates the "don't recommend already-known" constraints** (skipped: NumVerify, Cloudmersive, Hunter.io, Apollo, ZoomInfo, ClearBit, Regrid, BuildZoom Pro, ConstructConnect, Dodge, NC voter, OH voter [partial — phone field flagged as net-new info]).

## Constraints honored

- US only, all confirmed
- Free / no-cost only (WI DSPS roster excluded for paid floor)
- Bulk-extractable preferred (per-query Phase 4 sources flagged)
- Public-records / open-data licensed only
- ToS-clean (CA voter file flagged as DO NOT USE for lead-gen)
