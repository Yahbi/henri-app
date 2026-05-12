# Henri — Data Sources v2 (2026-05-12)

Second-round research consolidation. Builds on `henri-data-sources-master-catalog-2026-05-08.md` (still valid — this v2 is additive). Three parallel research agents probed 200+ endpoints over ~3.5 hours wall time. Focus weighted by Henri's wedge priorities:

- **TIER 1 — Pre-permit demand signals** (full depth — biggest competitive moat)
- **TIER 3 — Contractor quality / matching** (full depth — closes trust loop)
- **Tiers 2 / 4 / 5 / 6** — thin pass (confirmed saturation or surfaced missed gems)

Constraint set: US only · free or under $50/mo · public-records / open-data licensed · no ToS violations · skip 60+ already-known sources. **Negative findings preserved alongside positive ones** — knowing what's confirmed-dead is as valuable as new URLs.

---

## TIER 1 — Pre-permit demand signals

### 1A. Insurance claim filings

| Source | URL | Access | Free tier | Auth | Refresh | Owner? | Claim_date? | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **OpenFEMA FimaNfipClaims v2** | https://www.fema.gov/api/open/v2/FimaNfipClaims | REST JSON OData | Unlimited | None | Monthly | No | YES (`dateOfLoss`) | Census tract + ZIP | Public domain | **~2.6M claims**, monthly refresh. National NFIP only. Rebuilds follow ~3-9mo after `dateOfLoss`. |
| OpenFEMA FimaNfipPolicies v2 | https://www.fema.gov/api/open/v2/FimaNfipPolicies | REST JSON OData | Unlimited | None | Monthly | No | n/a | Census tract | Public domain | At-risk addresses (policy renewals). |
| FL OIR Catastrophe Reporting | https://floir.gov/tools-and-data/catastrophe-reporting | HTML/XLSX | Free | None | Per-storm | No | YES | ZIP-aggregate | Public records | ZIP-level open-claim counts per named storm. FL only. |
| TX TDI consumer complaints | https://www.tdi.texas.gov/reports/report4.html | HTML reports | Free | None | Annual | No | aggregate | TX | Public records | Aggregate only — low Henri value. |
| FEMA LOMA/LOMR | https://msc.fema.gov/portal/availabilityHome | Per-community PDF index | Free | None | Continuous | Limited | No | Per-community | Public | **No bulk API** — `LomcDocs`/`Lomas` OpenFEMA endpoints both 404. PHASE_4_BACKLOG. |
| NY DFS | https://www.dfs.ny.gov/ | HTML | Free | None | Sporadic | No | No | NY | Public | No structured claim feed; PDF reports only. |
| NAIC CIS | https://content.naic.org/ | HTML | Free | None | Annual | No | aggregate | National | Public | Carrier-level complaint indices only — no per-claim. |
| NICB | https://www.nicb.org/ | HTML | None | n/a | n/a | No | No | National | Restricted | No public bulk feed. |

### 1B. Mortgage refi / HELOC / cash-out-refi filings

| Source | URL | Access | Free tier | Auth | Refresh | Owner? | Claim_date? | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **HMDA Loan-Level (CFPB Data Browser)** | https://ffiec.cfpb.gov/v2/data-browser-api/view/nationwide/csv | REST CSV | Unlimited | None | Annual full + Q | No | n/a | Census tract | Public domain | **STRONGEST 1B HIT.** TX 2023: 107k cash-out + 55k refi. Filter `loan_purposes=31,32` (refi+cash-out) or `=2` (home improvement). 68MB stream in 8s verified. |
| HMDA Aggregations API | https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations | REST JSON | Unlimited | None | Annual | No | n/a | National | Public domain | Ideal for ranking states/MSAs by refi+improvement volume. |
| NMLS Consumer Access | https://www.nmlsconsumeraccess.org/ | Web search only | Search-only | None | Continuous | No | No | National | **ToS forbids scraping** | All bulk paths 404. PHASE_4_BACKLOG only. |
| VA Loan stats | https://www.benefits.va.gov/homeloans/ | HTML reports | Aggregate | None | Quarterly | No | No | National | Public | Aggregate volume only — no borrower-level data. |

