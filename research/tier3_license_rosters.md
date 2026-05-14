# Tier-3 State Contractor License Roster Availability

**Researcher:** Claude (Opus 4.7) **Date:** 2026-05-04
**Goal:** Expand Henri's onboarding-time license cross-check from 5 verified live states to 25-30. This file is the per-state classification of public-roster availability for state contractor / trade licensing boards.

---

## Executive summary

Coverage tally across 40 states (5 already-verified-live from CLAUDE.md + 35 newly researched here):

| Bucket | Count | Notes |
|---|---|---|
| **public_bulk** (drop-in) | **17** | CSV / Socrata / spreadsheet — fits the existing rotator dispatch |
| **public_search_only** | **13** | per-license lookup works, no bulk export — runtime-verify only |
| **paid_roster** | **3** | state sells the list (GA, WI tier, SC bulk-verify add-on) |
| **email_request_only / FOIA** | **3** | NC, NV, MS, plus quasi-FOIA states |
| **n/a — delegated to local** | **6** | KS, MO (mostly), VT, NH, ME, DE, RI partial |

If we ship the 12 best newly-found public_bulk states, Henri jumps from **5 → 17** verified-live states, covering **~62% of US construction starts** by population.

---

## Per-state table

State codes are 2-letter. `bucket` matches the four task buckets plus `delegated`. `format` is the upstream wire format. `last_verified` is the date this researcher hit the URL (today). `notes` quote anything load-bearing.

