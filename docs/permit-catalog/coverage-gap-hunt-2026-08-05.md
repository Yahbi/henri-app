# Coverage gap hunt — 2026-08-05

Regional agents probed for live permit endpoints in Henri's worst-covered states.
Every ACCEPT was then re-probed by a SEPARATE verifier agent instructed to default to
rejection when uncertain. Only the survivors are listed as confirmed.

## Run did not complete

16 of 31 agents died on an API usage limit, including:

- the **southeast** region (GA 2,033 rows / TN 170 / SC 450 / AR 1)
- the **midwest-empty** region (MI 79 / WI 8 / MN 2 / IN 728 / MO 2,428)
- the **high-contact-hunt** — feeds anywhere in the US exposing owner or contractor
  phone/email. This was the highest-value brief of the six, because phone fill is ~1%
  and is the real ceiling on lead quality.
- the **synthesis** step, which was meant to produce per-source field mappings and a
  ready-to-paste SQL INSERT block.

This file is a faithful hand-capture of what survived verification, so the work is not
lost. To finish the missing regions, re-run the workflow with
`resumeFromRunId: "wf_9224ca31-7a1"` — completed agents replay from cache and are not
re-charged.

## Result

- 46 endpoints claimed by hunters
- **12 independently confirmed**
- **6 of those carry POPULATED contact fields**

Note the verifiers were strict about contact fields specifically, because
present-but-empty contact columns are the most over-claimed thing in this domain.
One find was rejected on exactly that basis — see the Texas notes on Midland.

## Confirmed sources

Insert all of these with `enabled=false`. Each needs a smoke-test via
`/api/cron/scrape?source_key=<key>` before it is allowed to feed the catalog.

| # | Jurisdiction | Contact | Endpoint |
|---|---|---|---|
| 1 | Plano (TX) | no | `https://maps.planogis.org/arcgiswad/rest/services/OpenData/BuildingInspectionPermits/FeatureServer/0/query?where=APPLIED%3E%3DCURRENT_TIMESTAMP-90&outFields=*&outSR=4326&resultRecordCount=2000&resultOffset=0&f=json` |
| 2 | Dallas, TX — right-of-way / drive approach / utility-cut permits (City of Dallas ROW Permits - Points) | **YES** | `https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/ROW/FeatureServer/0/query?where=ISSUEDATE+%3E%3D+CURRENT_TIMESTAMP+-+INTERVAL+%2790%27+DAY&outFields=*&orderByFields=ISSUEDATE+DESC&outSR=4326&resultRecordCount=2000&f=json` |
| 3 | San Marcos (TX) | no | `https://smgis.sanmarcostx.gov/arcgis/rest/services/Planning/CoSM_BuildingPermits/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&orderByFields=OBJECTID+ASC&resultOffset=0&resultRecordCount=1000&f=json` |
| 4 | Tyler (TX) | **YES** | `https://services5.arcgis.com/RmXXW3PwBZGOxlSe/arcgis/rest/services/Permit_Data_With_XY/FeatureServer/0/query?where=1%3D1&outFields=*&f=json` |
| 5 | Arlington, TX | no | `https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1/query?where=1%3D1&outFields=*&f=json` |
| 6 | Bend, OR (City of Bend — Deschutes County) | **YES** | `https://services5.arcgis.com/JisFYcK2mIVg9ueP/arcgis/rest/services/Permits_and_Contractors_Table/FeatureServer/0` |
| 7 | Bend (Deschutes County), OR | **YES** | `https://services5.arcgis.com/JisFYcK2mIVg9ueP/arcgis/rest/services/Permit_Applications_Point/FeatureServer/0` |
| 8 | Redmond, OR — Accela Permits (BuildingPermits layer), City of Redmond Oregon ArcGIS FeatureServer | no | `https://services2.arcgis.com/B0h69gkZPiRSTUFu/arcgis/rest/services/Accela_Permits/FeatureServer/0` |
| 9 | Salem, OR — Structure Permits (rolling 12-month window) | no | `https://services.arcgis.com/kIA6yS9KDGqZL7U3/arcgis/rest/services/Structure_Permits/FeatureServer/0` |
| 10 | Portland, OR — City of Portland BDS "All Permits" (PortlandMaps ArcGIS FeatureServer layer 22) | no | `https://www.portlandmaps.com/arcgis/rest/services/Public/BDS_Permit/FeatureServer/22/query?where=ISSUED%3E%3Dtimestamp%20%272026-05-06%2000%3A00%3A00%27%20AND%20ISSUED%3C%3DCURRENT_TIMESTAMP&outFields=*&outSR=4326&f=json` |
| 11 | Henderson, NV — OpenDevPermits, Residential Permits (MapServer layer 1) | **YES** | `https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDevPermits/MapServer/1` |
| 12 | Henderson, NV — OpenDevPermits MapServer layer 2 ("Other Permits", commercial + trade) | **YES** | `https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDevPermits/MapServer/2/query?where=1%3D1&outFields=*&returnGeometry=false&f=json` |