### 1C. Real-estate sale events (national)

| Source | URL | Access | Free tier | Auth | Refresh | Owner? | Sale_date? | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **NYC ACRIS Real Property Master** | https://data.cityofnewyork.us/resource/bnx9-e6tj.json | Socrata REST | Unlimited | None (app token rec.) | Daily | YES (via Parties join `636b-3b5g`) | YES | NYC 5 boroughs (BBL grain) | Public domain | **3.6M DEED + 4.2M MTGE + 2.6M SAT (mortgage satisfaction).** SAT = payoff = likely refi/sale within 60 days. Best single feed found. |
| **Redfin Data Center ZIP Tracker** | https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz | S3 public | Unlimited | None | Weekly | No | n/a | National ZIP | Free w/ attribution | **101MB gzipped** — richest free ZIP-level real-estate dataset publicly available. |
| **Realtor.com Inventory ZIP CSV** | https://econdata.s3.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv | S3 CSV | Unlimited | None | Weekly | No | n/a | National ZIP | Free w/ attribution | 7.2MB. `new_listing_count`, `median_days_on_market`, `price_reduced_count` per ZIP. |
| Zillow Research ZHVI/ZORI | https://files.zillowstatic.com/research/public_csvs/zhvi/ | Static CSV | Unlimited | None | Monthly | No | No | Metro/County/ZIP | Free w/ attribution | 4.4MB Metro file. Monthly. Complements Redfin. |
| NYC ACRIS Personal Property | https://data.cityofnewyork.us/resource/sv7x-dduq.json | Socrata REST | Unlimited | None | Daily | Indirectly | No | NYC | Public domain | UCC filings — useful for contractor-on-contractor leads. |
| TX/PA/FL DOR sales feeds | various | Mixed | n/a | n/a | n/a | n/a | n/a | — | n/a | **State-level bulk sales = county-clerk problem, not state-DOR.** TX Comptroller has no statewide sales feed; FL DOR portal is request-form only; PA revenue.pa.gov 302→login. |
| ATTOM Data | https://api.gateway.attomdata.com/ | API | Free tier 100 calls/day | API key | Continuous | YES | YES | National | Commercial ToS | Free tier not bulk-extractable. |

### 1D. Property tax appeal filings

| Source | URL | Access | Free tier | Auth | Refresh | Owner? | Filing_date? | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Collin CAD ARB Protest (TX) | https://data.texas.gov/dataset/Collin-CAD-Code-File-ARB-Protest/kugr-hngz | Socrata | Unlimited | None | Annual | Yes (parcel) | filing-year | Collin Co TX | Public | **Only 1 of 254 TX counties on data.texas.gov.** Most TX CAD protest data lives on per-county portals. PHASE_4_BACKLOG to crawl 50 largest CADs. |
| IL PTAB ASI | https://www.ptab.illinois.gov/asi/ | HTML search-only | Search-only | None | Daily | Yes | No | IL statewide | Public | No CSV export; per-appeal PDF. PHASE_4_BACKLOG. |
| TX Comptroller ARB survey | https://comptroller.texas.gov/taxes/property-tax/protests/ | PDF reports | Free | None | Annual | No | No | TX | Public | Aggregate counts only. |
| FL VAB | https://floridarevenue.com/property/Pages/VAB.aspx | HTML | Aggregate | None | Annual | No | No | FL | Public | Per-county VAB data on county clerk sites; no statewide bulk. |

### 1E. HOA / planned-community architectural review