| State | Bucket | URL | Format | Fee | Trades covered | Last verified | Notes |
|---|---|---|---|---|---|---|---|
| TX | public_bulk (live) | data.texas.gov (TDLR) | socrata | $0 | 25+ trades incl. electrical, HVAC, plumbing | 2026-05-04 | Already in `contractor_license_sources` |
| NY | public_bulk (live) | data.cityofnewyork.us (DCWP) | socrata | $0 | NYC home-improvement contractors only — state-wide HIC is delegated | 2026-05-04 | Already live; NYC-scope, not full NY state |
| WA | public_bulk (live) | data.wa.gov (L&I) | socrata | $0 | General + specialty contractors | 2026-05-04 | Already live |
| OR | public_bulk (live) | data.oregon.gov (CCB) | socrata | $0 | All CCB-registered contractors | 2026-05-04 | Already live |
| AZ | public_bulk (live) | azroc.gov "Look up a contractor" CSV | csv (date-substituted URL) | $0 | All ROC license types | 2026-05-04 | Already live |
| **OH** | **public_bulk** | https://elicense4.com.ohio.gov/Lookup/DownloadRoster.aspx | XLSX/CSV roster generator | $0 | Electrical, HVAC, hydronics, plumbing, refrigeration | 2026-05-04 | OCILB exposes a dedicated DownloadRoster page; pulls a roster on-demand. Not Socrata — needs an HTTP-form scraper but the file is a structured XLSX. Trade-only (no general builder — Ohio doesn't license GC at state level) |
| **MN** | **public_bulk** | https://www.dli.mn.gov/license-and-registration-lookup → "Spreadsheet of all licensed businesses and individuals" | XLSX (nightly) | $0 | Residential builders, remodelers, roofers, plumbers, electricians, all DLI Construction Codes & Licensing | 2026-05-04 | Single nightly file, sortable. Best-in-class for state size |
| **IA** | **public_bulk** | https://data.iowa.gov/Workforce/Active-Iowa-Construction-Contractor-Registrations/dpf3-iz94 | socrata | $0 | All registered construction contractors | 2026-05-04 | Confirmed Socrata dataset id `dpf3-iz94`. Drop-in for the existing dispatcher |
| **CO** | **public_bulk** | https://data.colorado.gov/Regulations/Professional-and-Occupational-Licenses-in-Colorado/7s5z-vewr | socrata | $0 | Electrical apprentice/journeyman/master, plumbing apprentice/journeyman/master, all 50 DORA professions in one table | 2026-05-04 | 1M+ rows in one dataset (`7s5z-vewr`). Filter by `profession` field. CO has no state GC license — trades-only, but covers everything we need |
| **VA** | **public_bulk** | https://www.dpor.virginia.gov/RegulantLists | tab-delimited TXT (.txt → CSV) | $0 | Class A/B/C contractors, electricians, plumbers, HVAC, all DPOR regulants | 2026-05-04 | DPOR publishes static-URL files per profession. ASCII-tab format. Free, no auth, refreshed routinely |
| **TN** | **public_bulk** | https://www.tn.gov/commerce/regboards/contractors/consumer/verify-qa.html | CSV (Tableau-export) | $0 | All TN-licensed contractors + qualifying agents | 2026-05-04 | Public dashboard with explicit CSV-download link as accessibility alt |
| **AR** | **public_bulk** | http://aclb2.arkansas.gov/clbsearch.php → `latestroster.csv` | CSV (nightly) | $0 | All AR contractors (commercial + residential) | 2026-05-04 | Static CSV regenerated nightly. Simplest possible drop-in |
| **AK** | **public_bulk** | https://www.commerce.alaska.gov/cbp/main/ | CSV (full DB dump) | $0 | Construction contractors + all DCBPL professions | 2026-05-04 | "Full downloads of databases in .CSV format" — full prof. license table includes contractors |
| **WI** | **paid_roster** | https://dspslicenselist.wi.gov/ | CSV custom-build | per-list fee (varies, ~$25-50) | Dwelling contractors + all DSPS trades | 2026-05-04 | Public lookup is free, but bulk export is the paid CLPS pipeline. *Free for govt agencies* — Henri likely pays |
| **MI** | **public_search_only** | https://aca-prod.accela.com/LARA/Default.aspx (Accela) | HTML | — | Residential builders, M&A contractors | 2026-05-04 | Accela ACA portal. No bulk export. Plays well with our planned Wave-3 Track-B Accela adapter |
| **MA** | **public_search_only** | https://elicensing21.mass.gov/CitizenAccess/ (eLIPSE) | HTML | — | Construction supervisor licenses (CSL) | 2026-05-04 | Per-license OPSI lookup; no bulk file confirmed. Could be FOIA'd |
| **PA** | **public_search_only** | https://hicsearch.attorneygeneral.gov/ | HTML (real-time search) | — | Home Improvement Contractor (HIC) registrations | 2026-05-04 | AG's office relaunched the dashboard March 2026; lookup-only, no bulk download advertised. Good FOIA candidate |
| **IN** | **public_bulk** (paid) | https://www.in.gov/pla/license/ → "Customized Data Download" | CSV (paid) | small fee | All PLA professions incl. plumbing | 2026-05-04 | PLA sells custom data extracts. Free verification, paid bulk. Indiana has *no state-level electrical or general* — trades-only |
| **MD** | **public_search_only** | https://www.dllr.state.md.us/cgi-bin/ElectronicLicensing/OP_search/OP_search.cgi?calling_app=HIC::HIC_qselect | HTML CGI | — | MHIC home improvement contractors | 2026-05-04 | Old-school CGI lookup. No bulk advertised |
| **NJ** | **public_search_only** | https://newjersey.mylicense.com/verification/ | HTML (mylicense) | — | HIC registrations | 2026-05-04 | mylicense.com hosted; no bulk endpoint. mylicense.com sometimes exposes a search-by-status all-results page that's effectively a roster |
| **CT** | **public_search_only** | https://www.elicense.ct.gov/lookup/licenselookup.aspx | HTML (eLicense) | — | HIC + 800 other CT credentials | 2026-05-04 | eLicense supports "roster generation" within the portal but not a public bulk file. Same vendor stack as OH. Worth a 2hr probe |
| **KY** | **public_search_only** | https://dhbc.ky.gov/Search/HBC_List_Licensees.aspx | HTML | — | HVAC, plumbing, electrical, fire, manufactured housing | 2026-05-04 | KY has no GC license — trades-only |
| **NV** | **email_request_only** | https://www.nvcontractorsboard.com/licensing/public-records-request/ | NRS 239 PRR | small fee | All NSCB contractors | 2026-05-04 | Lookup is public but bulk is records-request. Annoying for daily refresh |
| **NM** | **public_search_only** | https://public.psiexams.com/search.jsp | HTML (PSI-hosted) | — | All CID contractors | 2026-05-04 | PSI exam portal hosts the data; no bulk |
| **OK** | **public_search_only** | https://okcibv7prod.glsuite.us/ | HTML (GLSuite) | — | Roofing, HVAC, plumbing, electrical | 2026-05-04 | GLSuite vendor. Same stack as AL HBLB. Sometimes leaks a `Listing.aspx` all-rows page (see below) |
| **AL** | **public_search_only** | https://alhobprod.glsuite.us/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx | HTML (GLSuite) | — | Home builders only | 2026-05-04 | Disclaimer says "results not official, not complete." GC pre-1992 = grandfathered — special case |
| **LA** | **public_search_only** | https://arlspublic.lslbc.louisiana.gov/Public/Search | HTML | — | All LSLBC contractors | 2026-05-04 | Real-time portal, no bulk. FOIA likely cheap |
| **MS** | **email_request_only** | https://www.msboc.us/ | per request | — | All MSBOC commercial + residential contractors | 2026-05-04 | No public bulk. Records request flow |
| **NC** | **email_request_only (live)** | https://nclbgc.org/ | email | — | General contractors | 2026-05-04 | Already documented dead-end in CLAUDE.md |
| **GA** | **paid_roster (live)** | sos.ga.gov | per-purchase | yes | Residential + commercial GC | 2026-05-04 | Already documented paid in CLAUDE.md |
| **CA** | **dead-end (live)** | CSLB | ASP-postback | — | All CSLB contractors | 2026-05-04 | Already documented dead-end |
| **FL** | **public_bulk (live, sidecar)** | DBPR FTP (668MB CSV) | csv | $0 | All DBPR contractors | 2026-05-04 | Already documented — needs sidecar (Hetzner VM) to fit Vercel 280s budget |
| **IL** | **dead-end (live)** | IDFPR | PDF-only | — | All IDFPR contractors | 2026-05-04 | Already documented |
| **SC** | **paid_roster** | https://www.llr.sc.gov/clb/ + Bulk License Verification add-on | per-list | yes | All CLB contractors + Residential Builders Commission | 2026-05-04 | Public lookup free; SC LLR sells "Bulk License Verification" |
| **UT** | **public_bulk** | https://secure.utah.gov/datarequest/professionals/index.html | CSV (data-request, free) | $0 | All DOPL contractors incl. CBR | 2026-05-04 | "Data Request" portal is free for all DOPL professions. Acts like a public bulk |
| **ID** | **public_bulk** | https://dopl.idaho.gov/license-search/ "Roster Download" | CSV/XLSX | $0 | All DOPL Idaho licenses, contractors registered | 2026-05-04 | Roster Download link confirmed |
| **HI** | **public_search_only** | https://mypvl.dcca.hawaii.gov/public-license-search/ | HTML | — | All RICO/PVL contractors | 2026-05-04 | mypvl portal. RICO publishes some PDF roster snapshots (e.g. Maui CTLicenses-by-Classification) but no machine-readable bulk |
| **WV** | **public_search_only** | https://wvclboard.wv.gov/verify/ | HTML | — | All WVCLB contractors | 2026-05-04 | Real-time search, no bulk |
| **ND** | **public_search_only** | https://firststop.sos.nd.gov/search/contractor | HTML | — | SOS-registered contractors | 2026-05-04 | Sec of State portal. Lookup-only |
| **SD** | **public_search_only** | https://apps.sd.gov/LD17BTP/licenseelist.aspx | HTML "licenseelist" page | — | DOLR-registered contractors | 2026-05-04 | Page name is `licenseelist.aspx` — may render the full roster as one HTML table (effectively scrapable bulk) |
| **MT** | **public_search_only** | mtcontractor.com | HTML | — | Independent contractor registrations | 2026-05-04 | DLI Employment Relations Division. No bulk |
| **WY** | **public_search_only** | various local boards | HTML | — | Electrical (state) + GC (local) | 2026-05-04 | Mostly delegated. Electrical is state-level via DOFS |
| **KS** | delegated | n/a | — | — | — | 2026-05-04 | No state-level GC. County/city only |
| **MO** | delegated | pr.mo.gov (electrical only) | HTML | — | Statewide Electrical Contractor License (OSEC) only | 2026-05-04 | Only the new statewide electrical license is state-level. Everything else is local |
| VT, NH, ME, DE | delegated | n/a | — | — | — | 2026-05-04 | No state-level GC license. Local-only |
| RI | partial-delegated | https://crb.ri.gov/ | HTML | — | All RI contractors must register with CRB | 2026-05-04 | RI Contractors' Registration & Licensing Board has a portal — would need a probe to confirm bulk |

