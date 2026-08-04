# Free data sources — verified sweep (2026-08-04)

Two multi-agent sweeps: **109 agents, 94 candidates, 90 verified live, 0 errors.**
"Verified live" means an agent issued a real HTTP request and saw the named fields — not that it
read documentation.

**Read `commercial_use` before ingesting anything.** Several high-volume sources (notably state
voter files) are marked `unclear` or prohibit commercial use; those are listed for completeness,
not as a green light.

## Honest framing — what this does and does not solve

Henri's contact gap is **homeowner-side**: `leads.owner_name` 39%, `phone` 0.9%, `email` 0.002%.

- The federal registries below (FMCSA, FCC ULS, DOL EFAST2) carry **business/contractor** contact
  data, not homeowner data. An agent measured FMCSA against Henri's 15 highest-volume real
  contractor names and got **4/15 (27%)** — and those are the largest contractors, the ones most
  likely to hold a USDOT number, so 27% is a ceiling, not an average. These raise
  *contractor-side* fill and help verify contractor identity at onboarding. **They will not move
  `leads.phone` or `leads.email`.**
- **Parcel/assessor layers are the realistic homeowner path** — they yield owner NAME and MAILING
  ADDRESS (direct mail works without a phone). Boston's assessment file additionally carries
  YR_BUILT / ROOF_COVER / HEAT_TYPE, which feeds the enrichment cron's `year_built IS NULL` gate.
- NJ specifically: the statewide parcel layer has **OWNER_NAME empty on all 3.48M rows** (Daniel's
  Law). NJ gives addresses, never owners.

## Verified sources