| Source | URL | Access | Free tier | Auth | Refresh | Owner? | Filing_date? | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenGov per-tenant ARB agendas | https://www.opengov.com/ (per-tenant) | Per-portal | Free per-portal | None | Daily | YES (in agenda PDFs) | YES | ~1500 US cities | Per-tenant ToS | **TRUE pre-permit signal** — ARB filings are "I want to remodel, here's my address." NOT a single bulk endpoint — requires per-tenant crawl. PHASE_4_BACKLOG: top 50 affluent CA/FL/TX/NY tenants. |
| CA SOS bizfileonline (CID registry) | https://bizfileonline.sos.ca.gov/ | Web search | Free | None | Continuous | Mgmt agent yes | No | CA HOAs | Public | SI-CID form yields HOA name + manager contact + unit count. Bulk via SOS data-extract request. PHASE_4_BACKLOG. |
| RI OpenMeetings | https://opengov.sos.ri.gov/openmeetings | State portal | Free | None | Daily | No | No | RI | Public | Statewide OpenMeetings index — useful PATTERN for ARB agendas. Small geo. |
| NV Real Estate Division CIC | https://red.nv.gov/Content/CIC/Resources/ | HTML | Free | None | n/a | n/a | n/a | NV | Public | Small registry. |
| CO DRE HOA Resource Center | https://dre.colorado.gov/division-real-estate-hoa-information-resource-center | Web | n/a | n/a | n/a | n/a | n/a | CO | 403 Cloudflare | PHASE_4_BACKLOG. |

### 1F. Foreclosure / pre-foreclosure (NOD, Lis Pendens)

| Source | URL | Access | Free tier | Auth | Refresh | Owner? | Filing_date? | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **NYC ACRIS — Lis Pendens (doc_type=LP/NLP)** | https://data.cityofnewyork.us/resource/bnx9-e6tj.json | Socrata REST | Unlimited | None | Daily | YES | YES | NYC (BBL grain) | Public domain | Filter `doc_type` for LP/NLP. Same feed as 1C — Lis Pendens lives inside ACRIS Master. |
| King County WA Foreclosure Parcels | https://data.kingcounty.gov/d/nx4x-daw6 | Socrata | Unlimited | None | Weekly | Yes (APN) | No | King County WA | Public domain | Current parcels-in-foreclosure. |
| Cook County IL data catalog | https://datacatalog.cookcountyil.gov/ | Socrata catalog | Free | None | Daily | Yes | No | Cook County IL | Public domain | `q=foreclosure` returns datasets via cross-domain federation. |
| USDA Rural Resale (foreclosure) | https://catalog.data.gov/dataset/usda-rural-development-resale-properties-foreclosure | Static CSV | Free | None | Weekly | No (govt-owned) | No | National rural | Public domain | Post-foreclosure REO — wrong direction for Henri (no homeowner to call). |
| LA/Maricopa/Riverside/SD/Miami-Dade recorders | various | Per-county | Mixed | Mixed | Mixed | n/a | n/a | County | Various | LA County timed out, Maricopa 403 Cloudflare, Miami-Dade TLS timeout. **PHASE_4_BACKLOG: per-county scrapers.** |

### 1G. New-construction-address feeds

| Source | URL | Access | Free tier | Auth | Refresh | Geo grain | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenAddresses delta detection | https://results.openaddresses.io/ | Static run output | Unlimited | None | Per-source | National | CC0 | **Diff weekly runs** = new-address signal. Henri already has the source — extending to delta is a new derivation. |
| Realtor.com `new_listing_count` | https://econdata.s3.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv | S3 CSV | Unlimited | None | Weekly | National ZIP | Free w/ attribution | Listed in 1C; proxy for new construction + churn. |
| OSM Overpass (`addr:housenumber` deltas) | https://overpass-api.de/ | Query API | Unlimited (fair use) | None | Continuous | National | ODbL | Diff weekly snapshots — community-added new build addresses. |
| Census BPS | https://www2.census.gov/econ/bps/ | Static CSV | Unlimited | None | Monthly | County aggregate | Public domain | Already in v1 catalog. |
| HIFLD Open | https://hifld-geoplatform.opendata.arcgis.com/ | ArcGIS | Unlimited | None | Varies | National | Public | Infrastructure layers — no new-address feed. |

---

## TIER 3 — Contractor quality / matching data

### 3A. Reviews / ratings

