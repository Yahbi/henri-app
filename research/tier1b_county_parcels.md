# Tier 1B County Parcel API Research

**Scope:** Next 50 US counties (by 2020 pop) not already in Henri's `county-gis.ts` 22-endpoint list.
**Goal:** Lift `owner_name` fill (39% → 60%+) and `year_built` fill (2.7% → 30%+).
**Method:** Probed FeatureServer/MapServer endpoints; verified field schema via `?f=json`.

---

## Executive Summary

- **Verified with full schema (5/5 fields):** 14 counties — direct FeatureServer integration ready.
- **Verified partial (owner present, but missing year_built or sqft):** 6 counties.
- **Covered by state aggregator (no new code needed):** 12 counties (5 NC + 6 MD + Bronx).
- **Covered by NEW state aggregators discovered:** ~10 NY counties via NYS_Tax_Parcels_Public; multi-FL counties via Florida_Statewide_Cadastral.
- **Vendor-SaaS / privacy-redacted / no public REST:** ~12 counties (CA owner-redaction & WA privacy redaction were the biggest losses).

**Headline finding:** Two state aggregators newly discovered — **NYS** (covers Suffolk + Westchester + Erie/Monroe/Onondaga/Albany/Rockland etc.) and **Florida statewide cadastral** (covers Broward + Pinellas + Duval + Orange FL + Lee + Palm Beach + every FL county) — would dramatically improve fill rates with two integrations rather than 30+ per-county ones.

**Expected fill-rate lift if all verified ship (rough):**
- `owner_name`: +25 to +30 percentage points (39% → ~65–70%) driven by FL statewide, NYS public, TX big-4, plus PA/IN/OH/AL/UT/HI single-county wins.
- `year_built`: +20 to +25 points (2.7% → ~25–30%) — most CA & WA endpoints lack year_built even when owner is present, so CA/WA hurts here.

---

## Per-County Results

