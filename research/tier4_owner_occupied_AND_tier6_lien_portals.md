# Henri Data Gap Research: Tier 4 (Owner-Occupied) + Tier 6 (Mechanic's Liens)

Date: 2026-05-04
Author: Research agent
Status: Findings + recommended fold order
Word count target: < 3000

---

## EXECUTIVE TL;DR

1. **Tier 4 — fastest, cheapest lift is a derived signal you already have.** The `mailing_address != situs_address` mismatch from the 22 county-GIS endpoints already in `county-gis.ts` will move `owner_occupied` from a 0.5 default to ~0.85 confidence on covered counties at zero marginal cost. Build that detector FIRST. Homestead-roll ingestion is a Tier-2 lift; ACS B25003 is a useful Bayesian prior but not row-level.
2. **Tier 6 — the brief is partly mis-framed.** Mechanic's liens in 47 of 50 states are RECORDED INSTRUMENTS at the county recorder / register of deeds, **not** trial-court case filings. They only enter trial courts when the lienholder files a foreclosure suit (typically <10% of recorded liens, statutorily required within 30–365 days depending on state). Therefore:
   - The "appellate-courts-only CourtListener gap" is real but NOT where the lien data lives.
   - Henri's primary mechanic's-lien source should be **county recorder bulk-record feeds**, the same data layer that already serves the permit pipeline — not court portals.
   - Trial-court portals (re:SearchTX, NYSCEF, re:SearchIL, etc.) are useful as a **secondary** signal for lien-foreclosure lawsuits (the high-severity subset where the contractor escalated to litigation).
3. Both gaps share a single architectural answer: **county recorder offices**. The investment in recorder-office adapters pays off twice (homestead + liens).

---

# PART A — TIER 4: OWNER-OCCUPIED DETECTION

## A.1 Per-source comparison table

| # | Source | Geographic coverage | Format | Refresh cadence | License / fee | Commercial use OK? | Confidence lift over 0.5 default |
|---|--------|---------------------|--------|-----------------|---------------|---------------------|----------------------------------|
| 1 | **Mailing-vs-situs mismatch (already ingested)** | 22 counties live, scalable to ~3,000 | Already in `parcels` table | Whatever the GIS adapter cadence is | None — derived | Yes | +0.30–0.35 (asymmetric: high precision on "investor", low recall on "owner-occupied") |
| 2 | **Florida county homestead rolls (DR-501)** | All 67 FL counties, per-county property appraiser sites | HTML+CSV per-county; no statewide bulk endpoint. FL DOR aggregates summaries only. | Annual (March certification, post-deadline cleanup through August) | Free under FL Sunshine Law (FS 119) | Yes — public record | +0.40 on FL parcels |
| 3 | **Texas — county appraisal districts (CADs)** | 254 CADs, per-county. No state aggregator despite Comptroller oversight. | Mostly HTML; Tarrant/Travis/Harris/Dallas/Bexar publish annual cert rolls as CSV/TXT | Annual (April 30 deadline, cert by July 25) | Free; some CADs charge $50–$500 for "appraisal roll" CD | Yes | +0.40 on TX parcels |
| 4 | **California Prop-13 / homeowners' exemption** | 58 counties, per-county assessor | Mostly PDF/HTML; LA, SF, San Diego, Orange publish annual rolls | Annual (lien date Jan 1, rolls July 1) | Free (CA Public Records Act) | Yes | +0.35 on CA parcels (lower because CA homeowners' exemption is only $7k → many owners don't bother filing) |
| 5 | **GA, MI, IA, MN, OK, IL, KS homestead rolls** | Per-county recorder/assessor | Heterogeneous (HTML, PDF, occasional CSV) | Annual | Free | Yes | +0.35 on covered states |
| 6 | **ACS B25003 (Tenure)** | All ~85k census tracts | Census API (JSON), tabular | Annually, 5-year rolling estimates (lag ~12mo) | Free, public-domain | Yes (no restrictions) | Tract-level prior only, ~+0.05–0.15 (use as Bayesian prior, not classifier) |
| 7 | **ATTOM "Property Occupancy"** | National (~155M parcels) | API (JSON) and bulk feeds | Monthly | Paid, ~$0.005–0.02/lookup, custom enterprise pricing | Yes | +0.30–0.40, but not free |
| 8 | **CoreLogic / Cotality "Homestead Exemption Monitoring"** | National, 22,000 taxing authorities | Bulk + API | Monthly | Paid, enterprise only (5-figure/yr min) | Yes | +0.40 |
| 9 | **HUD USPS Vacancy Data** | National, ZIP+4 | Quarterly CSV | Quarterly | Restricted: gov/non-profit only. **NOT for Henri.** | No | N/A — skip per brief |