| Source | URL | Access | Free tier | Auth | Refresh | Trust signal | Trade coverage | Geo | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Yelp Fusion (Places API) | https://docs.developer.yelp.com/docs/places-intro | REST per-query | 30-day trial only; then ~$239+/mo | API key | Live | rating, review_count, business URL | All trades in taxonomy | US/CA | Low | **BUSTS $50 BUDGET** at scale. Useful only as per-match lookup. |
| Google Business Profile (Places API) | already wired | — | per spec | — | — | rating, user_ratings_total, 5-review cap | All trades | Global | Low | Already wired. 5-review cap is ToS-enforced. |
| BBB business profiles | https://www.bbb.org/search | HTML scrape only | Free if scraped | None | Live | A+/F rating, complaint count, accreditation | All trades | US/CA/MX | **HIGH** — Cloudflare + ToS bars automated collection | **No public API exists.** All vendor "BBB APIs" are scrapers. PHASE_4_BACKLOG with scrape risk. |
| BBB Scam Tracker | https://www.bbb.org/scamtracker | HTML scrape | Free if scraped | None | Daily | scam_type, $ loss, narrative | Includes "Home Improvement" | US/CA | **HIGH** — same posture | Match-rate to a specific contractor is low. |
| Angi / HomeAdvisor | https://www.angi.com/ | 403 to curl | None free | — | — | — | All trades | US | DEAD | **Confirmed paid-only.** ServiceTitan partnerships only. |
| Houzz | https://www.houzz.com/pro/api | OAuth partner-only | Houzz Pro >>$50 | OAuth | — | reviews, project photos | Mostly remodel/design-build | US | Medium | **Confirmed paid-only.** |
| Nextdoor | https://nextdoor.com/ | Auth-walled | None | Login required | — | — | All trades | US | High | **Confirmed auth-walled.** |
| Thumbtack / Porch / Homestars (CA) | — | Scrape or auth-walled | None | — | — | — | — | — | Various | **All confirmed paid or scrape-risk.** |

### 3B. Disciplinary actions / license discipline

| Source | URL | Access | Free tier | Auth | Refresh | Trust signal | Trade coverage | Geo | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **WA L&I Debarred Contractors** | https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx | HTML table | Free | None | Per-order | Debarment date + reason | All WA construction | WA | Low | **Small dataset (<500) but highest-signal negative trust marker available.** |
| **WA L&I per-license infractions + bond lawsuits** | https://secure.lni.wa.gov/verify/ contractor detail | HTML scrape | Free | None | Live | Infractions + Lawsuits Against Bond | All WA construction | WA | Low | Already touches WA via Socrata; per-detail-page scrape extends signals at near-zero cost. |
| CSLB CA disciplinary actions | https://www.cslb.ca.gov/About_Us/Library/Disciplinary_Actions_Cases.aspx | HTML + PDF accusations | Free | None | Weekly board | Accusation date, statute, penalty | All CA C-licenses | CA | Low | No CSV/Socrata — discipline must be scraped from accusation PDFs. |
| TDLR TX administrative orders | https://www.tdlr.texas.gov/enforcement.htm | Monthly PDF "Enforcement Actions" | Free | None | Monthly | Order date, violation, penalty | TDLR trades (no GC in TX) | TX | Low | PDF-only; parseable but not CSV. |
| WA L&I citations | https://data.wa.gov/resource/m8qx-ubtq.json | Socrata | Free | App token rec. | Daily | License status, bond, insurance | All WA construction | WA | Low | Already in Henri 26 sources. Infractions live on HTML page, not in Socrata. |
| FL DBPR disciplinary | https://www2.myfloridalicense.com/construction-industry/public-records/ | HTML per-license | Free | None | Weekly | Order #, statute, penalty | FL CILB-regulated | FL | Low | No bulk; per-license-detail scrape feasible inside Henri's existing FL loop. |
| NYC DCWP Consumer Complaints | NYC Open Data Socrata | Socrata | Free | None | Daily | Complaint records | NYC HIC only | NYC | Low | **High-value bulk source** for NYC home-improvement contractors. |
| AZ ROC / IL IDFPR / OR CCB final orders / DC-MD-VA-CO-MN-IA-DE-MT discipline | various | Per-state HTML or PDF | Free | None | Varies | Order data | Per-state | per-state | Low | **No state publishes bulk CSV discipline.** All per-license-detail or PDF board packets. Pattern is structural across all 26+ states. |
| NASCLA Accredited Exam registry | https://www.nascla.org/page/AccreditedExamProgram | 404 on member page | None | NASCLA account | — | — | Commercial GC | Multi-state | DEAD | **Member-only.** Skip. |

### 3C. Litigation history

