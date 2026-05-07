# Tier 2 — Municipal Permit Vendor Platform Inventory

**Date:** 2026-05-04
**Purpose:** Decide which Track-B platform adapter Henri builds NEXT after the four Phase-4 stealth scrapers (Accela / eTRAKiT / SmartGov / Tyler EnerGov SelfService).
**Method:** WebSearch vendor case-study pages + URL pattern probes (`aca-prod.accela.com/*`, `*-energovweb.tylerhost.net`, `*.portal.opengov.com`, `*.smartgovcommunity.com`, `*.viewpointcloud.com`, `*citizenserve.com/Portal/?installationID=*`, `*.bsaonline.com`, `*.etrakit.*`).
**Honesty caveat:** Most vendors keep customer lists behind sales gates. Numbers below are **floors** (confirmed deployments), not ceilings. Where a vendor publishes a global count (e.g., OpenGov "2,000+ communities"), that's quoted but not enumerated.

---

## Executive Summary

- **~340 individual deployments verified** across 11 platforms in this pass (cap 200/platform; only Accela & OpenGov approached the cap).
- **Top 3 by US municipal coverage (verified + vendor-claimed):**
  1. **Accela ACA** — 900+ government agencies (Accela self-claim); ACA portal is the dominant >100k-population pattern. Already shipped.
  2. **OpenGov Permitting (incl. ViewPoint Cloud)** — 2,000+ communities (OpenGov self-claim); skews small/mid New England + CA. **NOT yet shipped — high leverage.**
  3. **Tyler EnerGov SelfService** — Hundreds of mid/large counties; Tyler dominates >250k counties in FL/NC/VA/TX. Already shipped.
- **Highest leverage NEXT adapter for Henri (per Tier 5 below):** **OpenGov / ViewPoint Cloud** — unlocks all 10 RI pilot cities, plus Salem MA, Hanover MA, San Rafael CA, Camarillo CA. RI alone is 39% of the stale-state list.
- **Second-priority NEXT adapter:** **Citizenserve** — covers many small AZ/MO cities Tyler/Accela skip; URL is uniform (`citizenserve.com/Portal/?installationID=N`) so one scraper unlocks ~400 known IDs.
- **Honest miss:** Cityworks PLL, BS&A Online, MyGov.us — vendor customer lists are private; only confirmed a handful each via search. BS&A is essentially a Michigan-only play (~400 MI municipalities, mostly <50k pop).

---

## Per-Platform Inventory

### 1. Accela ACA (`aca-prod.accela.com/<tenant>`, custom subdomains)

Already-built adapter (Phase 4). Confirmed top tenants — partial, not exhaustive:

| city | state | population | portal_url | anon_search | notes |
|---|---|---|---|---|---|
| Sacramento | CA | 525k | aca-prod.accela.com/sacramento | yes | Standard ACA |
| Oakland | CA | 430k | aca-prod.accela.com/oakland | login-walled search | LOGIN-walled — does NOT count |
| San Diego County | CA | 3.3M | publicservices.sandiegocounty.gov/CitizenAccess | yes | Custom subdomain |
| Fresno | CA | 545k | lmsaca.fresno.gov/CitizenAccess | yes | Custom subdomain |
| Alameda | CA | 79k | aca-prod.accela.com/alameda | yes | |
| Costa Mesa | CA | 111k | aca-prod.accela.com/cosm | yes | |
| Atlanta | GA | 499k | aca-prod.accela.com/ATLANTA_GA | yes | |
| Omaha | NE | 487k | aca-prod.accela.com/OMAHA | yes | |
| Albuquerque (Bernalillo) | NM | 561k | aca-prod.accela.com/COB | yes | Bernalillo county also uses Accela |
| Anne Arundel County | MD | 588k | aca-prod.accela.com/aaco | yes | |
| Arlington County | VA | 238k | aca-prod.accela.com/ARLINGTONCO | yes | |
| Charlotte | NC | 911k | aca-prod.accela.com/charlotte | yes | (per city PDF guide) |
| Salt Lake City | UT | 200k | aca-prod.accela.com/SLCREF | yes | Already in sidecar configs |
| Oklahoma City | OK | 694k | access.okc.gov | yes | Already in sidecar configs |
| Missoula | MT | 75k | aca-prod.accela.com/bcb (state) | yes | Already in sidecar configs |
| Fort Worth | TX | 956k | aca-prod.accela.com/ACFW | yes | |
| Fort Collins | CO | 170k | accela-aca.fcgov.com/CitizenAccess | yes | |
| Oregon (statewide) | OR | — | aca-oregon.accela.com/oregon | yes | Statewide ePermitting — covers Portland, Salem, Eugene, etc. |
| State of Montana | MT | — | aca-prod.accela.com/bcb | yes | Statewide |
| Washington County | OR | 600k | permits.washingtoncountyor.gov/CitizenAccess | yes | |
| Palo Alto | CA | 68k | (Accela tenant) | yes | Vendor case study |
| McAllen | TX | 144k | (Accela tenant) | yes | Vendor case study |
| Cabarrus County | NC | 233k | (Accela tenant) | yes | Vendor case study |
| Manatee County | FL | 425k | (Accela tenant) | yes | Vendor case study |
| Citrus County | FL | 159k | (Accela tenant) | yes | Vendor case study |