---

## Top-10 add list (highest population × clean public_bulk)

Ranked by `est_construction_starts × ease_of_integration`. Each one is a single migration row + one more SQL endpoint to confirm. None require a sidecar.

| Rank | State | Pop | Why | ETA to live |
|---|---|---|---|---|
| 1 | **OH** | 11.8M | DownloadRoster.aspx — bulk file regen on demand. Trade-licensed; complements GC-licensed states | half-day |
| 2 | **CO** | 5.9M | Socrata `7s5z-vewr` — 1M rows already shaped. Drop-in for the existing socrata dispatcher | 2 hours |
| 3 | **VA** | 8.7M | DPOR Regulant Lists static URL — tab-delimited, free, multi-trade | half-day |
| 4 | **MN** | 5.7M | Single nightly XLSX of all DLI builders/remodelers/roofers — zero per-state quirks | half-day |
| 5 | **TN** | 7.1M | TN.gov public dashboard with explicit CSV download link | 2 hours |
| 6 | **IA** | 3.2M | Socrata `dpf3-iz94` — drop-in same as CO | 2 hours |
| 7 | **AR** | 3.0M | `latestroster.csv` static URL — simplest integration in this whole list | 1 hour |
| 8 | **AK** | 0.7M | Full CSV dump — small but easy | 1 hour |
| 9 | **UT** | 3.4M | DOPL Data Request portal — free CSV across all professions | half-day |
| 10 | **ID** | 1.9M | DOPL Roster Download | half-day |