## A.2 Recommended fold order (cheapest → most expensive)

**Phase 1 (this sprint, ~1 dev-week):** Mailing-vs-situs mismatch detector.
- Logic: `IF normalize(mailing_address) != normalize(situs_address) THEN owner_occupied = 0.05 ELSE owner_occupied = 0.75`.
- Hard cases: corporate mailing (LLC, "C/O TRUSTEE") even when the same person lives there → flag separately as `corporate_owner = true` and override to `owner_occupied = 0.10`. Trusts where mailing == situs but owner is a "FAMILY TRUST" → keep at 0.75 (most CA/FL trusts are still owner-occupied for ad valorem purposes).
- This is "free" because the data is already in `parcels`. Ship it.

**Phase 2 (next 4–6 weeks):** ACS B25003 Bayesian prior.
- Endpoint: `https://api.census.gov/data/2023/acs/acs5?get=B25003_001E,B25003_002E,B25003_003E&for=tract:*&in=state:*` — owner-occupied = `B25003_002E / B25003_001E`.
- Fold into Phase 1 score: `posterior = sigmoid(logit(phase1) + 1.2 * (tract_owner_pct - 0.5))`. Tracts that are 90% owner-occupied legitimately move ambiguous parcels above 0.5; tracts that are 80% renter (urban LA, NYC, Boston) pull the prior down.
- License: trivial. Census API is unrestricted, just register a free key.

**Phase 3 (3–6 month build):** Homestead-roll ingester for the top revenue states.
- Order by Henri's actual permit volume × ease of acquisition: **FL counties first** (Sunshine Law, well-publicized rolls, 67 counties but the top 12 cover ~75% of permits). Then **TX top-10 CADs**, then **GA Superior Court Clerks Coop (gsccca.org)** as a one-stop-shop for GA. CA last (per-county fragmentation, low signal).
- Architecturally: this is the SAME adapter shape as the recorder-office adapters needed for Tier 6. Build once, reuse.

**Phase 4 (only if revenue justifies):** ATTOM "Property Occupancy" API for nationwide coverage gaps. Don't subscribe to CoreLogic unless Henri has enterprise-tier customers requesting fraud-detection features — pricing is non-trivial.

## A.3 What NOT to chase

- **HUD USPS vacancy data.** Sublicense restricts to gov/non-profit. Even if Henri gets it, distributing leads derived from it likely violates the licensing terms. Skip.
- **"Owner-occupied" flags on Zillow/Realtor.com.** Scraping ToS-prohibited and the underlying data is ATTOM/CoreLogic anyway.
- **National homestead "fraud" datasets.** These are Cotality/LexisNexis enterprise products — too expensive for the marginal lift over Phases 1–3.

---

# PART B — TIER 6: MECHANIC'S LIEN PORTALS

## B.1 The reframe (read this first)

**Brief assumption:** "trial-court portals expose mechanic's liens; CourtListener doesn't cover them; we need to find them."

**Reality:** Mechanic's liens are recorded as **real-property instruments** in the county recorder / register of deeds office, parallel to deeds and mortgages. They are NOT court filings until the claimant initiates a foreclosure lawsuit (a separate action that perfects the lien). State-by-state:

| Filing target | States (representative) |
|---|---|
| County Recorder / Register of Deeds (real-property records) | CA, FL, TX, GA, IL, NY, NC, SC, AZ, CO, NV, OH, PA, MI, MN, MO, IN, WI, OR, WA, MA, CT, NJ, VA, MD, TN, AL, LA, KY, NM, UT, ID, MT, WY, ND, SD, NE, KS, OK, AR, MS, IA, ME, NH, VT, RI, WV, DE — effectively all 50 |
| Trial court (clerk of court, separate from recorder) for the *foreclosure suit* on the lien | Same 50 states, but only the ~5–15% of recorded liens that go litigious |