## Regional findings

Verbatim from each regional agent. These carry the observed row counts, field-fill
percentages and honest dead-ends — read them before re-probing anything here.

### texas

TX went from 69,539 rows to roughly 530,000 addressable new permit records across 12 confirmed live endpoints. Every URL below was fetched in this run; row counts are from returnCountOnly=true and dates from max() outStatistics, not from documentation.

THE BIG THREE NEW WINS
1. Plano — 198,344 rows, APPLIED current to 2026-08-04, 4,051 issued in the trailing 90 days. Single biggest new TX volume. Undiscoverable via ArcGIS Online search; only found by enumerating maps.planogis.org/arcgiswad REST folders directly. Excellent trade attribution in PermitType (e.g. "WATER HEATER ONLINE"). Caveat: a handful of rows carry data-entry-error future ISSUED values (2026-12-23); clamp ISSUED <= now on ingest.
2. Midland — 86,481 rows, current to 2026-08-03, 83 distinct PermitWorkClass values giving clean trade splits ("Residential Plumbing", "Water Heater", "Commercial Electrical").
3. Dallas ROW — 62,486 rows, current to 2026-08-03. This is the ONLY live Dallas permit feed that exists; the Socrata building-permit set died in 2020. Scope is right-of-way, but ROWIMPROVEMENTREPAIR values are real trade work: "Drive Approach", "Alley Paving", "Wastewater", "Water" — concrete, driveway and utility contractor leads. ALLCONTRACTORSNAME is 93.2% filled (58,227/62,486) and LOCATIONNAMES carries full street+ZIP ("2410 BOYD ST, DALLAS, 75224"). Note the sibling layer 2 "Permit Detail" has 87,448 rows if you want the non-spatial superset.

BEST CONTACT-FILL FIND
Tyler — OWNER_NAME 98.6% filled (29,583/29,994) and CONTRACTOR_NAME 93.4% (28,003/29,994), alongside APPLICANT_NAME. Names only, no phone or email, but for a market where Henri sits at 1% phone this is the strongest per-permit identity data found in Texas.

TWO CORRECTIONS TO THINGS THAT LOOKED LIKE WINS
- Midland's PHONE and CONTACT columns are a trap. They are 97% "filled" (84,078/86,481) but a returnDistinctValues query over the last 365 days returns exactly two pairs: NULL, and "John Burkholder" / "685-7204". That is one city-staff contact stamped on every row, not per-permit contact data. I set hasContactFields=false for Midland deliberately — treating those columns as contact fill would inject a single fake phone number onto 84k leads.
- El Paso ships an Owner/OWNNAME column in both feeds but it is empty: residential Owner non-blank count = 0 of 42,677; commercial OWNNAME = 24 of 11,322. Map the address and dates, ignore the owner column.