| State | Class | Records | Commercial use | Source | Endpoint |
|---|---|--:|---|---|---|
| NC | voter | 4,325,404,914 | allowed | North Carolina State Board of Elections — Statewide Voter Registration F | `https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip` |
| ALL |  | 1,555,272,253 | allowed | SEC EDGAR company submissions API + bulk | `https://data.sec.gov/submissions/CIK0000320193.json` |
| ALL | federal | 219,002,208 | allowed | FCC ULS Amateur Radio licence database (complete weekly file, EN.dat + H | `https://data.fcc.gov/download/pub/uls/complete/l_amat.zip` |
| ALL |  | 198,859,506 | allowed | FCC ULS Amateur Radio + GMRS licensee bulk (l_amat / l_gmrs) | `https://data.fcc.gov/download/pub/uls/complete/l_amat.zip` |
| ALL | federal | 77,657,602 | allowed | DOL EFAST2 Form 5500-SF public disclosure file (small-plan employer spon | `https://www.askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_SF_2025_Latest.zip` |
| ALL |  | 50,671,429 | unclear | Cook County IL Assessor — Parcel Addresses (Socrata 3723-97qp) | `https://datacatalog.cookcountyil.gov/resource/3723-97qp.json` |
| FL | parcel | 10,831,924 | allowed | Florida DOR Statewide Cadastral (FDOR Cadastral 2025) | `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0` |
| ALL |  | 10,831,924 | allowed | Florida DOR Statewide Cadastral (NAL assessment roll as ArcGIS FeatureSe | `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0` |
| OH | voter | 7,710,063 | unclear | Ohio Secretary of State — County Voter Files (VOTERFTP bulk download, 88 | `https://www6.ohiosos.gov/ords/f?p=VOTERFTP:DOWNLOAD::FILE::2:P2_PRODUCT_NUMBER:63&cs=1479BA51C958ADD54228B037E` |
| ALL |  | 6,318,338 | allowed | Ohio Statewide Parcels — ODNR owner layer + OGRIP mailing layer (join on | `https://gis.ohiodnr.gov/arcgis/rest/services/OIT_Services/odnr_landbase/MapServer/4` |
| ALL |  | 5,940,709 | allowed | NC OneMap Statewide Parcels (NC1Map_Parcels) | `https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1` |
| PA | recorder | 5,126,373 | unclear | Philadelphia Real Transfer Tax (RTT) Summary — deed + mortgage recorder  | `https://phl.carto.com/api/v2/sql?q=SELECT+*+FROM+rtt_summary` |
| ALL | federal | 4,478,914 | allowed | FMCSA Company Census File (USDOT motor carrier registry) | `https://data.transportation.gov/resource/az4n-8mr2.json` |
| ALL |  | 4,478,914 | allowed | FMCSA Motor Carrier Census (Company Census File) — US DOT | `https://data.transportation.gov/resource/az4n-8mr2.json` |
| ALL |  | 3,827,530 | allowed — fe | New York State Tax Parcels Public (NYS ITS, 2025 roll) | `https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1` |
| NJ | permit | 2,755,796 | allowed | NJ DCA Statewide Construction Permit Data | `https://data.nj.gov/resource/w9se-dmra.json` |
| MN | parcel | 2,708,126 | allowed | Minnesota MnGeo Statewide Parcels (Opt-In Open Data Counties) | `https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/1/que` |
| ALL |  | 2,599,761 | prohibited | Colorado Public Parcels (OIT statewide composite) | `https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0` |
| ALL |  | 2,368,623 | allowed | Austin TX Issued Construction Permits (Socrata 3syk-w9eu) — contractor_p | `https://datahub.austintexas.gov/resource/3syk-w9eu.json` |
| TX | permit | 1,605,031 | allowed | City of Fort Worth Development Permits (live ArcGIS view) | `https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/Feat` |
| MO | permit | 1,524,600 | allowed | Kansas City MO — City Issued Permits (Socrata) | `https://data.kcmo.org/resource/w8jz-wjgn.json` |
| ALL |  | 1,522,185 | allowed | FCC ULS Private + Commercial Land Mobile bulk (l_LMpriv / l_LMcomm) | `https://data.fcc.gov/download/pub/uls/complete/l_LMpriv.zip` |
| OR | permit | 1,461,380 | unclear | City of Portland BDS — All Permits (PortlandMaps ArcGIS) | `https://www.portlandmaps.com/arcgis/rest/services/Public/BDS_Permit/FeatureServer/22/query` |
| ALL |  | 1,303,832 | unclear | Connecticut Business Registry — Agents + Business Master (CT Secretary o | `https://data.ct.gov/resource/qh2m-n44y.json` |
| ALL |  | 1,282,833 | allowed | Connecticut CAMA and Parcel Layer (CT OPM / CT GIS Office) — CC0 | `https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureSe` |
| FL | permit | 1,105,918 | allowed | City of Orlando Permit Applications | `https://data.cityoforlando.net/resource/ryhf-m453.json` |
| CO | recorder | 765,573 | unclear | Adams County CO Property Sales (recorder grantor/grantee) | `https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Property_Sales/FeatureServer/0/query` |
| CO | recorder | 681,304 | unclear | Douglas County CO Property Sales Data (recorder grantor/grantee) | `https://services.arcgis.com/seTexOicoRXDvRsJ/arcgis/rest/services/OpenData/FeatureServer/7/query` |
| MO | permit | 681,036 | unclear | Kansas City MO — Permits - CPD Dataset (CompassKC / Tyler EnerGov, BLDS) | `https://data.kcmo.org/resource/ntw8-aacc.json` |
| OH | permit | 676,292 | allowed | Columbus OH — Building Permits (Accela-backed ArcGIS FeatureServer) | `https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Building_Permits/FeatureServer/0` |
| MA | permit | 658,668 | allowed | Boston Approved Building Permits (Analyze Boston CKAN — LIVE, not the fr | `https://data.boston.gov/api/3/action/datastore_search?resource_id=6ddcd912-32a0-43df-9908-63574f8c7e77` |
| ALL | federal | 602,874 | allowed | FCC ULS GMRS licensee database (weekly complete file l_gmrs.zip) | `https://data.fcc.gov/download/pub/uls/complete/l_gmrs.zip` |
| TX | permit | 546,948 | allowed | City of San Antonio Building Permits (CKAN datastore) | `https://data.sanantonio.gov/api/3/action/datastore_search?resource_id=c21106f9-3ef5-4f3a-8604-f992b4db7512` |
| MI | recorder | 531,997 | unclear | Detroit Assessor Property Sales (grantor/grantee) | `https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/assessor_property_sales_view/FeatureServer/` |
| TX | parcel | 479,360 | allowed | Collin CAD Appraisal Data 2025 (Texas, Socrata on data.texas.gov) | `https://data.texas.gov/resource/vffy-snc6.json` |
| OH | permit | 444,303 | allowed | Cincinnati OH — Building Permits Contacts (owner/contractor roster) [HIS | `https://data.cincinnati-oh.gov/resource/vmk6-gy84.json` |
| NC | parcel | 437,339 | unclear | Wake County NC — Tax Parcels (Property layer, Revenue/CAMA attributes) | `https://maps.wakegov.com/arcgis/rest/services/Property/Parcels/MapServer/0/query` |
| HI | permit | 432,021 | unclear | City & County of Honolulu — Building Permits, Jan 2005 through Jun 30 20 | `https://data.honolulu.gov/resource/4vab-c87q.json` |
| IN | parcel | 410,543 | unclear | Marion County / Indianapolis IN — Assessor ParcelOwner table (Accela HHC | `https://xmaps.indy.gov/arcgis/rest/services/Accela/HHC_ParcelOwner/MapServer/1/query` |
| LA | permit | 345,554 | allowed | City of New Orleans — Permits (Socrata, all divisions) | `https://data.nola.gov/resource/rcm3-fn58.json` |
| IL | parcel | 337,324 | unclear | DuPage County IL — Assessment Parcels (Cadastral Realestate, owner + ass | `https://gis.dupageco.org/arcgis/rest/services/ParcelSearch/DuPageAssessmentParcelViewer/MapServer/4/query` |
| FL | permit | 204,760 | allowed | City of Fort Lauderdale Building Permit Tracker (city only — NOT county- | `https://gis.fortlauderdale.gov/arcgis/rest/services/BuildingPermitTracker/BuildingPermitTracker/MapServer/0/qu` |
| ALL |  | 201,133 | unclear | San Diego County Building Permits — Contractors (BLDS format, Planning & | `https://internal-sandiegocounty.data.socrata.com/resource/76h4-nnmj.json` |
| VA | permit | 200,920 | unclear | City of Virginia Beach VA — Building Permits (ArcGIS FeatureServer) | `https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Building_Permits/FeatureServer/0` |
| OH | permit | 198,610 | allowed | Cleveland OH — Building Permits (City of Cleveland ArcGIS) | `https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Building_Permits/FeatureServer/0` |
| NC | permit | 183,294 | unclear | City of Raleigh NC — Building Permits (ArcGIS hosted) | `https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0` |
| OH | permit | 178,621 | allowed | Cincinnati OH — Building Permits (BLDS) | `https://data.cincinnati-oh.gov/resource/uhjb-xac9.json` |
| ALL |  | 160,707 | allowed | WA L&I Contractor License Data + OR CCB Active Licenses (already ingeste | `https://data.wa.gov/resource/m8qx-ubtq.json` |
| WI | parcel | 159,963 | unclear | City of Milwaukee WI — MPROP full parcel + assessment (Parcels - MPROP_f | `https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/property/parcels_mprop/MapServer/2/query` |
| LA | permit | 142,609 | allowed | East Baton Rouge Parish — EBR Building Permits (Socrata) | `https://data.brla.gov/resource/7fq7-8j7r.json` |
| FL | permit | 139,225 | allowed | Miami-Dade County Building Permits Issued (2 prior years to present) | `https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0/query` |
| MN | permit | 114,665 | unclear | Metropolitan Council MN — Residential Building Permits (Twin Cities 7-co | `https://arcgis.metc.state.mn.us/data1/rest/services/structure/Other_Structure_Public/FeatureServer/0` |
| TN | permit | 112,195 | unclear | Nashville / Davidson County TN — Trade Permits (Electrical, Plumbing, Ga | `https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Trade_Permits_View/FeatureServer/0` |
| TX | permit | 107,087 | allowed | Collin CAD Building Permits (McKinney / Allen / Frisco / Plano / Celina  | `https://data.texas.gov/resource/82ee-gbj5.json` |
| MA | permit | 103,490 | allowed | Somerville MA — Applications for Permits and Licenses (live, near-daily) | `https://data.somervillema.gov/resource/nneb-s3f7.json` |
| NY | license_roster | 103,114 | unclear | NYC DOB License Info (licensed trades roster — GC / Electrical Firm / Su | `https://data.cityofnewyork.us/resource/t8hj-ruu2.json` |
| WA | business | 83,883 | allowed | City of Seattle — Active Business License Tax Certificate (NAICS-23 cons | `https://data.seattle.gov/resource/wnbq-64tb.json` |
| ALL |  | 83,883 | allowed — ve | City business-license / business-tax-receipt Socrata cluster (Seattle WA | `https://cos-data.seattle.gov/resource/wnbq-64tb.json` |
| CO | permit | 78,984 | unclear | City & County of Denver — Residential Construction Permits (ArcGIS Featu | `https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureSer` |
| ALL |  | 69,885 | allowed | NYC DCWP Issued Licenses (Socrata w7w3-xahh; dataset was formerly titled | `https://data.cityofnewyork.us/resource/w7w3-xahh.json` |
| PA | permit | 64,029 | allowed | City of Pittsburgh PLI Permits (WPRDC CKAN) | `https://data.wprdc.org/api/3/action/datastore_search?resource_id=f4d1177a-f597-4c32-8cbf-7885f56253f6` |
| MA | permit | 62,903 | unclear | Framingham MA Building Permits — HISTORICAL ONLY (frozen 2020-06-30) | `https://data.framinghamma.gov/resource/2vzw-yean.json` |
| MA | permit | 54,340 | allowed | Cambridge MA permit family (8 Socrata datasets) — per-trade cost split + | `https://data.cambridgema.gov/resource/qu2z-8suj.json` |
| NC | permit | 52,218 | unclear | Mecklenburg County NC — Building Permits (Accela feed) | `https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits_Accela/MapServer/0/query` |
| NE | permit | 51,978 | unclear | MAPA Regional Building Permits (Omaha–Council Bluffs 8-county aggregator | `https://services.arcgis.com/CHjpJeHqytL8t8op/arcgis/rest/services/Building_Permits_as_of_October_2019/FeatureS` |
| NM | permit | 45,382 | unclear | City of Albuquerque — City Building Permits (AGIS FeatureServer) | `https://coageo.cabq.gov/cabqgeo/rest/services/agis/City_Building_Permits/FeatureServer/0/query` |
| CO | permit | 42,864 | unclear | City & County of Denver — Commercial Construction Permits (ArcGIS Featur | `https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_COMMERCIALCONSTPERMIT_P/FeatureServ` |
| GA | permit | 34,795 | unclear | City of Atlanta — Accela building permits (live ArcGIS point feed) | `https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/` |
| TN | permit | 31,868 | unclear | Chattanooga / Hamilton County TN — New-Construction Building Permits (CH | `https://services2.arcgis.com/cclAu9OKhOfjeUdr/arcgis/rest/services/Building_Permits_to_April_2021/FeatureServe` |
| ALL | federal | 23,783 | allowed | HUD Multifamily Properties - Assisted (management-agent contacts) | `https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServe` |
| WI | permit | 16,685 | allowed | Milwaukee WI — Residential and Commercial Permit Work Data (DNS) | `https://data.milwaukee.gov/api/3/action/datastore_search?resource_id=828e9630-d7cb-42e4-960e-964eae916397` |
| MO | permit | 12,332 | unclear | Missouri DNR — Asbestos Demolition Notifications (vatz-3gek) + Asbestos  | `https://data.mo.gov/resource/vatz-3gek.json` |
| TX | license_roster | 9,453 | allowed | City of Dallas — Active Contractors (contractor registration roster) | `https://www.dallasopendata.com/resource/jhgk-eg9m.json` |
| FL | business | 7,405 | allowed | City of Gainesville FL — Active and Inactive Businesses (highest EMAIL f | `https://data.cityofgainesville.org/resource/hk2b-em59.json` |
| ALL |  | 2,026 | allowed | FMCSA Company Census File (US DOT / data.transportation.gov Socrata) | `https://data.transportation.gov/resource/az4n-8mr2.json` |
| WY | permit | 542 | unclear | City of Cody WY — Building Permits 2026 (Cityworks PLL public map servic | `https://app06.cityworksonline.com/CLIENT_CodyWY/gis/1/1/rest/services/qe/FeatureServer/7/query` |
| ALL | federal | 200 | allowed | NPPES NPI Registry API (CMS national provider registry) | `https://npiregistry.cms.hhs.gov/api/?version=2.1` |

## Detail — top 20 by volume

### North Carolina State Board of Elections — Statewide Voter Registration File (ncvoter)
- **State / class**: NC / voter
- **Records**: ~9.0M rows statewide, all statuses. Derived from the exact zip64 central-directory uncompressed size (4,325,404,914 bytes) divided by a measured 480 chars/row weighted across 3 counties — NOT an exact count. ~73% Active (Yancey exact: 12,558 A / 1,932 I / 2,668 R / 114 D = 17,272 total). Mecklenburg approx 970k rows. Statewide zip 519,324,493 bytes; per-county zips range 437 KB (ncvoter15) to 62 M
- **Platform**: csv · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip`
- **Fields**: address: res_street_address + res_city_desc + state_cd + zip_code (5-digit) / person name: first_name, middle_name, last_name, name_suffix_lbl / phone: full_phone_number (exactly 10 digits, no punctuation — verified 8,006/8,006 well-formed, 0 non-digit) / email: NONE — no email column exists in the 70-col layout / mailing address: mail_addr1, mail_addr2, mail_addr3, mail_addr4, mail_city, mail_state, mail_zipcode / value: NONE / date: registr_dt (MM/DD/YYYY) / join/filter keys: ncid (stable person key, links to the ncvhis voter-history file), county_id, county_desc, status_cd (A/I/R/D), voter_status_desc, confidential_ind, birth_year, party_cd, precinct_desc
- **Example**: `https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter100.zip`
- **Notes**: VERIFIED LIVE 2026-08-04. Downloaded ncvoter100.zip (841,745 bytes, HTTP 200, no auth), unzipped to ncvoter100.txt (7,492,640 bytes), parsed 17,272 rows / 70 tab-delimited quoted columns. Every field named above was observed. Real active row: LINDA DALE ABERCROMBIE / '1156  BYRD BRANCH RD   ' / BURNSVILLE / NC / 28714 / 8284420355 / registr_dt 03/04/2021 / ncid ES29559. Statewide zip separately verified by range request: same 70-col header, single member ncvoter_Statewide.txt, sorted by county (ALAMANCE first). Official layout doc live at https://s3.amazonaws.com/dl.ncsbe.gov/data/layout_ncvoter.txt.  CORRECTION TO THE CANDIDATE'S PHONE ESTIMATE — the '~30-35% statewide blended' figure is almost certainly too LOW. I measured three counties and the spread is far wider than stated: Yancey (rural, county 100) 63.8% of active; Mecklenburg/Charlotte (metro, county 60) 26.9% of active on a 65,225-row head slice; Alamance (mid-size, county 1) 79.0% of active on a 38,141-row head slice. Range is 27-79%, not a tight band. A true statewide blend cannot be measured without pulling the 519 MB file, so treat blended fill as UNMEASURED — plan per-county. Metro/urban counties (where Henri's permi

### SEC EDGAR company submissions API + bulk
- **State / class**:  / 
- **Records**: VERIFIED: bulk submissions.zip is exactly 1,555,272,253 bytes (1.56 GB), Last-Modified 2026-08-04 — candidate's byte count was exact. ~900k CIK filers is the right order of magnitude for TOTAL filers, but the PROPERTY slice is far smaller than the candidate implies. Measured live filer counts by SIC: 1531 Operative Builders=178, 6500 Real Estate=300, 6512 Apartment Operators=199, 6513 Apartment Op
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://data.sec.gov/submissions/CIK0000320193.json`
- **Fields**: registrant/ENTITY name, phone, business address (street, city, state, zip), mailing address, former names, EIN, state of incorporation. IMPORTANT CORRECTION: the address is the entity's CORPORATE/HQ address, NOT the property address on the permit. Yields no homeowner name, no email, and nothing tied to a specific parcel.
- **Example**: ``
- **Notes**: 

### FCC ULS Amateur Radio licence database (complete weekly file, EN.dat + HD.dat)
- **State / class**: ALL / federal
- **Records**: ~1.70M EN records estimated (EN.dat 219,002,208 bytes uncompressed / 128.78 avg bytes-per-record measured on a 19,726-row sample decompressed from the complete file). Of those, ~93.4% are individual-with-street-address. CRITICAL: only ~40-43% carry license_status='A' in HD.dat, so realistic USABLE yield is roughly 650k-1.1M active residential name-to-street-address pairs (wide range because the sa
- **Platform**: csv · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://data.fcc.gov/download/pub/uls/complete/l_amat.zip`
- **Fields**: Pipe-delimited positional .dat inside a zip. NOTE: the index numbers below are 0-BASED array offsets after split('/'), NOT the FCC spec's 1-based positions — verified against real rows. EN.dat (219,002,208 bytes uncompressed, 30 fields/row): 0=record_type('EN'), 1=unique_system_identifier (JOIN KEY), 4=call_sign, 5=entity_type('L'), 7=entity_name ('LAST, FIRST M'), 8=first_name (98.4% fill), 9=middle_initial, 10=last_name (98.4%), 12=phone (0.00% — ALWAYS EMPTY), 13=fax (0.00% — ALWAYS EMPTY), 14=email (0.00% — ALWAYS EMPTY), 15=street_address (94.66% fill), 16=city (100%), 17=state (100%, NOT reliably uppercase — 'Ms' observed, must .upper()), 18=zip_code (100%, never hyphenated, MIXED leng
- **Example**: `https://data.fcc.gov/download/pub/uls/daily/l_am_mon.zip`
- **Notes**: VERIFIED LIVE 2026-08-04 at two levels. (1) Daily delta l_am_mon.zip fetched (HTTP 200, 25,893 bytes) and EN.dat parsed — the two rows quoted in the candidate appear VERBATIM. (2) The 198MB complete file was verified WITHOUT downloading it: HTTP Range requests (server returns 206, Accept-Ranges: bytes) retrieved the ZIP central directory, then a 1MB Range slice of EN.dat's raw-deflate stream was incrementally decompressed to recover 19,726 real rows from the complete file itself. Both samples agree.  CONFIRMED: phone/fax/email are 0.00% filled across 19,726 complete-file rows AND all 178 delta rows — the candidate's 'NO phone, NO email' warning is exactly right, this adds owner NAME + MAILING ADDRESS only. Also confirmed: no auth, public-domain federal data, and NO live query API (data.fcc.gov/api/license-view returns 301, wireless2.fcc.gov ULS search returns 403 to non-browser) — bulk zip is the only access path.  SIX CORRECTIONS to the candidate: 1. **BIGGEST MISS — license status.** EN.dat carries NO status field. HD.dat idx5 shows only ~40-43% 'A' (Active); the rest are 'E' (Expired, 7,929) and 'C' (Cancelled, 1,824). Amateur licences run 10-year terms, so an expired record's a

### FCC ULS Amateur Radio + GMRS licensee bulk (l_amat / l_gmrs)
- **State / class**:  / 
- **Records**: CORRECTED. Byte counts confirmed exactly as claimed: l_amat.zip = 198,859,506 bytes, l_gmrs.zip = 53,487,756 bytes, both Last-Modified Sun 02 Aug 2026. But the '~1.6M individual licensees' figure was wrong in both directions. Full-file parse: amateur EN.dat = 1,692,306 rows, GMRS EN.dat = 602,874 rows = 2,295,180 raw license records. However only 1,272,733 are license_status='A' (Active) per HD.da
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://data.fcc.gov/download/pub/uls/complete/l_amat.zip`
- **Fields**: licensee full name (entity_name + first/middle/last) + RESIDENTIAL mailing address (street, city, state, zip). CONFIRMED AT FULL SCALE: NO phone, NO email, NO fax.
- **Example**: ``
- **Notes**: 

### DOL EFAST2 Form 5500-SF public disclosure file (small-plan employer sponsors)
- **State / class**: ALL / federal
- **Records**: Independently corroborated. Zip = 77,657,602 bytes (74 MB); it expands to ONE member, f_5500_sf_2025_latest.csv, at 358,515,493 bytes = 342 MB (candidate reported only the zip size — the 342 MB uncompressed footprint is the real operational cost). Measured 751.7 bytes/row on a live 20,256-row sample, extrapolating to ~476,900 rows — within 0.5% of the candidate's full-parse figure of 479,129, so t
- **Platform**: csv · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://www.askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_SF_2025_Latest.zip`
- **Fields**: VERIFIED LIVE against the real CSV header (191 columns, exact match to the bundled layout). Fill rates below are measured on a 20,256-row live sample.  BUSINESS/OWNER NAME: SF_SPONSOR_NAME (100.0%) / SF_SPONSOR_DFE_DBA_NAME (1.0% — near-useless) MAILING ADDRESS: SF_SPONS_US_ADDRESS1 (100.0%), SF_SPONS_US_ADDRESS2 (14.9%), SF_SPONS_US_CITY (100.0%), SF_SPONS_US_STATE (100.0%), SF_SPONS_US_ZIP (100.0%). 7.3% of sponsor addresses are PO boxes. PHONE: SF_SPONS_PHONE_NUM (99.5%, 10-digit unformatted e.g. '3032925537') — this is the ONLY high-fill phone. SF_ADMIN_PHONE_NUM is 5.5%; SF_PREPARER_PHONE_NUM is 0.0% (empty column); SF_FDCRY_TRUSTE_CUST_PHONE_NUM also present. PERSON NAME: SF_ADMIN_SIGN
- **Example**: `curl -sL -H "Range: bytes=0-3500000" "https://www.askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_SF_2025_Latest.zip" -o head.zipfrag   # then raw-inflate past the 30+filename-byte local header with zlib.decompressobj(-15) to get ~20k real CSV rows without pul`
- **Notes**: VERIFIED LIVE 2026-08-04 by range-fetching only the first 3.5 MB and stream-inflating it to 15.2 MB of real CSV — 20,256 parsed data rows, 191-column header matching the layout exactly. I did NOT download the full file. Real rows seen, including the candidate's own example verbatim: 'WALKER COMPONENT GROUP, INC. / 420 E. 58TH AVENUE / DENVER, CO 80216 / ph=3032925537 / NAICS 423990 / recd=2026-02-25', plus construction rows like 'EVERGREEN RENOVATIONS, INC. / 4824 SW SCHOLLS FERRY ROAD / PORTLAND, OR / ph=5038287947 / 236110' and 'JOHN T AMBROSE HOME IMPROVEMENT / 11 ESTES ST / IPSWICH, MA / ph=9783871760 / 238900'.  URL CORRECTED: use the www host directly — https://www.askebsa.dol.gov/FOIA%20Files/2025/Latest/... returns HTTP 200 with no redirect. The candidate's askebsa.dol.gov host 301s to a Location header containing a LITERAL UNENCODED SPACE, which breaks strict HTTP clients; curl -L tolerates it, many libraries do not. Server sends Accept-Ranges: bytes, so ranged sampling works (206 Partial Content confirmed).  CORRECTIONS TO THE CANDIDATE: (1) SF_ADMIN_NAME is only 5.6% filled, not a usable person field — the candidate led with it. The real person-name field is SF_ADMIN_SIG

### Cook County IL Assessor — Parcel Addresses (Socrata 3723-97qp)
- **State / class**:  / 
- **Records**: 50,671,429 rows total across all roll years (2011-2026). Per-year parcel universe is ~1.86M. VERIFIED live counts: year 2026 = 1,863,575 (CURRENT roll year); 2025 = 1,863,808; 2024 = 1,864,112; 2023 = 1,864,162. Dataset last updated 2026-08-01 (3 days before verification), refreshed semi-monthly.
- **Platform**:  · **Auth**: none — anonymous requests return HTTP 200. No app token required; no rate-limit headers returned on anonymous access. Register a free Socrata app token only if you exceed the anonymous throttle under sustained paging. · **Commercial use**: unclear
- **Endpoint**: `https://datacatalog.cookcountyil.gov/resource/3723-97qp.json`
- **Fields**: owner NAME + MAILING ADDRESS only. NO PHONE, NO EMAIL — this source does not move Henri's phone/email gap at all.  Name fields (two variants, verified fill across all 50,671,429 rows): - owner_address_name — 50,661,488 non-null (99.98%) — BEST name field, use this as primary - mail_address_name — 48,002,851 non-null (94.73%) — taxpayer of record  Mailing address: mail_address_full (94.73%), mail_address_city_name, mail_address_state, mail_address_zipcode_1 (94.2%); plus owner_address_full / owner_address_city_name / owner_address_state / owner_address_zipcode_1 variant.  Site address (the permit join key): prop_address_full (99.73%), prop_address_city_name (99.99%), prop_address_state, prop_
- **Example**: ``
- **Notes**: 

### Florida DOR Statewide Cadastral (FDOR Cadastral 2025)
- **State / class**: FL / parcel
- **Records**: 10,831,924 (verified exactly via where=1%3D1&returnCountOnly=true, HTTP 200)
- **Platform**: arcgis · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query`
- **Fields**: VERIFIED against the layer's full 121-field schema. address=PHY_ADDR1 (98.8% fill) + PHY_ADDR2 + PHY_CITY (90%) + PHY_ZIPCD (90%, numeric/Double not string); owner=OWN_NAME (98.8-99.8% fill) + FIDU_NAME (fiduciary/trustee); owner mailing=OWN_ADDR1, OWN_ADDR2, OWN_CITY, OWN_STATE, OWN_ZIPCD (all ~98.5-98.8%); phone=NONE; email=NONE (confirmed absent across all 121 fields); value=JV (just/market, 98.8%), LND_VAL, AV_SD, NCONST_VAL (new-construction delta — only 1.0-4.8% fill); year_built=ACT_YR_BLT (88-92%) and EFF_YR_BLT; sqft=TOT_LVG_AR (88%) + LND_SQFOOT; also NO_BULDNG, NO_RES_UNT, IMP_QUAL, CONST_CLAS, DT_LAST_IN; sale=SALE_YR1+SALE_MO1+SALE_PRC1+QUAL_CD1 (and ...2 for prior sale) — SPARS
- **Example**: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query?where=ACT_YR_BLT%3E2015%20AND%20PHY_ADDR1%20IS%20NOT%20NULL&outFields=PARCEL_ID,PHY_ADDR1,PHY_CITY,PHY_ZIPCD,OWN_NAME,OWN_ADDR1,OWN_CITY,OWN_ST`
- **Notes**: VERIFIED LIVE 2026-08-04. The example_request returned HTTP 200 with real rows (e.g. PARCEL_ID 17125-000-000, 13367 NE 148TH AVE, WALDO 32694, OWN_NAME 'GATEWOOD SHERITA', ACT_YR_BLT 2020, TOT_LVG_AR 1560, JV 147960). Layer name 'FDOR Cadastral 2025'; FL Dept of Revenue PTO tax roll (NAL file) from all 67 county property appraisers, joined to GIS parcel polygons, exported Aug 2025 from April 2025 county submissions. Candidate's core value claim CONFIRMED: owner name + owner MAILING address + year_built + living sqft + assessed value statewide, no auth, queryable via existing load_parcels_arcgis.py with no new loader shape. THREE CANDIDATE CLAIMS ARE WRONG — correct before building: (1) CO_NO IS NOT INDEXED. The layer's only attribute indexes are OBJECTID (PK) and PARCEL_ID; CO_NO returnCountOnly also 400s, and a CO_NO=13 feature fetch took 13.0s. Do NOT chunk by CO_NO. Chunk by OBJECTID ranges instead — where=OBJECTID>N AND OBJECTID<=N+2000 is fast (full count 0.34s, windowed page 2.2s) and resultOffset paging within a window verified working. (2) '+'-as-space does NOT trigger a 400 — the same where clause with '+' separators returned HTTP 200 with data. That gotcha is false; %20 a

### Florida DOR Statewide Cadastral (NAL assessment roll as ArcGIS FeatureServer)
- **State / class**:  / 
- **Records**: 10,831,924 (verified live via returnCountOnly). All 67 counties, single layer, ASMNT_YR 2025 (a small share of rows carry ASMNT_YR 0 / blank attributes).
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0`
- **Fields**: owner_name (OWN_NAME, 99.6% filled) + owner mailing (OWN_ADDR1/OWN_ADDR2/OWN_CITY/OWN_STATE/OWN_ZIPCD, 98.9-99.5%) + site address (PHY_ADDR1/PHY_ADDR2/PHY_CITY/PHY_ZIPCD, 92-94%) + a second fiduciary/trustee contact block (FIDU_NAME/FIDU_ADDR1/FIDU_CITY/FIDU_STATE/FIDU_ZIPCD) useful when OWN_NAME is an LLC or trust. NO phone, NO email anywhere in the 121-field schema (verified against full field list).
- **Example**: ``
- **Notes**: 

### Ohio Secretary of State — County Voter Files (VOTERFTP bulk download, 88 county .txt files)
- **State / class**: OH / voter
- **Records**: ~7.7M voter rows across 88 county .txt files, 4.58 GB uncompressed total. Verified live: PAULDING.txt = 7,710,063 bytes (~12.1k rows, 637 bytes/row); ADAMS.txt = 10,582,862 bytes; FRANKLIN.txt (Columbus) = 529,407,282 bytes. All 88 counties stamped Last Updated 01-AUG-26 (3 days before probe date 2026-08-04) — weekly full-file refresh confirmed.
- **Platform**: csv · **Auth**: none · **Commercial use**: unclear
- **Endpoint**: `https://www6.ohiosos.gov/ords/f?p=VOTERFTP:DOWNLOAD::FILE::2:P2_PRODUCT_NUMBER:63&cs=1479BA51C958ADD54228B037E8D438B84`
- **Fields**: address: RESIDENTIAL_ADDRESS1 + RESIDENTIAL_SECONDARY_ADDR + RESIDENTIAL_CITY + RESIDENTIAL_STATE + RESIDENTIAL_ZIP + RESIDENTIAL_ZIP_PLUS4 (all 100% filled in sample) / name: FIRST_NAME, MIDDLE_NAME, LAST_NAME, SUFFIX (100%) / mailing address: MAILING_ADDRESS1 + MAILING_SECONDARY_ADDRESS + MAILING_CITY + MAILING_STATE + MAILING_ZIP + MAILING_ZIP_PLUS4 (only 9.1% filled) / date: REGISTRATION_DATE (100%, ISO yyyy-mm-dd) / also: DATE_OF_BIRTH (100%), VOTER_STATUS (ACTIVE/CONFIRMATION), PARTY_AFFILIATION, COUNTY_NUMBER, COUNTY_ID / person key: SOS_VOTERID (e.g. OH0011102498) / PHONE: NONE — verified absent / EMAIL: NONE — verified absent / value: NONE
- **Example**: `https://www6.ohiosos.gov/ords/f?p=VOTERFTP:DOWNLOAD::FILE::2:P2_PRODUCT_NUMBER:63&cs=1479BA51C958ADD54228B037E8D438B84`
- **Notes**: VERIFIED LIVE 2026-08-04. Fetched PAULDING (product 63): HTTP 200, Content-Disposition attachment; filename="PAULDING.txt", 7,710,063 bytes. Parsed 1,413 real rows. Generalization re-verified on product 1 -> ADAMS.txt and product 25 -> FRANKLIN.txt (product->county map is strictly alphabetical 1=ADAMS .. 88=WYANDOT and matches Content-Disposition exactly).  THE CANDIDATE'S CORE CLAIM IS CONFIRMED — AND IT IS A REAL CLAUDE.md BUG. I enumerated the full header: 137 columns, of which 91 are vote-history columns. Regex scan for phone/tel/email/cell/mobile returned ZERO matches. Ohio's voter file has NO phone and NO email column. CLAUDE.md repeatedly describes 'NC + OH voter coverage' as a free PHONE source and lists OH in the pre-launch phone-fill plan ('launch on NC + OH voter coverage (free phone source for those 2 states)'). That line is wrong for Ohio and must be fixed; do not size any phone-fill projection off OH.  BOTH OF THE CANDIDATE'S URLs WERE WRONG — CORRECTED ABOVE. (1) Its example_request (data.ohiosos.gov/portal/voter-registration) is a landing page AND returns HTTP 403. (2) Its url field used '...:DOWNLOAD::FILE:NO:2:P2_PRODUCT_NUMBER:63' with no checksum — that also 403

### Ohio Statewide Parcels — ODNR owner layer + OGRIP mailing layer (join on statewide PIN)
- **State / class**:  / 
- **Records**: ODNR: 6,318,338 parcels; 5,230,049 with OWNER1 populated (82.8%) — both counts confirmed exact. OGRIP: 6,313,610 rows — count confirmed exact, BUT this is the row count, NOT the mailing-bearing count. CORRECTION: measured per-county mailing fill (MailZip non-null) across the 8 largest counties = 892,831/2,400,400 = 37%, and it is wildly uneven: Hamilton 98%, Stark 98%, Butler 95%, Franklin 40%, Lu
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://gis.ohiodnr.gov/arcgis/rest/services/OIT_Services/odnr_landbase/MapServer/4`
- **Fields**: owner_name (OWNER1, OWNER2) from ODNR — VERIFIED, 82.8% fill. mailing (MailAddressAll, MailNumber, MailStreetName, MailCity, MailState, MailZip) + site address (SitusAddressAll) from OGRIP — VERIFIED present but PARTIAL fill (~37%, see est_records). No phone, no email in either layer (confirmed against full field lists).
- **Example**: ``
- **Notes**: 

### NC OneMap Statewide Parcels (NC1Map_Parcels)
- **State / class**:  / 
- **Records**: 5,940,709 parcel polygons — verified live via returnCountOnly. 100 counties present + Eastern Band of Cherokee Indians. Layer 0 (points) carries the identical 68 attributes and is cheaper to page.
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1`
- **Fields**: owner_name: ownname (99.0% fill, 5,882,520 rows) + ownname2. Mailing: mailadd (99.3%), mcity, mstate (86.2%), mzip (85.2%), munit. Site address: siteadd (86.7%), scity (39.7%), szip (ONLY 25.8%). Property context: parval, improvval, landval, structyear (45.8%), saledate, gisacres, parusedesc/parusedsc2, owntype, subdivisio. NO phone, NO email (confirmed against the full 70-field schema). CORRECTION: pre-parsed ownfrst/ownlast exist in the schema but are populated in ONLY 2 of 100 counties — ownfrst 383,970 rows (6.5%) and ownlast 501,395 rows (8.4%), all in Mecklenburg + Orange.
- **Example**: ``
- **Notes**: 

### Philadelphia Real Transfer Tax (RTT) Summary — deed + mortgage recorder feed
- **State / class**: PA / recorder
- **Records**: 5,126,373 total rows (verified exact via count(*)), spanning recording_date 1974-01-02 to 2026-06-13. Recurring volume: 35,220 DEED rows in the trailing 365 days (~96/day, ~35k/yr). The candidate's '4,282 DEED in last 90 days' is exact but MISLEADING — the now()-90d window (2026-05-06 → 2026-08-04) contains only ~38 days of actual published data because the feed ends 2026-06-13. Other doc types in
- **Platform**: rest · **Auth**: none · **Commercial use**: unclear
- **Endpoint**: `https://phl.carto.com/api/v2/sql?q=SELECT+*+FROM+rtt_summary`
- **Fields**: 51 columns total, all verified live. ADDRESS: street_address (full, 100% fill) + components address_low/address_high/address_low_frac/address_low_suffix/street_predir/street_name/street_suffix/street_postdir; unit_num (11.8% fill on 2026 deeds); zip_code (varchar, 9-digit UNPADDED e.g. '191285029' = 19128-5029, 86.5% fill); ward; condo_name. OWNER/PEOPLE: grantees = BUYER (text, 100% fill, semicolon-delimited multi-party e.g. 'WENTZ ELIZABETH A;VALANDRA PATRICK'); grantors = SELLER (text). VALUE: total_consideration, cash_consideration, other_consideration, fair_market_value, assessed_value, common_level_ratio, local_tax_amount, state_tax_amount, local_tax_percent, state_tax_percent, plus 'a
- **Example**: `https://phl.carto.com/api/v2/sql?q=SELECT%20street_address%2Czip_code%2Cgrantors%2Cgrantees%2Ctotal_consideration%2Cdocument_type%2Crecording_date%20FROM%20rtt_summary%20WHERE%20document_type%3D%27DEED%27%20AND%20recording_date%20%3E%20now()%20-%20interval%20%`
- **Notes**: VERIFIED LIVE — the example_request returned 3 real rows in 3.2s, no auth, no key, no headers. Sample row: street_address='4148 MANAYUNK AVE', zip_code='191285029', grantors='REVOCABLE DEED OF TRUST JAMES BRUNO A/K/A JAMES ALLEN BRUNO', grantees='BARRETT KYLE J', total_consideration=350000, recording_date=2026-05-06. All candidate claims re-probed independently and confirmed. THREE CORRECTIONS TO THE CANDIDATE: (1) commercial_use downgraded 'allowed' -> 'unclear'. The dataset carries the 'City of Philadelphia License' (raw text at github.com/CityOfPhiladelphia/terms-of-use/LICENSE.md), which is a disclaimer + indemnification instrument, NOT a CC0/public-domain grant. It states the City 'retains all trademark, service mark, copyright, patent, trade secret, and other proprietary rights therein' and requires the user to indemnify the City for downstream use. There is no explicit commercial PROHIBITION (unlike voter files), and the underlying recorded deeds are PA public records by statute, but there is also no affirmative commercial grant — treat as legal-review-before-resale, not clean-green. (2) est_records reframed: the 90-day DEED figure overstates freshness (see est_records field

### FMCSA Company Census File (USDOT motor carrier registry)
- **State / class**: ALL / federal
- **Records**: VERIFIED EXACT: 4,478,914 total rows; 2,232,593 status_code='A'; 1,696,346 ACTIVE rows carry an email. Nationwide fill: phone 4,330,601 (96.7%), company_officer_1 3,818,597 (85.3%). Construction-trade subset (ACTIVE + email + crgo_construct OR crgo_bldgmat): 414,714 nationwide, GA 17,173, KS 4,291. Gap-state phy_state totals re-verified live today, all 8 spot-checks matched the candidate exactly: 
- **Platform**: socrata · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://data.transportation.gov/resource/az4n-8mr2.json`
- **Fields**: address: phy_street, phy_city, phy_state, phy_zip, phy_cnty / mailing: carrier_mailing_street, carrier_mailing_city, carrier_mailing_state, carrier_mailing_zip / owner/person: legal_name, dba_name, company_officer_1, company_officer_2 / phone: phone, cell_phone, fax (fax IS in the schema, 1,159,523 non-null — candidate was right) / email: email_address / value(proxy): power_units, truck_units, total_drivers, total_cdl, mcs150_mileage, fleetsize / date: mcs150_date (last self-update, confirmed 'YYYYMMDD HHMM' e.g. '20260304 1913'), add_date, review_date, safety_rating_date / status: status_code (A=active, I=inactive) / TRADE FILTER (candidate missed these — highest-value columns for Henri): c
- **Example**: `https://data.transportation.gov/resource/az4n-8mr2.json?$limit=5&$where=phy_state%3D%27KS%27%20AND%20email_address%20IS%20NOT%20NULL`
- **Notes**: VERIFIED LIVE 2026-08-04. example_request returned HTTP 200 with 3 real rows; every named field observed populated (phone=6203654507, cell_phone=3037177568, email_address=BRIAN.CARR@GATES.COM, company_officer_1=MONICA JUNG, phy_street=1450 MONTANA RD IOLA KS 66749). No auth, no app token needed. rowsUpdatedAt=2026-08-04T10:51:36Z (TODAY — candidate said 08-03), confirming the R/P1D daily refresh. Publisher FMCSA, Public Access Level 'public', 614,258 downloads.  THREE CORRECTIONS TO THE CANDIDATE: (1) OFFICER FILL OVERSTATED. Candidate claimed ~85-95%. Measured: nationwide 85.3%, GA 85.1%, KS 80.7%. Real range is ~81-85%, not 85-95%. (2) THE 'power_units=1 => residence' INFERENCE IS WRONG AS STATED. I sampled KS power_units='1' + ACTIVE + email and got incorporated businesses at commercial addresses (CURTIS MACHINE COMPANY INC / FILSON MANUFACTURING CO / LUSCO BRICK & STONE CO / FLEET MAINTENANCE INC), not residences. The correct filter for the owner-operator/residential segment is business_org_desc='INDIVIDUAL' (216,717 rows nationally) or legal_name==company_officer_1. That filter DOES produce the claimed pattern — KS sample returned CRAIG HATCH @ 1107 N GROVE YATES CENTER (kansa

### FMCSA Motor Carrier Census (Company Census File) — US DOT
- **State / class**:  / 
- **Records**: VERIFIED EXACT — all three claimed counts reproduced by live SoQL aggregates. Total 4,478,914. status_code breakdown: A=2,232,593 / I=2,245,342 / P=979. Active + phone NOT NULL = 2,218,606. Active + email_address NOT NULL = 1,696,346. Construction-relevant subset: 369,565 active carriers carry the crgo_construct flag, of which 290,520 have BOTH phone and email. Dataset is refreshed daily (Update F
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://data.transportation.gov/resource/az4n-8mr2.json`
- **Fields**: owner_name (legal_name 4,429,475 non-null; dba_name 1,175,048; company_officer_1 3,789,209), phone (phone 4,281,067; cell_phone 1,919,766), email (email_address 2,895,511), mailing (phy_street/city/state/zip + carrier_mailing_street/city/state/zip, ~100% fill). All 147 columns confirmed present via /api/views/az4n-8mr2.json. Measured contact quality on a live 50k-row page: 99.2% of emails are RFC-shaped, 100% of phones are >=10 digits, 100% phy_zip fill.
- **Example**: ``
- **Notes**: 

### New York State Tax Parcels Public (NYS ITS, 2025 roll)
- **State / class**:  / 
- **Records**: 3,827,530 total parcels (verified exact: returnCountOnly=true on where=1=1). 1,826,298 rows match PROP_CLASS='210' AND PRIMARY_OWNER IS NOT NULL (verified exact — candidate's figure was right to the digit). 3,810,144 rows have any PRIMARY_OWNER. County spot-checks: Suffolk 586,600 (425,285 class-210 w/ owner), Erie 370,424 (241,531), Westchester 258,145 (163,973), Queens 324,164, Kings 275,680.
- **Platform**:  · **Auth**: none — anonymous GET, no token, no key, no referer requirement. All probes returned 200 with data. · **Commercial use**: allowed — fetched the AGOL item (arcgis.com/sharing/rest/content/items/8af5cef967f8474a9f262684b8908737?f=json). licenseInfo is a pure warranty disclaimer: data provided 'as is', State disclaims liability, followed by 'This map service is available to the public.' No commercial-use restriction, no attribution mandate, no redistribution clause. accessInformation only names the contributing counties, NYS ITS Geospatial Services, and NYSDTF ORPTS as credit.
- **Endpoint**: `https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1`
- **Fields**: owner_name: PRIMARY_OWNER + ADD_OWNER — 3,810,144 of 3,827,530 rows populated (99.5%), verified by returnCountOnly. Person-level names in both upstate ORPTS rows and NYC MapPLUTO rows (sampled: 'Matysiak, Edward F' / 'YIP, ANNIE LIT KWANLAU'). mailing: MAIL_ADDR, PO_BOX, MAIL_CITY, MAIL_STATE, MAIL_ZIP (+ ADD_MAIL_* for second owner) — 2,820,570 of 3,827,530 (73.7%), NOT universal. CORRECTION vs candidate: all 5 NYC boroughs have MAIL_ADDR populated on ZERO rows (Kings 0/275,680; Queens 0/324,164 — verified). site address: PARCEL_ADDR 3,810,667 (99.6%); LOC_ST_NBR / LOC_STREET / LOC_UNIT. CORRECTION: LOC_ZIP is only 2,359,383 (61.6%) — 38% null, so it is a weak join key. NO PHONE and NO EMAI
- **Example**: ``
- **Notes**: 

### NJ DCA Statewide Construction Permit Data
- **State / class**: NJ / permit
- **Records**: 2,755,796 exact (via $select=count(1), fetched live). 412,193 rows dated 2025; 186,589 dated 2026 YTD. 561 distinct municipalities (count(distinct comu)). 142,677 of the 186,589 2026 rows are usegroup R-5 (IRC residential) = 76.5% residential mix.
- **Platform**: socrata · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://data.nj.gov/resource/w9se-dmra.json`
- **Fields**: address=NONE — no street field exists. Location resolves ONLY to muniname + munitype + county + block + lot (+ comu/treasurycode muni codes). owner=NONE. phone=NONE. email=NONE. value=constcost (also squarefeet, cubic, salegained, rentgained). date=permitdate (issue), certdate (CO), processdate (DCA receipt). TRADE FEE COLUMNS (trade attribution): buildfee, plumbfee, electfee, firefee, elevfee, dcafee, certfee, otherfee, totalfee. Other: recordid, permitno, status, permitstatusdesc, permittype, permittypedesc, update, certtype, certtypedesc, certcount, usegroup, usegroupdesc, censusnumber, censusdesc, public, storage, manufactured, hudseal, source, sourcedesc, version, pk. Exactly 46 columns
- **Example**: `https://data.nj.gov/resource/w9se-dmra.json?$limit=5&$where=permitdate%20%3E%20%272026-01-01%27`
- **Notes**: VERIFIED LIVE 2026-08-04: HTTP 200, returned real rows (sample: ATLANTIC CITY, block 112 lot 3, permitno 20260002, permittypedesc Alteration, constcost 11200, usegroup R-5). License Public Domain, publisher NJ OIT Open Data Center, refresh Monthly, contact ContactDataNJ@tech.nj.gov. CORRECTIONS TO CANDIDATE: (1) newest permitdate is 2026-07-08, not 2026-06-02 (max processdate 2026-07-07); (2) year counts drift slightly from candidate — measured 412,193 for 2025 and 186,589 for 2026 YTD. CONFIRMED CRITICAL CAVEAT: there is genuinely NO street address and NO owner/phone/email anywhere in the 46 columns — I read the full column list, not just a sample. To make these leads actionable you MUST join (county, muni, block, lot) to the NJOGIS Parcels Composite already in Henri (3.48M rows, OWNER_NAME + mailing + DEED_DATE). Good news for that join: block AND lot are populated on essentially 100% of 2026 rows (186,608 non-null of 186,589 in-range — the 19-row excess is dirty future-dated rows leaking past the lower bound). Without the parcel join this is volume with no person attached. NEW CAVEATS FOUND IN METADATA THAT THE CANDIDATE MISSED: (a) despite the N.J.A.C. 5:23-4.5(d) monthly-repor

### Minnesota MnGeo Statewide Parcels (Opt-In Open Data Counties)
- **State / class**: MN / parcel
- **Records**: 2,708,126 parcels total (verified returnCountOnly); 1,163,795 with year_built>1800 (verified); 2,137,501 with owner_name (verified); 565,801 with heating (verified). 59 of MN's 87 counties participate. Largest: Hennepin 447,024 · St. Louis 186,455 · Ramsey 172,014 · Dakota 153,848 · Anoka 139,930 · Washington 118,942 · Stearns 73,149 · Carver 47,644
- **Platform**: arcgis · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/1/query`
- **Fields**: ALL 94 field names confirmed live, all LOWERCASE. address (decomposed, must concatenate)=anumberpre, anumber, anumbersuf, st_pre_mod, st_pre_dir, st_pre_typ, st_pre_sep, st_name, st_pos_typ, st_pos_dir, st_pos_mod, sub_type1, sub_id1, sub_type2, sub_id2, zip, zip4, ctu_name, postcomm, co_name, state_code; owner=owner_name (78.9% fill), owner_more, ownership; owner mailing=own_add_l1 (61.9%), own_add_l2, own_add_l3, own_add_l4; tax-bill mailing=tax_name, tax_add_l1 (68.0%), tax_add_l2..l4; phone=NONE (verified absent across all 94 fields); email=NONE (verified absent); value=emv_total (80.3%), emv_bldg, emv_land, tax_capac, total_tax, spec_asses, mkt_year, tax_year; date=sale_date (epoch mill
- **Example**: `https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/1/query?where=heating+IS+NOT+NULL+AND+year_built%3E2015&outFields=county_pin,anumber,st_pre_dir,st_name,st_pos_typ,zip,ctu_name,co_name,owner_name,own_add_`
- **Notes**: VERIFIED LIVE — endpoint returned real rows; all 94 field names confirmed exactly as claimed; both record counts (2,708,126 / 1,163,795) reproduced exactly via returnCountOnly. Sample row: {owner_name:'Chu Yang Heu Mang & Caroline', own_add_l1:'857 Juniper Cir N', ctu_name:'Lake Elmo', co_name:'Washington', year_built:2017, fin_sq_ft:3099, heating:'FA Gas', cooling:'Yes', garagesqft:792, emv_total:886800, sale_date:1525046400000, sale_value:725467}. TWO MATERIAL CORRECTIONS TO THE ORIGINAL PITCH. (1) The 'richest HVAC schema' headline is OVERSTATED: heating fills only 20.9% statewide (565,801/2,708,126), not the implied ~43%. Worse, HENNEPIN COUNTY — Minneapolis, 447,024 parcels, MN's largest and the obvious first sellable territory — has heating=0 and supplies NO characteristics at all. The original example_request queried Minneapolis WITH heating/cooling in outFields and returns NULL for both on every row (I reproduced this). Counties that DO ship characteristics: Anoka (118,330/118,330 = 100% of its year_built rows), Washington (95,510), Dakota (121,818), Ramsey (114,424), St. Louis (67,547), Carver (38,381). (2) Characteristic values are NOT a normalized enum — they are per-cou

### Colorado Public Parcels (OIT statewide composite)
- **State / class**:  / 
- **Records**: 2,599,761 parcels (VERIFIED live via returnCountOnly=true). Spans 44 counties including all major metros: Denver, El Paso, Arapahoe, Jefferson, Adams, Douglas, Larimer, Boulder, Weld, Pueblo, Mesa, Broomfield. Sample row dateReceived 4/23/2026.
- **Platform**:  · **Auth**: none — anonymous HTTPS GET, HTTP 200, no key, no token, no referer check · **Commercial use**: prohibited
- **Endpoint**: `https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0`
- **Fields**: owner_name (owner 85.5% fill = 2,221,739 rows; owner2 only 13.7% = 355,439) + mailing address (ownerAdd 86.7%, ownAddCty, ownAddStt, ownAddZip 85.1%, ownAddCou) + site address (situsAdd 73.2% = 1,903,546, sitAddCty 72.1%, sitAddZip only 49.1% = 1,275,500) + saleDate 54.4% / salePrice / apprValTot / asedValTot / landUseDsc / landAcres. VERIFIED: NO phone and NO email column exists anywhere in the 35-field schema. This source does NOT move Henri's phone (0.9%) or email (0.002%) fill at all — it only improves owner_name and mailing address.
- **Example**: ``
- **Notes**: 

### Austin TX Issued Construction Permits (Socrata 3syk-w9eu) — contractor_phone / applicant_phone columns
- **State / class**:  / 
- **Records**: 2,368,623 permits total (verified exact). contractor_phone non-null on 1,357,255 rows (57.3%, verified exact); applicant_phone non-null on 242,180 rows (10.2%, verified exact). BUT row counts badly overstate yield: only 43,249 DISTINCT contractor_phone values and 25,928 distinct applicant_phone values. Concentration is extreme — D R Horton Homes alone accounts for 21,724 rows on one number; the to
- **Platform**:  · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://datahub.austintexas.gov/resource/3syk-w9eu.json`
- **Fields**: CORRECTED. Yields CONTRACTOR contact only, NOT homeowner: contractor_phone, contractor_company_name, contractor_full_name, contractor_trade, contractor_address1/city/zip (contractor's business mailing address), applicant_full_name, applicant_phone. There is NO property-owner field anywhere in this dataset — I pulled the full 60+ column list and there is no owner_name, owner_phone, owner_email, or owner mailing column. original_address1/city/zip is the JOB SITE address (which Henri already ingests), not an owner mailing address. No email column of any kind.
- **Example**: ``
- **Notes**: 

### City of Fort Worth Development Permits (live ArcGIS view)
- **State / class**: TX / permit
- **Records**: 1,605,031 total, verified via returnCountOnly (2001-06-30 → 2026-08-04). Realistic ongoing ingest rate is ~75,809/yr (verified count for trailing 12 months) — NOT 1.6M/yr; 48,446 filed in 2026 YTD. Permit_Type breakdown (exact): Plumbing 409,318 · Electrical 345,658 · Mechanical 279,314 · Residential Building Permit 251,162 · Plumbing Backflow 145,051 · Commercial Building Permit 84,741 · Resident
- **Platform**: arcgis · **Auth**: none · **Commercial use**: allowed
- **Endpoint**: `https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query`
- **Fields**: address=MUST be built from Addr_No (int) + Direction + Street_Name + Street_Suffix + Street_Suffix_Dir — Full_Street_Address exists in the schema but is 100% NULL (verified count=0 of 1,605,031). Street_Name fill 99.5% lifetime / 99.6% trailing-yr. Zip_Code (int) fill 67.0% lifetime (1,075,084) but 98.0% trailing-yr (74,261/75,809). owner=Owner_Full_Name — 93.2% lifetime (1,495,767), 98.2% trailing-yr (74,481); residential rows carry real PERSON names in 'LAST, FIRST' form (observed: 'NEUPANE, DISOJ', 'SMITH, JULIEN', 'CHAVEZ, EGRISALDA', 'TAYLOR, JAMES H'). phone=(none — verified absent from all 30 fields). email=(none — verified absent). value=JobValue (esriFieldTypeString, needs numeric c
- **Example**: `https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query?where=File_Date%3E%3DDATE%20%272026-07-01%27&outFields=Permit_No,Permit_Type,File_Date,Owner_Full_Name,Addr_No,Street_Name,Zip_Code,`
- **Notes**: VERIFIED LIVE 2026-08-04 — example_request returned real rows (CG26-00141 'DD EAST HARMON LLC' 1701 HARMON 76131; CG26-00142 'SP Capstone Group, LLC' 9716 OXENFREE 76108) and I confirmed every named field in the response schema. Service dataLastEditDate = 2026-08-04T21:25Z and max(File_Date) = 2026-08-04, so this refreshes to TODAY. Confirmed NOT a duplicate of the frozen Socrata BLDS feed qy5k-jz7m the brief said to skip: different host, different 30-field schema, live vs dead since 2015. Biggest raw TX volume win available. All four headline candidate counts verified EXACT (1,605,031 total / 1,495,767 owner / 251,162 residential / 11-value Permit_Type enum). CORRECTIONS TO THE CANDIDATE'S NOTES — (1) Full_Street_Address is not 'often null', it is 100% NULL: `WHERE Full_Street_Address IS NOT NULL AND <> ''` returns count=0 across all 1.6M rows. Component concatenation is mandatory. (2) The candidate's advice to 'request returnGeometry=true instead' is WRONG — this layer is "type":"Table" with no geometryType and no geometry field; I tested returnGeometry=true and features come back with no geometry key at all. Location_1 string-parsing (regex on '(lat, lng)') is the ONLY coordinat