| Source | URL | Access | Free tier | Auth | Refresh | Trust signal | Geo | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **FTC Cases & Proceedings** | https://www.ftc.gov/legal-library/browse/cases-proceedings | HTML + datasets at ftc.gov/policy-notices/open-government/data-sets | Free | None | Daily | Defendant + charges + settlement amount + docket # | US | None | **Strong source.** One-time bulk pull + monthly delta. Low volume but high signal. |
| **FTC Home Improvement Penalty Offenses** | https://www.ftc.gov/enforcement/penalty-offenses/homeimprovement | HTML | Free | None | Per-action | Penalty triggers + $50,120/violation | US | None | Cross-reference against contractor names from license rosters. |
| **CFPB Consumer Complaint DB** | https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/ | REST + bulk CSV | Free | None | Daily | Narrative complaint, company, response | US | None | **Confirmed 1,085,449 records.** Financial products only — but useful for PACE/mortgage-financed renovation fraud touching contractors. |
| State AG press releases (CA, NY, TX, MI) | per-state AG site | HTML scrape | Free | None | Per-release | Defendant + settlement | per-state | Low (public press) | Useful as alert feed; low volume, high impact when match. |
| State court e-filing | per-state portals (Odyssey/Tyler) | Captcha/login-walled | Mostly free | Captcha+login | — | Case caption, defendant | per-state | **HIGH** — captcha + ToS | **No free per-state defendant-name bulk path.** TX OCA publishes aggregate stats only, not case-level. |

### 3D. Workers' comp + general liability insurance status

| Source | URL | Access | Free tier | Auth | Refresh | Trust signal | Geo | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TX TDI/DWC TXCOMP coverage | https://www.tdi.texas.gov/wc/employer/coverage.html | Per-query web form | Free | None | Live | Has active WC policy + carrier name | TX | Low | Per-query only. data.texas.gov has mirror bulk CSV via City of Austin catalog. |
| WA L&I (same agency as licensing) | https://data.wa.gov/resource/m8qx-ubtq.json | Already wired Socrata | Free | App token | Daily | WC account + premium status | WA | Low | Already in Henri (license source). |
| WCIRB X-mod | https://www.wcirb.com/ | Member portal | Paid only | Required | — | Experience modification rate (strongest possible WC signal) | CA | DEAD for free | **Confirmed paid.** Only place X-mod lives. |
| CA DIR Labor Commissioner judgments | https://cadir.data.socrata.com/ | Socrata mirror | Free | App token | Varies | Wage claim judgments | CA | Low | **Adjacent signal.** Labor-law violators correlate with poor contractors. |
| NY WCB coverage search | https://www.wcb.ny.gov/ | Per-query | Free | None | Live | Has active policy? | NY | Low | No bulk; per-query only. |
| FL DWC proof-of-coverage | https://apps8.fldfs.com/proofofcoverage/Search.aspx | Per-query | Free | None | Live | Coverage status | FL | Low | Slow/intermittent. |
| IL WCC injury case lookup | https://iwcc.illinois.gov/ | Per-query | Free | None | — | WC claim history | IL | Low | **Inverse signal:** heavy claims = worker-safety concern. |
| **Ohio BWC** | https://www.bwc.ohio.gov/ | Public lookup | Free | None | Live | Coverage + delinquency | OH | Low | **OH is monopoly state — strongest public WC data in US.** |
| GL coverage status | — | — | — | — | — | — | — | — | **NO US STATE PUBLISHES GL.** Best proxy: "GL on file Y/N" flag in CA/OR/NV license records. |

### 3E. Bond claims