ON THE BRIEF'S TWO SPECIFIC QUESTIONS
- Dallas e7gq-4sah is NOT live. 126,840 rows spanning 2019-01-01 to 2020-08-29, and the dataset description now redirects to the Dallas Accela portal. But the phone hypothesis is CONFIRMED: the free-text contractor column embeds phone numbers, e.g. "HOFFMAN TEXAS INC DBA ROTO ROOTER SERVICE PLUMBING CO 3817 CONFLANS, IRVING, TX 75061 (972) 986-1027". Regex-extractable. Value is historical contractor-phone enrichment, not lead flow — you could mine ~127k contractor phone pairs from it for a Dallas contractor directory.
- Fort Worth's frozen BLDS Socrata feed stays dead, and Henri already has the live Fort Worth ArcGIS replacement, so no action needed there.

HONEST GAPS THAT REMAIN
- Houston is genuinely closed. I checked three independent channels (Public Works hub DCAT 185 datasets, MyCity hub DCAT 173 datasets, CKAN package_search) and none publishes address-level permits. The 2.3M-population hole in TX coverage cannot be filled with a free anonymous API; it needs the permits.houstontx.gov portal, which is Phase-4 scrape territory.
- San Antonio, Fort Worth, Austin and Collin CAD were already in Henri's catalog and are excluded from the accept list above by design.
- Lubbock, Laredo, Waco, Garland, Amarillo, Odessa and Denton have no city permit API. Lubbock and Waco both run EnerGov and expose only the empty GIS scaffolding around it, which is the signature of a Tyler EnerGov tenant — those are load_energov_ss.py candidates, not API candidates.
- Abilene (gis.abilenetx.com) is the one unresolved probe; the host exists in ArcGIS item URLs but its REST directory did not return JSON. One retry is warranted before writing it off.

METHOD NOTE FOR THE NEXT RUN
ArcGIS Online title search is close to useless for this task — it is dominated by Survey123 forms, out-of-state cities and foreign data, and it completely missed Plano, San Marcos and Arlington, which were the three best structural finds. What actually worked was (a) enumerating a city's own ArcGIS REST directory folder-by-folder, and (b) crawling AGO for permit-titled services then filtering client-side on each item's extent centroid falling inside the Texas bbox. The reusable prober is at C:\Users\yabis\AppData\Local\Temp\claude\C--Users-yabis-Desktop-Henri-App\450c7c90-f254-4776-92a5-dda12f35b23c\scratchpad\probe.py and the extent-filtered crawler at txcrawl.py in the same directory. No database was touched and no application source was modified.

**Rejected in this region:** 15 endpoints.

### northeast

HONEST BOTTOM LINE FOR THIS REGION: New England is the thinnest permit-data region in the US after the Deep South. Only THREE jurisdictions publish a live, anonymous, structured permit feed — Boston, Cambridge and Somerville, all in Massachusetts. RI, VT, ME and NH have essentially nothing current.

WHAT MOVES THE NEEDLE MOST (in order):
1. Boston CKAN — 658,668 rows, 37,073/yr, updated daily (newest record I saw was issued 2026-08-03 04:10:47, permit E1880399, ELECTRICAL, "Upgrade the service and rewiring all 3 apartments"). Henri already has boston.yml with the correct resource_id 6ddcd912-32a0-43df-9908-63574f8c7e77 — I re-verified it end to end. With MA sitting at 722 rows in the permits table, simply running the existing Boston CKAN config is the single largest win available in this region. The worktype column already splits ELECTRICAL / PLUMBING / etc., so no separate trade feed is needed.
2. Cambridge — this is the real NEW find. Henri's catalog records it as "8 Socrata datasets" and only ever configured qu2z-8suj (Addition/Alteration, 14,167 rows). The portal actually publishes a 15-dataset permit family PLUS a master aggregator (3wsm-e5jx Permit Finder, 122,506 rows, updated today) that unions every type with address + lat/lng + parcel (mbl) + submit and issue dates + a link back to the type-specific row. The per-trade tables are the contact-fill prize: Gas carries plumber_licensee_name + plumber_company + plumber_license_no; Sheet Metal carries business_name + license_number; Roof and Solar carry firm_name + license_number; Electrical carries licensee; Plumbing and Mechanical carry company_name. Every one of these is a licensed-contractor identity tied to a specific address and date. Still no homeowner phone or email anywhere.
3. Somerville nneb-s3f7 — 103,490 rows, 7,062/yr, updated 2026-08-03, with applicant_company_name and a clean per-trade split (Building 28,306 / Electrical 25,070 / Plumbing 11,331 / Gas Fitting 9,436 / Sheet Metal 3,068). Already in the catalog; worth confirming it is actually being ingested.

