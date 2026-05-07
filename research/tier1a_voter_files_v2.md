# Tier 1.A Voter-File Inventory v2 — Phone+Address Verification

**Generated:** 2026-05-04
**Scope:** 9 target states (AR, AK, CO, MI, OK, WA, UT, DE, GA). NC + OH already shipped.
**Hard requirement:** PUBLIC bulk extract must include BOTH `phone` AND `mailing_address`,
parseable format (CSV/TXT/TSV/ZIP), <$300 fee or free, no per-row API auth.

---

## Executive Summary

**2 of 9 fully verified · 1 partial (opt-in phone) · 6 confirmed misses.**

| Tier | States | Action |
|---|---|---|
| Verified hit (download/order today) | **AR, CO** | Submit forms now; CSV ships with phone + mailing addr |
| Partial — phone is opt-in only | **WA** | Pull free CSV; phone fill-rate will be low (~10-20%) but legal and clean |
| Confirmed miss — phone excluded by statute or pricing | **AK, MI, OK, UT, DE, GA** | Skip; no path to phone-fill via voter file |

The phone-fill score-cap unlock from this batch is materially smaller than NC/OH delivered.
Net new states with rich phone coverage: **AR, CO** (~5.0M registered voters combined).
WA adds ~5M voters at low phone-fill, still useful for address validation.

---

## Per-State Verification Table

| State | Status | URL | Format | Phone? | Mailing addr? | Fee | Records | Notes |
|---|---|---|---|---|---|---|---|---|
| **AR** | HIT (form-required) | https://www.sos.arkansas.gov/uploads/elections/Data%20Request%20Form.pdf | CSV (ASCII, comma-delimited, double-quoted) | YES | YES | $2.50 per file | ~1.8M | VRVH file (Voter Registration + Vote History combined) explicitly contains "Voter ID, county, voter name, address (residential and/or mailing), phone number, DOB, precinct, district, party, last voted." Section A+B form + payment. |
| **AK** | MISS | https://www.elections.alaska.gov/research/ | (purchasable list) | NO — confidential | YES (residential) | ~$21 CD historical | ~600k | AK Division of Elections explicitly classifies phone numbers as confidential per AS 15.07.195. Public release excludes phone, DOB, DL#, SSN. |
| **CO** | HIT | https://www.sos.state.co.us/pubs/elections/FAQs/VoterRegistrationData.html | CSV-on-disc or subscription | YES (if voter provided) | YES | $50/data set, or $1,000/2yr cycle | ~4.0M | Public CO statewide voter list includes "voter ID, name, residential address, birth year, gender (if provided), voter status, party, **phone number (if provided by the voter)**, county, precinct, district." Not all voters provide a phone — fill rate likely 30-50%. |
| **MI** | MISS | https://www.michigan.gov/sos/elections/admin-info/qvf | CSV via FOIA form | NO — prohibited by law | YES | varies (FOIA cost) | ~7.8M | MCL 168.509gg explicitly **prohibits** disclosure of "the telephone number provided by a registered voter." Mailing address yes; QVF returns name/residence/mailing/YOB/registration date/voter status/voter ID/history. Phone never. |
| **OK** | MISS | https://oklahoma.gov/elections/candidates/voter-registration-list.html | CSV (Election Data Warehouse) | NO — never collected publicly | YES (residential only, mailing partial) | $0 once approved | ~2.3M | 26 O.S. § 7-103.2: "Voter registration records do not include … telephone numbers, e-mail addresses…" Phone is statutorily excluded — there is no path. |
| **WA** | PARTIAL | https://www.sos.wa.gov/washington-voter-registration-database-extract | Pipe-delimited TXT (CSV-equivalent) | OPT-IN ONLY | YES | $0 | ~5.0M | VRDB extract is free and downloadable after a brief signup. Per user's prior CLAUDE.md note + WA practice, phone column is populated only when voter opted in at registration → low fill rate but legally clean. Confirm with VRSupport@sos.wa.gov / (360) 902-4194. |
| **UT** | MISS | https://vote.utah.gov/obtain-voter-registration-or-election-data/ | bulk file | likely yes | yes | **$1,050 flat** | ~1.8M | Lt. Governor's Office: "$1,050.00 for a one-time purchase. Refunds, subscriptions, or updates without a fee are not offered." Exceeds the $300 budget. Also UT Code 20A-2-607 freezes data until 2026-05-25 — pre-cutoff requests fulfilled with 2026-03-08 snapshot. |
| **DE** | MISS | https://elections.delaware.gov/voter/vregdata.shtml (file: https://elections.delaware.gov/voter/pdfs/VoterFileDocumentation.pdf) | structured file with `Phone_Area_Code`, `Phone_Exchange`, `Phone_Last_Four` | NO for public extract | YES | $0 candidates only; public fee unspecified | ~750k | Documentation: phone fields exist in the file format BUT "files and lists provided to **major and minor political parties and candidates** for elective office include … telephone numbers." "Files provided to **the public** are limited to voter names, addresses, party, voting history, district info, and years of birth." Henri = public requestor → no phone. |
| **GA** | MISS | https://sos.ga.gov/page/order-voter-registration-lists-and-files | electronic file (email delivery) | NO | YES | $250 flat | ~7.6M | Confirmed $250 still current. Field set explicitly: "voter name, residential address, mailing address if different, race, gender, registration date, last voting date." No phone column. Also: "may not be used by any person for commercial purposes" — Henri's commercial use likely violates this, separate blocker. |