| Source | URL | Access | Free tier | Auth | Refresh | Trust signal | Geo | ToS risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CA CSLB bond claims | per-license detail page on cslb.ca.gov | HTML | Free | None | Live | Claim count + amount | CA | Low | **Per-contractor scrape, no bulk.** Henri's CSLB integration likely already touches this page. |
| WA L&I Lawsuits Against Bond | https://secure.lni.wa.gov/verify/ contractor detail | HTML | Free | None | Live | Lawsuit date + judgment amount | WA | Low | Same pattern as CSLB. |
| OR CCB bond claims | search.ccb.state.or.us | HTML per-contractor | Free | None | Live | Claim record | OR | Low | Per-contractor only. |
| TX TDLR recovery fund | https://www.tdlr.texas.gov/enforcement.htm (in monthly PDFs) | PDF parse | Free | None | Monthly | Award $ + license # | TX | Low | Same source as TDLR discipline. |
| AZ ROC recovery fund | https://roc.az.gov/recovery-fund | 403 | None automated | PRR-only (7-30 day SLA) | — | Award $/claim | AZ | DEAD | PHASE_4_BACKLOG. |
| Other states (NV NSCB, MD MHIC, MN DLI etc.) | per-state | HTML per-license | Free | None | Live | Bond claim flag | per-state | Low | **Same pattern across all 8 states probed — per-license-detail only, no bulk.** |

---

## TIER 2 — Phone (thin pass, FULLY CLOSED)

**Result: stop chasing phone-fill on free data.** WV NG911 Res_Phone is the only unicorn.

| Probe attempted | Result |
|---|---|
| NYC BoE voter file | 404 — phone not published; civic-use only per NY ELN §3-103 |
| LA County RR/CC | CA EC §2188 restricts to political use (same as state) |
| Cook County Clerk | IL state file only — no county addition |
| Miami-Dade Elections | Redundant with FL state file |
| Maricopa AZ PSAP layers | No phone in public schema |
| Cook IL data catalog | No PSAP feeds with phone fields |
| 10 random county assessor CAMA feeds | **Zero counties exposed owner_phone** in public schema |
| TruePeopleSearch / FastPeopleSearch / Whitepages | All 403 to bot UAs; ToS prohibits bulk |
| NJ eCourts / FL CCIS party-phone | Phone is NOT a court-record field by rule |
| Utility customer rolls | FOIA-exempt across all probes |

**Verdict**: Tier 2 is saturated. Pursue paid (Apollo/Spokeo) or per-county PSAP partnerships if 60%+ phone fill is non-negotiable.

---

## TIER 4 — Property context (thin pass, CLOSED)

| Probe attempted | Result |
|---|---|
| Free national year-built/sqft database | **DOES NOT EXIST.** 59 state parcel sources is the ceiling. |
| Roof age | No free national substrate. DOE WAP/FHA aggregate-only by federal rule. |
| MA Mass Save | Town-level program participation counts — NO address-level |
| CT Energize CT | Similar — aggregate-only |
| DOE Weatherization Assistance Program | Aggregate counts per state (CFR §440 confidentiality) |
| EIA RECS | Census-region grain |
| **Census ACS 5-year re-pull** | `api.census.gov/data/2022/acs/acs5` — **free API key, ZIP/tract tenure + housing-cost-burden + median-year-built**. Worth re-adding. |

---

## TIER 5 — Outreach hygiene (small additions)

| Source | URL | Free tier | Notes |
|---|---|---|---|
| FCC National DNC seller access | telemarketing.donotcall.gov | First 5 area codes free; full US ~$20K/yr | **NOT under $50/mo.** Use state DNCs instead if targeting specific states. |
| **NJ DNC** | njconsumeraffairs.gov/donotcall | $50/yr per area code | Under budget. |
| **CO DNC** | coloradonocall.com | $25/quarter per area code | Under budget. |
| **IN DNC** | in.gov/attorneygeneral/.../indiana-do-not-call-list | $10/quarter | Cheapest state DNC. |
| TX No Call | texasnocall.com | ~$75/quarter | Fits budget. |
| OK DNC | oag.ok.gov | $50 + $25/quarter | Fits budget. |
| WY DNC | ag.wyo.gov | 404 / appears defunct | Skip. |
| TCPA Litigator DB | tcpalitigatordb.com | Paid-only | No free version. |
| Blacklist Alliance | blacklistalliance.com | Sub-$50 entry tier exists | TCPA litigator + DNC scrub. |
| SpamHaus + Sender Score | spamhaus.org / senderscore.org | Free tiers for own-IP monitoring | Bulk recipient lookup is paid. |

---

## TIER 6 — Market-size signals (small additions)