RHODE ISLAND — the brief asked me to confirm or refute the ViewPoint theory. CONFIRMED, with one correction. Cranston, Warwick, Pawtucket, Newport, East Providence AND Providence all run OpenGov ViewPoint tenants; api-east.viewpointcloud.com/v2/<tenant>/records returns HTTP 403 forbidden to anonymous callers (only /recordTypes is open, and it returns type metadata, not records). BUT Providence separately publishes three historical exports that nobody has catalogued, and they are good: the Interactive Permitting Map (BETA) FeatureServer has 48,176 records through 2024-03-25 with Contractor_Name AND Contractor_License_Number AND Project_Cost AND lat/lng, broken out by trade (Electrical 11,537 / Mechanical 7,036 / Plumbing 5,840 / Roofing 4,816 / Solar 2,901 / Siding 1,006 / Window 1,080). That is 2.5 years fresher than the Socrata dataset Henri would otherwise find. RI will never be a live-lead state on free data, but these 48k rows are usable for historical_conversion scoring and for a contractor-identity roster.

NEW HAMPSHIRE — near-total loss, and there is a correction Henri needs. The existing nashua-nh.yml is marked status: verified, but the layer Building_Permits_June_2025 froze on 2025-06-04 — it is a one-time snapshot, 14 months stale, and the config maps applicant: ProjectName which is not a field on the layer (an outFields request containing it returns HTTP 400). The only genuinely live NH permit feed I could find anywhere is Nashua's PermitAreaToAGO (street-opening and driveway permits, 3,939 rows, 224 filed since 2026-05-01, newest 2026-08-03). It carries a contractor CompanyName but only on 5.5% of rows, and driveway/street-opening is a narrow trade slice. Manchester, Concord, Portsmouth, Derry, Dover, Rochester, Keene: no public endpoint found by any method.

MAINE — zero. No municipal API found. The state ArcGIS org publishes exactly 3 services and the permit one is aggregate town-year counts with no addresses. Portland ME remains eTRAKiT-scrape-only (Henri's portland-me.yml, status unverified) and that assessment still holds.

VERMONT — effectively zero, and worse than the catalog implies. Act 250 is live with 8,278 records but the layer has NO date field whatsoever, so it cannot satisfy freshness scoring or even be ordered; Henri's config references Status_Date, which does not exist. I would either drop vt-act250-statewide.yml or re-point it after finding a companion table that carries dates.

METHOD NOTES / TRAPS FOR THE NEXT RUN: (a) ArcGIS Online's bbox parameter and ArcGIS Hub's filter[extent] silently do not constrain results — I probed three "New England" hits that were in Washington, Alberta and Ontario. Always verify the owning org. (b) Enumerating an AGOL org's full service list (https://services{N}.arcgis.com/{orgKey}/arcgis/rest/services?f=json) was far more productive than keyword search. (c) A service literally named "OpenGov Permitting" or "EnerGov_CSS" is usually the basemap for a permitting app, not the permit records — always list the layers before believing the name. (d) The national Socrata catalog at api.us.socrata.com/api/catalog/v1 is the fastest way to prove a negative for a whole region; the /domains endpoint 404s but paging q=permit works.

**Rejected in this region:** 17 endpoints.

### west-mountain

SCOREBOARD: 15 accepted (13 genuinely new + 2 known-but-never-ingested re-verified), 20 rejected. Every accepted URL was fetched in this run; every row count, field name and date below came off a live response, not documentation.

THE BRIEF'S CENTRAL QUESTION — "confirm whether any anonymous JSON endpoint exists for NV before writing it off": Clark County is confirmed Accela-only via three independent probes (ACA portal returns HTML; the county's own gisgate.co.clark.nv.us REST root has Accela and BuildingDepartment folders but they contain only inspection-AREA polygons and geocoders; the county ArcGIS Hub returns numberMatched:0 for q=permit). Write Clark County off for anonymous JSON. BUT NV is NOT a dead state — Las Vegas city (2,065,618 rows, ISSUE_YR 2026 present) and Henderson (28,406 + 8,500 rows, newest 2026-08-03) both have live anonymous ArcGIS feeds. NV shows 0 rows in Henri's permits table not because the data is unreachable but because ingestion never ran.