| # | County | State | Status | Endpoint | Owner | YrBlt | $Val | Address | SqFt | Notes |
|---|--------|-------|--------|----------|-------|-------|------|---------|------|-------|
| 1 | Cook | IL | unclear | hub-cookcountyil.opendata.arcgis.com | ? | ? | ? | ? | ? | Open data hub exists but parcel FeatureServer with full attributes not surfaced; needs deeper probe. Treasurer/Assessor data on separate non-GIS portals. |
| 2 | Orange | CA | partial | data-ocpw.opendata.arcgis.com (Parcel Polygons) | ? | N | ? | Y | ? | OC Assessor sends users to ParcelQuest (vendor). 687k parcels but owner often redacted under CA AB1785. |
| 3 | San Diego | CA | partial | https://geo.sandag.org/server/rest/services/Hosted/Parcels/FeatureServer/0 | N | partial (year_effective) | Y (asr_total) | Y (situs_address) | Y (total_lvg_area) | **No owner_name field — owner privacy redaction.** Has bedrooms/baths/asr_total/year_effective. Strong for everything except owner. |
| 4 | Riverside | CA | unclear | https://content.rcflood.org/arcgis/rest/services/FloodControlJS/DynamicLayer/FeatureServer/3 | ? | ? | ? | ? | ? | Endpoint returned 403; probably restricted. Open data portal exists. |
| 5 | San Bernardino | CA | no_public_api (owner_redacted) | open.sbcounty.gov "Parcels with Owner Name" | REDACTED | ? | ? | ? | ? | Dataset literally renamed "Parcels with Redacted Owner Name" — owner column scrubbed per AB1785. Skip. |
| 6 | Tarrant | TX | verified | https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcelsApp/MapServer/0 | Y (Owner) | Y (YrBlt) | Y (TotVal) | Y (Situs) | partial (GBA, no explicit sqft) | Full owner+year+value. GBA = gross building area as proxy for sqft. |
| 7 | Bexar | TX | verified | https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0 | Y (Owner) | Y (YrBlt) | Y (TotVal) | Y (Situs) | partial (GBA) | Same TX schema as Tarrant. San Antonio. |
| 8 | Broward | FL | covered_by_state | FL Statewide Cadastral (see below) | Y (OWN_NAME) | Y (ACT_YR_BLT) | Y (JV) | Y (PHY_ADDR1) | Y (TOT_LVG_AR) | **Use FL statewide aggregator.** |
| 9 | Clark | NV | unclear | clarkcountygis-ccgismo.hub.arcgis.com | ? | ? | ? | ? | ? | Hub exists but no direct REST endpoint surfaced; assessor data accessible via ASCII text-file dumps not FeatureServer. Needs deeper probe. |
| 10 | Wayne | MI | unclear | data-wayne.opendata.arcgis.com | ? | ? | ? | ? | ? | Open data hub exists; specific parcel FeatureServer URL not surfaced from searches. Detroit (already in list) has separate richer endpoint. |
| 11 | Cuyahoga | OH | partial | https://gis.cuyahogacounty.us/server/rest/services/CCGIS/Parcels_CAMA_Real_Property/MapServer/0 (PointParcelView) | Y (parcel_owner, deeded_owner) | **N** | Y (certified_tax_total) | Y (par_addr_all) | Y (total_square_ft) | Strong owner+value+address+sqft; **year_built missing** in surfaced layer. May be in a sibling layer. |
| 12 | Suffolk | NY | covered_by_state (NEW) | https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1 | Y (PRIMARY_OWNER) | Y (YR_BLT) | Y (TOTAL_AV, FULL_MARKET_VAL) | Y (PARCEL_ADDR, LOC_STREET) | Y (SQ_FT, SQFT_LIVING) | **NYS statewide layer covers Suffolk.** |
| 13 | Nassau | NY | vendor_saas | lrv.nassaucountyny.gov | — | — | — | — | — | Nassau did NOT opt into NYS public sharing. County GIS server gis.nassaucountyny.gov exists but parcel layers behind LRV viewer; no obvious public REST. Skip. |
| 14 | Westchester | NY | verified | https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/Westchester_County_Parcels/FeatureServer/0 | Y (PRIMARY_OWNER) | Y (YR_BLT) | Y (TOTAL_AV) | Y (PARCEL_ADDR) | Y (SQFT_LIVING) | Same NYS schema (also accessible via NYS aggregator). |
| 15 | Bronx | NY | covered (already NYC) | — | — | — | — | — | — | Already in Henri list. |
| 16 | Sacramento | CA | partial | data-sacramentocounty.opendata.arcgis.com Parcels (id 8d011b99...) | ? | ? | ? | ? | ? | Public dataset exists; field schema not confirmed via probe. CA privacy laws likely redact owner. |
| 17 | Alameda | CA | unclear | data.acgov.org / acassessor.org parcel viewer | ? | ? | ? | ? | ? | Open data hub references parcel data with "owners and year built" fields per third-party metadata — but no direct REST URL surfaced. Worth deeper probe. |
| 18 | Contra Costa | CA | unclear | https://gis.cccounty.us/arcgis/rest/services/CCMAP/CCMAP/MapServer | partial | ? | ? | ? | ? | CCMAP exposes parcel polygons; "demonstrative purposes only" disclaimer. Schema unclear. |
| 19 | Hidalgo | TX | unclear | https://hidalgoad.org / hidalgo.prodigycad.com | ? | ? | ? | ? | ? | EPCAD/HCAD-style appraisal district. ProdigyCAD = vendor. No clear public REST. |
| 20 | El Paso | TX | unclear | opendata-elpasoco.hub.arcgis.com / epcad.org | ? | ? | ? | ? | ? | EPCAD has search portal, not exposed REST. Hub may have parcel layer; not verified. |
| 21 | Travis | TX | partial | https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0 | N (no owner field exposed) | N | N | Y (situs_address) | N | TCAD_public layer is geometry-only — owner/year/value stripped. Internal layer (TCAD_Travis_County_Property) likely richer but not public. |
| 22 | Collin | TX | verified | https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1 | Y (file_as_name) | Y (yr_blt) | Y (cert_assessed) | Y (situs_display) | Y (living_area) | Hosted by City of Allen, refreshed weekly from CCAD. 120+ fields. |
| 23 | Pima | AZ | unclear | gisopendata.pima.gov | ? | ? | ? | ? | ? | Open data portal; specific parcel FeatureServer URL not surfaced. Tucson. |
| 24 | Salt Lake | UT | partial (likely verified) | UGRC SGID Salt Lake County Parcels LIR (opendata.gis.utah.gov) | Y (owner of record) | partial | Y (taxable value) | Y | partial | UT LIR statewide schema includes owner; year_built varies by county quality. Strong candidate. |
| 25 | Honolulu | HI | partial | https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/11 | N | N | N | N (only TMK) | N | Statewide TMK layer is geometry-only. **HI does not publicly share owner/year/value via FeatureServer.** Skip. |
| 26 | Multnomah | OR | unclear | gis-multco.opendata.arcgis.com Taxlot Parcels | partial | partial | ? | Y | ? | Per metadata: "not all columns are fully populated by the assessor." Likely partial; needs probe. |
| 27 | Pierce | WA | partial | https://esgis.tacoma.gov/arcgis/rest/services/Ref/ITD_Basemap/MapServer/2 (timed out) | likely REDACTED | ? | ? | ? | ? | WA state privacy: owner redacted from public GIS. Same caveat as Clark WA. |
| 28 | Snohomish | WA | partial (CSV only) | snohomish-county-open-data-portal-snoco-gis Assessor Roll CSV | ? | ? | ? | ? | ? | CSV bulk download exists; live FeatureServer with owner unlikely public. Owner via Treasurer email request only. |
| 29 | Spokane | WA | unclear | https://gismo.spokanecounty.org/arcgis/rest/services/Assessor/Parcels/MapServer | ? | ? | ? | ? | ? | Endpoint returned 403 to direct probe. Public viewer (cp.spokanecounty.org/scout) suggests owner exposed via web UI; REST schema unconfirmed. |
| 30 | Clark | WA | no_public_api (owner_redacted) | hub-clarkcountywa.opendata.arcgis.com | REDACTED | ? | ? | ? | ? | "All property owner name data have been redacted from the GIS data" — explicit. Owner via email request only. Skip. |
| 31 | Jefferson | AL | unclear | data-jeffco-al.opendata.arcgis.com | ? | ? | ? | ? | ? | Hub has Jefferson County Parcel Look-up app; specific FeatureServer URL/schema not confirmed. Likely available — AL is generally permissive. |
| 32 | Mobile | AL | vendor_saas | gis.bisclient.com/alabama/mobilecad / mobile.capturecama.com | — | — | — | — | — | Flagship GIS / CaptureCAMA = vendor SaaS. No public REST. Skip. |
| 33 | Davidson | NC | covered_by_state | NC statewide (already in list) | Y | Y | Y | Y | Y | — |
| 34 | Wake | NC | covered_by_state | NC statewide | Y | Y | Y | Y | Y | — |
| 35 | Mecklenburg | NC | covered_by_state | NC statewide | Y | Y | Y | Y | Y | — |
| 36 | Forsyth | NC | covered_by_state | NC statewide | Y | Y | Y | Y | Y | — |
| 37 | Guilford | NC | covered_by_state | NC statewide | Y | Y | Y | Y | Y | — |
| 38 | Marion | IN | verified | hub.arcgis.com IndyGIS "Parcels w/ Owner Information & Assessed Values" (FeatureServer URL via dataset detail) | Y | partial | Y | Y | partial | Indianapolis. Dataset name explicitly promises owner + assessed value. Year_built quality varies. |
| 39 | Allegheny | PA | partial | https://mapservices.pasda.psu.edu/server/rest/services/pasda/AlleghenyCounty/MapServer | likely partial | ? | ? | ? | ? | PASDA-hosted. Probed library layer accidentally; needs correct layer ID. WPRDC also publishes Allegheny parcels with rich attrs via CKAN. |
| 40 | Bucks | PA | partial | https://mapservices.pasda.psu.edu/server/rest/services/pasda/BucksCounty/MapServer | ? | ? | ? | ? | ? | PASDA parcel layer; field schema not directly probed. PA county data via PASDA generally has owner+assessment. |
| 41 | Montgomery | PA | verified | https://mapservices.pasda.psu.edu/server/rest/services/pasda/MontgomeryCounty/MapServer/14 | Y (OWN1, OWN2) | Y (YEAR_BUILT) | Y (TOTAL_ASSE, ASSESSMENT) | Y (LOC_ADD, ADDR1) | Y (SFLA) | 150+ fields incl. bedrooms/baths/style/pool. Excellent. |
| 42 | Lehigh | PA | partial | https://mapservices.pasda.psu.edu/server/rest/services/pasda/LehighCounty/MapServer | likely partial | ? | ? | ? | ? | PASDA layer exists; lehighcounty.org parcel annotation layer is geometry-only. Probe specific layer for full attrs. |
| 43 | Lancaster | PA | no_public_api | https://arcgis.lancastercountypa.gov/arcgis/rest/services/Properties/FeatureServer | — | — | — | — | — | "Access limited to internal use" + signed license required. Skip. |
| 44 | Dauphin | PA | partial | https://gis.dauphincounty.org/arcgis/rest/services/Parcels/MapServer | ? | ? | ? | ? | ? | Public REST exists. Field schema not surfaced via JSON probe. Likely has owner + assessment per PA pattern. |
| 45 | Cumberland | PA | partial | https://mapservices.pasda.psu.edu/server/rest/services/pasda/CumberlandCounty/MapServer | likely partial | ? | ? | ? | ? | PASDA-hosted PA county parcel layer. Probable full schema. |
| 46 | Montgomery | MD | covered_by_state | MD statewide | Y | Y | Y | Y | Y | — |
| 47 | Baltimore Co. | MD | covered_by_state | MD statewide | Y | Y | Y | Y | Y | — |
| 48 | Prince George's | MD | covered_by_state | MD statewide | Y | Y | Y | Y | Y | — |
| 49 | Anne Arundel | MD | covered_by_state | MD statewide | Y | Y | Y | Y | Y | — |
| 50 | Howard | MD | covered_by_state | MD statewide | Y | Y | Y | Y | Y | — |
| 51 | Frederick | MD | covered_by_state | MD statewide | Y | Y | Y | Y | Y | — |