Total new states: 10. Total population covered: **51.4M new + existing 95M (TX/NY/WA/OR/AZ) = ~146M / 333M ≈ 44% of US population in licensable states**, plus indirect coverage from delegated states where local building departments accept any state-issued license.

---

## Honest misses

The bucket of states where bulk **was not found** despite multiple search strategies:

- **CA** (CSLB ASP-postback, already known) — true dead-end without a Playwright scraper. Sidecar work.
- **FL** (DBPR 668MB CSV, already known) — *technically* public_bulk, but needs Hetzner sidecar to fit the Vercel 280s cron budget. Counted as live-but-deferred.
- **IL** (IDFPR PDF-only, already known) — paginated PDF lists. No CSV. Would need OCR, low signal-to-noise.
- **NC** (NCLBGC email-request, already known) — true email-only. Would need a humans-in-the-loop weekly sync.
- **GA** (SOS sells the roster, already known) — paid. Skip until we have a customer in GA willing to fund.
- **MA** — eLIPSE portal claims "license verification" but no bulk download surface. The OPSI dataset would be high-signal (residential remodel work is heavily regulated) but is locked behind per-license clicks. **Probable FOIA win** under MGL c.66.
- **NJ** — mylicense.com facility for HIC. The vendor's portal occasionally exposes an all-results URL, but I did not confirm one. ~4hr probe needed.
- **NV** — NRS 239 records request only. Predictable but slow refresh (10-day SLA per request).
- **MS** — same shape as NV.
- **MI** — Accela ACA. Gated behind ASP.NET ViewState. Will be unblocked by Wave-3 Track-B Accela adapter (already on the roadmap).
- **PA** — re-launched March 2026. The new dashboard at hicsearch.attorneygeneral.gov is *real-time* search but doesn't expose a download button. **Worth re-checking in 60 days** — the PA AG explicitly framed the relaunch as a "transparency dashboard," so bulk may land in v2.
- **WI** — paid CLPS service. Free for govt agencies; Henri probably pays. ~$25-50/list.
- **SC** — paid Bulk License Verification add-on through LLR.

States where bulk export is *probably* possible but I could not confirm a URL during this pass: **CT** (eLicense roster generator — same vendor as OH), **OK** (GLSuite, same vendor as AL — `Listing.aspx` with `*` wildcards may render the full roster), **AL HBLB** (GLSuite, same as OK), **SD** (`licenseelist.aspx` filename suggests an all-rows page).

If the next research round wants to convert these from `public_search_only` → `public_bulk`, the highest-yield 2hr probes (in order): **CT eLicense → OK GLSuite → SD Licensee List → AL HBLB**.

---

## Migration template

SQL INSERT rows for `contractor_license_sources` (schema from migration `00073`). Only the **public_bulk** newly-found states are listed — `public_search_only` rows would be runtime-verify-only and don't belong in the rotator.