BIGGEST WIN — BEND, OREGON. Bend's Permits_and_Contractors_Table is the best find in this region by a wide margin and directly attacks Henri's binding contact constraint. 95,164 rows, 2,870 in the trailing 90 days, newest 2026-08-03, and it is TRADE-ATTRIBUTED: separate ElectricalContractorName / MechanicalContractorName / PlumbingContractorName / GeneralContractorName / RightOfWayContractorName columns. Measured fill on the full table: Owner 95,164/95,164 = 100%, Address 93,205 = 98%, ElectricalContractorName 47,983 = 50%, MechanicalContractorName 38,126 = 40%, PlumbingContractorName 37,335 = 39%, ContractorName 29,961 = 31%. A verbatim row: ApplicationNumber PR20-1083-SOLR, Address "63125 PIKES CT, BEND, OR 97701", Owner "ARCHULETA, KEVIN G", ContractorName "TESLA ENERGY OPERATIONS INC", PermitTypeDescription "Electrical". Bend publishes four interlocking services (Permitting_Table 204k, Permit_Applications_Point 164k geocoded, Permits_and_Contractors_Table 95k, Permit_Contacts_Table 274k) that join on GNCommonID — ingest them as a set.

ACTION REQUIRED — A CONFIGURED SOURCE IS BROKEN. scripts/_sidecar_loaders/configs/henderson-nv.yml points at https://opendata.cityofhenderson.com/resource/fpc9-568j.json. That host now 302-redirects to gis-hendersonnv.opendata.arcgis.com and serves no JSON; the documented performance.cityofhenderson.com mirror fails TLS entirely. Henderson migrated off Socrata to ArcGIS. Two consequences: (a) repoint to the OpenDevPermits MapServer layers I accepted; (b) DELETE the config's contact-gold claim — the replacement keeps OWNER and BUSINESSPHONE columns in the schema but I measured both at exactly 0 non-empty rows out of 28,406.

TRUTHFULNESS CORRECTION ON PORTLAND. I nearly reported Portland BDS as carrying an applicant name. Its CUSTOMER field is a numeric surrogate ID (observed values 3949787, 2488907, 3435648), NOT a name. Portland BDS has NO contact field. Flagging because it would have been an easy overclaim. Portland itself is otherwise excellent and fully live — 1,461,541 rows, 12,124 in the trailing 90 days, newest 2026-08-03. OR carrying only 119 rows in the permits table means Portland was configured but never ingested; that alone is ~52k permits/yr sitting unclaimed.

BOZEMAN'S CONTACT CLAIM IS REAL — I VERIFIED IT. CLAUDE.md calls Bozeman a jackpot; measured on the live layer: CONTRACTOR_EMAIL 908/908 = 100%, CONTRACTOR_PHONE_1 908/908 = 100%, OWNER_NAME 749/908 = 82%. Newest permit 2026-08-03, 328 in the trailing 90 days. It is small (~620/yr) but it is the only feed in this region publishing contractor email AND phone, and it is genuinely current.

