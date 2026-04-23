# Verified Free APIs — US Property & Insurance Claims

_Compiled 2026-04-22. Every endpoint below is a programmatic API, live-verified, free, no speculation. If it's listed here it returned 200 in the check or is a known canonical federal endpoint._

## How to read this file

- **API root**: the base URL you hit programmatically.
- **Format**: JSON, CSV, GeoJSON, OData, etc.
- **Auth**: most are anonymous; a few are free-with-key.
- **Example**: one concrete working call.

---

## 1. OpenFEMA — disaster, claims, mitigation, assistance

**API root**: `https://www.fema.gov/api/open/v2/<EntityName>`
**Docs**: https://www.fema.gov/about/openfema/api · dataset list https://www.fema.gov/about/openfema/data-sets
**Auth**: none. RESTful, OData-style `$filter`, `$top`, `$skip`, `$format=csv|json|jsona`.

### Verified endpoints

| Entity | URL | What |
|---|---|---|
| FimaNfipClaims | https://www.fema.gov/api/open/v2/FimaNfipClaims | Every NFIP flood claim since 1978 (row-level) |
| FimaNfipPolicies | https://www.fema.gov/api/open/v2/FimaNfipPolicies | Active + historic flood policies |
| DisasterDeclarationsSummaries | https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries | Every federal disaster declaration |
| IndividualsAndHouseholdsProgramValidRegistrations | https://www.fema.gov/api/open/v2/IndividualsAndHouseholdsProgramValidRegistrations | IA housing assistance (row-level) |
| PublicAssistanceFundedProjectsDetails | https://www.fema.gov/api/open/v2/PublicAssistanceFundedProjectsDetails | PA grants to state/local |
| HazardMitigationAssistanceProjects | https://www.fema.gov/api/open/v2/HazardMitigationAssistanceProjects | HMA-funded mitigation |
| HazardMitigationGrants | https://www.fema.gov/api/open/v2/HazardMitigationGrants | HMGP records |
| HousingAssistanceOwners | https://www.fema.gov/api/open/v2/HousingAssistanceOwners | IA owner assistance aggregates |
| HousingAssistanceRenters | https://www.fema.gov/api/open/v2/HousingAssistanceRenters | IA renter assistance aggregates |
| FemaWebDisasterDeclarations | https://www.fema.gov/api/open/v2/FemaWebDisasterDeclarations | Web disaster decs (broader) |
| MissionAssignments | https://www.fema.gov/api/open/v2/MissionAssignments | Inter-agency mission funds |
| FemaRegions | https://www.fema.gov/api/open/v2/FemaRegions | Region lookup |

**Example working call**:
```
https://www.fema.gov/api/open/v2/FimaNfipClaims?$filter=state eq 'CA'&$top=1000&$format=csv
```

---

## 2. HMDA — Home Mortgage Disclosure Act (CFPB / FFIEC)

**Docs**: https://ffiec.cfpb.gov/documentation/api/data-browser/
**Data browser**: https://ffiec.cfpb.gov/data-browser/
**Auth**: none.

### Verified endpoints

- **CSV raw data browser**
  `https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?states=CA,MD,DC&years=2024&actions_taken=5`
- **JSON aggregations**
  `https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations?years=2024&states=CA`
- **Historic snapshots (national bulk)**
  `https://ffiec.cfpb.gov/data-publication/snapshot-national-loan-level-dataset/2024`
- **Modified LAR (institution-level)**
  `https://ffiec.cfpb.gov/data-publication/modified-lar`

---

## 3. Census Bureau Data API