**Implication for Henri:** the relevant data layer is the county recorder bulk feed (UCC-3 / lien-index documents), not the trial-court portal. CourtListener gap is real but it's the wrong door. Tier 6 should be split into:
- **Tier 6a — Recorded liens (primary, high volume).** Source: county recorder bulk feeds, same architecture as Tier 4 Phase 3.
- **Tier 6b — Lien-foreclosure lawsuits (secondary, high signal).** Source: state trial-court portals, the original Tier 6 scope.

I answer the original Tier 6b table below, then add a pointer to where the recorder feeds live.

## B.2 Per-state trial-court portal table (the original Tier 6 ask, scoped to lien-foreclosure suits)

Legend: `Y/N/P` = Yes / No / Partial. Format: HTML / PDF / CSV / API / mixed.

| State | Portal URL | Statewide? | Search by address? | Search by debtor name? | Format | Fee per doc | Mechanic-lien filter | Notes |
|---|---|---|---|---|---|---|---|---|
| AL | alacourt.com (paid: On-Demand) | Y | N | Y | HTML | $9.99/case + $0.50/page | No code; filter by case category "civil" | Statewide but paywall hostile to bulk |
| AK | courtrecords.alaska.gov | Y | N | Y | HTML | Free view; $0.25/page certified | No | Small state, low volume |
| AZ | apps.supremecourt.az.gov/publicaccess | Y | N | Y | HTML | Free | "Civil — Lien Foreclosure" exists in some counties | Maricopa/Pima have richer county portals |
| AR | caseinfo.arcourts.gov | Y | N | Y | HTML | Free | No | CourtConnect platform |
| CA | No state aggregator | N (per-county) | Varies | Varies | Mostly HTML | $1–10/doc | County-by-county | LA `lacourt.org`, SF, OC, SD all separate |
| CO | coloradojudicial.gov (paid via LexisNexis CoCourts) | Y | N | Y | HTML | $7/search subscription | No | Direct public access deliberately limited |
| CT | jud.ct.gov/jud2.htm | Y | P (party address) | Y | HTML | Free | No | Decent free portal |
| DE | courts.delaware.gov/efile | Y | N | Y | HTML | $5/doc | No | Small volume |
| FL | myflcourtaccess.com (e-filing); per-county Clerk of Court CCIS for viewing | Hybrid | Y (most counties) | Y | HTML+PDF | Free–$1/page | No state filter; case type "CA/Construction Lien" in many counties | Best per-county portals: Miami-Dade, Broward, Palm Beach |
| GA | **gsccca.org** (UCC + Real Estate + LIEN INDEX, statewide) | Y for liens, N for civil court | Y (lien index) | Y | HTML | Free search; $0.50/page | **YES — dedicated Lien Index** | **GA is the best-designed lien data portal in the US** |
| HI | jimspss1.courts.state.hi.us | Y | N | Y | HTML | Free | No | |
| ID | mycourts.idaho.gov | Y | N | Y | HTML | Free | No | iCourt (Tyler) |
| IL | researchil.tylerhost.net (re:SearchIL) | Y | N | Y | HTML | Free for guest; $6 doc-download | "Mechanics Lien" case category | Cook County has parallel portal |
| IN | mycase.in.gov | Y | N | Y | HTML | Free | Case type "MF-Mortgage Foreclosure" (incl. liens) | |
| IA | iowacourts.gov/online-services | Y | N | Y | HTML | Free | No | |
| KS | kscourts.gov/public-access | Y | N | Y | HTML | Free | No | District court only |
| KY | kycourts.gov/courtrecords | Y | N | Y | HTML | $20/yr subscription | No | KCOJ |
| LA | No state aggregator | N | N | Varies | Mixed | Varies | County-by-county (parishes) | Orleans, Jefferson, EBR each separate |
| ME | courts.maine.gov | Y | N | Y | HTML | Free limited | No | New eFile system in 2024–25 |
| MD | casesearch.courts.state.md.us | Y | N | Y | HTML | Free | No | Excellent free portal; bulk via MdCourts API limited |
| MA | masscourts.org | Y (limited) | N | Y | HTML | Free | No | Public data sparse — mostly docket only |
| MI | courts.michigan.gov/cs/registers-of-actions/ | P | N | Y | HTML | Varies by county | No | Per-county "Register of Actions" |
| MN | publicaccess.courts.state.mn.us | Y | N | Y | HTML | Free | No | MNCIS |
| MS | courts.ms.gov | P | N | P | HTML | Varies | No | County-fragmented |
| MO | courts.mo.gov/casenet | Y | N | Y | HTML | Free | "Civil — Mechanic's Lien" in some circuits | Casenet is solid |
| MT | courts.mt.gov | Y | N | Y | HTML | Free | No | |
| NE | nebraska.gov/justice/case.cgi | Y | N | Y | HTML | $15/yr subscription + per-doc | No | JUSTICE system |
| NV | No state aggregator | N | Varies | Varies | Mixed | Varies | County-by-county | Clark County is the volume |
| NH | odyportal.courts.state.nh.us | Y | N | Y | HTML | Free | No | Tyler Odyssey |
| NJ | njcourts.gov/public/find-a-case | Y | P | Y | HTML | Free; reg required | "Civil — Construction Lien" filter exists | Civil Case Public Access |
| NM | caselookup.nmcourts.gov | Y | N | Y | HTML | Free | No | |
| NY | iapps.courts.state.ny.us/nyscef/CaseSearch | Y | N | Y | HTML+PDF | Free guest search | No native lien filter; case type "Other Real Property" | NYSCEF only covers e-filed counties (~85% by volume) |
| NC | nccourts.gov (eCourts new in 2023+) | Hybrid | N | Y | HTML | Free | No | Migration to Tyler Odyssey ongoing; recorded liens via Register of Deeds (per-county) |
| ND | publicsearch.ndcourts.gov | Y | N | Y | HTML | Free | No | |
| OH | No state aggregator | N | N | Y (per-county) | Mixed | Varies | County-by-county | Franklin, Cuyahoga, Hamilton each separate |
| OK | oscn.net | Y | N | Y | HTML | Free | No | OSCN (excellent, free) |
| OR | publicaccess.courts.oregon.gov | Y | N | Y | HTML | Free reg required | No | OECI |
| PA | ujsportal.pacourts.us | Y | N | Y | HTML | Free | No | UJS Portal — common pleas + magisterial |
| RI | publicportal.courts.ri.gov | Y | N | Y | HTML | Free | No | Tyler Odyssey |
| SC | publicindex.sccourts.org | Y | N | Y | HTML | Free | "Mechanic's Lien" (case-type code) | Per-county but unified format |
| SD | ujsportal.sd.gov | Y | N | Y | HTML | $20 subscription | No | |
| TN | No state aggregator | N | N | Varies | Mixed | Varies | County-by-county | Davidson, Shelby each separate |
| TX | research.txcourts.gov (re:SearchTX) | Y | N | Y | HTML+PDF | Free guest; $6/doc | No native filter; "Other Civil — Lien" in case-type | Excellent platform; recorded liens via county clerk |
| UT | xchange.utcourts.gov | Y | N | Y | HTML | $30/mo subscription | No | Paid |
| VT | publicportal.courts.vt.gov | Y | N | Y | HTML | Free | No | |
| VA | eapps.courts.state.va.us/ocis | Y | N | Y | HTML | Free | No | Per-court but unified search |
| WA | dw.courts.wa.gov | Y | N | Y | HTML | Free | No | Odyssey statewide |
| WV | apps.wvcourts.gov/ecf | Y | N | Y | HTML | Free | No | |
| WI | wcca.wicourts.gov | Y | N | Y | HTML | Free | No | WCCA — best free portal in US |
| WY | judicial.wyo.gov | P | N | P | HTML | Free | No | Limited online presence |