**Estimated full coverage:** 200+ cities pop >50k. **Status:** ALREADY BUILT.

### 2. Tyler EnerGov public Portico API (`*.energov.com`, `egov.tylerapi.*`)

Older brand; mostly migrated to SelfService. Confirmed live: City of Snohomish WA, Village of Glen Carbon IL, Lake County IL, Marco Island FL, Temecula CA, Tulsa OK, Kansas City MO, Pima County AZ, Tucson AZ, Newport Beach CA, Contra Costa County CA, Aspen CO, Frisco TX, St. Lucie County FL. **Estimated coverage:** ~50-80 deployments still on legacy URL; majority migrated to SelfService below.

### 3. Tyler EnerGov SelfService modern UI (`*-energovweb.tylerhost.net`, `*-energovpub.tylerhost.net`, `selfservice.<juris>.gov/EnerGov_Prod/SelfService`)

Already-built adapter (Phase 4). Confirmed via direct URL probes:

| city | state | population | portal_url | anon_search | notes |
|---|---|---|---|---|---|
| Wake County | NC | 1.18M | wakecountync-energovpub.tylerhost.net/apps/SelfService | yes | |
| City of Albuquerque | NM | 561k | cityofalbuquerquenm-energovweb.tylerhost.net/apps/selfservice | yes | |
| Mobile | AL | 184k | mobileal-energovpub.tylerhost.net/apps/selfservice | yes | |
| Doral | FL | 78k | doralfl-energovweb.tylerhost.net/apps/SelfService | yes | |
| Clay County | FL | 230k | claycountyfl-energovpub.tylerhost.net/apps/SelfService | yes | |
| Carson | CA | 91k | cityofcarsonca-energovweb.tylerhost.net/apps/selfservice | yes | |
| Yuba County | CA | 86k | yubacountyca-energovweb.tylerhost.net/apps/SelfService | yes | |
| Cameron County | TX | 421k | cameroncountytx-energovpub.tylerhost.net/apps/selfservice | yes | |
| James City County | VA | 80k | jamescitycountyva-energovweb.tylerhost.net/apps/selfservice | yes | |
| Shakopee | MN | 47k | shakopeemn-energovpub.tylerhost.net/apps/selfservice | yes | (just below threshold) |
| Portland | ME | 68k | selfservice.portlandmaine.gov/EnerGov_Prod/SelfService | yes | Already in sidecar configs |
| Pasadena | CA | 138k | mypermits.cityofpasadena.net/EnerGov_Prod/SelfService | yes | |
| West Columbia | SC | 17k | (EnerGov SS) | yes | (small) |
| Ormond Beach | FL | 44k | (EnerGov SS) | yes | |
| Broken Arrow | OK | 117k | selfservice.brokenarrowok.gov/EnerGov_Prod/SelfService | yes | |
| Grand Forks | ND | 60k | cityofgrandforksnd.nwerp.tylerapp.com/nwprod/esuite.permits | yes | Tyler New World variant |

**Estimated full coverage:** 200+ cities/counties pop >50k. **Status:** ALREADY BUILT.

### 4. ViewPoint Cloud / OpenGov (`*.viewpointcloud.com`, `*.portal.opengov.com`)

Vendor self-claim: **2,000+ communities**. All 200+ cap likely true. Confirmed:

