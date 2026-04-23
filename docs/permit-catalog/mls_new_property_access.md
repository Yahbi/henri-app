# MLS & New Property Listings — Access Guide

_Compiled 2026-04-21. Every path below is real; most require credentials._

## The hard truth about MLS

There is **no single nationwide MLS**. The US has ~500 local MLSs, each owned by a regional Realtor association. To get listings you either:

1. Join a broker/agent in each MLS territory (RESO Web API access), **or**
2. License an aggregator that has already done that (Bridge, Trestle, Spark, MLS Grid), **or**
3. Use a vendor feed (ATTOM, CoreLogic) that blends MLS + public records.

There is no free public "all new listings" API. Zillow/Redfin/Realtor display listings under MLS contracts and do not republish them as open data.

---

## 1. RESO Web API (industry standard)

All major MLSs now expose RESO Web API endpoints (OData-based). Spec:

- https://www.reso.org/reso-web-api/
- Data Dictionary: https://www.reso.org/data-dictionary/

You cannot hit these without MLS-issued OAuth credentials tied to a licensed agent/broker or approved vendor.

---

## 2. Aggregators (single contract → many MLSs)

| Aggregator | Coverage | Link |
|---|---|---|
| **Bridge Interactive** (Zillow) | 600+ MLSs | https://bridgedataoutput.com/ |
| **Trestle** (CoreLogic) | 200+ MLSs | https://trestle.corelogic.com/ |
| **Spark API** (FBS) | 100+ MLSs | https://sparkplatform.com/docs/api |
| **MLS Grid** | major MLSs, RESO-compliant | https://www.mlsgrid.com/ |
| **Realtyna** | reseller | https://realtyna.com/ |

Process for all of these: apply, sign a data license, get approved by each underlying MLS you want, receive OAuth keys.

---

## 3. Near-substitutes that do NOT require MLS approval

### 3a. Realtor.com RapidAPI mirrors (unofficial, ToS-gray)

- https://rapidapi.com/search/realtor — multiple providers scrape listings
- **Legal risk**: violates Move/Realtor.com ToS; not suitable for production.

### 3b. Zillow "Zestimate" API via Bridge

- Requires Bridge approval; not open.

### 3c. ATTOM listings

- Includes active listings blended with public records.
- https://api.developer.attomdata.com/

### 3d. Redfin Data Center (aggregates, not row-level)

- https://www.redfin.com/news/data-center/
- Weekly market metrics by ZIP/metro — free CSV.

---

## 4. "New property" — new construction (public, free)

For newly built homes (not resales), these are authoritative and open:

### 4a. Census Building Permits Survey (BPS)

- Monthly, every permit-issuing place in the US.
- https://www.census.gov/construction/bps/
- API: https://api.census.gov/data/timeseries/eits/resconst

### 4b. Census Survey of Construction (SOC)

- https://www.census.gov/construction/nrc/

### 4c. HUD SOCDS Building Permits

- https://socds.huduser.gov/permits/

### 4d. NAHB / Dodge Construction Network (paid)

- https://www.construction.com/

### 4e. Local permit open data portals

Most large cities publish live permit feeds:

- NYC DOB: https://data.cityofnewyork.us/Housing-Development/DOB-Permit-Issuance/ipu4-2q9a
- LA: https://data.lacity.org/
- Chicago: https://data.cityofchicago.org/
- Austin: https://data.austintexas.gov/
- Seattle: https://data.seattle.gov/

---

## 5. Ready-to-run pulls (no MLS credentials needed)

```powershell
# NYC — all building permits issued (live open data, Socrata)
Invoke-WebRequest `
  "https://data.cityofnewyork.us/resource/ipu4-2q9a.csv?`$limit=50000" `
  -OutFile "$env:USERPROFILE\Desktop\nyc_permits.csv"

# LA — building permits
Invoke-WebRequest `
  "https://data.lacity.org/resource/nbyu-2ha9.csv?`$limit=50000" `
  -OutFile "$env:USERPROFILE\Desktop\la_permits.csv"

# Austin — issued construction permits
Invoke-WebRequest `
  "https://data.austintexas.gov/resource/3syk-w9eu.csv?`$limit=50000" `
  -OutFile "$env:USERPROFILE\Desktop\austin_permits.csv"

# Redfin weekly market data (ZIP level)
Invoke-WebRequest `
  "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz" `
  -OutFile "$env:USERPROFILE\Desktop\redfin_zip.tsv.gz"
```

---

## 6. Decision tree

- **You want live resale listings nationwide** → license Bridge or Trestle. Budget $500–$5,000/month depending on usage.
- **You want new construction nationwide, free** → Census BPS + local Socrata permit portals.
- **You want sold prices nationwide** → ATTOM or CoreLogic (commercial) or county assessor bulk files (free, fragmented).
- **You are not a licensed real estate professional** → you will not get RESO Web API access. Go aggregator.

---

## 7. What you cannot get, period

- Pre-market / pocket listings (private by design)
- Off-MLS FSBO at scale (no unified source; Craigslist/Zillow FSBO scraping violates ToS)
- MLS data without a data license