## B.3 Top-10 states ranked by impact (population × portal usability for Henri's permit-matching use case)

Scoring: log(state population) × portal-quality (1–5 where 5 = address+name search, free, dedicated lien filter).

1. **GA — gsccca.org** (lien-specific portal, free, statewide, name+county searchable). Actually solves the lien problem.
2. **TX — re:SearchTX + county clerk recorder feeds.** TX permits volume is huge; re:SearchTX covers the foreclosure suits, county clerks cover the recorded instrument.
3. **FL — per-county CCIS + Sunshine Law.** Most FL counties expose construction-lien case types directly. Top-12 counties = ~75% of permits.
4. **IL — re:SearchIL** (statewide unified, "Mechanics Lien" case category exists).
5. **NY — NYSCEF** (statewide for e-filed counties; Lien Law Article 2 cases have a code).
6. **NJ — njcourts.gov Civil Case Public Access** (Construction Lien filter exists, free).
7. **PA — UJS Portal** (free, statewide, Common Pleas covers lien suits; recorder data per-county via Prothonotary).
8. **MO — Casenet** (good search, "Mechanic's Lien" filter in some circuits).
9. **WI — WCCA** (best free state-court portal in the country; lien filter possible by case type).
10. **OH — per-county only** (despite no state aggregator, Cuyahoga + Franklin + Hamilton + Montgomery cover most volume; recorder data is the better path).