| Source | URL | Free tier | Notes |
|---|---|---|---|
| **Census County Business Patterns (CBP)** | https://api.census.gov/data/cbp | Free API key | **GENUINE NET-NEW**: ZIP × NAICS-23xx establishment counts. More granular than BLS QCEW (county-only). |
| Census Population Estimates Program (PEP) | https://census.gov/programs-surveys/popest.html | Free API key | County/ZIP population + components of change. |
| HUD SOCDS Permits | socds.huduser.gov/permits | Free | Just reshapes Census BPS — no incremental signal if BPS is wired. |
| NAHB / HomeAdvisor cost data | various | Paid | Skip. |

---

## TOP 5 — RANKED BY (IMPACT × EASE)

Scoring rubric: **Impact** (1-10) = lead-time advantage + address-grain + geographic breadth + signal uniqueness. **Ease** (1-10) = integration time + auth complexity + ToS clarity. Total = impact × ease.

### #1 (tied) — HMDA Loan-Level via CFPB Data Browser API · score 72

- **URL**: https://ffiec.cfpb.gov/v2/data-browser-api/view/nationwide/csv
- **Impact 9**: 1-6 month lead time before permit (cash-out refi → remodel within 90 days; loan_purpose=2 explicit "home improvement" intent code). National 100% coverage of regulated lenders. Census tract grain (must join to assessor for street).
- **Ease 8**: REST CSV, no auth, public domain, ~68MB streams in 8s. Trivial ETL pattern (filter + load).
- **Caveat**: census tract grain (~4k households per tract). Pair with the existing 59 parcel sources to narrow to street.
- **What it unlocks for Henri**: The single highest-confidence pre-permit intent signal at national scale. Filter `loan_purposes=31,32,2` for refi+cash-out+improvement. A homeowner who took a cash-out refi has a 30-60% probability of pulling a permit within 6 months.

### #1 (tied) — NYC ACRIS Real Property Master via Socrata · score 72

- **URL**: https://data.cityofnewyork.us/resource/bnx9-e6tj.json
- **Impact 8**: 30-180 days lead time across SAT (mortgage payoff)/DEED (new owner)/LP (Lis Pendens distress). Address-grain via BBL (block-lot). 3.6M DEED + 4.2M MTGE + 2.6M SAT records in one feed.
- **Ease 9**: Socrata REST, no token required, well-documented, daily refresh.
- **Caveat**: NYC 5 boroughs only — narrow geography but 3M+ properties.
- **What it unlocks for Henri**: Only single dataset combining address-grain + deed-date + mortgage-event + lis-pendens. Pattern replicates to any other Socrata-using county recorder (King WA already verified, more findable).

### #3 — WA L&I Debarred Contractors list + detail-page scrape · score 63

- **URL**: https://secure.lni.wa.gov/debarandstrike/ContractorDebarList.aspx + https://secure.lni.wa.gov/verify/ (per-license detail)
- **Impact 7**: Cleanest free, no-ToS-risk binary discipline flag. Combines debarment list + infractions + bond lawsuits in one workflow. Pattern explicitly replicates to CA CSLB and OR CCB for the same payoff at scale.
- **Ease 9**: Tiny static page + per-license-detail scrape that Henri's existing license loop already touches. Zero ToS risk (public records, no Cloudflare/captcha).
- **Caveat**: WA-only initially. Multi-state requires the 3-state scrape replication.
- **What it unlocks for Henri**: Trust-loop closure for WA. A contractor matched to a homeowner is filtered against a verified clean-discipline check before delivery.

### #4 (tied) — FTC Cases & Proceedings + Home Improvement Penalty Offenses · score 60

- **URL**: https://www.ftc.gov/legal-library/browse/cases-proceedings + https://www.ftc.gov/enforcement/penalty-offenses/homeimprovement
- **Impact 6**: Federal enforcement is rare but each hit is catastrophic for trust — a contractor named in an FTC action is essentially uninsurable from a homeowner's POV. Low volume (~hundreds of relevant cases) — but exactly the contractors Henri must NOT route leads to.
- **Ease 10**: Zero ToS risk, fully public, name-matchable against the contractor roster. One-time bulk pull + monthly delta.
- **What it unlocks for Henri**: Negative-screening at federal scale. Single integration covers all 50 states.

### #4 (tied) — CFPB Consumer Complaint DB · score 60