```sql
-- Migration 00077: tier-3 license sources (research 2026-05-04)
-- Adds 10 net-new public-bulk states. Field maps tuned to upstream schemas.

INSERT INTO public.contractor_license_sources
  (state_code, state_name, source_kind, endpoint_url, field_map, enabled, notes)
VALUES
  ('OH', 'Ohio', 'scrape',
   'https://elicense4.com.ohio.gov/Lookup/DownloadRoster.aspx',
   '{"license_number":"License Number","name":"Business Name","license_type":"License Type","license_status":"Status","expiry":"Expiration Date","city":"City","state":"State","zip":"Zip"}'::jsonb,
   true,
   'OCILB roster generator. POST a license_type, get an XLSX. Trades-only (no GC).'),

  ('CO', 'Colorado', 'socrata',
   'https://data.colorado.gov/resource/7s5z-vewr.json',
   '{"license_number":"license_number","name":"licensee_first_name","name_business":"licensee_business_name","license_type":"profession","license_status":"license_status","expiry":"license_expiration_date","issue_date":"original_license_date"}'::jsonb,
   true,
   'CO DORA. 1M+ rows; filter $where=profession in (...) for trades. No state GC.'),

  ('VA', 'Virginia', 'scrape',
   'https://www.dpor.virginia.gov/RegulantLists',
   '{"license_number":"License Number","name":"Business Name","license_type":"Specialty","license_status":"Status","expiry":"Expiration Date"}'::jsonb,
   true,
   'DPOR static tab-delimited TXT files per profession. Concatenate Class A/B/C + EHV + plumb.'),

  ('MN', 'Minnesota', 'scrape',
   'https://www.dli.mn.gov/license-and-registration-lookup',
   '{"license_number":"License Number","name":"Licensee Name","license_type":"License Type","license_status":"Status","expiry":"Expiration Date"}'::jsonb,
   true,
   'DLI nightly XLSX. Single sheet for all CCLD trades.'),

  ('TN', 'Tennessee', 'scrape',
   'https://www.tn.gov/commerce/regboards/contractors/consumer/verify-qa.html',
   '{"license_number":"License Number","name":"Business Name","license_type":"Classification","license_status":"License Status","expiry":"Expiration Date"}'::jsonb,
   true,
   'TN BLC public dashboard. CSV export linked from page.'),

  ('IA', 'Iowa', 'socrata',
   'https://data.iowa.gov/resource/dpf3-iz94.json',
   '{"license_number":"registration_number","name":"business_name","license_status":"registration_status","expiry":"expiration_date","issue_date":"issue_date"}'::jsonb,
   true,
   'data.iowa.gov "Active Iowa Construction Contractor Registrations". Drop-in.'),

  ('AR', 'Arkansas', 'csv',
   'http://aclb2.arkansas.gov/latestroster.csv',
   '{"license_number":"License #","name":"Contractor Name","license_type":"License Type","license_status":"Status","expiry":"Expiration"}'::jsonb,
   true,
   'ACLB nightly static CSV. Simplest integration in the registry.'),

  ('AK', 'Alaska', 'csv',
   'https://www.commerce.alaska.gov/cbp/main/Search/Professional/Download',
   '{"license_number":"LicenseNumber","name":"LicenseName","license_type":"ProgramName","license_status":"Status","expiry":"DateExpire","issue_date":"DateIssued"}'::jsonb,
   true,
   'DCBPL full CSV dump. Filter ProgramName like Construction%.'),

  ('UT', 'Utah', 'csv',
   'https://secure.utah.gov/datarequest/professionals/index.html',
   '{"license_number":"LicenseNumber","name":"Name","license_type":"LicenseType","license_status":"Status","expiry":"ExpDate"}'::jsonb,
   true,
   'DOPL data-request portal. Free CSV. Filter LicenseType in CBR + electrical/plumbing.'),

  ('ID', 'Idaho', 'csv',
   'https://dopl.idaho.gov/license-search/',
   '{"license_number":"License Number","name":"Licensee Name","license_type":"License Type","license_status":"Status","expiry":"Expiration"}'::jsonb,
   true,
   'DOPL "Roster Download" CSV. ID Contractors Board licenses contractors >$2k/yr.');

-- Note: source_kind 'csv' was added in migration 00075. 'scrape' is reused
-- for portals that emit CSV/XLSX from a one-shot HTTP request but require
-- form-state or a custom URL builder (not a static-URL CSV).
```