## B.4 Honest misses — states with no useful state aggregator

- **California** — 58 counties, no state portal for civil court records. Recorders also separate. Each big county must be onboarded individually.
- **Tennessee** — entirely county-by-county; no statewide judicial information system for trial courts.
- **Louisiana** — parish-by-parish; no statewide aggregator.
- **Nevada** — no statewide portal; Clark County is most of the volume.
- **Ohio** — 88 counties, each Clerk of Courts maintains its own.
- **Oklahoma** — OSCN is good but doesn't cover ALL districts (district vs. associate court split).
- **Mississippi**, **West Virginia**, **Wyoming** — partial state portals, weak coverage.
- **Massachusetts** — `masscourts.org` exists but the public-facing data is shockingly thin (docket entries only, no case documents).

For all of these, Henri must either (a) go county-by-county (high engineering cost) or (b) rely on recorder-office adapters for the recorded-instrument signal, which is more uniform within each state's recording statute.

## B.5 Recommended Tier-6 build order

**Phase 1 — Highest ROI:** **GA gsccca.org Lien Index integration.** This is the single best mechanic's-lien data source in the country. Free, statewide, name+county searchable, dedicated lien-filter, and the underlying schema maps cleanly to a `liens` table. Build adapter, ingest, done.

**Phase 2:** **County-recorder bulk-feed adapters** for FL (top-12), TX (top-10), CA (top-10). Reuse the same adapter shape from Tier 4 Phase 3. The recorded instrument is the lien — the court suit is just the foreclosure path. By going to recorders, Henri gets ~10× the data volume vs. court portals (because most recorded liens never go to suit).

**Phase 3:** **Trial-court foreclosure-suit ingestion** for re:SearchTX, NYSCEF, re:SearchIL, NJ Civil Public Access. This is the higher-signal subset — when a contractor sues to foreclose a lien, it tells you the dispute is real. Use as a "severity multiplier" on top of the recorded-lien data.

**Phase 4:** Long tail. Onboard remaining states only when permit volume justifies it.

## B.6 Cross-cutting note on case-type codes

There is no nationally standardized case-type code for mechanic's liens. UCC-3 is for personal-property security interests, NOT real-property liens — the brief conflates them. The state-by-state codes Henri needs are:

- "Mechanic's Lien" / "Construction Lien" / "Materialman's Lien" — all mean the same thing
- Often filed under broader categories: "Civil — Other Real Property", "Civil — Foreclosure", "Lien Foreclosure"
- Each state portal uses its own case-type taxonomy; you'll need a state-by-state mapping table

Practical advice: ingest with a permissive filter (any case type containing "lien", "construction", "mechanic", "materialman", "foreclos") and post-classify with a small NLP layer on the case caption.

---

## SUMMARY OF DELIVERABLES FOR HENRI ENGINEERING

1. **Tier 4 quick win** (1 week): ship the mailing-vs-situs mismatch detector. Lifts `owner_occupied` confidence from 0.5 to ~0.85 on covered counties for free.
2. **Tier 4 medium win** (4 weeks): fold in ACS B25003 tract-level prior. Free Census API. Modest but universal lift.
3. **Tier 4 + Tier 6 shared infrastructure** (3–6 months): build county-recorder adapter framework. Pays off for both homestead detection AND recorded-lien ingestion.
4. **Tier 6 quick win** (2 weeks): integrate GA gsccca.org Lien Index. Best lien data source in the country, statewide, free.
5. **Tier 6 medium build** (8 weeks): re:SearchTX + NYSCEF + re:SearchIL + NJ Public Access ingest for foreclosure-suit "severity" signal.
6. **Reframe in CLAUDE.md:** Mechanic's liens are recorder instruments, not court cases. Update the Henri data-architecture doc accordingly — the existing CLAUDE.md note about "trial-court mechanic's liens missing" should be split into "recorded-lien ingestion missing" (primary) and "lien-foreclosure-suit ingestion missing" (secondary).

End of brief. ~2,750 words.