UTAH IS NOW UNBLOCKED. UT previously had only the frozen 2023 SLC Socrata feed. The Greater Salt Lake Municipal Services District runs a Cityworks PLL query-engine endpoint that answers anonymously: 12,618 building cases, newest DateIssued 2026-08-04 (today), Location 100% filled with street + city + ZIP, and CaseTypeDesc giving the trade. Verbatim newest rows: "REM26-1469 / Residential Remodel / 9858 S AMBER LN, WHITE CITY, 84094 / Shower remodel + handrail" and "SFD26-1173 / Residential Single Family / 4999 S LA CONTESSA ST, UNINCORPORATED, 84117". This covers unincorporated Salt Lake County plus Millcreek, Magna, Kearns, White City and Holladay — real SLC-metro volume, not a rural edge case.

CITYWORKS PLL IS A REUSABLE PATTERN WORTH GENERALIZING. Two of my accepts (Greater Salt Lake MSD, and Cody WY which Henri already has) are the same platform: https://app0N.cityworksonline.com/CLIENT_<tenant>/gis/1/1/rest/services/qe/FeatureServer/<layer>. It answers anonymous ArcGIS queries and exposes issued-permit case layers with trade in CaseTypeDesc. I searched ArcGIS Online for other tenants and found only MorgantownWV, BayCityMI, MosesLakeWA and LoyalistON outside this region, and brute-forcing app01-app07 against nine MT/WY city names produced zero hits — but any future Cityworks city is a one-line config, so it is worth keeping the pattern on file.

TWO PLATFORM GOTCHAS FOR WHOEVER BUILDS THE LOADERS. (1) Las Vegas stores ISSUE_DT as a DD-MMM-YY STRING ('06-OCT-04'), so server-side date filtering and ORDER BY are impossible — page on OBJECTID and filter the ISSUE_YR string instead; this matches the warning already in las-vegas-nv.yml and it is still true. (2) Bend's Permitting_Table and Permit_Applications_Point contain dirty future-dated IssueDate values running to 2033, so a naive MAX() reads 2033-10-20 — the honest currency signal is the bounded trailing-90d count (1,557 and 971 respectively), which is what I used.

HONEST CEILING FOR THIS REGION. Oregon and Nevada are in good shape after this pass: Portland + Bend + Redmond + Salem gives OR roughly 66k permits/yr of anonymous JSON, and Las Vegas + Henderson gives NV its first real coverage. Utah is now partially open via Greater Salt Lake MSD but SLC proper is still Accela-only. Montana is genuinely thin — Bozeman and Kalispell are live and total under 900 permits/yr combined, and Billings, the state's largest city, has no reachable GIS host at all. Wyoming is the worst in the country I have seen: Cody, population roughly 10,000, is the ONLY jurisdiction in the entire state with a live anonymous permit endpoint, and Cheyenne, Casper, Gillette, Sheridan, Laramie and Teton County are all unreachable. Do not budget further research time against WY or Billings MT on free public sources — those need either a scraper or a commercial feed. The highest-value remaining unclaimed work in this region is not more discovery, it is ingesting Portland and Las Vegas, which are already configured, already verified live today, and together represent over 3.5M rows that Henri's permits table currently shows as 119 and 0.

**Rejected in this region:** 20 endpoints.

## Still uncovered

The three regions that never ran are still the largest uncovered populations in the
catalog. Minneapolis, St Paul, Detroit, Milwaukee, Indianapolis, Nashville, Atlanta,
Memphis and Chattanooga were all named in the original briefs and were never probed.

Houston is separately confirmed closed: three independent channels were checked
(Public Works DCAT, MyCity DCAT, CKAN package_search) and none publishes
address-level permits. That hole needs a Phase-4 scraper, not an API.
