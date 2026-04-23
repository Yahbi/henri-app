# Solutions: Getting Sold Property + Insurance Claims Data

_Compiled 2026-04-21. Concrete paths ranked by practicality._

---

## Part A — Sold Property (nationwide, row-level)

### Solution 1 — License a bulk vendor (fastest, $$)

Single contract → nationwide sold coverage. Pick one:

| Vendor | Typical entry cost | Strength |
|---|---|---|
| **ATTOM** | ~$1–5k/mo API; bulk $$$$ | Widest nationwide coverage, modern API |
| **CoreLogic** | Enterprise, $$$$ | Deepest + MLS integration |
| **First American DataTree** | per-doc or subscription | Deed image + records |
| **Black Knight (ICE)** | Enterprise | Mortgage servicing-grade |
| **Regrid** | $50–$2k/mo tiers | Parcel boundaries + attributes; cheapest nationwide |

**Action**: email sales@attomdata.com with use case + volume; ask for "nationwide sales / deed file, monthly refresh." Get quote in ~48h. Regrid self-serves at https://regrid.com/pricing.

### Solution 2 — County-by-county bulk harvest (free, heavy)

Authoritative, free, but you build and maintain 3,100 scrapers/parsers.

Start with the states that publish statewide bulk files:

1. **Texas** — TCAD, HCAD, BCAD, DCAD etc. bulk ZIP files
2. **Florida** — DOR NAL/SDF statewide: https://floridarevenue.com/property/Pages/DataPortal.aspx
3. **Ohio** — county portals, most in CAMA export
4. **North Carolina** — statewide via NCOneMap
5. **Washington** — DOR annual sales file
6. **Maryland** — SDAT statewide
7. **NY** — ORPTS statewide assessment + RPS sales

Remaining 40+ states: per-county scraping (Selenium/Playwright against assessor sites, FOIA for bulk).

**Stack**: Python + `requests`/`playwright` + Postgres/PostGIS + dbt to normalize to a common schema (APN, address, sale date, price, grantor, grantee). Budget 2–6 engineer-months for meaningful national coverage.

### Solution 3 — Hybrid (recommended)

- **Regrid** ($) for nationwide parcel spine (APN, geometry, owner).
- **ATTOM** or county bulk for sold prices layered on top.
- **HMDA** (free) for loan side.

This is how most proptech startups actually do it.

### Solution 4 — MLS aggregator (if you want active listings + recent sold)

- **Bridge Interactive** (Zillow), **Trestle** (CoreLogic), **MLS Grid**, **Spark API**.
- Requires data license + per-MLS approval. 4–12 week onboarding.
- MLS "sold" data is excellent for last ~18 months, not a full historical record.

---

## Part B — Insurance Claims

### Reality

Row-level nationwide claims data is **not** for sale, anywhere. P&C claims are carrier-confidential. Health claims are HIPAA-protected. The solution is to stitch together what *is* available by line of business.

### Solution 1 — Flood: solved, free, row-level

**OpenFEMA NFIP Claims** — every NFIP flood claim since 1970, row-level, with ZIP, date, payout, cause.

- https://www.fema.gov/api/open/v2/FimaNfipClaims
- Pull it today, no auth. This is the single best public claims dataset in the US.

### Solution 2 — Homeowners/Auto: aggregated only

No row-level public source. Best you can do:

- **NAIC Market Conduct Annual Statement** — complaint counts, claims closed with/without payment, by carrier by state.
- **State DOI rate filings (SERFF)** — loss ratios, claim frequency in actuarial exhibits: https://filingaccess.serff.com/
- **CA DOI, NY DFS, TX TDI, FL OIR** — the most-publishing states.
- **LexisNexis C.L.U.E.** — individual claim history, but only with consumer authorization (can't pull at scale).

### Solution 3 — Health: CMS research files

- **CMS Chronic Conditions Warehouse / VRDC** — Medicare claims, row-level, for approved researchers.
- Requires Data Use Agreement (DUA), IRB, and fees ($5k–$30k+ per project).
- https://resdac.org/ — start here.
- Medicaid equivalent: T-MSIS via CMS.

### Solution 4 — Disaster / cat losses

- **OpenFEMA Disaster Declarations, IA, PA** (row-level)
- **NOAA Storm Events** — $ loss by event
- **SBA Disaster Loans** — approved loans bulk file
- **PCS (Verisk)** — industry loss estimates (paid)
- **Swiss Re sigma** / **Munich Re NatCatSERVICE** — annual reports, free PDFs

### Solution 5 — Workers' comp

- State-level. **NCCI** holds the national pool (paid). Some states (CA WCIRB, NY WCB) publish aggregates.

### Solution 6 — Build your own via claims adjusters / InsurTech partnerships

If you're building a product that needs real claims flow:

- **Verisk ISO ClaimSearch** — partnership only, for carriers.
- **Duck Creek, Guidewire** integrations — if embedded in carrier workflow.
- **CCC Intelligent Solutions** — auto claims ecosystem.

These are not "buy a feed" — they are "be a carrier or carrier-adjacent vendor."

---

## Part C — Practical 30-day plan

If your goal is a working nationwide dataset for property + claims within a month:

**Week 1 — Free data, running in a DB**
- Pull: OpenFEMA NFIP claims, FEMA disasters, HMDA 2023, FHFA HPI ZIP5, Census BPS, Redfin ZIP market tracker.
- Load into Postgres. ~5M+ rows across tables. Zero cost.

**Week 2 — Statewide county bulk**
- Ingest Florida DOR + Texas TCAD/HCAD + NY ORPTS sold files.
- That alone gives you ~40M parcels with sold history.

**Week 3 — Commercial quote & trial**
- Get ATTOM + Regrid demos.
- Get Bridge/Trestle MLS application in motion (slow process).

**Week 4 — Claims aggregates**
- Scrape NAIC complaint index + state DOI loss ratio filings.
- Enrich with NOAA storm events for cat exposure by ZIP.

Result: nationwide property sold coverage ~60% row-level (via licensed vendor or statewide bulk), claims coverage = flood row-level + everything else aggregated.

---

## Part D — What will never work

- Scraping Zillow/Redfin/Realtor at scale (ToS + legal risk + CAPTCHA).
- Asking the federal government for "all claims" (no such dataset exists centrally).
- Expecting real-time. Most authoritative sold/claims data lags 30–90 days.
- A single API that returns "every sold + every claim." It doesn't exist and won't.

---

## Part E — Minimum viable data partner stack

For a production system, this is the canonical stack:

- **Property**: ATTOM (or CoreLogic) + Regrid parcels
- **Listings**: Bridge or Trestle (MLS)
- **Flood claims**: OpenFEMA (free)
- **Other claims context**: NAIC + state DOI scrapes + NOAA + FEMA disasters
- **Risk scoring**: First Street Foundation (climate), Verisk (if you can)
- **Mortgage**: HMDA + MBA weekly apps

Total realistic budget to stand up: **$3k–$15k/month** in data licenses plus engineering.