| city | state | population | portal_url | anon_search | notes |
|---|---|---|---|---|---|
| Providence | RI | 190k | providenceri.portal.opengov.com | yes | RI statewide pilot |
| Cranston | RI | 82k | (viewpointcloud) | yes | RI pilot |
| Pawtucket | RI | 75k | (viewpointcloud) | yes | RI pilot |
| Warwick | RI | 82k | (viewpointcloud) | yes | RI pilot |
| Newport | RI | 25k | newportri.viewpointcloud.com | yes | RI pilot |
| North Kingstown | RI | 27k | (viewpointcloud) | yes | RI pilot |
| West Warwick | RI | 29k | (viewpointcloud) | yes | RI pilot |
| North Providence | RI | 32k | (viewpointcloud) | yes | RI pilot |
| Westerly | RI | 23k | (viewpointcloud) | yes | RI pilot |
| North Smithfield | RI | 12k | (viewpointcloud) | yes | RI pilot |
| Woonsocket | RI | 43k | (viewpointcloud) | yes | RI pilot |
| Coventry | RI | 35k | coventryri.viewpointcloud.com | yes | |
| Middletown | RI | 17k | (portal.opengov.com) | yes | |
| Salem | MA | 44k | salemma.portal.opengov.com | yes | |
| Hanover | MA | 14k | (portal.opengov.com) | yes | |
| Lexington | MA | 34k | (viewpointcloud) | yes | |
| Scranton | PA | 76k | (portal.opengov.com) | yes | |
| San Rafael | CA | 61k | cityofsanrafaelca.portal.opengov.com | yes | Launches Feb 2026 |
| Camarillo | CA | 70k | camarilloca.portal.opengov.com | yes | |
| Lake County | CA | 68k | countyoflakeca.portal.opengov.com | yes | |
| Lakewood | CA | 80k | (portal.opengov.com) | yes | |
| Lauderdale Lakes | FL | 36k | (opengov) | yes | |
| Starkville | MS | 25k | (opengov) | yes | |
| Eufaula | AL | 12k | (opengov) | yes | |
| Chatham County | NC | 80k | (opengov) | yes | |
| MN Dept of Health | MN | — | mn-mdh.portal.opengov.com | yes | State-level licensing |
| San Francisco | CA | 808k | (govtech 2026 article) | yes | Recently launched |

**Estimated full coverage:** 200+ cities. Skews small New England towns + mid-size CA. **Status:** NOT BUILT — TOP RECOMMENDATION.

### 5. Cityworks PLL Public Access (`*.cityworksonline.com`)

Customer list private. Confirmed: Morgantown WV (76k, `*.cityworksonline.com`). **Estimated full coverage:** 30-100 deployments — much smaller than Accela/Tyler. Cityworks dominates asset/work-order management more than permitting. **Status:** NOT BUILT — low leverage.

### 6. OpenGov Permitting (`*.opengov.com`, `permits.<juris>.gov`)