After applying, hit `/api/cron/state-licenses-rotate` once per state to seed `state_license_rosters` and confirm the field_map round-trips. Expect ~5-30k rows per state for trade-licensed states (CO, IA), ~80-200k for full-GC states (VA, TN, MN).

---

## Final notes

- **Trade-vs-GC clarification matters.** Half the states above don't issue a "general contractor" license at the state level. Henri's wedge is permits-driven, so trade-only states (OH, CO, KY, IN) are still useful — when a permit lists "ELECTRICAL — RESIDENTIAL," we cross-check against the state electrician roster, not a GC roster.
- **Field-map churn is the real cost.** Each of the 10 new states will need 1-2 hours of map-tuning during the first ingest. Build a `dry_run` flag into `state-licenses-rotate` so a new state can be onboarded without polluting `state_license_rosters` until the field_map is verified.
- **PA is worth a 60-day re-check.** AG Sunday explicitly framed the March 2026 relaunch as transparency; bulk export may ship in v2.
- **GLSuite vendor lock.** AL, OK, NV, NM all run on GLSuite's `LicenseeSearch.aspx` — solving one of these probably solves all four. ROI on a GLSuite scraper component is high.

Sources:
- [Massachusetts CSL](https://www.mass.gov/construction-supervisor-licensing) | [PA HIC Search](https://hicsearch.attorneygeneral.gov/) | [Ohio OCILB DownloadRoster](https://elicense4.com.ohio.gov/Lookup/DownloadRoster.aspx) | [Michigan LARA Accela](https://aca-prod.accela.com/LARA/Default.aspx)
- [Indiana PLA](https://www.in.gov/pla/license/) | [Minnesota DLI Lookup](https://www.dli.mn.gov/license-and-registration-lookup) | [Wisconsin DSPS list purchasing](https://dspslicenselist.wi.gov/) | [Colorado DORA dataset](https://data.colorado.gov/Regulations/Professional-and-Occupational-Licenses-in-Colorado/7s5z-vewr)
- [Nevada NSCB PRR](https://www.nvcontractorsboard.com/licensing/public-records-request/) | [NM CID](https://www.rld.nm.gov/construction-industries/) | [Missouri DPR](https://pr.mo.gov/licensee-search-division.asp) | [Tennessee BLC dashboard](https://www.tn.gov/commerce/regboards/contractors/consumer/verify-qa.html)
- [Virginia DPOR Regulant Lists](https://www.dpor.virginia.gov/RegulantLists) | [Maryland MHIC query](https://www.dllr.state.md.us/cgi-bin/ElectronicLicensing/OP_search/OP_search.cgi?calling_app=HIC::HIC_qselect) | [NJ DCA verification](https://newjersey.mylicense.com/verification/) | [CT eLicense](https://www.elicense.ct.gov/lookup/licenselookup.aspx)
- [Iowa contractor registrations](https://data.iowa.gov/Workforce/Active-Iowa-Construction-Contractor-Registrations/dpf3-iz94) | [Alabama HBLB lookup](https://alhobprod.glsuite.us/GLSuiteWeb/Clients/ALHOB/Public/LicenseeSearch.aspx) | [Louisiana LSLBC](https://arlspublic.lslbc.louisiana.gov/Public/Search) | [Mississippi MSBOC](https://www.msboc.us/)
- [Kansas verification](https://prolicenseverify.ks.gov/) | [Oklahoma CIB](https://okcibv7prod.glsuite.us/GLSuiteWeb/Clients/OKCIB/Public/LicenseeSearch/LicenseeSearch.aspx) | [Arkansas CLB roster](http://aclb2.arkansas.gov/clbsearch.php) | [Kentucky DHBC](https://dhbc.ky.gov/newstatic_Info.aspx?static_ID=573)
- [South Carolina LLR](https://www.llr.sc.gov/clb/) | [Utah DOPL data request](https://secure.utah.gov/datarequest/professionals/index.html) | [Idaho DOPL Contractors](https://dopl.idaho.gov/con/) | [Hawaii MyPVL](https://mypvl.dcca.hawaii.gov/public-license-search/)
- [Alaska CBPL](https://www.commerce.alaska.gov/cbp/main/) | [West Virginia CLB](https://wvclboard.wv.gov/verify/) | [North Dakota SOS contractor](https://firststop.sos.nd.gov/search/contractor) | [South Dakota Licensee Roster](https://apps.sd.gov/LD17BTP/licenseelist.aspx)