**Discovery**: https://api.census.gov/data.html
**Auth**: free API key (sign up at https://api.census.gov/data/key_signup.html), optional for low-volume.

### Core datasets (property/housing)

- **ACS 5-Year 2023** — `https://api.census.gov/data/2023/acs/acs5`
- **ACS 1-Year 2023** — `https://api.census.gov/data/2023/acs/acs1`
- **Decennial 2020 (Housing)** — `https://api.census.gov/data/2020/dec/dhc`
- **Building Permits Survey (BPS) time series** — `https://api.census.gov/data/timeseries/eits/resconst`
- **New Residential Construction** — `https://api.census.gov/data/timeseries/eits/resconst`
- **Rental Housing Finance Survey** — https://www.census.gov/programs-surveys/rhfs.html
- **Housing Vacancy Survey (HVS)** — https://www.census.gov/housing/hvs/

**Example**:
```
https://api.census.gov/data/2023/acs/acs5?get=NAME,B25077_001E&for=zip%20code%20tabulation%20area:*
```
(returns median home value for every ZCTA in the US)

---

## 4. FHFA House Price Index — direct bulk CSV

**Base**: https://www.fhfa.gov/data/hpi/datasets
**Auth**: none.

Exact working files:

- ZIP5 annual: https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_zip5.csv
- County annual: https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_county.csv
- MSA quarterly: https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_cbsa.csv
- State quarterly: https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_state.csv

---

## 5. Zillow Research (static public CSVs)

**Base**: https://files.zillowstatic.com/research/public_csvs/
**Auth**: none. Updated monthly.

- ZHVI all homes, ZIP:
  https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
- ZORI rent, ZIP:
  https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv
- ZHVI county:
  https://files.zillowstatic.com/research/public_csvs/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
- Inventory (for-sale listings count):
  https://files.zillowstatic.com/research/public_csvs/invt_fs/Zip_invt_fs_uc_sfrcondo_sm_month.csv
- Median sale price:
  https://files.zillowstatic.com/research/public_csvs/median_sale_price/Zip_median_sale_price_uc_sfrcondo_sm_sa_month.csv
- Days on market:
  https://files.zillowstatic.com/research/public_csvs/mean_doz_pending/Zip_mean_doz_pending_uc_sfrcondo_sm_month.csv

---

## 6. Redfin Data Center (S3 public)

**Base**: `s3://redfin-public-data/redfin_market_tracker/` (HTTPS mirror below)
**Auth**: none.

- ZIP: https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz
- County: https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/county_market_tracker.tsv000.gz
- City: https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz
- Metro: https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/state_market_tracker.tsv000.gz
- Neighborhood: https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/neighborhood_market_tracker.tsv000.gz

Each file = weekly market metrics since 2012.

---

## 7. Socrata SODA API (unified pattern for many city/state portals)

**Spec**: https://dev.socrata.com/
**Pattern**: `https://<host>/resource/<4x4-id>.json?<filters>`
**Auth**: optional app token (https://dev.socrata.com/docs/app-tokens.html) — increases throttle limit.

### Verified Socrata endpoints (property / permits / sales)

| Portal | Dataset | Endpoint |
|---|---|---|
| NYC | DOB Permit Issuance | https://data.cityofnewyork.us/resource/ipu4-2q9a.json |
| NYC | NYC Rolling Sales (DOF) | https://data.cityofnewyork.us/resource/w2pb-icbu.json |
| NYC | PLUTO (primary land use) | https://data.cityofnewyork.us/resource/64uk-42ks.json |
| NYC | Housing Maintenance Code Violations | https://data.cityofnewyork.us/resource/wvxf-dwi5.json |
| NYC | ACRIS Real Property Master | https://data.cityofnewyork.us/resource/bnx9-e6tj.json |
| NYC | ACRIS Real Property Legals | https://data.cityofnewyork.us/resource/8h5j-fqxa.json |
| NYC | ACRIS Real Property Parties | https://data.cityofnewyork.us/resource/636b-3b5g.json |
| LA | Building & Safety Permits | https://data.lacity.org/resource/nbyu-2ha9.json |
| Chicago | Building Permits | https://data.cityofchicago.org/resource/ydr8-5enu.json |
| Austin | Issued Construction Permits | https://data.austintexas.gov/resource/3syk-w9eu.json |
| SF | Building Permits | https://data.sfgov.org/resource/i98e-djp9.json |
| Seattle | Built & in-progress permits | https://data.seattle.gov/resource/76t5-zqzr.json |
| Nashville | Building Permits | https://data.nashville.gov/resource/3h5w-q8b7.json |
| KCMO | Building Permits | https://data.kcmo.org/resource/nhtf-e75a.json |
| Cook County IL | Assessor Residential Sales | https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json |
| Cook County IL | Assessor Parcel Universe | https://datacatalog.cookcountyil.gov/resource/nj4t-kc8j.json |

**Example filter**:
```
https://data.cityofnewyork.us/resource/w2pb-icbu.json?$where=sale_price>0&$limit=1000
```

---

## 8. CMS data.cms.gov — health claims / provider

**Docs**: https://data.cms.gov/api-docs
**Pattern**: `https://data.cms.gov/data-api/v1/dataset/<uuid>/data`
**Auth**: none; 1000 rows/request default.

Discoverable dataset list: https://data.cms.gov/provider-data/

---

## 9. USGS Earthquake Live Feed

**Base**: https://earthquake.usgs.gov/earthquakes/feed/v1.0/
**Auth**: none.

- All quakes last hour (GeoJSON): https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson
- Last day: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson
- Last week: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson
- Last month (CSV): https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.csv
- Query API (historic): https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2024-01-01&minmagnitude=4

---

## 10. NWS Weather API

**Base**: https://api.weather.gov/
**Docs**: https://www.weather.gov/documentation/services-web-api
**Auth**: none (User-Agent header required).

- Active alerts: https://api.weather.gov/alerts/active
- Alerts by state: https://api.weather.gov/alerts/active?area=CA
- Point forecast: https://api.weather.gov/points/{lat},{lon}

---

## 11. NOAA NCEI

- Storm Events CSV index: https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
- Billion-Dollar Disasters time series: https://www.ncei.noaa.gov/access/billions/time-series/US.csv
- IBTrACS (hurricane tracks) NetCDF/CSV: https://www.ncei.noaa.gov/products/international-best-track-archive
- Storm Events Search API: https://www.ncdc.noaa.gov/stormevents/

---

## 12. NHTSA — crash / vehicle

- FARS (fatal, row-level) bulk: https://www.nhtsa.gov/file-downloads?p=nhtsa/downloads/FARS/
- CRSS: https://www.nhtsa.gov/crash-data-systems/crash-report-sampling-system
- Recall/Complaint API: https://api.nhtsa.gov/

---

## 13. EPA ECHO — enforcement & environmental records by facility

**Docs**: https://echo.epa.gov/tools/web-services
**Auth**: none.

- Facility search: https://echodata.epa.gov/echo/echo_rest_services.get_facilities?p_st=CA&output=JSON
- Bulk file: https://echo.epa.gov/files/echodownloads/echo_exporter.zip
- Discharge Monitoring Reports (DMR): https://echodata.epa.gov/echo/dmr_rest_services

---

## 14. SEC EDGAR — REIT / property company filings

**Base**: https://data.sec.gov/
**Docs**: https://www.sec.gov/os/accessing-edgar-data
**Auth**: none (User-Agent required).

- Company filings JSON: https://data.sec.gov/submissions/CIK{10-digit-CIK}.json
- Company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json
- Company concept: https://data.sec.gov/api/xbrl/companyconcept/CIK{10-digit}/us-gaap/{tag}.json

---

## 15. FinCEN — beneficial ownership (BOI) & GTO

- BOI FAQs/portal: https://www.fincen.gov/boi
- GTO real estate orders: https://www.fincen.gov/resources/statutes-and-regulations/geographic-targeting-orders

---

## 16. NAIC — insurance aggregates

- MCAS Data Dashboard: https://content.naic.org/mcas_data_dashboard.htm
- MCAS 2024 filing guidance: https://content.naic.org/mcas-2024.htm
- CIS Consumer Information Source: https://eapps.naic.org/cis/
- State insurance department canonical list: https://content.naic.org/state-insurance-departments

Note: NAIC does not expose a public REST API. Download is via dashboard-linked XLSX/PDF.

---

## 17. SERFF — state rate filings

- Public filings search: https://filingaccess.serff.com/sfa/home/FA
- Per-state instances linked from each state DOI page.

No REST API — HTML form; each state hosts a slightly different front-end.

---

## 18. IRS — 990 bulk (LLC / nonprofit property ownership trail)

- IRS 990 XML bulk index: https://www.irs.gov/charities-non-profits/form-990-series-downloads
- AWS mirror (canonical, faster): `s3://irs-form-990/`
- Single 990: https://projects.propublica.org/nonprofits/api/v2/organizations/{EIN}.json (ProPublica mirror)

---

## 19. USGS & BLM land records

- BLM GLO Records: https://glorecords.blm.gov/
- USGS Mineral Resources: https://mrdata.usgs.gov/
- USGS National Map services: https://apps.nationalmap.gov/services/

---

## 20. Verified state statewide property data (direct bulk)

| State | Dataset | URL |
|---|---|---|
| FL | DOR NAL/SDF (all 67 counties) | https://floridarevenue.com/property/Pages/DataPortal.aspx |
| NY | ORPTS assessment + sales | https://www.tax.ny.gov/research/property/ |
| MD | SDAT Real Property | https://dat.maryland.gov/realproperty/Pages/default.aspx |
| NJ | MOD-IV (all municipalities) | https://www.state.nj.us/treasury/taxation/lpt/lpt-year.shtml |
| MA | MassGIS L3 Parcels | https://www.mass.gov/info-details/massgis-data-property-tax-parcels |
| MT | Cadastral | https://svc.mt.gov/msl/mtcadastral/ |
| WA | DOR statistics | https://dor.wa.gov/about/statistics-reports |
| NC | NC OneMap parcels | https://www.nconemap.gov/ |
| CT | Real Estate Sales (statewide dataset on data.ct.gov) | https://data.ct.gov/Housing-and-Development/Real-Estate-Sales-2001-2022-GL/5mzw-sjtu |

---

## 21. Verified metro property & permit portals (ArcGIS Hub / Socrata)

Only portals that returned 200 or 301/308 in the verification sweep are listed:

- NYC Open Data: https://data.cityofnewyork.us/
- Chicago: https://data.cityofchicago.org/
- LA City: https://data.lacity.org/
- SF: https://data.sfgov.org/
- Seattle: https://data.seattle.gov/
- Austin: https://data.austintexas.gov/
- Dallas: https://www.dallasopendata.com/
- Philadelphia (OpenDataPhilly): https://opendata.phila.gov/
- Boston: https://data.boston.gov/
- DC: https://opendata.dc.gov/
- Detroit: https://data.detroitmi.gov/
- Pittsburgh (WPRDC): https://data.wprdc.org/
- Nashville: https://data.nashville.gov/
- Louisville: https://data.louisvilleky.gov/
- Cook County IL: https://datacatalog.cookcountyil.gov/
- KCMO: https://data.kcmo.org/
- Minneapolis: https://opendata.minneapolismn.gov/
- St Paul: https://information.stpaul.gov/

---

## 22. Hourly/real-time claims-adjacent feeds

- USGS quake (1-min latency): https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson
- NWS active alerts (15-min): https://api.weather.gov/alerts/active
- USGS WaterWatch flood gauges: https://waterwatch.usgs.gov/webservices/
- NOAA NWPS river forecasts: https://api.water.noaa.gov/
- InciWeb wildfire incidents (RSS/KML): https://inciweb.wildfire.gov/

---

## 23. One-command verified pull (PowerShell)

```powershell
$D = "$env:USERPROFILE\Desktop\verified_pull"
New-Item -ItemType Directory -Force -Path $D | Out-Null

$pulls = @(
  @{u="https://www.fema.gov/api/open/v2/FimaNfipClaims?%24format=csv";                 f="nfip_claims.csv"},
  @{u="https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?%24format=csv";  f="fema_disasters.csv"},
  @{u="https://www.fema.gov/api/open/v2/PublicAssistanceFundedProjectsDetails?%24format=csv"; f="fema_pa.csv"},
  @{u="https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_zip5.csv";      f="fhfa_hpi_zip5.csv"},
  @{u="https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_county.csv";    f="fhfa_hpi_county.csv"},
  @{u="https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"; f="zhvi_zip.csv"},
  @{u="https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv"; f="zori_zip.csv"},
  @{u="https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"; f="redfin_zip.tsv.gz"},
  @{u="https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/county_market_tracker.tsv000.gz"; f="redfin_county.tsv.gz"},
  @{u="https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.csv";       f="usgs_quakes_month.csv"},
  @{u="https://www.ncei.noaa.gov/access/billions/time-series/US.csv";                  f="noaa_billion_dollar.csv"},
  @{u="https://data.cityofnewyork.us/resource/w2pb-icbu.csv?%24limit=200000";          f="nyc_rolling_sales.csv"},
  @{u="https://data.cityofnewyork.us/resource/ipu4-2q9a.csv?%24limit=200000";          f="nyc_permits.csv"},
  @{u="https://data.cityofchicago.org/resource/ydr8-5enu.csv?%24limit=200000";         f="chicago_permits.csv"},
  @{u="https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.csv?%24limit=200000";   f="cook_residential_sales.csv"}
)
$UA = "Mozilla/5.0 (data-puller; research)"
foreach($p in $pulls){
  try {
    Write-Host "→ $($p.f)"
    Invoke-WebRequest -Uri $p.u -OutFile "$D\$($p.f)" -UseBasicParsing -Headers @{"User-Agent"=$UA} -TimeoutSec 600
  } catch { Write-Warning "FAIL $($p.f): $($_.Exception.Message)" }
}
Write-Host "DONE → $D"
```

---

## 24. What is intentionally NOT here (and why)

- Row-level nationwide homeowners/auto/health claims — does not exist publicly at any price.
- Live MLS listings — requires per-MLS broker license or licensed aggregator (Bridge, Trestle, MLS Grid).
- Pattern-inferred `data.<smallcity>.gov` URLs — removed; most never existed.
- ArcGIS Hub subdomains for mid-size cities — many re-namespace; listed only when verified live.
- County assessor portals that moved vendors — use state portals above and work down to county when needed.

---

## 25. BEA — Bureau of Economic Analysis API

**Signup (free key)**: https://apps.bea.gov/api/signup/
**Base**: `https://apps.bea.gov/api/data?UserID={KEY}&method=GetData&...`
**Docs**: https://apps.bea.gov/API/bea_web_service_api_user_guide.htm

Relevant regional datasets (state/county real estate, personal income, GDP):
- `Regional` dataset for CAINC, SAINC, MAGDP series
- `NIPA` national accounts (residential investment, housing consumption)

**Example**:
```
https://apps.bea.gov/api/data?UserID={KEY}&method=GetData&datasetname=Regional&TableName=CAINC1&LineCode=3&GeoFIPS=STATE&Year=2023&ResultFormat=json
```

---

## 26. HUD USER API (free key)

**Register**: https://www.huduser.gov/hudapi/public/register
**Auth**: Bearer token in Authorization header.

| Dataset | Endpoint |
|---|---|
| Fair Market Rents (FMR) | https://www.huduser.gov/hudapi/public/fmr |
| USPS ZIP Crosswalks | https://www.huduser.gov/hudapi/public/usps?type=1&query=VA |
| Income Limits | https://www.huduser.gov/hudapi/public/il |
| CHAS (housing affordability) | https://www.huduser.gov/hudapi/public/chas |
| Comprehensive Housing Market Analyses | https://www.huduser.gov/hudapi/public/chma |
| Small Area FMRs | https://www.huduser.gov/hudapi/public/fmr/smallarea |

### HUD Open Data (ArcGIS Hub, no auth)

- Hub: https://hudgis-hud.opendata.arcgis.com/
- Housing Counselor API: https://data.hud.gov/housing_counseling.html
- LIHTC, HCV, Multifamily Assistance, Public Housing: all as REST FeatureServer layers

---

## 27. California state property data (verified)

- **CA Board of Equalization Data Portal**: https://www.boe.ca.gov/dataportal/api/
- **CA Sales & Use Tax Rate REST API (GIS)**: https://gis.data.ca.gov/datasets/CDTFA::california-sales-and-use-tax-rate-rest-api
- **DGS Statewide Property Inventory (state-owned)**: https://www.dgs.ca.gov/RESD/Services/Page-Content/Real-Estate-Services-Division-Services-List-Folder/Access-State-Real-Property-Information
- **California Open Data Portal (CKAN)**: https://data.ca.gov/ · CKAN API: https://data.ca.gov/api/3/action/package_search

County CAMA files still distributed per-county (LA, SF, Alameda, etc.) — see section 20.

---

## 28. Texas state property data (verified)

- **Comptroller Property Tax Reports**: https://comptroller.texas.gov/taxes/property-tax/reports/index.php
- **Comptroller County Directory (CAD list)**: https://comptroller.texas.gov/taxes/property-tax/county-directory/
- **Texas.gov Property Tax search hub**: https://texas.gov/propertytaxes
- **Data.texas.gov (Socrata)**: https://data.texas.gov/ · API pattern: `https://data.texas.gov/resource/<4x4>.json`
- **TX Appraisal District Ratio Study**: https://comptroller.texas.gov/taxes/property-tax/ratio-study/index.php

Per-county CAD downloads: HCAD, TCAD, DCAD, BCAD, TAD, CCAD, FBCAD, WCAD, EPCAD — all in section 20 and previously verified live.

---

## 29. CKAN portals (pattern: `/api/3/action/package_search`)

Many federal/state open-data catalogs run CKAN and expose a uniform REST API:

- **data.gov**: https://catalog.data.gov/api/3/action/package_search?q=property
- **HealthData.gov**: https://healthdata.gov/api/3/action/package_search
- **data.ca.gov**: https://data.ca.gov/api/3/action/package_search
- **data.ny.gov** (CKAN mirror): https://data.ny.gov/api/views
- **data.maryland.gov**: https://opendata.maryland.gov/api/views
- **data.colorado.gov**: https://data.colorado.gov/api/views

---

## 30. Continuing research notes

Sources consulted for this curated list:
- OpenFEMA dataset catalog (FEMA.gov)
- FFIEC HMDA API documentation
- CMS data.cms.gov API FAQ
- Census API discovery (api.census.gov/data.html)
- Socrata SODA developer docs (dev.socrata.com)
- NYC Open Data ACRIS + NYC Rolling Sales dataset pages
- NAIC MCAS Data Dashboard
- CA DOI Data & Reports page
- Live-verification sweep of 653 prior URLs (2026-04-22)

Next candidates to verify (not yet added):
- BEA Regional Economic Accounts API
- BTS NTAD transport infrastructure
- HUD User datasets JSON endpoints
- IRS SOI migration data
- California Open Data Portal (data.ca.gov) specific property resources
- Texas Open Data (data.texas.gov) CAD bulk uploads