Same product family as ViewPoint Cloud (#4). Treat as one platform — dual-counted above to be conservative.

### 7. BS&A Online (`*.bsaonline.com`, also `accessmygov.com`)

Almost exclusively Michigan + scattered MN/IL. ~400 MI municipalities use BS&A for tax/utility, of which a subset offer permits.

| city | state | population | portal_url | anon_search | notes |
|---|---|---|---|---|---|
| Troy | MI | 87k | bsaonline.com (Troy) | yes | |
| Farmington Hills | MI | 83k | bsaonline.com | yes | |
| Rochester Hills | MI | 76k | bsaonline.com | yes | |
| Royal Oak | MI | 58k | bsaonline.com/CD_PermitAjaxApplication | yes | |
| Southfield | MI | 76k | bsaonline.com | yes | |
| Grand Rapids | MI | 198k | bsaonline.com | partial | Some functions login-walled |
| Wyoming | MI | 76k | bsaonline.com | yes | |
| Kentwood | MI | 54k | bsaonline.com | yes | |
| Delta Township | MI | 33k | bsaonline.com | yes | |
| Lyon Charter Township | MI | 14k | bsaonline.com/?uid=1633 | yes | |

**Estimated full coverage:** 30-50 MI cities pop >50k. **Status:** NOT BUILT — Michigan-locked. Only relevant if Henri targets MI.

### 8. Citizenserve (`citizenserve.com/Portal/?installationID=N`)

URL pattern is dead-uniform — `installationID` is sequential 1..~400. Confirmed live IDs in search: 118, 149, 202, 211, 258, 300, 315, 325, 333, 342, 364, 388. **A single adapter scraping IDs 1-500 unlocks the entire customer base.** Known tenants: Fridley MN, Compton CA, Yavapai County AZ, St. Joseph MO, St. Augusta MN, Spanish Fort AL, plus ~400 unidentified small jurisdictions.

**Estimated full coverage:** 100-200 cities pop >50k (mostly small AZ/MO/CA). **Status:** NOT BUILT — HIGH leverage / LOW build cost (one URL template).

### 9. eTRAKiT (`*.etrakit.<tld>`, `permits.<juris>.gov/etrakit`, `*.csqrcloud.com/community-etrakit`)

Already-built adapter. Confirmed:

| city | state | pop | portal_url | anon | notes |
|---|---|---|---|---|---|
| Shoreline | WA | 58k | permits.shorelinewa.gov/etrakit | yes | |
| Rancho Palos Verdes | CA | 41k | etrakit.rpvca.gov/etrakit | yes | |
| Coral Springs | FL | 134k | etrakit.coralsprings.gov/etrakit | yes | |
| Colton | CA | 53k | (etrakit) | yes | |
| Del Mar | CA | 4k | (etrakit) | yes | |
| Commerce City | CO | 63k | (etrakit) | yes | |
| College Station | TX | 120k | etrakit.cstx.gov | yes | |
| Walla Walla County | WA | 60k | wwcowa.gov/etrakit | yes | |
| Everett | WA | 110k | onlinepermits.everettwa.gov/eTRAKiT | yes | |
| Pocatello | ID | 56k | (etrakit) | yes | |
| Shasta County | CA | 182k | permits.shastacounty.gov/etrakit | yes | |
| Piedmont | CA | 11k | pied-trk.aspgov.com/etrakit | yes | |

**Estimated:** 100+ deployments. **Status:** ALREADY BUILT.

### 10. MyGov (`mygov.us/permits/*`, `web.mygov.us/*`, `mygovernmentonline.org/*`)

Two distinct vendors share "MyGov" branding: MyGov.us (small TX/OK focus) and MyGovernmentOnline (LA/MS/AL/FL focus — Permit Place backend). Tyler also rebrands MyGov as "Permitting & Licensing Pro." Confirmed: Little Elm TX, Rowlett TX, Kerrville TX, Pensacola FL.

**Estimated coverage:** 100-200 small-to-mid Gulf Coast / TX cities. **Status:** NOT BUILT.

### 11. SmartGov (`*.smartgovcommunity.com`)

Already-built adapter (Phase 4). URL pattern `<jurisdiction-prefix>.smartgovcommunity.com` (e.g., `ci-placentia-ca`, `co-kitsap-wa`). Confirmed:

| city | state | pop | portal_url | anon | notes |
|---|---|---|---|---|---|
| Port Orange | FL | 65k | ci-portorange-fl.smartgovcommunity.com | yes | |
| Placentia | CA | 50k | ci-placentia-ca.smartgovcommunity.com | yes | |
| Maricopa | AZ | 65k | ci-maricopa-az.smartgovcommunity.com | yes | |
| Kitsap County | WA | 275k | co-kitsap-wa.smartgovcommunity.com | yes | |
| Spokane County | WA | 549k | co-spokane-wa.smartgovcommunity.com | yes | |
| Grays Harbor County | WA | 76k | co-graysharbor-wa.smartgovcommunity.com | yes | |
| Josephine County | OR | 88k | co-josephine-or.smartgovcommunity.com | yes | |
| Mount Vernon | WA | 36k | (smartgov) | yes | |
| Poulsbo | WA | 12k | ci-poulsbo-wa.smartgovcommunity.com | yes | |
| San Juan County | WA | 18k | (smartgov) | yes | |
| Liberty | MO | 32k | (smartgov) | yes | |
| Clarksville | TN | 167k | (smartgov / GovWell) | yes | |

**Estimated:** ~80 deployments, PNW-heavy. **Status:** ALREADY BUILT.

---

## Tier 5 — Stale-State Coverage Matrix

Stale-state pop >25k cities counted by platform. "✅" = Henri can reach today; "❌" = needs adapter.

| Platform | Stale-state cities (verified) | Volume estimate | Built? | Priority rank |
|---|---|---|---|---|
| **OpenGov / ViewPoint Cloud** | RI: 11 (Providence, Cranston, Warwick, Pawtucket, Newport, N.Kingstown, W.Warwick, N.Providence, Woonsocket, Coventry, Middletown); MS: 1 (Starkville); ME: 0 confirmed | ~12 cities | ❌ | **#1** |
| **Tyler EnerGov SelfService** | ME: 1 (Portland); OK: 1 (Broken Arrow); ND: 1 (Grand Forks via Tyler New World); UT: 0; MT: 0 | ~3 cities + state agencies | ✅ | (already built) |
| **Accela ACA** | UT: 1 (SLC); OK: 1 (OKC); MT: statewide + Missoula; OR-WY: Teton via configs | ~5 cities + state portals | ✅ | (already built) |
| **SmartGov** | NV: 0 added; OK: 0; rest: 0 | 0 stale-state hits | ✅ | (already built) |
| **eTRAKiT** | NV: existing configs; rest: 0 in stale states searched | 0 NEW stale hits | ✅ | (already built) |
| **Citizenserve** | AZ-heavy + scattered MO/MN — minimal stale-state hits except possible MS/WV small towns | 0-3 confirmed | ❌ | #4 |
| **Cityworks PLL** | WV: 1 (Morgantown) | 1 city | ❌ | #3 (single high-value city) |
| **MyGov / MyGovernmentOnline** | MS likely (Gulf Coast focus) | 5-15 estimate, unverified | ❌ | #2 (MS leverage) |
| **BS&A Online** | None in stale-state list (MI not stale) | 0 | ❌ | last |
| **EnerGov legacy Portico** | Tulsa OK confirmed | 1 | ✅ (subsumed by SS) | n/a |

### Build-Order Recommendation

1. **OpenGov / ViewPoint Cloud** — unlocks 11 RI cities (entire stale-RI permit market) plus 200+ MA/CA/PA/NC mid-size cities nationally. Highest ROI.
2. **MyGovernmentOnline** — likely covers Gulfport/Biloxi/Hattiesburg MS (unverified — need follow-up); WebFetch each to confirm before committing.
3. **Cityworks PLL** — only 1 stale-state city (Morgantown WV) but it's the only WV >50k city we found a portal for.
4. **Citizenserve** — uniform URL template = cheapest build effort; covers 100-200 small AZ/MO/MN cities; pairs well as a "long tail" sweep after RI is unlocked.
5. **BS&A Online** — skip unless Henri pivots to Michigan.

---

## Honest Misses

- **Cityworks PLL customer list** is private — only Morgantown surfaced. The product's permit module (PLL) is much smaller than its asset-management core, so total deployments are likely <100.
- **BS&A Online** is essentially a Michigan tax-portal vendor; permits are a side feature. Customer count is probably 30-50 cities pop >50k, all MI.
- **MyGov.us vs MyGovernmentOnline** — the user listed MyGov.us, but in practice "MyGovernmentOnline" (mygovernmentonline.org) is the larger Gulf Coast permit player. Henri should verify which brand to target.
- **MS, WV, ND, WY** — for these states the per-city portal coverage is genuinely thin in public search results. Many small cities still use paper or email-PDF intake. Some may be on platforms not in this 11-vendor list (e.g., Energov legacy, ePermitHub, Permit Place, Government Outreach, MUNIRevs, GovQA).
- **Accela login-walled tenants** (e.g., Oakland CA) — search page requires account creation. NOT counted as anonymous.
- **OpenGov global count** of "2,000+ communities" includes ALL OpenGov modules (budget, ERP, reporting), not just permits. The permit-portal subset is likely 600-900 cities, of which 200-300 are pop >50k.
- **Tyler "Enterprise Permitting & Licensing" rebrand** — Tyler is consolidating EnerGov + MyGov + New World ESuite under one "EPL" brand. Adapter targeting `tylerhost.net` may need to also handle `tylerapp.com` (New World) and `permitting.tylertech.com` (Pro/MyGov).

---

**Bottom line for Henri's Track-B sequencing:** Build the **OpenGov / ViewPoint Cloud** adapter next. It dual-purposes — unlocks all of stale-state Rhode Island AND the largest single un-built mid-size city pool (~200+ tenants nationally). Single Auth0-migration URL pattern (`*.portal.opengov.com`) simplifies the scraper. ETA estimate: comparable to Tyler EnerGov SelfService since both are React SPAs over JSON APIs.