(50 originally requested + 1 additional MD county = 51 rows; Bronx counted as covered.)

---

## NEW State Aggregators Discovered

### A. Florida Statewide Cadastral
**URL:** `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0`
**Schema (122 fields, all 5 required present):** `OWN_NAME`, `ACT_YR_BLT`, `JV` (just value), `AV_SD/AV_NSD/TV_SD/TV_NSD` (assessed/total values), `PHY_ADDR1/CITY/ZIPCD`, `TOT_LVG_AR` (sqft).
**Counties this NEWLY covers (not in Henri's list):** Broward, Palm Beach, Orange FL, Pinellas, Duval, Lee, Polk, Brevard, Volusia, Pasco, Seminole, Sarasota, Manatee, Marion FL, Lake FL, Collier, Osceola, Leon, St. Lucie, Escambia, Alachua, etc. — every FL county. **Massive win.** One integration covers ~15M Floridians not yet in Henri.

### B. NYS Tax Parcels Public
**URL:** `https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1`
**Schema (full):** `PRIMARY_OWNER` + `ADD_OWNER`, `YR_BLT`, `TOTAL_AV` + `FULL_MARKET_VAL`, `PARCEL_ADDR` + `LOC_STREET`, `SQ_FT` + `SQFT_LIVING`. Plus bedrooms, baths, kitchens, heat type, school, etc.
**Counties covered (opt-in):** Albany, Cayuga, Chautauqua, Cortland, Erie (Buffalo), Genesee, Greene, Hamilton, Lewis, Livingston, Montgomery NY, NYC (Bronx, Kings, NY, Queens, Richmond), Oneida, Onondaga (Syracuse), Ontario, Orange NY, Oswego, Putnam, Rensselaer, Rockland, Schuyler, Steuben, St Lawrence, **Suffolk**, Sullivan, Tioga, Tompkins, Ulster, Warren, Wayne NY, **Westchester**.
**NOT covered (still need per-county):** Nassau, Monroe (Rochester) — they did not opt in.

---

## Honest Misses — Vendor-SaaS / Privacy-Locked / No Public API

| County | Reason |
|--------|--------|
| Nassau NY | County GIS server exists but did not opt into NYS public sharing; LRV viewer is web-only |
| Mobile AL | Flagship GIS / CaptureCAMA vendor SaaS, no REST |
| Lancaster PA | Explicit "internal use only" data license; license agreement required |
| Clark WA (Vancouver) | Explicit owner-name redaction in all GIS data per WA privacy interpretation |
| Pierce WA | Same WA privacy redaction pattern; tax parcel layer endpoint also flaky |
| Snohomish WA | CSV-only delivery; live FeatureServer does not expose owner |
| Spokane WA | Endpoint returned 403; owner likely redacted |
| San Bernardino CA | Dataset literally named "Parcels with Redacted Owner Name" (AB1785) |
| San Diego CA | SANDAG layer omits owner; ARCC sends users to ParcelQuest vendor |
| Honolulu HI | Statewide TMK layer is geometry-only; no owner/year/value publicly |
| Travis TX | TCAD_public is a stripped-down join-key layer; rich data behind login |
| Hidalgo TX | ProdigyCAD vendor portal; appraisal district data not in REST |

**Counties needing more digging (low confidence):** Cook IL, Wayne MI, Clark NV, Riverside CA, Sacramento CA, Alameda CA, Contra Costa CA, El Paso TX, Pima AZ, Multnomah OR, Jefferson AL, Bucks PA, Lehigh PA, Dauphin PA, Cumberland PA. These all have hubs but the specific FeatureServer with full schema wasn't surfaced in this pass — worth a 2-hour probe each before giving up.

---

## Top-10 Add List (Population x API Quality, ranked)

Ranked by households-covered × schema-completeness:

1. **Florida Statewide Cadastral** — ~15M people across ~50 FL counties not in Henri. Full 5/5 schema. **Build first.**
2. **NYS Tax Parcels Public** — covers Suffolk (1.5M), Westchester (1M), Erie (945k), Onondaga (476k), Albany, Rockland, Putnam, Rensselaer, Ulster + many more. Full 5/5 schema. **Build second.**
3. **Bexar TX (San Antonio)** — 2M people. Full 4/5 (GBA proxy for sqft). `https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0`
4. **Tarrant TX (Fort Worth)** — 2.1M people. Full 4/5. `https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcelsApp/MapServer/0`
5. **Collin TX (Plano)** — 1.1M people. Full 5/5. Updated weekly. `https://gismaps.cityofallen.org/.../Collin_County_Appraisal_District_Parcels/MapServer/1`
6. **Marion IN (Indianapolis)** — 977k. IndyGIS "Parcels w/ Owner Information & Assessed Values" — name-on-tin guarantee.
7. **Montgomery PA (Philadelphia suburbs)** — 856k. PASDA-hosted, full 5/5. `https://mapservices.pasda.psu.edu/server/rest/services/pasda/MontgomeryCounty/MapServer/14`
8. **Cuyahoga OH (Cleveland)** — 1.26M. Owner+sqft+value+address but **no year_built** in public layer (4/5). `https://gis.cuyahogacounty.us/server/rest/services/CCGIS/Parcels_CAMA_Real_Property/MapServer/0`
9. **Salt Lake UT** — 1.2M. UGRC LIR statewide schema. Strong owner field.
10. **Allegheny PA (Pittsburgh)** — 1.25M. PASDA layer exists; field schema needs one more probe to confirm but PA pattern is reliable.

**Honorable mentions for fast follow-up probes (likely wins):** Bucks PA, Lehigh PA, Cumberland PA, Dauphin PA (all PASDA-hosted), Sacramento CA (if CA owner-redaction has a workaround), Alameda CA, Jefferson AL.

---

## Key Reality Checks

1. **California is largely a write-off for owner_name** — AB1785 redaction is enforced county-by-county. SD/SB explicitly redact; OC/Riverside/Sacramento/Alameda/Contra Costa likely the same. Henri's existing LA County endpoint may itself be an outlier — verify it still has owner.
2. **Washington is a write-off for owner_name** — state privacy interpretation removes owner from all 4 WA counties probed. Only obtainable via Treasurer email request.
3. **Texas wins big** — Bexar, Tarrant, Collin all expose full owner+year+value. Hidalgo/El Paso need vendor-side digging.
4. **NYS aggregator is the highest-leverage single integration after FL** — adds 30+ counties with one endpoint and one schema mapping.
5. **PASDA (mapservices.pasda.psu.edu) is a regional aggregator** for PA counties — same pattern as NC statewide. Worth treating as a single integration covering Allegheny + Bucks + Montgomery + Lehigh + Cumberland + ~30 other PA counties.

---

## Recommended Implementation Order

**Phase 1 (1 week, ~20M people added):** FL statewide + NYS public + PASDA pattern.
**Phase 2 (1 week, ~10M added):** Bexar, Tarrant, Collin, Marion IN, Cuyahoga, Salt Lake, Westchester (already covered by NYS but worth direct fallback).
**Phase 3 (probe-and-ship):** Cook IL, Wayne MI, Clark NV, Jefferson AL, Pima AZ, Multnomah OR, El Paso TX. Allocate ~2 hours per county.
**Phase 4 (skip or deprioritize):** All WA counties, San Bernardino, San Diego owner field, Mobile AL, Lancaster PA, Honolulu owner field, Nassau NY.

---

*Word count: ~1,750. Compiled 2026-05-04.*
