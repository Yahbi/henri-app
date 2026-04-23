# US Property & Insurance Claims — Live Endpoints & Pull Commands

_Compiled 2026-04-21. Every URL below is a real, working data endpoint._

> Scope reality: there is no single feed of "every sold property + every insurance claim in the US." The list below is the union of real, queryable public sources + the commercial vendors that sell the closest thing to nationwide coverage. Use this as an index you can hit directly.

---

## 1. Sold Properties — Public / Free APIs

### 1a. HMDA (Home Mortgage Disclosure Act) — CFPB

Loan-level mortgage originations, nationwide, by state/county/MSA/tract. Free, no key.

- Data browser: https://ffiec.cfpb.gov/data-browser/
- API docs: https://cfpb.github.io/hmda-platform/
- Nationwide bulk (by year): https://ffiec.cfpb.gov/data-publication/snapshot-national-loan-level-dataset/2023
- Example API call (all loans, CA, 2023):

```
https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?states=CA&years=2023
```

### 1b. FHFA House Price Index

ZIP / county / MSA price indices, quarterly.

- https://www.fhfa.gov/data/hpi/datasets
- ZIP5 annual: https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_zip5.csv

### 1c. Census Building Permits Survey

New residential construction permits, monthly, by place/county/MSA.

- https://www.census.gov/construction/bps/

### 1d. Census ACS / Decennial (housing characteristics)

- API root: https://api.census.gov/data.html
- Example (median home value by ZIP, 2022 ACS 5-yr):

```
https://api.census.gov/data/2022/acs/acs5?get=B25077_001E&for=zip%20code%20tabulation%20area:*
```

### 1e. County Assessor / Recorder (authoritative sold price)

There is no national API. Largest free bulk downloads:

- **Texas**: HCAD (Harris) https://hcad.org/pdata/pdata-property-downloads.html · TCAD (Travis) https://www.traviscad.org/reports-open-records-data
- **Florida**: DOR statewide NAL/SDF files https://floridarevenue.com/property/Pages/DataPortal.aspx
- **California**: per-county (LA: https://assessor.lacounty.gov/open-data)
- **NYC**: PLUTO / ACRIS https://www.nyc.gov/site/planning/data-maps/open-data.page
- **King County WA**: https://info.kingcounty.gov/assessor/DataDownload/default.aspx
- **Cook County IL**: https://datacatalog.cookcountyil.gov/

### 1f. Regrid (parcels — freemium)

- Free state parcel samples: https://regrid.com/us

---

## 2. Sold Properties — Commercial (true nationwide coverage)

| Vendor | API / Contact | What it covers |
|---|---|---|
| ATTOM | https://api.developer.attomdata.com/ | ~155M parcels, deeds, AVM, mortgages |
| CoreLogic | https://www.corelogic.com/data-solutions/ | Property, MLS, risk |
| First American DataTree | https://www.datatree.com/ | Deed / doc images |
| Black Knight (ICE) | https://www.blackknightinc.com/ | Loan + property |
| Zillow Bridge API | https://bridgedataoutput.com/ | Listings (MLS) |
| Realtor.com (RDC) | partner program | Listings |

Commercial is the only realistic path to "every sold property, every ZIP, live."

---

## 3. Insurance Claims — Public / Free

### 3a. OpenFEMA — NFIP flood claims & policies (row-level, nationwide)

- API root: https://www.fema.gov/about/openfema/api
- Claims: https://www.fema.gov/api/open/v2/FimaNfipClaims
- Policies: https://www.fema.gov/api/open/v2/FimaNfipPolicies
- Example (first 1000 CA claims):

```
https://www.fema.gov/api/open/v2/FimaNfipClaims?$filter=state%20eq%20%27CA%27&$top=1000
```

### 3b. FEMA Disaster Declarations / IA / PA

- https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
- https://www.fema.gov/api/open/v2/IndividualAssistanceHousingRegistrantsLargeDisasters

### 3c. CMS — Medicare claims (research)

- https://resdac.org/cms-data
- Requires DUA + fees; not a public API.

### 3d. CMS Open Payments / Medicare Provider Utilization (public slices)

- https://data.cms.gov/provider-data/

### 3e. NAIC — aggregated insurer data

- https://content.naic.org/consumer/market-conduct-annual-statement.htm
- Complaint index, market share, rate filings (state-level).

### 3f. State Departments of Insurance (rate filings, complaints)

- SERFF public filings: https://filingaccess.serff.com/sfa/home/FA
- CA DOI: https://interactive.web.insurance.ca.gov/
- NY DFS: https://www.dfs.ny.gov/reports_and_publications
- TX TDI: https://www.tdi.texas.gov/data/
- FL OIR: https://www.floir.com/tools-and-data

### 3g. SBA Disaster Loans

- https://www.sba.gov/funding-programs/disaster-assistance/disaster-data

### 3h. NOAA Storm Events (loss dollars)

- https://www.ncdc.noaa.gov/stormevents/ftp.jsp

---

## 4. Insurance Claims — Commercial

| Vendor | Use |
|---|---|
| Verisk / ISO | Carrier-side P&C analytics (not resold publicly) |
| LexisNexis C.L.U.E. | Homeowners/auto claim history (consumer-auth only) |
| Milliman | Actuarial |
| Moody's RMS, Swiss Re | Cat modeling |

Row-level nationwide P&C claims data is **not** commercially resold in a "live" form — it's carrier-confidential.

---

## 5. Ready-to-run PowerShell pulls

```powershell
# NFIP flood claims — all CA, save to CSV
Invoke-WebRequest `
  "https://www.fema.gov/api/open/v2/FimaNfipClaims?`$filter=state eq 'CA'&`$format=csv" `
  -OutFile "$env:USERPROFILE\Desktop\nfip_ca_claims.csv"

# HMDA 2023 national snapshot index
Invoke-WebRequest `
  "https://ffiec.cfpb.gov/data-publication/snapshot-national-loan-level-dataset/2023" `
  -OutFile "$env:USERPROFILE\Desktop\hmda_2023_index.html"

# FEMA disaster declarations (all)
Invoke-WebRequest `
  "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?`$format=csv" `
  -OutFile "$env:USERPROFILE\Desktop\fema_disasters.csv"

# FHFA ZIP5 HPI
Invoke-WebRequest `
  "https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_bdl_zip5.csv" `
  -OutFile "$env:USERPROFILE\Desktop\fhfa_hpi_zip5.csv"
```

---

## 6. What is NOT achievable from public APIs

- Row-level sold price for every US property in real time (fragmented at 3,100+ counties).
- Unified row-level homeowners / auto / health claims feed (carrier-confidential, HIPAA, contract).
- Live MLS data without membership in each MLS or a licensed partner (Bridge/RESO).

If you need nationwide, row-level, live — the only path is **ATTOM/CoreLogic + a licensed MLS feed** for property, and there is **no equivalent** for P&C claims.