---

## Honest Misses (and why)

| State | Why it failed | Could it be fixed later? |
|---|---|---|
| AK | Phone is statutorily confidential | No — needs legislation |
| MI | Phone explicitly banned by MCL 168.509gg | No — needs legislation |
| OK | Phone never part of voter record per 26 O.S. § 7-103.2 | No — needs legislation |
| UT | Fee $1,050 > $300 budget | Yes — pay the fee if UT becomes high-priority |
| DE | Public extract strips phone (parties/candidates only get it) | Possibly — register Henri as a "political committee" if eligible (likely not) |
| GA | Voter record schema lacks phone; commercial-use restriction; $250 | No phone path; commercial-use restriction is a separate blocker |

**WebFetch limits encountered:** WA SOS PDFs returned 402, MI/CO/AK pages returned 403/SSL errors. Field-list confirmation came from search-result excerpts and cross-referenced state statutes, not direct page reads. Recommend a human eyeball-verify of WA's vrdb-database-fields.pdf to confirm the phone column header name before the ingestor is written.

---

## Recommended Action Per State

| State | Recommended action | Owner | ETA |
|---|---|---|---|
| **AR** | Fill out Data Request Form, mail with $2.50/file × 3 files = $7.50 check to Arkansas SoS Elections Division. Email corprequest@sos.arkansas.gov to confirm. | ops | 2-3 weeks |
| **CO** | Order one-time $50 statewide voter list on disc. (Skip the $1,000 subscription unless we need monthly refresh.) | ops | 1-2 weeks |
| **WA** | Submit free VRDB extract request at sos.wa.gov/washington-voter-registration-database-extract. Verify phone column name + null rate on first delivery. If phone fill <10%, deprioritize. | ops | 3-5 business days |
| AK | Skip. No phone path. | — | — |
| MI | Skip. Phone illegal to release. | — | — |
| OK | Skip. Phone not in record. | — | — |
| UT | Skip for now (over budget). Reconsider if UT becomes a top-3 territory. | — | — |
| DE | Skip. Public version excludes phone. | — | — |
| GA | Skip. No phone column + commercial-use clause is risky. | — | — |

---

## Net Impact Estimate

If AR + CO + WA all land with their advertised data:
- ~10.8M registered-voter records added
- AR: high phone fill (~60-80% based on similar form-collected states)
- CO: medium phone fill (~30-50%, voter-provided opt-in pattern)
- WA: low phone fill (~10-20%, opt-in only)

Combined "phone hits" likely yield ~3-5M new voters with phone, materially below NC's ~5M alone. The Tier 1.A batch is partially exhausted; further expansion requires moving to states like FL (paid), NY (paid), or commercial sources (Apollo, BatchData, ATTOM).

---

## Sources

- [Arkansas Voter Registration Data Request Form (PDF)](https://www.sos.arkansas.gov/uploads/elections/Data%20Request%20Form.pdf)
- [Arkansas Secretary of State — Voter Registration Information](https://www.sos.arkansas.gov/elections/voter-information/voter-registration-information)
- [Alaska Division of Elections — Public and Confidential Information](https://www.elections.alaska.gov/Core/publicandconfidentialinformation.php)
- [Colorado SoS — Public Voter Data FAQs](https://www.sos.state.co.us/pubs/elections/FAQs/VoterRegistrationData.html)
- [Colorado Elections Fee Schedule](https://www.sos.state.co.us/pubs/info_center/fees/elections.html)
- [Michigan SoS — QVF page](https://www.michigan.gov/sos/elections/admin-info/qvf)
- [Michigan QVF Data Request Form (FOIA)](https://www.michigan.gov/sos/-/media/Project/Websites/sos/02lehman/FOIA_FORM.pdf)
- [Oklahoma Voter Registration List](https://oklahoma.gov/elections/candidates/voter-registration-list.html)
- [Washington VRDB Extract Request](https://www.sos.wa.gov/washington-voter-registration-database-extract)
- [Washington VRDB Database Fields (PDF)](https://www.sos.wa.gov/_assets/elections/vrdb-database-fields.pdf)
- [Utah — Obtain Voter Registration Data](https://vote.utah.gov/obtain-voter-registration-or-election-data/)
- [Delaware Voter File Documentation (PDF)](https://elections.delaware.gov/voter/pdfs/VoterFileDocumentation.pdf)
- [Delaware Statewide Voter Reg Order Form (PDF)](https://elections.delaware.gov/public/forms/pdfs/statewide_vreg_order_form.pdf)
- [Georgia SoS — Order Voter Lists and Files](https://sos.ga.gov/page/order-voter-registration-lists-and-files)