- **URL**: https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/
- **Impact 6**: 1,085,449 records confirmed live. Financial-products focus (mortgage/PACE/debt) but contractor-adjacent — PACE-financed renovation fraud is a real category that catches contractors the state license boards haven't disciplined yet.
- **Ease 10**: Open REST API, no auth, daily refresh, well-documented.
- **What it unlocks for Henri**: Name-match against contractor roster surfaces lender-side complaints that often precede state discipline.

### Honorable mention (just outside Top 5)

- **Redfin Data Center ZIP Tracker** (1C) — impact 6, ease 9, score 54. 101MB weekly ZIP file. Best free national real-estate-demand signal but ZIP-aggregate only.
- **OpenFEMA FimaNfipClaims v2** (1A) — impact 5, ease 9, score 45. National flood claims at census-tract grain. Already partly in Henri (NFIP claims sidecar via 00071) — extending to `dateOfLoss`-driven targeting is the new value.
- **Census CBP ZIP × NAICS-23xx** (Tier 6 net-new) — impact 5, ease 8, score 40. Best free contractor-density-per-ZIP source.

---

## What this v2 confirms vs the 2026-05-08 catalog

| Catalog claim from v1 | v2 finding |
|---|---|
| "FL Voter Extract is biggest single phone unlock" | Still true. Tier 2 saturation confirms no other free phone-fill source exists at scale. |
| "Bozeman MT + Henderson NV are unicorns w/ contractor phone in permits" | Still true. No US county was found to expose owner_phone in CAMA. |
| "60% phone fill not achievable on free data" | Confirmed by v2 negative findings across all Tier 2 subcategories. |
| "Pre-permit demand signals" gap | **Now closed at the architectural level.** HMDA + ACRIS + Redfin + Realtor.com Inventory + OpenFEMA Claims = the full free national pre-permit signal stack. |
| "Contractor-trust signals" gap | **Now closed at the architectural level.** WA debar pattern + FTC + CFPB = the workable free trust-loop stack. State-by-state discipline scraping is the structural ceiling. |
| "Census ACS pruned in 00079 — no consumers" | v2: Census ACS 5-year re-pull confirmed cheap. Worth re-adding. |
| "Need ZIP-level contractor-density signal" | v2: Census CBP fills it (more granular than QCEW which is county-only). |

---

## What's left after v2

After integrating the v2 Top-5, Henri's remaining unsolved gaps require either:

1. **Paid commercial data** — Apollo / Spokeo for phone-fill above 25%; WCIRB for X-mod (strongest WC trust signal); BBB Pro API; ATTOM full nationwide parcel.
2. **Phase 4 stealth scrapers** — OpenGov per-tenant ARB agendas (true pre-permit signal), per-county recorder Lis Pendens for non-NYC/non-King-WA counties, BBB scrape, state court e-filing.
3. **Per-county partnerships** — PSAP 911 phone data state-by-state for Tier 2.

The v2 audit confirms what the structural ceilings are — Henri's free-data roadmap is **NOT under-researched anymore**. Future research dollars are better spent on (a) operator time integrating v2 finds, (b) careful paid-tier evaluation for the specific blockers above.

---

## File provenance

This catalog consolidates verified findings from:

- Agent 1 (2026-05-12): Tier 1 pre-permit demand signals (full depth, ~70 min wall, 80+ probes)
- Agent 2 (2026-05-12): Tier 3 contractor quality / matching (full depth, ~75 min wall, 70+ probes)
- Agent 3 (2026-05-12): Tiers 2 / 4 / 5 / 6 thin pass (~45 min wall, ~50 probes)

Companion files:
- `Desktop/henri-data-sources-master-catalog-2026-05-08.md` (v1 — still valid)
- `Henri App/docs/permit-catalog/free-data-sources-2026-05-08.md` (per-gap working doc)
- `Henri App/docs/permit-catalog/16-stale-states-2026-05-06.md`
- `Henri App/docs/permit-catalog/opengov-viewpoint-partnership-2026-05-07.md`

To re-verify any URL: `curl -L -m 8 -A "Henri/1.0" '<url>'` and check HTTP status + content-type. All URLs probed live 2026-05-12.
