# US Property & Insurance Claims Data — Source Guide

_Compiled 2026-04-21_

## Reality check

- **No single live feed** exists for every US sold property. Transactions are recorded at the **county** level (~3,100 counties), each with its own system, format, fees, and access rules.
- **No public live feed** exists for "all insurance claims." Claims data is carrier-held and protected by contract, state insurance law, and (for health) HIPAA. Aggregated slices exist; a unified live stream does not.

---

## Sold / Property Data

### Commercial (nationwide, bulk-licensed — the real answer)
| Provider | What you get | Access |
|---|---|---|
| ATTOM Data | Deeds, assessments, mortgages, foreclosures, AVM — ~155M parcels | Paid API / bulk |
| CoreLogic | Property, MLS, risk, AVM | Paid, enterprise |
| First American DataTree | Deeds, docs, tax | Paid API |
| Black Knight / ICE | Mortgage + property | Paid, enterprise |
| Regrid | Nationwide parcel boundaries + attributes | Paid tiers; some free |

### Listings / sold proxies (ToS-restricted)
- **Zillow** — Bridge API / Zestimate (limited)
- **Redfin** — Data Center (downloadable market stats, no row-level)
- **Realtor.com (RDC)** — partner API
- **MLS / RESO Web API** — per-MLS membership required

### Authoritative public sources (free, fragmented)
- **County assessor / recorder** websites — authoritative sold prices & deeds; format varies wildly
- State bulk portals: **TX (TCAD/HCAD)**, **FL (DOR + county PA)**, **NC, OH, WA** publish bulk data
- **HMDA** (CFPB) — mortgage origination, loan-level, free: https://ffiec.cfpb.gov/data-browser/
- **FHFA HPI** — house price index, free
- **Census ACS / Building Permits Survey** — housing stats, free
- **HUD USPS Vacancy, FMR, CHAS** — free
- **FEMA NFHL** — flood zones

---

## Insurance / Claims-Adjacent Data

### Federal / public
- **OpenFEMA** — NFIP flood claims & policies (bulk CSV/API, free): https://www.fema.gov/about/openfema
- **CMS** — Medicare claims (Research Identifiable Files; DUA required, fees)
- **NAIC** — aggregated filings, market share, complaint index
- **SBA Disaster Loans** — bulk data
- **NOAA Storm Events** — loss context

### State
- **State Departments of Insurance** — complaint data, market conduct, rate filings (SERFF)
- **California DOI, NY DFS, TX TDI, FL OIR** publish the most

### Commercial
- **Verisk / ISO** — carrier-side analytics (not for outsiders)
- **Milliman, Moody's RMS, Swiss Re** — catastrophe / actuarial

### What's NOT available
- Row-level P&C claims nationwide
- Real-time homeowners/auto claim feeds
- Cross-carrier identified claim data

---

## Practical starting points (free, today)

1. **HMDA** — mortgage activity by geography
2. **OpenFEMA NFIP** — flood claims with ZIP/date
3. **FHFA HPI** — price trends by MSA/ZIP
4. **Census Building Permits** — new construction leading indicator
5. **County bulk downloads** — start with TX + FL for real sold prices

## If budget exists
- ATTOM or Regrid for nationwide parcel + sold
- Bridge/RESO for listings
- CoreLogic if institutional

