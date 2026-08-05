# Coverage + enrichment sweep — 2026-08-05

Continuation of [`coverage-gap-hunt-2026-08-05.md`](./coverage-gap-hunt-2026-08-05.md), which
completed 15 of 31 agents before hitting an API usage limit. This run covers the four briefs
that died: **southeast** (GA/TN/SC/AR), **midwest-empty** (MI/WI/MN/IN/MO),
**missing-five** (MT/NV/NH/OK/UT) and **contact-enrichment** (national phone/email hunt).

**23 endpoints independently confirmed. 10 carry populated phone or email. 8 more carry a
populated owner or contractor name.** Every URL in the confirmed table was fetched twice —
once by a regional hunter, then again by a separate verifier instructed to default to
rejection. Row counts come from `returnCountOnly` / `$select=count(*)`, dates from `max()`
`outStatistics`, fill rates from live `IS NOT NULL` counts. Nothing here is from documentation.

No database was touched (production is down, Cloudflare 522 / Disk IO exhausted). No
application source was modified. Nothing committed.

---

## 0. Read this before anything else

Three things in this document are worth more than the new endpoints:

1. **Three shipped loader configs point at field names that do not exist on their target
   layers** (`minneapolis-mn.yml`, `detroit-mi.yml`, `orlando-fl.yml`). ArcGIS and Socrata
   both return HTTP 400 when `outFields` / `$select` names a column that is not there. This
   is a plausible mechanical explanation for MN = 2 rows and MI = 79 rows. See §5.
2. **`detroit-mi.yml` is pointed at Virginia Beach, VA.** The URL recorded as "MI — Detroit"
   in `16-stale-states-2026-05-06.md` returns `State ∈ ['', 'VA']` and
   `City ∈ ['', 'Virginia Beach']` on `returnDistinctValues`. Zero Michigan rows. See §5.
3. **The instruction in `coverage-gap-hunt-2026-08-05.md` to delete Henderson NV's contact
   claim rests on a measurement artifact and should NOT be executed as written.** That probe
   used `WHERE col <> ''`; the layer is Oracle-backed, where the empty string *is* NULL, so
   that predicate is never true and returns 0 for **every** column — including
   `MAIN_ADDRESS_LINE1`, which the same document simultaneously relies on. Re-measured with
   `IS NOT NULL`: `OWNER` 99.2%, `BUSINESSPHONE` 58.3%, address 97.1%. See §4.6.

Generalize #3: **any fill measurement against an Oracle/SDE-backed ArcGIS layer must use
`IS NOT NULL`, never `<> ''`.**

---

## 1. Confirmed sources, ranked

Ranked contact-bearing first. Phone fill is ~1% today and is the binding constraint on lead
quality, so a small feed with real phones outranks a large one without. Within tiers, ranked
by (state gap × volume × freshness).

**"Contact populated" is measured, not schema-inferred.** Every contact column below survived
the distinct-value test — the failure mode that killed Midland TX (97% "filled", exactly two
distinct values, one city staffer stamped on 84k rows).

### Tier 1 — phone and/or email POPULATED (10)

| # | Source | ST | Kind | Rows | Contact fill (measured) | Endpoint |
|---|---|---|---|---:|---|---|
| 1 | **Raleigh NC — Building Permits** | NC | permit | 183,319 | **phone 83.1%** (152,327; 9,350 distinct, top value 2.87%) · **email 73.1%** (133,945) · owner name 87.9% (51,467 distinct). Contractor-side. | `https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0` |
| 2 | **Orlando FL — Permit Applications** | FL | permit | 1,105,918 | **phone 73.9%** (817,118; 16,760 distinct) · **owner name 75.6%** (835,895). Rare: both sides. | `https://data.cityoforlando.net/resource/ryhf-m453.json` |
| 3 | **Mesa AZ — Building Permits** | AZ | permit | 155,662 | **phone 18.3%** dataset-wide → **42.6% on 2025+**, 38.6% last 90d (4,429 distinct) · **email 17.2%** → 29.8% recent. Contractor-side only, no owner field. | `https://citydata.mesaaz.gov/resource/dzpk-hxfb.json` |
| 4 | **Elk Grove CA — TRAKiT Building Permits** | CA | permit | 187,439 | **phone 66.3%** all-time → **95.2% on last 400d** (1,009 distinct on 6,768 filled). Contractor-side. No owner field. | `https://webmaps.elkgrove.gov/arcgis/rest/services/AGOL/TRAKiT_Building_Permits/FeatureServer/0` |
| 5 | **Naperville IL — Building Permit Contractors** | IL | contact-enrichment | 33,217 | **phone 91.5%** (30,382; 3,669 distinct) · **email 91.5%** (30,406; 3,703 distinct) · mobile 37.2%. Contractor-side, per-permit-address. | `https://services1.arcgis.com/rXJ6QApc2sOtl1Pd/arcgis/rest/services/Building_Permit_Contractors____/FeatureServer/0` |
| 6 | **Henderson NV — OpenDevPermits L2 (Other/commercial+trade)** | NV | permit | 8,500 | **phone 47.2%** all-time → **82.6% last 90d** (1,055 distinct, top 3.64%) · applicant name 97.7%. Best phone *diversity* in NV. | `https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDevPermits/MapServer/2` |
| 7 | **Henderson NV — OpenDevPermits L1 (Residential)** | NV | permit | 28,406 | **phone 58.3%** (16,551; 621 distinct) · owner/applicant 99.2%. **Concentrated**: top phone = 31% of filled; 90d window has only 41 distinct phones. Builder switchboards. | `https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDevPermits/MapServer/1` |
| 8 | **Bozeman MT — Building Permits L1 "Active and Open"** | MT | permit | 899 rows / **255 addresses** | **email 100%** (173 distinct, 106 domains) · **phone 100%** (160 distinct) · owner name 82.3%. Contractor/applicant-side. | `https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/1` |
| 9 | **Bozeman MT — Building Permits L0 "Plan Review"** | MT | permit (pre-issuance) | 544 rows / **123 projects** | **email 100%** (80 distinct) · **phone 100%** (77 distinct) · owner name 78.7%. **Freshest Bozeman layer**, leads L1 by ~3.5 weeks. | `https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/0` |
| 10 | Bozeman MT — L2 "Certificate of Occupancy" | MT | permit (completed) | 317 rows / **66 permits** | phone 100% (45 distinct) · email 98.5% · owner 77.3% | `https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/2` |

> **#10 is an ANTI-SIGNAL for lead-gen.** `PERMIT_STATUS = "Certificate of Occupancy Issued"`
> on 316/317 rows. A CO means construction is finished and legally occupiable — the GC is paid
> and gone. Ingest for completion signal / historical scoring only. Never route to the Leads tab.

### Tier 2 — owner and/or contractor NAME populated, no phone or email (10)

| # | Source | ST | Kind | Rows | Contact fill (measured) | Endpoint |
|---|---|---|---|---:|---|---|
| 11 | **Minneapolis MN — CCS Permits** | MN | permit | **401,377** | owner (`fullName`) **93.9%** (6,572 distinct) — 98.9% on residential subset, real individual homeowners · contractor (`applicantName`) 100%. No phone/email columns exist. | `https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0` |
| 12 | **Detroit MI — BSEED Trades Permits** | MI | permit | **117,481** | owner **99.6%** (56,568 distinct, top value 3.6%) · contractor business 87.5% (5,850 distinct) · contact name 35.4%. | `https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_trades_permits/FeatureServer/0` |
| 13 | **Evansville / Vanderburgh County IN** | IN | permit | **153,036** | owner **99.5%** (3,377 distinct in 2026 sample) · contractor **83.0%** (95.9% on 2026). **Feed stalled 2026-06-30** — see §4.13. | `https://maps.evansvillegis.com/arcgis_server/rest/services/BC/BUILDING_COMMISSION_PERMITS/MapServer/0` |
| 14 | **St Louis MO — Plumbing Permits API** | MO | permit | 480 per **rolling 31d** | owner **100%** (422 distinct; 92.7% usable after stripping admin artifacts) · contractor 100% (147 distinct) · owner *mailing* address 97.1%. | `https://www.stlcitypermits.com/API/Permits/GetPlumbingPermits` |
| 15 | **St Louis MO — Electrical Permits API** | MO | permit | 364 per rolling 30d | owner **100%** (340 distinct) · contractor 100% (137 distinct) · owner mailing 94.2%. | `https://www.stlcitypermits.com/API/Permits/GetElectricalPermits` |
| 16 | **St Louis MO — Mechanical/HVAC Permits API** | MO | permit | 350 per rolling 30d | owner **100%** (326 distinct, top 1.7%) · contractor 100% (95 distinct) · owner mailing 92.6%. | `https://www.stlcitypermits.com/API/Permits/GetMechanicalPermits` |
| 17 | **Greenville SC — Building Permits, prior 2 years** | SC | permit | 3,778 | owner **100%** (2,353 distinct, real individuals) · **owner MAILING address + ZIP 99.7%** · contractor 99.3%. Best contact schema in the southeast. | `https://citygis.greenvillesc.gov/arcgis/rest/services/InfoHUB/BuildingPermits_PriorTwoYears/MapServer/0` |
| 18 | **Nashville TN — Trade Permits (E/P/Gas-Mech)** | TN | permit | **112,323** | `Contact` 100% (784 distinct per 5k sample) = the **trade contractor already hired**. Plus **phone regex-minable from `Purpose` on 6.2%** (~7,000 rows) and **email on 1.4%** (~1,550). | `https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Trade_Permits_View/FeatureServer/0` |
| 19 | **Nashville TN — Building Permits Issued** | TN | permit | 28,571 | `Contact` 99.996% (6,047 distinct) = builder/applicant. 2,209 rows read `SELF CONTRACTOR RESIDENTIAL` = owner-pulled, identity withheld. | `https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0` |
| 20 | **Nashville TN — Building Permit Applications** | TN | permit (pre-issuance) | 5,861 | `Contact` 100% (2,690 distinct = 45.9%) · **phone in `Purpose` on 8.6%** of newest 1,000 (65 distinct). Pre-issuance = ahead of the issued feed. | `https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permit_Applications_Feature_Layer_view/FeatureServer/0` |

> **The Tier-2 trap, stated plainly.** On #18/#19/#12 the populated contact is the
> **trade contractor who already pulled the permit**. A trade permit with a named electrician
> is a **closed job**. Piping those to contractors as "leads" sells them work someone else
> already won. Correct use is competitive intelligence and trade attribution, not lead contact.
> #11, #14–17 and #13 are different — those carry a genuine *property owner* name.

### Tier 3 — no contact fields at all (3)

| # | Source | ST | Kind | Rows | Contact | Endpoint |
|---|---|---|---|---:|---|---|
| 21 | **Atlanta GA — Accela building permit points** | GA | permit | 34,872 (**32,594** construction) | none. `Name` is a contaminated project-title field — do **not** map to owner. | `https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0` |
| 22 | **Johns Creek GA — Building Permits Issued** | GA | permit | 19,297 | none. Trade is derivable from the `JobID` prefix (MECH/ELCT/PLMB = 54.8%). | `https://services1.arcgis.com/bqfNVPUK3HOnCFmA/arcgis/rest/services/Building_Permits_Issued/FeatureServer/0` |
| 23 | **Greater Salt Lake Municipal Services District UT** | UT | permit | **12,619** (`case_group='Building'`) | none. Freshest feed in the whole run — newest case accepted *today*. | `https://gis.msd.utah.gov/server/rest/services/MSD_Cityworks/FeatureServer/0` |

---

## 2. Field mappings

Real upstream field names as seen in the live responses, mapped onto Henri's
`permit_sources` columns. Every row below is insertable without a second research pass.

Legend: `—` = the column does not exist upstream, leave NULL.

### Tier 1

**1. Raleigh NC** · ArcGIS FeatureServer/0 · maxRecordCount 2000

| Henri column | Upstream field |
|---|---|
| id_field | `permitnum` |
| type_field | `permitclassmapped` (Residential / Non-Residential) |
| status_field | — |
| desc_field | `description` |
| address_field | `originaladdress1` (99.97%) |
| date_field | `issueddate` (applieddate also available) |
| value_field | `estprojectcost` (83.2% > 0) |
| lat_field / lng_field | **— (DO NOT MAP)** |

> **Coordinate columns are corrupt.** On 2,000 permits issued in 2026, **42.4% have
> `latitude_perm`/`longitude_perm` disagreeing with the feature geometry by >150 m; worst
> delta 29.8 km.** Three permits at the same address returned stated coords 3.06 / 3.91 /
> 9.23 km from the consistent true geometry. Ingest via `returnGeometry=true&outSR=4326` and
> discard the attribute columns, or the radius/capacity filter and the storm-proximity
> booster get silently poisoned.
> Also: `contractorlicnum` / `statelicnum` are 84.5% filled for permits issued ≤2015 and
> **0 of 3,281 for 2026** — dead since ~2016, unusable for license verification.
> Extras worth carrying in raw_json: `contractorcompanyname`, `contractorphone`,
> `contractoremail`, `parcelownername`, `parcelowneraddress1`, `pin`, `originalzip`.

**2. Orlando FL** · Socrata `ryhf-m453`

| Henri column | Upstream field |
|---|---|
| id_field | `permit_number` |
| type_field | `worktype` |
| status_field | — |
| desc_field | `location` (free-text scope; `project_name` is the title) |
| address_field | `permit_address` (100%) |
| date_field | `issue_permit_date` (**not** `issued_date`) |
| value_field | — |
| lat_field / lng_field | — (point lives in `geocoded_column`) |

> **Three field names in circulation are wrong**: `description`, `issued_date` and treating
> `location` as the geo column. None of those exist / none behave that way. The shipped
> `orlando-fl.yml` uses a completely different and non-existent set — see §5.
> Extras: `contractor_phone_number`, `contractor_name`, `contractor_address`,
> `property_owner_name`, `parcel_number`, `processed_date`, `coo_date`.
> The claimed dirty `2230-03-13` max date did **not** reproduce; unbounded
> `max(processed_date)` = 2026-08-04. Keeping a `<= now()` clamp is harmless.

**3. Mesa AZ** · Socrata `dzpk-hxfb`

| Henri column | Upstream field |
|---|---|
| id_field | `permit_number` |
| type_field | `permit_type` (RES / COM / SVC) — `type_of_work` is finer |
| status_field | `status` |
| desc_field | `description_of_work` |
| address_field | `property_address` (98.8%) |
| date_field | `issued_date` (94.6%) |
| value_field | `job_value` |
| lat_field / lng_field | `latitude` / `longitude` |

> Extras: `contractor_phone`, `contractor_email`, `contractor_name`, `contractor_license`,
> `applicant`, `parcel_number` (99.9%), `total_square_feet`, `new_residential_permit`.
> **Do not wire `contractor_phone` into homeowner outreach.** There is no owner field here.
> Its second, arguably larger value is a clean 4,400-strong roster of active Mesa-area
> contractors — i.e. Henri's own AZ customer-acquisition list.

**4. Elk Grove CA** · ArcGIS FeatureServer/0 · maxRecordCount 2000

| Henri column | Upstream field |
|---|---|
| id_field | `PERMIT_NUMBER` |
| type_field | `PERMIT_TYPE` (`PERMIT_SUB_TYPE` is finer) |
| status_field | `PERMIT_STATUS` |
| desc_field | `PERMIT_DESCRIPTION` |
| address_field | `SITE_ADDRESS` (100%) |
| date_field | `APPLIED_DATE` |
| value_field | `JOB_VALUE` |
| lat_field / lng_field | **— (request `outSR=4326`)** |

> Native SR is **wkid 2226 (CA State Plane Zone 2, US feet)** — raw x/y ≈ 6.7M. Passing
> `outSR=4326` returns correct WGS84 (verified −121.4166, 38.3762). Filter forward-dated
> `ISSUED_DATE`; max is a `2099-12-06` sentinel. Field is `CONTRACTOR`, **not**
> `CONTRACTOR_NAME`. Extras: `CONTRACTOR_PHONE`, `CONTRACTOR_ADDRESS`, `GIS_APN` (100%).

**5. Naperville IL** · ArcGIS **Table** (not a feature layer)

| Henri column | Upstream field |
|---|---|
| id_field | `PERMITNUMBER` |
| type_field | `Contractor_Type` (General / Electrical / Plumbing / Roofing / …) |
| status_field | `PERMITSTATUS` |
| desc_field | `DESCRIPTION` |
| address_field | `PERMIT_ADDRESS` (98.6%, full street+city+ZIP) |
| date_field | `ISSUEDATE` (**29.3% NULL** — see below) |
| value_field | — |
| lat_field / lng_field | — (no geometry; `layers:[]`, `tables:[0]`) |

> Four things that will bite: (a) **row grain is not permit grain** — 33,217 rows = 14,237
> distinct `PERMITNUMBER` (~2.3 contractor rows per permit); (b) **9,737 rows have NULL
> `ISSUEDATE`**, including the freshest in-flight 2026 applications, so a date-windowed
> ingest silently drops them; (c) **publishing lags ~5 weeks** — layer edited today, but
> `ISSUEDATE >= 2026-07-01` returns 0; (d) the sibling `BldgPermitNaviMaster_view` is a
> **trap** — its `CONTRACTOR_PHONE` reads 99.98% filled but the values are license codes
> (`00`, `03125420`). Ingest the Contractors table, never the Master.
> Extras: `Business_Phone`, `Mobile_Phone`, `Home_Phone`, `Email`, `Contractor_Name`,
> `CONTRACTOR_ADDRESS`, `Contact_Name`.

**6 / 7. Henderson NV L2 and L1** · ArcGIS MapServer · identical schema

| Henri column | Upstream field |
|---|---|
| id_field | `CASENUMBER` |
| type_field | `CASETYPE` (`CASEWORKCLASS` gives the trade split) |
| status_field | `STATUS` |
| desc_field | `DESCRIPTION` |
| address_field | `MAIN_ADDRESS_LINE1` (97.1% L1 / 96.2% L2) |
| date_field | `ISSUEDATE` (`APPLICATIONDATE` is 100% and 1 day fresher) |
| value_field | — |
| lat_field / lng_field | **— (request `outSR=4326`)** |

> Native SR wkid **3421**; `outSR=4326` verified correct (−115.1157, 35.9287). **There is no
> ZIP column anywhere in the schema** — ZIP must come from reverse-geocoding the WGS84
> centroid. `SPATIALID` is the Clark County APN and is 100% filled — use it as the parcel key.
> Volume honesty: "8,500 rows" on L2 is **24 years of history** (min 2002-02-07); real flow is
> ~500–700/yr, 132 in 90d. L1 is ~2,300/yr. Phone formats are mixed and at least one value is
> corrupt (`7024) 456-6449`); out-of-state area codes are normal (out-of-area architects file
> here). L2 is commercial-only, L1 is residential-only — ingest both.

**8 / 9 / 10. Bozeman MT L1 / L0 / L2** · ArcGIS MapServer

| Henri column | L1 "Active and Open" | L0 "Plan Review" | L2 "Cert. of Occupancy" |
|---|---|---|---|
| id_field | `APPLICATION_NUMBER` | `APPLICATION_NUMBER` | `PERMIT_NUMBER` |
| type_field | `PERMIT_TYPE` | `PERMIT_TYPE` | `PERMIT_TYPE` |
| status_field | `PERMIT_STATUS` | `APPLICATION_STATUS` | `PERMIT_STATUS` |
| desc_field | `APPLICATION_DESC` | `APPLICATION_DESC` | — |
| address_field | `LOCATION` (100%) | `LOCATION` (100%) | `LOCATION` (100%) |
| date_field | `PERMIT_ISSUE_DATE` | **`APPLICATION_DATE`** | **`PERMIT_STATUS_DATE`** |
| value_field | `VALUATION` | `PROJECT_ESTIMATED_VALUE` (100%) | `VALUATION` |
| lat/lng | **— (`outSR=4326`)** | **— (`outSR=4326`)** | **— (`outSR=4326`)** |

> **`LATITUDE` / `LONGITUDE` are NOT degrees.** Values are ~5,059,483 / ~497,617 — the layer
> SR is **wkid 26912 (NAD83 / UTM 12N, metres)** and the columns are misnamed northing/easting.
> Proven by asking the server for the same record at `outSR=4326`: y=45.68890, x=−111.03061.
> Mapping them naively puts every Bozeman lead in the ocean.
>
> **L0-specific:** `PERMIT_NUMBER` is only 13.2% filled and `PERMIT_ISSUE_DATE` only 13.2% —
> these are pre-issuance records. Cloning `bozeman-mt.yml` onto L0 breaks on 87% of rows. Key
> on `APPLICATION_NUMBER + PERMIT_TYPE`.
>
> **Row inflation on all three layers:** long-format, one row per trade. L1 = 899 rows /
> 322 permits / **255 addresses**; L0 = 544 rows / **123 projects** (mean 4.4 rows each);
> L2 = 317 rows / **66 permits**. Henri's per-address collapse (commit `e949e2c`) handles it,
> but do not read the row count as lead volume.
>
> **Phones need normalisation** — double-parenthesised `(406) (579-3502)` on 896/899 rows,
> plus junk like `(6) (4)-(4)`. Contacts are the **applicant**, frequently an *architect*
> (blackmountainarch.com, intrinsikarchitecture.com, lakeflato.com) and 17% personal
> gmail/outlook — treat as B2B/competitive signal, not homeowner contact.

### Tier 2

**11. Minneapolis MN** · ArcGIS FeatureServer/0 · maxRecordCount 16000

| Henri column | Upstream field |
|---|---|
| id_field | `permitNumber` |
| type_field | `permitType` (Plumbing / Res / Mechanical / Commercial) |
| status_field | `status` |
| desc_field | `comments` |
| address_field | `Display` (100%, street line only) |
| date_field | `issueDate` |
| value_field | `value` (**43.9% only**) |
| lat_field / lng_field | `Latitude` / `Longitude` (99.9%) |

> `where` clauses on `issueDate` **reject epoch-millis** — use `DATE 'yyyy-mm-dd'` literal
> syntax. spatialReference is **wkid 4269 (NAD83)**, not 4326. `Display` has no city/state/ZIP
> — ZIP must come from the lat/lng or an `APN` join (APN = 13-digit Hennepin parcel id, 100%).
> `applicantAddress1`/`applicantCity` are the **contractor's mailing address**, not the job
> site — do not map to property. Owner is `fullName` (93.9%), contractor is `applicantName`.
> **This layer is `CCS_Permits` — the exact URL `minneapolis-mn.yml` already targets, with a
> field map that does not match it. See §5.**

**12. Detroit MI — BSEED Trades** · ArcGIS FeatureServer/0 · maxRecordCount 1000

| Henri column | Upstream field |
|---|---|
| id_field | `record_id` |
| type_field | `permit_type` (Mechanical / Electrical / Plumbing / Elevator / Fire Alarm / Boiler / Generator) |
| status_field | — |
| desc_field | `work_description` |
| address_field | `address` (100%) |
| date_field | `issued_date` |
| value_field | — |
| lat_field / lng_field | `latitude` / `longitude` (99.5%) |

> **Filter before scoring or lead volume gets polluted:** 15,383 rows (13%) are municipal
> DWSD utility-program permits (`DWSD WATER MAIN REPLACEMENT CONTRACT` 8,198 +
> `DWSD LEAD SERVICE REPLACEMENT` 7,185) — city-run work, not homeowner-initiated. Detroit
> Land Bank Authority (4,197) plus DPS / DHC / Wayne State / HFHS are institutional owners.
> `contact_*` and `contractor_address` identify the **contractor**, not the job site; the job
> site is `address`. ~118 pages at maxRecordCount 1000. Extras: `parcel_id`, `zip_code`
> (99.9%), `neighborhood`, `council_district`.

**13. Evansville / Vanderburgh County IN** · ArcGIS **MapServer 10.91** · maxRecordCount 12000

| Henri column | Upstream field |
|---|---|
| id_field | `USER_Application_Reference` (`USER_Permit_Number` also present) |
| type_field | `USER_Project_Activity` (43 values — RES ELECTRIC, ROOF RESIDENTIAL, MECHANICAL RESIDENTIAL …) |
| status_field | `USER_App_Status` |
| desc_field | `USER_Location_Desc` |
| address_field | `USER_Location` (98.9%) |
| date_field | `USER_Application_Recv_d` (99.5%) |
| value_field | `USER_Estimated_Cost` (90.5% > 0) |
| lat_field / lng_field | **— (`outSR=4326`; verified −87.4989, 38.0540)** |

> **The feed is stalled, 36 days as of this run.** `max(USER_Application_Recv_d)` =
> **2026-06-30**; July and August 2026 both return exactly 0 rows. This is anomalous, not a
> cadence: 2021–2025 run 8.5–9.8k/yr with no gaps, and 2025's Jun/Jul/Aug are all normally
> populated. Service exposes no `editingInfo`, so resumption cannot be predicted. **Ingest as
> a 15-year archive/backfill now** (min date 2011-01-04, ~210× Indiana's current 728 rows),
> and set a recheck: if the max has not moved past 2026-06-30 in ~30 days, reclassify as
> frozen-historical. `USER_Contractor` is a **person** name; `USER_Business` is 0.8% filled —
> do not map `USER_Contractor` to a business name.

**14 / 15 / 16. St Louis MO — Plumbing / Electrical / Mechanical** · plain JSON API, no auth

| Henri column | Upstream field |
|---|---|
| id_field | `PermitNumber` (`PermitID` also unique) |
| type_field | `PermitType` |
| status_field | `CurrentStatus` |
| desc_field | `ProjectName` |
| address_field | `ProjectAddress` (99.8–100%) |
| date_field | `ApplicationDate` (100%) |
| value_field | `ProjectCost` (94.5–100%) |
| lat_field / lng_field | **— (`ProjectX`/`ProjectY` are Missouri East State Plane, US feet)** |

> **This is a ROLLING ~30-DAY WINDOW, not an archive.** No offset, no date parameter, no
> pagination. 480/364/350 rows *is* the whole response. **Poll daily and accumulate, or the
> history is permanently lost.** Do not schedule weekly.
> `source_type` has no clean fit — Henri's `dispatch.ts` supports arcgis / socrata / ckan and
> sniffs the URL otherwise. These will resolve to `unsupported` and **fail loudly**, which is
> the correct behaviour. They need either a small JSON adapter or a Hetzner loader.
> `OwnerAddress` is the owner's **mailing** address and differs from `ProjectAddress` on 67.7%
> of plumbing rows — a free absentee/investor-owner signal. Strip the
> `***SUMMARY RECORD; NOT ON LRMS***` suffix and the `LRA` land-bank rows.
> First call is slow (~17–21 s); budget a generous timeout.
> Confirmed 404: `GetBuildingPermits`, `GetDemolitionPermits`, `GetHVACPermits`, `GetPermits`.
> `GetPermitTypes` returns the authoritative enum `{1:Electrical, 3:Plumbing, 4:Mechanical, 11:Sprinkler}`.

**17. Greenville SC** · ArcGIS **legacy MapServer** · maxRecordCount 7000 (whole layer in 1 call)

| Henri column | Upstream field |
|---|---|
| id_field | `PERMIT_NUM` |
| type_field | `PERMIT_TYPE` (BLDG / BLDC / DEMR / DEMC) |
| status_field | `BP_STATUS` |
| desc_field | `APPLIC_DESCRIPTION` |
| address_field | `STREETADDRESS` (100%) |
| date_field | `NewIssueDate` (100%, real esri date) |
| value_field | `PERMIT_VALUATION` (92.2%) |
| lat_field / lng_field | **— (`X_COORD`/`Y_COORD` are SC State Plane FEET)** |

> `APPLICDATE` is a **double holding YYYYMMDD** (`20240627.0`), not a date — only
> `NewIssueDate` is usable. Date filtering works **only** with the plain-string form
> (`NewIssueDate >= '2026-08-01'`); `date '...'` and `timestamp '...'` literals return HTTP
> 400 because `useStandardizedQueries` is false. `returnDistinctValues` 400s on this legacy
> server — sample rows instead. Values truncate at 30 chars.
> Scope honesty: **City** of Greenville (~72k), not the county (~550k), on a rolling ~2.6-year
> replace-style window ≈ 1,461/yr. Small but the highest-quality contact payload in the region:
> `OWNER_NAME` + `OWNER_ADDR` + `OWNER_ZIP` makes **direct mail viable with no phone**.

**18. Nashville TN — Trade Permits** · ArcGIS FeatureServer/0 · maxRecordCount 1000

| Henri column | Upstream field |
|---|---|
| id_field | `PermitNumber` |
| type_field | `Trade` (native Electrical 45% / Gas-Mechanical 30% / Plumbing 24%) |
| status_field | `Case_Status` |
| desc_field | `Purpose` |
| address_field | `Address` (**58.7% only** — see below) |
| date_field | `Date_Issued` (96.4%) |
| value_field | `Contract_Value` (93.7% > 0, median $7,000) |
| lat_field / lng_field | **— (`outSR=4326` mandatory)** |

> **Address is only 58.7% filled (52.9% in the recent window).** Not fatal: `Parcel` and `Zip`
> are 100% and Henri already holds `TN-DAVIDSON-NASHVILLE` (286,448 parcels) in
> `parcel_sources`, so street address is recoverable by parcel join, and geometry covers 99.5%.
> But an operator expecting an address on every row will be surprised.
> **Default geometry is TN State Plane FEET** (x≈1,759,178) — `outSR=4326` or the coordinates
> are garbage. Mine `Purpose` with `POC: <name> <phone>` regex for the ~7,000 phones /
> ~1,550 emails (verified real: `POC: Pamela Danzy, 615-992-1400`,
> `Poc: Ashley Borrelli 615-454-9664 aborrelli@dwhomes.com`) — these are commercial /
> multi-family points of contact, not homeowners.
> **This is a complementary layer to `nashville-tn.yml`, not a duplicate.**

**19. Nashville TN — Building Permits Issued** · the layer `nashville-tn.yml` already targets

| Henri column | Upstream field |
|---|---|
| id_field | `Permit__` |
| type_field | `Permit_Type_Description` (`Permit_Subtype_Description` finer) |
| status_field | — |
| desc_field | `Purpose` |
| address_field | `Address` (100%) |
| date_field | `Date_Issued` (100%) |
| value_field | `Const_Cost` (100% > 0, median $80,000) |
| lat_field / lng_field | `Lat` / `Lon` (100%) |

> Rolling ~3-year window (2023-08-01 → 2026-08-04), ~8,800/yr, 724 in last 30d.
> `nashville-tn.yml` is already `status: verified` with a correct field map — **TN showing
> 170 rows means the loader has never landed rows. The gap is execution, not discovery.**
> Minor: the config sets `limit: 200` against `maxRecordCount: 1000`, making a full backfill
> ~5× more requests than needed.

**20. Nashville TN — Building Permit Applications** (pre-issuance)

| Henri column | Upstream field |
|---|---|
| id_field | `Permit__` |
| type_field | `Permit_Type_Description` |
| status_field | — |
| desc_field | `Purpose` |
| address_field | `Address` (100%) |
| date_field | **`Date_Entered`** |
| value_field | `Const_Cost` (100%) |
| lat_field / lng_field | `Lat` / `Lon` |

> **Two corrections that would break a loader.** (a) The widely-circulated field list for this
> layer is **aliases, not field names** — `Permit #`, `Date Entered`, `Construction Cost`,
> `Zip Code` all return HTTP 400. Real names are `Permit__`, `Date_Entered`, `Const_Cost`,
> `ZIP`. (b) **`Date_Issued` is 100% NULL** — `Date_Issued IS NOT NULL` returns 0 of 5,861.
> The column exists and is entirely dead. `Date_Entered` is the only date available.
> ~7,700/yr, 636 in last 30d. Poll daily, upsert on `Permit__`.

### Tier 3

**21. Atlanta GA** · ArcGIS FeatureServer/0 · maxRecordCount 2000

| Henri column | Upstream field |
|---|---|
| id_field | `RecordID` |
| type_field | `TypeCombo` (`Use_` = Residential/Commercial, `Subtype` = New/Addition/Alteration/Demolition) |
| status_field | `Status_1` |
| desc_field | — (no clean description column; scope lives in `TypeCombo` + `Use_` + `Subtype`) |
| address_field | `Address` (100%, fully qualified with ZIP on 95.2%) |
| date_field | `Opend` (application-open date) |
| value_field | `JOB_VALUE` (**0 on 21.5% of construction rows**) |
| lat_field / lng_field | **— (`outSR=4326`; `DisplayX`/`DisplayY` units unverified)** |

> **Three caveats.** (a) **12-month data hole**: 2024-10 → 2025-08 inclusive return exactly
> zero rows. Fresh-lead generation is unaffected (recent window is dense) but no backfill or
> `historical_conversion` work may read that gap as "no permits issued". (b) **~20% of recent
> rows are not permits** — `Open Record Request` alone is 666 of the last 90d. **Filter
> `TypeCombo <> 'Open Record Request'`** (also Side Walk Waiver, Noise Temporary Variance).
> Keep `Temporary Power` — it flags an active jobsite. (c) `count(ObjectId)` returns 27,961
> against a true total of 34,872 because this view carries both `ObjectId` and `ObjectId2` —
> **do not size or paginate off `ObjectId`**.
> Org `5RxyIIJ9boPdptdo` resolves to *City of Atlanta — Department of City Planning GIS*
> (authoritative). Scope is **Atlanta city proper only** — no unincorporated Fulton/DeKalb,
> Sandy Springs, Marietta or Decatur.

**22. Johns Creek GA** · ArcGIS FeatureServer/0 · maxRecordCount 2000

| Henri column | Upstream field |
|---|---|
| id_field | `JobID` (**trade prefix**: MECH 21.6% / ELCT 18.1% / PLMB 15.1% / BLDR / RWEP / FIRE / TREE / FENCE) |
| type_field | `JobTypeDescription` (**69.6% filled**, only 33.9% in the last 6 months) |
| status_field | `JobStatus` |
| desc_field | — |
| address_field | `JobAddress` (97.3%, street-only, no city/ZIP) |
| date_field | `ISSUE_DATE` (100%) |
| value_field | **— (no valuation field exists anywhere in the layer)** |
| lat_field / lng_field | **— (`outSR=4326`; native wkid 102100)** |

> **`JobTypeDescription_Original` and `LocationType` are DEAD COLUMNS** — 0 of 19,297
> non-empty, table-wide. They appear in `outFields=*` and always return null. Do not map them.
> `JobSquareFootage` is present on 100% of rows but > 0 on only 21.2%.
> Henri's `permit_value` signal will be null for this entire source. The trade prefix in
> `JobID` is the real value — direct trade attribution with no NLP.

**23. Greater Salt Lake MSD UT** · ArcGIS FeatureServer/0 · maxRecordCount 20000

| Henri column | Upstream field |
|---|---|
| id_field | `case_number` |
| type_field | `case_type_desc` (trade-native: Residential Elec/Mech/Plumb, Solar/Photovoltaic, Roof Covering Replacement, Remodel, Addition, ADU) |
| status_field | `case_status` |
| desc_field | `case_type_desc` |
| address_field | `location` (100%, street + city + ZIP: `9771 S AMBER LN, WHITE CITY, 84094`) |
| date_field | `date_accepted` (100%) |
| value_field | — |
| lat_field / lng_field | **— (`outSR=4326` returns real points, e.g. −111.86569, 40.57411)** |

> **The row count that has been circulating is wrong by 3.1×.** `case_group='Building'` =
> **12,619**, not 39,258 — the larger number is `where=1=1` across all 11 case groups
> (Parking Enforcement, Code Enforcement, Addressing, Business Licensing, Storm Water,
> Planning…). **Filter `case_group='Building'` or you will ingest weed complaints and parking
> tickets as leads.** True flow: ~2,227/yr, 546 in 90d, 177 in 30d, newest accepted *today*.
> **Do not map the undisclosed `name` column to owner_name** — it is the municipality name
> (13 distinct values, duplicates `city`). Covers unincorporated Salt Lake County plus Magna,
> Kearns, White City, Brighton, Emigration Canyon, Copperton, part of West Jordan.
> The `app0N.cityworksonline.com/CLIENT_GSLMSD` host named in prior research now 404s; this
> is the operator's own replacement host.

---

## 3. SQL — ready to paste

```sql
-- docs/permit-catalog/coverage-and-enrichment-2026-08-05.md
-- 23 independently re-probed sources from the 2026-08-05 coverage + enrichment sweep.
--
-- ############################################################################
-- # EVERY ROW IS enabled = false ON PURPOSE. DO NOT FLIP enabled = true HERE. #
-- ############################################################################
-- Each source needs a smoke test through Henri's own loader before it is allowed
-- to feed the catalog:
--     /api/cron/scrape?source_key=<key>
-- Confirm (a) rows land, (b) the date parses, (c) the address is populated,
-- (d) lat/lng are real degrees and not State Plane feet / UTM metres, THEN
-- flip enabled = true and promote field_mapping_status to 'verified'.
--
-- field_mapping_status = 'probed' for all rows: the schema and the mapping were
-- confirmed against a live response, but nothing has been ingested through
-- Henri's loader yet. 'probed' also keeps them out of any bulk-promote script
-- that targets 'verified'.
--
-- priority mirrors the ranked table in section 1 (higher = scrape sooner once
-- enabled). Contact-bearing sources rank above larger contactless ones because
-- phone fill (~1%) is the binding constraint on lead quality.
--
-- lat_field / lng_field are deliberately NULL on 14 of 23 rows. Those layers
-- either ship projected coordinates in misleadingly-named columns (Bozeman
-- LATITUDE/LONGITUDE are UTM 12N metres; Greenville X_COORD/Y_COORD are State
-- Plane feet; Nashville Trade defaults to TN State Plane feet; Elk Grove is
-- wkid 2226) or ship corrupt ones (Raleigh: 42.4% of 2026 rows disagree with
-- the true geometry by >150 m, worst delta 29.8 km). For all of them the loader
-- MUST request returnGeometry=true&outSR=4326 and ignore the attribute columns.
--
-- Idempotent: ON CONFLICT (source_key) DO NOTHING. Safe to re-run.

BEGIN;

INSERT INTO public.permit_sources (
  source_key, name, state, city, jurisdiction, endpoint, source_type, auth, update_freq,
  id_field, type_field, status_field, desc_field, address_field, date_field, value_field,
  lat_field, lng_field, layer_index,
  enabled, discovered_via, field_mapping_status, priority, imported_at, notes
) VALUES

-- ── TIER 1: phone and/or email POPULATED ────────────────────────────────────

('arcgis_raleigh_nc_permits', 'Raleigh NC Building Permits', 'NC', 'Raleigh', 'City of Raleigh',
 'https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'permitnum', 'permitclassmapped', NULL, 'description', 'originaladdress1', 'issueddate', 'estprojectcost',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 100, now(),
 '183,319 rows, 2000-02-22 to 2026-08-04, ~6k/yr. contractorphone 83.1% (9,350 distinct, top value 2.87%), contractoremail 73.1%, parcelownername 87.9% (51,467 distinct). CONTACT IS CONTRACTOR-SIDE, not homeowner. CRITICAL: latitude_perm/longitude_perm are CORRUPT on 42.4% of 2026 rows (worst delta 29.8 km) - loader MUST use returnGeometry=true and outSR=4326 and discard those columns. contractorlicnum/statelicnum are dead since ~2016 (0 of 3,281 rows issued in 2026). No trade permits, Building + Demolition only. 73.6% residential. maxRecordCount 2000.'),

('socrata_orlando_permit_apps', 'Orlando FL Permit Applications', 'FL', 'Orlando', 'City of Orlando',
 'https://data.cityoforlando.net/resource/ryhf-m453.json',
 'socrata', 'none', 'daily',
 'permit_number', 'worktype', NULL, 'location', 'permit_address', 'issue_permit_date', NULL,
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 99, now(),
 '1,105,918 rows, newest 2026-08-04, ~35k/yr. contractor_phone_number 73.9% lifetime (16,760 distinct) but only 45.8% on the last 90d - size expectations at ~46% for fresh leads. property_owner_name 75.6% - one of very few feeds with BOTH owner name and contractor phone. Suppress the exact value (407)947-0369 at ingest: 47,024 rows, 44,428 with a NULL contractor_name, reads as a permit-expeditor placeholder. FIELD-NAME CORRECTIONS: description and issued_date DO NOT EXIST (use location and issue_permit_date); location is free-text scope, the geo point is geocoded_column. The shipped orlando-fl.yml uses a different, non-existent field set - see section 5.'),

('socrata_mesa_az_permits', 'Mesa AZ Building Permits', 'AZ', 'Mesa', 'City of Mesa',
 'https://citydata.mesaaz.gov/resource/dzpk-hxfb.json',
 'socrata', 'none', 'daily',
 'permit_number', 'permit_type', 'status', 'description_of_work', 'property_address', 'issued_date', 'job_value',
 'latitude', 'longitude', 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 98, now(),
 '155,662 rows = 6.3x the entire existing AZ permit count, from one anonymous endpoint. Mesa is AZ 3rd-largest city (~510k). Newest issued_date 2026-08-03, 1987-2026 span, ~5k/yr current. contractor_phone 18.3% dataset-wide but 42.6% on 2025+ and 38.6% last 90d (4,429 distinct, top value 3.0%); contractor_email 17.2% -> 29.8% on 2025+. Fill IMPROVES with recency. NO OWNER FIELD - this does not move homeowner phone fill. Second value: a clean 4,400-strong roster of active Mesa contractors, i.e. Henri own AZ customer-acquisition list. Do not wire contractor_phone into homeowner outreach paths. 64.7% residential on 2025+.'),

('arcgis_elk_grove_ca_trakit', 'Elk Grove CA TRAKiT Building Permits', 'CA', 'Elk Grove', 'City of Elk Grove',
 'https://webmaps.elkgrove.gov/arcgis/rest/services/AGOL/TRAKiT_Building_Permits/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'PERMIT_NUMBER', 'PERMIT_TYPE', 'PERMIT_STATUS', 'PERMIT_DESCRIPTION', 'SITE_ADDRESS', 'APPLIED_DATE', 'JOB_VALUE',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 90, now(),
 '187,439 rows 1972-2026, ~6,500/yr. CONTRACTOR_PHONE 66.3% all-time and 95.2% on the last 400d (1,009 distinct on 6,768 filled; top value 8.4% is SUNRUN, a real high-volume installer). Field is CONTRACTOR, NOT CONTRACTOR_NAME. Native SR is wkid 2226 (CA State Plane Zone 2, US feet) - MUST pass outSR=4326 or coordinates are garbage. Filter forward-dated ISSUED_DATE (max is a 2099-12-06 sentinel). Strong trade mix in last 400d: 1,487 HVAC, 1,243 solar PV, 891 plumbing, 562 electrical, 425 EV charger, 153 reroof, 32 ADU. LOW PRIORITY ON VOLUME: CA is already Henri best-covered state at 615,647 rows; the contact fields are the only reason to ingest.'),

('arcgis_naperville_il_contractors', 'Naperville IL Building Permit Contractors', 'IL', 'Naperville', 'City of Naperville',
 'https://services1.arcgis.com/rXJ6QApc2sOtl1Pd/arcgis/rest/services/Building_Permit_Contractors____/FeatureServer/0',
 'arcgis', 'none', 'weekly',
 'PERMITNUMBER', 'Contractor_Type', 'PERMITSTATUS', 'DESCRIPTION', 'PERMIT_ADDRESS', 'ISSUEDATE', NULL,
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 88, now(),
 'CONTACT-ENRICHMENT, NOT COVERAGE. IL already has 76,961 permits; this adds ~3.7k unique contractor emails and ~3.7k unique phones for the Chicago west suburbs, joinable on PERMITNUMBER/address. Email 91.5% (3,703 distinct), Business_Phone 91.5% (3,669 distinct), Mobile 37.2%. Explicit per-row Contractor_Type (General 13,728 / Electrical 6,834 / Plumbing 4,333 / Roofing 2,037 / Fire Suppression / Concrete / Irrigation / Elevator) - rare direct trade attribution. FOUR GOTCHAS: (1) type is Table, NOT a feature layer - no geometry, geocoding required; (2) 33,217 rows = only 14,237 distinct PERMITNUMBER (~2.3 contractor rows per permit) - this is a child/junction table; (3) 29.3% NULL ISSUEDATE including the freshest in-flight 2026 applications, so a date-windowed ingest silently drops 9,737 rows; (4) publishing lags ~5 weeks - layer edited today but ISSUEDATE >= 2026-07-01 returns 0. AVOID the sibling BldgPermitNaviMaster_view: its CONTRACTOR_PHONE reads 99.98% filled but the values are license codes.'),

('arcgis_henderson_nv_other', 'Henderson NV OpenDevPermits Other (commercial + trade)', 'NV', 'Henderson', 'City of Henderson',
 'https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDevPermits/MapServer/2',
 'arcgis', 'none', 'daily',
 'CASENUMBER', 'CASETYPE', 'STATUS', 'DESCRIPTION', 'MAIN_ADDRESS_LINE1', 'ISSUEDATE', NULL,
 NULL, NULL, 2,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 86, now(),
 'NV currently has ZERO permits in the table. BUSINESSPHONE 47.2% all-time and 82.6% on last 90d, 1,055 DISTINCT values, top value only 3.64% - the BEST phone diversity of the two Henderson layers. OWNER 97.7% but it is the APPLICANT FIRM (architect/GC/developer), not the property owner; 28.6% are individuals. VOLUME HONESTY: 8,500 rows is 24 years of history (min 2002-02-07); real flow is ~500-700/YEAR, 132 in 90d, 37 in 30d - do not read 8,500 as ingest yield. Commercial only (112 of last 90d are BLDG-Commercial Building); layer 1 is the residential one. Native SR wkid 3421, MUST pass outSR=4326. NO ZIP COLUMN EXISTS - reverse-geocode from the WGS84 centroid. SPATIALID is the Clark County APN, 100% filled. Phone formats are mixed and at least one value is corrupt (7024) 456-6449) - normalise and validity-check. Out-of-state area codes are normal. ORACLE BACKEND: measure fill with IS NOT NULL, never <> (empty string), which always returns 0.'),

('arcgis_henderson_nv_residential', 'Henderson NV OpenDevPermits Residential', 'NV', 'Henderson', 'City of Henderson',
 'https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDevPermits/MapServer/1',
 'arcgis', 'none', 'daily',
 'CASENUMBER', 'CASETYPE', 'STATUS', 'DESCRIPTION', 'MAIN_ADDRESS_LINE1', 'ISSUEDATE', NULL,
 NULL, NULL, 1,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 85, now(),
 'CORRECTS coverage-gap-hunt-2026-08-05.md line 119, which instructs the operator to DELETE the Henderson contact claim because a probe measured OWNER and BUSINESSPHONE at exactly 0 non-empty of 28,406. That is a MEASUREMENT ARTIFACT: the layer is Oracle-backed where the empty string IS NULL, so the predicate col <> (empty string) is never true and returns 0 for EVERY column, including MAIN_ADDRESS_LINE1 which the same doc relies on. Re-measured with IS NOT NULL: OWNER 99.2% (28,169), BUSINESSPHONE 58.3% (16,551, 621 distinct), address 97.1%. DO NOT EXECUTE THAT DELETE. HONEST LIMIT: the phone is heavily concentrated - top value covers 31.1% of filled rows, top 10 = 71%; the 90d window has only 41 distinct phones across 359 filled. 82% of recent rows are production tract homebuilding (KB Home, Richmond American, Pulte, D.R. Horton, Beazer, Taylor Morrison). This is BUILDER phone, NOT homeowner phone. The homeowner-grade slice is the Addition / SFR-Custom / Guest House / Accessory work classes = 55 of 465 rows in 90d, roughly 55-70 individual contacts per year. 28,406 rows, ~2,318/yr. Only two CASETYPE values exist - no trade permits anywhere in this service. Native SR wkid 3421, use outSR=4326. No ZIP column.'),

('arcgis_bozeman_mt_active', 'Bozeman MT Building Permits Active and Open (layer 1)', 'MT', 'Bozeman', 'City of Bozeman',
 'https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/1',
 'arcgis', 'none', 'daily',
 'APPLICATION_NUMBER', 'PERMIT_TYPE', 'PERMIT_STATUS', 'APPLICATION_DESC', 'LOCATION', 'PERMIT_ISSUE_DATE', 'VALUATION',
 NULL, NULL, 1,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 84, now(),
 'MT currently has ZERO permits in the table. CONTRACTOR_EMAIL 100% (173 distinct, 106 domains, 0 malformed) and CONTRACTOR_PHONE_1 100% (160 distinct), top value only 9.2% - passes the repeated-office-number test decisively. OWNER_NAME 82.3%. ALREADY CONFIGURED as bozeman-mt.yml (status verified) with a correct field map; the contact columns land in raw_json and no extractor has been built. FOUR CAVEATS: (1) 899 rows = only 322 permits and 255 ADDRESSES (long-format, one row per sub-permit) - real yield is 255 addresses, not 899 leads; (2) LATITUDE/LONGITUDE ARE NOT DEGREES - values ~5,059,483 / ~497,617, layer SR is wkid 26912 NAD83/UTM 12N in METRES; server-reprojected outSR=4326 gives the true 45.68890 / -111.03061; (3) the phone/email belong to the CONTRACTOR/applicant and there is NO owner phone or owner email column - this does nothing for the homeowner-phone ceiling, and many contacts are architects (blackmountainarch.com, intrinsikarchitecture.com, lakeflato.com) or personal gmail (17%); (4) phone format is double-parenthesised (406) (209-8330) on 896/899 rows and OWNER_ZIP_CODE is dirty (91355.) - both need normalisation.'),

('arcgis_bozeman_mt_planreview', 'Bozeman MT Building Permits Plan Review (layer 0)', 'MT', 'Bozeman', 'City of Bozeman',
 'https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/0',
 'arcgis', 'none', 'daily',
 'APPLICATION_NUMBER', 'PERMIT_TYPE', 'APPLICATION_STATUS', 'APPLICATION_DESC', 'LOCATION', 'APPLICATION_DATE', 'PROJECT_ESTIMATED_VALUE',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 83, now(),
 'NET-NEW: bozeman-mt.yml ingests layer 1 only. Compared distinct APPLICATION_NUMBER sets - layer 0 = 123, layer 1 = 340, INTERSECTION = 0. Fully disjoint, and layer 0 newest APPLICATION_DATE (2026-08-04) leads layer 1 newest APPLICATION_DATE (2026-07-10) by ~3.5 weeks, so it is a genuine pre-permit pipeline signal. CONTRACTOR_EMAIL 100% (80 distinct), CONTRACTOR_PHONE_1 100% (77 distinct), OWNER_NAME 78.7%. CONTRACTOR_PHONE_2/3/4 are 0% - do not map. DO NOT CLONE bozeman-mt.yml ONTO THIS LAYER: PERMIT_NUMBER is only 13.2% filled and PERMIT_ISSUE_DATE only 13.2% (pre-issuance records), so the existing issued_date and order_field mapping breaks on 87% of rows. Key on APPLICATION_NUMBER + PERMIT_TYPE. 544 rows = only 123 distinct projects (mean 4.4 rows each, exploded one row per trade with per-trade VALUATION). Same UTM 12N coordinate trap as layer 1 - use outSR=4326. Status mix confirms pre-permit: Plan Check 459, Permit Printed 64, To Be Issued 12.'),

('arcgis_bozeman_mt_co', 'Bozeman MT Building Permits Certificate of Occupancy (layer 2)', 'MT', 'Bozeman', 'City of Bozeman',
 'https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/2',
 'arcgis', 'none', 'weekly',
 'PERMIT_NUMBER', 'PERMIT_TYPE', 'PERMIT_STATUS', NULL, 'LOCATION', 'PERMIT_STATUS_DATE', 'VALUATION',
 NULL, NULL, 2,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 20, now(),
 'DO NOT ROUTE TO THE LEADS TAB. PERMIT_STATUS is Certificate of Occupancy Issued on 316 of 317 rows - a CO means construction is FINISHED and legally occupiable, so the fresh date is the job COMPLETION date and the GC is already paid and gone. This is an ANTI-SIGNAL for lead-gen. Ingest only as a completion signal and a historical_conversion denominator. Contact fill is genuine at unique-permit grain (66 permits): PHONE_1 100% with 45 distinct, EMAIL 98.5% with 46 distinct, OWNER_NAME 77.3%. Row count inflated 4.8x - 317 rows = 66 distinct PERMIT_NUMBER = 62 addresses, exploded per trade. RECENCY CORRECTION: APPLICATION_DATE max is 2026-03-27 with 0 rows in 90d, but PERMIT_STATUS_DATE max is 2026-08-04 with 204 of 317 rows inside 90d - the feed is maintained daily, it is not frozen; the wrong column was being read. Same UTM 12N coordinate trap. Layer 1 is strictly better on every lead-gen axis.'),

-- ── TIER 2: owner and/or contractor NAME populated, no phone or email ───────

('arcgis_minneapolis_mn_ccs', 'Minneapolis MN Construction Code Services Permits', 'MN', 'Minneapolis', 'City of Minneapolis',
 'https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'permitNumber', 'permitType', 'status', 'comments', 'Display', 'issueDate', 'value',
 'Latitude', 'Longitude', 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 80, now(),
 'MN currently has 2 permit rows. This endpoint is 401,377 rows spanning 2016-12-01 to 2026-08-02, 9,336 in the last 90d (~37k/yr). Owner (fullName) 93.9% with 6,572 distinct - 98.9% on the residential subset and the values are individual homeowner names (EARL R HALL, LAURA A HAUSCHILD, TIMOTHY M BLAZEK), not a placeholder; top value MPLS PUBLIC HOUSING AUTHORITY is only 0.6%. Contractor (applicantName) 100%. No phone or email column exists in the schema. FIVE OPERATIONAL NOTES: (1) where-clauses on issueDate REJECT epoch-millis - use DATE yyyy-mm-dd literal syntax; (2) spatialReference is wkid 4269 NAD83, not 4326; (3) Display is street-line only with no city/state/ZIP - ZIP must come from lat/lng or an APN join (APN is the 13-digit Hennepin parcel id, 100% filled); (4) applicantAddress1/applicantCity are the CONTRACTOR mailing address, not the job site; (5) value is only 43.9% filled so permit_value scoring will be null on most rows. THIS IS THE EXACT URL minneapolis-mn.yml ALREADY TARGETS with a field map whose names do not exist on the layer - see section 5 of the source doc.'),

('arcgis_detroit_mi_trades', 'Detroit MI BSEED Trades Permits', 'MI', 'Detroit', 'City of Detroit BSEED',
 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_trades_permits/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'record_id', 'permit_type', NULL, 'work_description', 'address', 'issued_date', NULL,
 'latitude', 'longitude', 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 79, now(),
 'MI currently has 79 permit rows for a ~10M-population state. This endpoint is 117,481 rows, 2019-01-02 to 2026-08-04, ~15k/yr, dataLastEditDate today. owner_name 99.6% with 56,568 DISTINCT values (top value Detroit Land Bank Authority only 3.6%) and a long tail of real individual homeowners. contractor business 87.5% (5,850 distinct), contact name 35.4% and declining (23.2% in last 12mo). No phone or email columns exist. permit_type is a clean trade enum: Mechanical 43,376 / Electrical 35,666 / Plumbing 32,134 / Elevator 2,388 / Fire Alarm 2,292 / Boiler 1,055 / Generator 570. FILTER BEFORE SCORING: 15,383 rows (13%) are municipal DWSD utility-program permits (WATER MAIN REPLACEMENT 8,198 + LEAD SERVICE REPLACEMENT 7,185) - city-run work, not homeowner-initiated; plus Land Bank / DPS / DHC / Wayne State / HFHS institutional owners. contact_* and contractor_address identify the CONTRACTOR, not the job site (job site is the address column). maxRecordCount 1000 so ~118 pages for a full backfill. THIS IS THE CORRECT DETROIT ENDPOINT - the URL currently in detroit-mi.yml returns Virginia Beach VA data.'),

('arcgis_evansville_in_permits', 'Evansville / Vanderburgh County IN Building Commission Permits', 'IN', 'Evansville', 'Evansville-Vanderburgh Building Commission',
 'https://maps.evansvillegis.com/arcgis_server/rest/services/BC/BUILDING_COMMISSION_PERMITS/MapServer/0',
 'arcgis', 'none', 'weekly',
 'USER_Application_Reference', 'USER_Project_Activity', 'USER_App_Status', 'USER_Location_Desc', 'USER_Location', 'USER_Application_Recv_d', 'USER_Estimated_Cost',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 78, now(),
 'IN currently has 728 permit rows. This is a 15-year archive of 153,036 permits (min 2011-01-04) with USER_Owner 99.5% (3,377 distinct in the 2026 sample, top value 1.3%) and USER_Contractor 83.0% (95.9% on 2026 rows). ~210x increase for IN. No phone or email columns exist. USER_Business is effectively dead (0.8%). CAVEAT - THE FEED IS STALLED: max USER_Application_Recv_d is 2026-06-30 and July + August 2026 both return exactly 0 rows. This is anomalous, not a cadence - yearly volume is steady 8.5-9.8k with no gaps and 2025 mid-year months are all normally populated. The service exposes no editingInfo so resumption cannot be predicted. INGEST AS BACKFILL NOW and set a recheck: if max has not moved past 2026-06-30 in ~30 days, reclassify as frozen-historical. USER_Contractor is a PERSON name (MAYES ROBERT A), not a company - do not map to a business name. Excellent trade splits in USER_Project_Activity: RESIDENTIAL ALTERATION/REPAIR 16.3%, MECHANICAL RESIDENTIAL 15.4%, ROOF RESIDENTIAL 14.9%, RES ELECTRIC 11.0%. Use outSR=4326 for coordinates. maxRecordCount 12000.'),

('json_stlouis_mo_plumbing', 'St Louis MO Plumbing Permits API', 'MO', 'St Louis', 'City of St Louis',
 'https://www.stlcitypermits.com/API/Permits/GetPlumbingPermits',
 'json', 'none', 'daily',
 'PermitNumber', 'PermitType', 'CurrentStatus', 'ProjectName', 'ProjectAddress', 'ApplicationDate', 'ProjectCost',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 76, now(),
 'MO has 2,428 permit rows for a ~6.2M state. THREE sibling endpoints (plumbing/electrical/mechanical) together yield ~14k permits/yr, natively trade-segmented, for St Louis CITY only (~280k pop; NOT St Louis County, Kansas City or Springfield). OwnerName 100% raw with 422 distinct (92.7% usable after stripping LRA land-bank rows and the ***SUMMARY RECORD; NOT ON LRMS*** artifact); ContractorCompanyName 100% (147 distinct); owner MAILING address 97.1%, which differs from ProjectAddress on 67.7% of rows - a free absentee/investor-owner signal. No phone or email anywhere in the 40-key payload. CRITICAL SCHEDULING CONSTRAINT: this is a ROLLING ~31-DAY WINDOW, not an archive. No offset, no date parameter, no pagination - 480 rows IS the entire response. POLL DAILY AND ACCUMULATE or history is permanently lost; do NOT schedule weekly. ProjectX/ProjectY are Missouri East State Plane in US survey feet, NOT lat/lng - reproject or geocode from address+ZIP. source_type=json is not one of Henri three supported scrapers, so dispatch.ts will correctly resolve this to unsupported and fail LOUDLY until a JSON adapter or Hetzner loader exists. First call is slow (~21s) - budget the timeout.'),

('json_stlouis_mo_electrical', 'St Louis MO Electrical Permits API', 'MO', 'St Louis', 'City of St Louis',
 'https://www.stlcitypermits.com/API/Permits/GetElectricalPermits',
 'json', 'none', 'daily',
 'PermitNumber', 'PermitType', 'CurrentStatus', 'ProjectName', 'ProjectAddress', 'ApplicationDate', 'ProjectCost',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 75, now(),
 'Sibling of the plumbing endpoint, identical schema and constraints. 364 rows per rolling 30d window (2026-07-05 to 2026-08-04). OwnerName 100% with 340 distinct - top repeat is BARNES-JEWISH HOSPITAL x4, a legitimate large institution, not a staffer placeholder. ContractorCompanyName 100% (137 distinct). OwnerAddress 94.2%, OwnerZipCode 94.8%, ProjectParcelID 99.5%, ProjectCost 94.5%. StructureType Residential 263 / Commercial 97 / Industrial 4. Same rolling-window, same State Plane coordinate trap, same unsupported source_type. GetBuildingPermits and GetDemolitionPermits both 404 - do not chase them; GetPermitTypes confirms the complete enum is {1:Electrical, 3:Plumbing, 4:Mechanical, 11:Sprinkler}.'),

('json_stlouis_mo_mechanical', 'St Louis MO Mechanical HVAC Permits API', 'MO', 'St Louis', 'City of St Louis',
 'https://www.stlcitypermits.com/API/Permits/GetMechanicalPermits',
 'json', 'none', 'daily',
 'PermitNumber', 'PermitType', 'CurrentStatus', 'ProjectName', 'ProjectAddress', 'ApplicationDate', 'ProjectCost',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 74, now(),
 'Sibling of the plumbing endpoint, identical schema and constraints. 350 rows per rolling 30d window (2026-07-06 to 2026-08-05), 4 rows dated today. OwnerName 100% with 326 distinct, most-common value only 1.7%. ContractorCompanyName 100% (95 distinct: Hoffmann Bros 38, Classic Aire Care 28, DOLE HVAC 22). OwnerAddress 92.6%. 86.9% Residential. ProjectType is replacement-heavy (Replacement 288, Alteration 24, Rehab 20, New Construction 17) which is exactly the HVAC wedge. Owner mailing address matches project address on 49.9% - usable owner-occupied signal. Addresses are lowercase and often lack a street suffix (3118 n grand) - normalise. PermitID and PermitNumber are both 100% unique. Same rolling-window and State Plane traps.'),

('arcgis_greenville_sc_permits', 'Greenville SC Building Permits Prior Two Years', 'SC', 'Greenville', 'City of Greenville',
 'https://citygis.greenvillesc.gov/arcgis/rest/services/InfoHUB/BuildingPermits_PriorTwoYears/MapServer/0',
 'arcgis', 'none', 'weekly',
 'PERMIT_NUM', 'PERMIT_TYPE', 'BP_STATUS', 'APPLIC_DESCRIPTION', 'STREETADDRESS', 'NewIssueDate', 'PERMIT_VALUATION',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 72, now(),
 'SC currently has 450 permit rows. Small (3,778 rows, rolling ~2.6-year window, ~1,461/yr, CITY of Greenville ~72k only - NOT Greenville County ~550k) but the best contact schema found in the southeast. OWNER_NAME 100% with 2,353 DISTINCT values, top value only 7.3% (STANLEY MARTIN HOMES, a legitimate volume homebuilder), and real individual person names verified in recent rows. CONTRACTOR_NAME 99.3% (HOME OWNER appears 184x as an owner-builder marker). CRITICALLY it also ships OWNER_ADDR + OWNER_ZIP at 99.7% - an owner MAILING address, which makes DIRECT MAIL viable with no phone. No phone or email columns exist. FOUR LOADER CAVEATS: (1) X_COORD/Y_COORD are SC State Plane FEET, not lat/lng - use returnGeometry=true and outSR=4326; (2) APPLICDATE is a DOUBLE holding YYYYMMDD (20240627.0), only NewIssueDate is a real date; (3) date filtering works ONLY with the plain-string form NewIssueDate >= 2026-08-01 - date and timestamp literals return HTTP 400 because useStandardizedQueries is false; (4) returnDistinctValues 400s on this legacy MapServer - sample rows instead. Values truncate at 30 chars. maxRecordCount 7000 so the whole layer pages in one request.'),

('arcgis_nashville_tn_trade', 'Nashville-Davidson TN Trade Permits (Electrical Plumbing Gas-Mechanical)', 'TN', 'Nashville', 'Metro Nashville-Davidson County',
 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Trade_Permits_View/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'PermitNumber', 'Trade', 'Case_Status', 'Purpose', 'Address', 'Date_Issued', 'Contract_Value',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 70, now(),
 'TN currently has 170 permit rows. This single endpoint is 112,323 - a ~660x state increase - and is DISTINCT from the existing nashville-tn.yml building-permits target (complementary layer, not a duplicate). Newest Date_Issued 2026-08-04, ~100 permits/day. Native Trade column: Electrical 45% / Gas-Mechanical 30% / Plumbing 24% - no NLP needed. Contact 100% (784 distinct per 5k sample, 15.7% unique) but it is the TRADE CONTRACTOR ALREADY HIRED (HILLER PLUMBING 197x, LEE COMPANY 143x, ROMANOFF ELECTRIC 114x) - A TRADE PERMIT WITH A NAMED TRADE CONTRACTOR IS A CLOSED JOB. Do not sell these as leads; correct use is competitive intelligence and trade attribution. Zero phone/email columns, BUT phone is regex-minable from the free-text Purpose field on 6.2% of rows (~7,000) and email on 1.4% (~1,550) in a POC: <name> <phone> pattern, verified real - these are commercial/multi-family project points of contact, not homeowners. TWO INGEST NOTES: (1) Address is only 58.7% filled (52.9% recent) - Parcel and Zip are 100% and Henri already holds TN-DAVIDSON-NASHVILLE (286,448 parcels) in parcel_sources, so street address is recoverable by parcel join; (2) default geometry is TN State Plane FEET (x~1759178) - MUST pass outSR=4326.'),

('arcgis_nashville_tn_issued', 'Nashville-Davidson TN Building Permits Issued', 'TN', 'Nashville', 'Metro Nashville-Davidson County',
 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'Permit__', 'Permit_Type_Description', NULL, 'Purpose', 'Address', 'Date_Issued', 'Const_Cost',
 'Lat', 'Lon', 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 69, now(),
 'NOT A NEW DISCOVERY - this exact URL is already configured at scripts/_sidecar_loaders/configs/nashville-tn.yml with status verified and a correct field map, and it is documented in 16-stale-states-2026-05-06.md and verified-free-sources-2026-08-04.md. TN shows 170 rows, so THE LOADER HAS NEVER LANDED ROWS. The gap is execution, not discovery. Re-verified live: 28,571 rows, rolling ~3-year window 2023-08-01 to 2026-08-04, 724 in the last 30 days (~8,800/yr). Address 100%, ZIP 100%, Date_Issued 100%, Const_Cost > 0 on all rows (median 80,000), Lat/Lon 100%. Contact 99.996% with 6,047 distinct (NVR/Ryan Homes 464, Meritage 406, Beazer 318) - contractor-side; the 2,209 SELF CONTRACTOR RESIDENTIAL rows are the homeowner-pulled jobs but their identity is explicitly withheld (SEE APPLICANT INFORMATION, not in this feed). Secondary fix: the config sets limit 200 against a server maxRecordCount of 1000, making a full backfill ~5x more requests than needed.'),

('arcgis_nashville_tn_applications', 'Nashville-Davidson TN Building Permit Applications (pre-issuance)', 'TN', 'Nashville', 'Metro Nashville-Davidson County',
 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permit_Applications_Feature_Layer_view/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'Permit__', 'Permit_Type_Description', NULL, 'Purpose', 'Address', 'Date_Entered', 'Const_Cost',
 'Lat', 'Lon', 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 68, now(),
 'Pre-issuance applications layer - earlier in the funnel than the Issued layer, which fits the speed-to-lead wedge. 5,861 rows, 2023-08-01 to 2026-08-04, 636 in last 30d (~7,700/yr), growing (2023 577 / 2024 1407 / 2025 1540 / 2026 2337). Address 100%, Parcel 100%, ZIP 100%, Const_Cost 100%. TWO CORRECTIONS THAT WOULD BREAK A LOADER: (1) the circulated field list is ALIASES, not field names - Permit #, Date Entered, Construction Cost and Zip Code all return HTTP 400; the real names are Permit__, Date_Entered, Const_Cost, ZIP; (2) Date_Issued is 100% NULL (IS NOT NULL returns 0 of 5,861) - the column exists but is entirely dead, so Date_Entered is the only usable date. Contact 100% with 2,690 DISTINCT (45.9% cardinality, top value 2.4%) = contractor/builder, plus 118 rows reading SELF CONTRACTOR RESIDENTIAL. Phone is regex-minable from Purpose on 8.6% of the newest 1,000 rows (65 distinct numbers). Poll daily, upsert on Permit__.'),

-- ── TIER 3: no contact fields ──────────────────────────────────────────────

('arcgis_atlanta_ga_permits', 'Atlanta GA Building Permits (Accela point feed)', 'GA', 'Atlanta', 'City of Atlanta',
 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'RecordID', 'TypeCombo', 'Status_1', NULL, 'Address', 'Opend', 'JOB_VALUE',
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 60, now(),
 'GA currently has 2,033 permit rows for an 11M-population state. Org 5RxyIIJ9boPdptdo resolves to City of Atlanta Department of City Planning GIS (authoritative, not a mirror) and every row carries an ACA_Link to the live Accela tenant. 34,872 total, 32,594 usable CONSTRUCTION rows, ~9,230/yr, newest 2026-08-04, 1,052 in last 30d. NO CONTACT FIELDS - and DO NOT map the Name column to owner_name: it is a mixed free-text project-title/status-note field contaminated with clerical junk (NO RECORDS MATCHING THE REQUEST x17, WAITING ON RESPONSE, PLANS ON LIST, Temp Power x20). THREE CAVEATS: (1) TWELVE-MONTH DATA HOLE - months 2024-10 through 2025-08 inclusive return exactly ZERO rows; fresh-lead flow is unaffected but no backfill or historical_conversion work may read that gap as no permits issued; (2) ~20% of recent rows are NOT permits - Open Record Request alone is 666 of the last 90d, so filter TypeCombo <> Open Record Request (also Side Walk Waiver, Noise Temporary Variance) but KEEP Temporary Power, which flags an active jobsite; (3) count(ObjectId) returns 27,961 against a true total of 34,872 because this view carries both ObjectId and ObjectId2 - do not size or paginate off ObjectId. JOB_VALUE is 0 on 21.5% of construction rows. 2,000 rows resolve to 1,411 distinct addresses (multi-trade sub-permits) - the per-address collapse from commit e949e2c handles it. Scope is Atlanta city proper ONLY. Also: the existing arcgis_atlanta seed row and atlanta-energov.yml are both dead placeholders - see section 5.'),

('arcgis_johns_creek_ga_permits', 'Johns Creek GA Building Permits Issued', 'GA', 'Johns Creek', 'City of Johns Creek',
 'https://services1.arcgis.com/bqfNVPUK3HOnCFmA/arcgis/rest/services/Building_Permits_Issued/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'JobID', 'JobTypeDescription', 'JobStatus', NULL, 'JobAddress', 'ISSUE_DATE', NULL,
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 58, now(),
 '19,297 rows, 2013-12-11 to 2026-08-04, ~4,200/yr, 70 in the last 7 days and 1,052 in 90d - genuinely issued permits (cleaner than Atlanta application-grade feed). No owner/phone/email columns exist. TWO DEAD COLUMNS confirmed table-wide: JobTypeDescription_Original and LocationType are 0 of 19,297 non-empty - they return in outFields=* and are always null, do not map them. JobTypeDescription itself is only 69.6% filled table-wide and 33.9% in the last 6 months. NO VALUATION FIELD EXISTS AT ALL, so Henri permit_value signal falls through to null for this entire source; JobSquareFootage is present on 100% of rows but > 0 on only 21.2%. THE REAL VALUE IS TRADE ATTRIBUTION WITH NO NLP: the JobID prefix encodes the trade - MECH 21.6%, ELCT 18.1%, PLMB 15.1% (= 54.8% HVAC/electrical/plumbing), BLDR 11.8%, RWEP 6.3%, FIRE 4.1%, TREE 2.8%, FENCE 1.3%. AddrLocationID is the parcel PIN at 99.7%. JobAddress is street-only with no city/state/ZIP - rely on the point geometry (100%, native wkid 102100, request outSR=4326) for ZIP assignment.'),

('arcgis_slco_msd_ut_cityworks', 'Greater Salt Lake Municipal Services District UT Cityworks Permits', 'UT', 'Salt Lake City', 'Greater Salt Lake Municipal Services District',
 'https://gis.msd.utah.gov/server/rest/services/MSD_Cityworks/FeatureServer/0',
 'arcgis', 'none', 'daily',
 'case_number', 'case_type_desc', 'case_status', 'case_type_desc', 'location', 'date_accepted', NULL,
 NULL, NULL, 0,
 false, 'coverage_and_enrichment_2026_08_05', 'probed', 56, now(),
 'UT currently has ZERO permits in the table. FRESHEST FEED IN THE ENTIRE RUN - newest date_accepted is TODAY (case REM26-1501, Residential Remodel, 9771 S AMBER LN WHITE CITY 84094). MANDATORY FILTER case_group=Building: the layer holds 11 case groups and where=1=1 returns 39,258 rows, of which only 12,619 are permits - the rest are Parking Enforcement, Code Enforcement, Addressing, Business Licensing, Storm Water, Planning and Engineering. The widely-circulated 39,258 figure is that unfiltered count and overstates permit volume by 3.1x. True flow ~2,227/yr, 546 in 90d, 177 in 30d, 12,619 of history. location is 100% filled as street + city + ZIP and 99.8% contain a 5-digit ZIP; no parcel id column but returnGeometry=true with outSR=4326 returns real points so no geocoding pass is needed. NO CONTACT DATA and DO NOT map the undisclosed name column to owner_name - it is the MUNICIPALITY name (13 distinct values: MAGNA 2259, KEARNS 1538, UNINCORPORATED 488, WHITE CITY 250...) and duplicates the city column. Trade mix is squarely the wedge: Residential Elec/Mech/Plumb 1,712, Solar/Photovoltaic 707, Townhome 630, Single Family 451, Remodel 277, Roof Covering Replacement 244, Window and Door 160, Addition 125, plus a dedicated ADU permit type. Covers unincorporated Salt Lake County plus Magna, Kearns, White City, Brighton, Emigration Canyon, Copperton and part of West Jordan. The app0N.cityworksonline.com/CLIENT_GSLMSD host in prior research now 404s - this is the replacement. maxRecordCount 20000.')

ON CONFLICT (source_key) DO NOTHING;

COMMIT;
```

**Post-insert smoke-test order** (highest expected yield first):

```
arcgis_nashville_tn_issued      -- already configured, never ingested. Cheapest win.
arcgis_minneapolis_mn_ccs       -- 401k rows, MN=2. Fix the field map first (section 5).
arcgis_detroit_mi_trades        -- 117k rows, MI=79. Repoint detroit-mi.yml first (section 5).
arcgis_nashville_tn_trade       -- 112k rows, +660x for TN.
arcgis_raleigh_nc_permits       -- best contact payload in the run.
socrata_orlando_permit_apps     -- 1.1M rows, phone + owner name. Fix orlando-fl.yml first.
arcgis_evansville_in_permits    -- 153k backfill, +210x for IN.
arcgis_atlanta_ga_permits       -- +16x for GA. Apply the TypeCombo filter.
arcgis_slco_msd_ut_cityworks    -- opens UT. Apply the case_group filter.
arcgis_henderson_nv_*           -- opens NV.
arcgis_bozeman_mt_*             -- opens MT. Build the contact extractor at the same time.
```

---

## 4. Rejected — with the specific reason

Do not re-probe these. Grouped by region; reason is the disqualifier, not a summary.

### 4.1 Southeast (GA / TN / SC / AR)

| Candidate | Reason |
|---|---|
| Knoxville TN `BuildingPermits` (**the URL `knoxville-tn.yml` targets**) | **Frozen since 2025-05-13.** 13,034 rows — *identical* to the count recorded when the config was verified 2026-05-06, proving zero growth in 3 months. Owner 54.8% / contractor 96.3% fill is real but dead. Worse: the owning org `Ty9G85JMF2cDHlRt` publishes only 16 services and they are all urban-history research layers (HOLC redlining, 1917 Sanborn maps, 1953 city directories) — it is **not** the City of Knoxville. **Downgrade the config to `historical_only`.** |
| Knoxville TN KGIS `ResPermits` (the real KGIS org) | Aggregate, not address-level. Entire schema is `Year / Residential_Permits / Location / FID` — annual counts, no addresses, no dates, no names. |
| Chattanooga TN `BuildingPermits` (CHCRPA) | Frozen since 2023-11-30 (20 months). 76,957 rows, no contact fields. |
| Chattanooga TN `Chatt_permits_to_12_31_2025` | Static annual export, cut off 2025-12-31 — the name declares it. 42,633 rows. Worth ingesting as backfill (2 years fresher than the layer already catalogued) but not a live feed. Re-probe Jan 2027 for a `_2026` sibling. |
| Little Rock AR Socrata | **TLS certificate expired** — host unfetchable anonymously. Discoverable datasets are described as *monthly counts* and a *trendline*, which reads aggregate, not address-level. One retry with a cert-tolerant client is warranted only to establish whether address-level data exists at all. |
| Savannah / Chatham GA · Athens-Clarke GA · Augusta-Richmond GA · **Gwinnett County GA** · Cobb County GA | Full DCAT-US catalogs pulled; **zero permit datasets** in any of them. Gwinnett is GA's 2nd-most-populous county (~1M) and publishes no permit API. Cobb has zoning-petition apps only. |
| Peachtree Corners GA | Abandoned one-off monthly snapshots (Sept 2018, July 2019, Aug 2019, Dec 2020). Newest frozen Dec 2020. |
| Horry County SC (Myrtle Beach) | Full REST folder enumerated: 45 services, zero permits. Permits live behind a search UI, not an API. |
| Columbia / Richland County SC | Only hit is a Blythewood FeatureServer behind a `utility.arcgis.com/usrsvcs/...` **credentialed proxy** (fails the anonymous constraint), and Blythewood is ~4k population. The state capital has no anonymous permit API. |
| Charleston County / Mount Pleasant / North Charleston SC | No permits. Charleston County GIS publishes 70,090 address points but no permits. Only the **City** of Charleston publishes, and only new construction. |
| Conway AR · Bentonville / Rogers / Springdale AR · Washington County AR | No permit datasets in any REST folder; Washington County's server did not respond. The regional "NWA Building Permits" resource is a newspaper viewer, not an API. |
| Atlanta Regional Commission hub | **DCAT feed returned HTTP 500** — unresolved, and the highest-value loose end in GA. ARC is the 11-county metro planning agency and advertises a `permits` tag, which would cover Gwinnett/Cobb/DeKalb/Fulton in one place. Retry the DCAT endpoint; if still 500, fall back to `?tags=permits` and resolve items individually. |
| `services6.arcgis.com/ONZht79c8QWuX759/.../Building_Permits` | **Search-engine trap — reject on sight.** Returned as the top hit for Knoxville, Greenville SC, Little Rock *and* Fayetteville AR queries. Schema is `Year / Quarter / Geography / Single_Units / … / TotalPermits_Value` — a Census-style quarterly units-authorized rollup with no addresses, no dates, no names, no identifiable jurisdiction. |

### 4.2 Midwest (MI / WI / MN / IN / MO)

| Candidate | Reason |
|---|---|
| **`Building_Permits_Applications_view` on org `CyVvlIiUfRBmMQuu`** — the URL `detroit-mi.yml` uses | **Wrong state.** `returnDistinctValues` on `State` = `['', 'VA']`, on `City` = `['', 'Virginia Beach']`. Zero Michigan rows. It is a perfectly good **Virginia** source (103,672 rows, live, max IssueDate 2026-07-31) that is simply mislabeled — re-file it under VA. Secondary gotcha: its `IssueDate`/`ApplicationDate` are **strings** (`2026/07/31`), so date-typed where-clauses silently return 0 rather than erroring. |
| Kansas City MO `ntw8-aacc` (the contact-bearing KCMO set) | **Frozen since 2025-05-09** (15 months); a bounded 90d count returns exactly 0. Painful — it carries `contractorcompanyname` on 660,283 rows plus `contractorlicnum` and `contractortrade`. Worth a **one-time** pull for a ~660k-row KC contractor directory; must not be scheduled as live. |
| Kansas City MO `w8jz-wjgn` | Live (1,524,600 rows, 10,555 in 90d) but **zero contact fields**, and it carries dirty far-future dates — `max(issue_date)` reads **3036-03-04**, so any unbounded MAX or one-sided filter misreads freshness. Bound both ends; honest newest is 2026-07-31. Not rejected on quality, only deprioritized behind contact-bearing sources. |
| Indianapolis IN (`gis.indy.gov`, `xmaps.indy.gov`) | **Host unreachable** — curl HTTP 000 (connection failure, not 4xx) on both, including a service URL harvested from Indy's own DCAT. Separately, `data.indy.gov` has 651 datasets and the only permit hits are **scanned zoning-ordinance PDFs**. Largest city in the region and still uncovered. Retry from a different egress before writing off. |
| Fort Wayne IN | **Cloudflare interactive challenge** — returns the "Just a moment…" JS page. Phase-4 headless-browser territory. |
| Ann Arbor MI | Documented as CKAN but `/api/3/action/*` returns a Next.js SPA shell — the action API is not exposed. Records live in STREAM (Accela-class) and A2Trak. Scrape-only. |
| Grand Rapids MI | Classic false positive. The `Accela` folder contains only inspection-**AREA** polygons (`Electrical Areas`, `Plumbing Inspection Areas`) — administrative geography for the permitting app, zero permit records. GRData hub's only permit-named dataset is Soil Erosion. MI's 2nd-largest city has no permit API. |
| Madison WI | Triple-checked. The `ELAM` folder (ELAM *is* Madison's Accela system) contains exactly one service: **`ELAM_Edibles`** (edible plants). Open-data hub's only permit hits are residential *parking* permits. Real data is behind `aca-prod.accela.com/madison` + SSRS HTML reports. |
| Green Bay WI | **Not anonymous.** The `utility.arcgis.com` proxy returns HTTP 500 "Unable to generate token with the credentials provided". Own hosts do not resolve. |
| **St Paul MN `Approved_Building_Permits`** | **Frozen 2025-06-30**, zero permits in 90d. The contractor-name claim is *true* — `CONTRACTORNAME` 100%, 19,680 distinct, real values — but the feed is 13 months stale, its sibling layer freezes on the same date, and all 31 services in St Paul's AGOL org were enumerated with no fresher permit layer. **Accept only as** a 19,680-name contractor roster and a `historical_conversion` denominator. Do not let it imply MN metro coverage. |
| Twin Cities MN Met Council Residential Permits | **Annual granularity, not a lead feed.** Only temporal field is `YEAR` (a string), range 2009–2025, **zero 2026 rows**. ZIP only 31%. Usable as `zip_demand` context across the 7 metro counties, never as lead flow or freshness input. |
| Milwaukee WI CKAN | The only live permit feed confirmed **in the entire state**, and it is thin: 16,685 rows but **164 issued in 90d**, max 2026-06-15, no contact fields, and only 4 permit types — **none of them trade permits** (Commercial/Residential Alteration + New Construction). Does not solve WI. |
| Greenwood IN · Westfield IN | Abandoned. Greenwood 259 rows frozen 2015; Westfield's layer is literally named "Building Permits 2009-2015" and is really a parcel/assessor join. |
| Brampton / Peel **ONTARIO** (surfaced by a Grand Rapids search) | Wrong country **and** wrong grain — 684 rows of annual aggregate counts. Cautionary case for title-search results. |
| South Bend IN · Evansville APC historical · Springfield MO · Columbia MO · MSDIS | Four hubs read in full, no live permit records. Springfield and Columbia are MO's 3rd and 4th largest cities and remain uncovered. |
| St Louis MO `stlgis.stlouis-mo.gov` | Redirects to a "Down for Maintenance" page. Retry later. Separately, St Louis **building** permits (the 80+ field set with contractor data) are distributed **only as a 30 MB Microsoft Access `.zip`** — not a free anonymous JSON endpoint. |

### 4.3 Missing-five (MT / NV / NH / OK / UT)

| Candidate | Reason |
|---|---|
| Oklahoma City OK `gis.okc.gov` | **Incapsula bot wall, still up.** HTTP 200 but the body is a 949-byte challenge page. No anonymous API access. |
| Norman OK | Every permit-named service is a year-stamped snapshot (`Single_Family_Permits_2017/2018`, `Multi_Family_2017/2018`, `Mobile_Home_2018`). 8 years stale. |
| Edmond OK `EdmondOKPLL` | Folder name promises Cityworks Permits/Licensing/Land; all 24 layers are basemap (Addresses, Parcels, Streets, Schools). Zero permit records. |
| City of Tulsa OK hub | DCAT fully enumerated: 30 datasets, **zero permits**. |
| Moore OK | Folder contains exactly one service: `Zoning:MapServer`. |
| **Las Vegas NV `Bldg_Permits` layer 379** | **Frozen ~2026-01-31 — corrects prior research.** Prior work called it live because "ISSUE_YR 2026 is present". It is present with **2,060 rows, all January**; Feb–Aug 2026 tested individually all return **0**, against 197,632 for 2025. Excellent as a **1.88M-row backfill** (ADDR 100%, owner `APNAME` 99.2%, contractor `APPLICANT` 99.9%, VALUATION 96.1%) but it will not produce a single fresh lead. Gotcha: `ISSUE_DT` is a **string** `DD-MMM-YY` so server-side date filtering and ORDER BY are impossible — page on OBJECTID. |
| Las Vegas NV `Building_Permits_Open_Data` | 436,181 rows, layer exposes **exactly one field: `ObjectId`**. Still field-stripped. |
| Clark County NV `gisgate.co.clark.nv.us` | **TLS certificate hostname mismatch** — not fetchable without disabling verification, which was not done. Combined with three prior independent probes concluding Accela-only, the highest-value NV jurisdiction (~80–120k permits/yr) stays uncovered. |
| Utah County UT `Building_Permits` MapServer | Service is published with a promising description but returns `layers:[]`, `tables:[]`, and `/0`, `/1`, `/2` each return "Layer not found". **An empty shell.** Provo/Orem (~700k) uncovered. |
| Sandy UT `EnerGov/egMap` | Basemap trap — 19 reference layers. The only permit-ish layer is Site Plan Review (planning cases). |
| Carson City NV | 68 commercial + 24 residential rows, created and last-edited 2023-12-20. Curated development snapshots, not a stream. |
| Douglas County NV `Historical_Building_Permits_Table` | 68,654 rows but **no date field of any kind**, no address, no owner, no value. `PermitType` is an opaque 4-char code. Structurally unusable. |
| **Nashua NH `Building_Permits_June_2025`** (the URL `nashua-nh.yml` targets) | **Frozen — one-time June-2025 snapshot, 14 months stale.** `Issue_Year 2026` = 0 rows; zero entries in 90d. The config is marked `status: verified` — that is wrong and should be corrected. (Prior research separately found the config maps `applicant: ProjectName`, a field that does not exist on the layer, so an `outFields` request containing it returns HTTP 400.) |
| 26-host bulk sweep across NV/UT/MT/NH/OK | Dead by DNS failure, timeout, 404 or TLS mismatch: Reno, Sparks, N. Las Vegas, Carson City, Washoe Co; SLC, Provo, Ogden, West Valley, St George; Billings, Kalispell, Helena, Missoula city, Gallatin Co, MT state GIS; Manchester, Concord, Portsmouth, Dover; Oklahoma Co, Lawton, Midwest City, Broken Arrow, Stillwater, Tulsa city + county. Also checked and empty of permits: Missoula County Permitting folder, Great Falls Planning folder, Salt Lake County slco.org. |

### 4.4 Contact-enrichment hunt — the "present but empty" graveyard

**Eleven of twenty-one rejections were columns that exist and are empty or fake. That is the
base rate in this domain.** Assume a contact column is empty until a non-null count says otherwise.

| Candidate | Reason |
|---|---|
| **WV statewide Site Address Points `Res_Phone`** | **CORRECTION TO CLAUDE.md.** Henri's notes call WV `Res_Phone` a phone-fill unicorn ("gold"). Measured: **1,095 of 1,050,208 rows = 0.10%**, max `LASTUPDATE` **2017-03-17**. Downgrade from "gold" to "noise". |
| Raleigh SAMB · Wyoming SAMB · Mercer County NJ · Harrison County WV — `Res_Phone` | 0 of 45,321 · 0 of 19,767 (and frozen 2016) · **1** of 33,215 and that value is `EDDIE VIA`, a person's name typed into a phone field · 0 of 35,076. **With WV above, this closes the NG911 / SAMB angle: `Res_Phone` is a schema artifact and is empty everywhere, including in WV itself.** |
| **Miami-Dade `data_accounts` (505,722) + Bulky Waste Pickup Orders (976,181)** | Looked like the single largest homeowner-phone find available — `OWNER_PHONE` keyed to `PROPERTY_ADDRESS`. Measured **`OWNER_PHONE` = 0 on both**. `OCCUPANT_PHONE` also 0. Pure schema. |
| Atlanta DPW Traffic Control Permits | `APPLICANT_PHONE` 0 and `APPLICANT_EMAIL` 0 of 16,780. GA has only 2,033 rows so this would have mattered. |
| Kennesaw GA iWorq Parcels | `Owner_Phone` 0 and `Owner_Email` 0 of 33,680. The iWorQ parcel template ships both columns unpopulated. |
| Schuber MO Parcels | 347,334 parcels, `Owner_Phone` populated on **5 rows, all holding `8888888888`**. Present-but-fake. |
| Bismarck ND Building Permit Activity | `OWNER_PHONE` 1.3% (83 distinct), `OWNER_EMAIL` 0.6%. Live and well-structured but at Henri's current baseline plus noise. |
| Opengov Permitting Layers Address Point | `OWNER_PHONE` 0 and `OWNER_EMAIL` 0 of 21,911. |
| **Naperville IL `BldgPermitNaviMaster_view`** | `CONTRACTOR_PHONE` reads **99.98% filled** — exactly the shape of a false positive. Sampled values are `00`, `05225`, `05265`, `03125420`: license/registration codes, not phone numbers. Ingest the *Contractors* table instead. |
| Denton County TX Culvert Permits | `OwnerPhone` 72.5% — genuinely good — but **frozen 2023-05-30** (layer title says "1/05-7/23") and only 1,212 rows. |
| **Shovels.ai layers** (LA County + nationwide trade layers) | The data is real (LA County: contractor phone 37.6%, email 30.9%, owner phone 5.7%) and answers anonymously, **but these are a commercial vendor's public marketing/demo layers** (owner accounts `shovelsai`, `ianwellskennedy_shovels`), not a government open-data publication. Ingesting and reselling a competitor's aggregated product is a licensing exposure Henri should not take. Flagged for awareness only. |
| `pmaV5_property_data` (156,351 rows, `owner_email` 100%, `owner_phone` 34%) | Best-looking homeowner file in the crawl. **Rejected on provenance**: hosted on a personal ArcGIS Online account (`jglover1900`) with no government publisher, max `last_update` 2022-04-24. Unknown origin, likely purchased or scraped. Not a public record. |
| Chula Vista CA business licenses | `OwnerPhone` 93.4% but sampled values include impossible US area codes (`(180) 558-8169 x2`, `(194) 221-5666`) — scrambled or misparsed. Grain is business licenses at a business address, not property owners at a job site. Would inject bad numbers. |
| Victoria **BC** building-permit layers | Out of scope — Canada (`.ca` domains, 250 area code), and ~5% fill. The 5 distinct phones on the sibling layer are all city-staff `250-83x` numbers. |
| `building_permits` on org `lQySeXwbBg53XWDi` | Live (max 2026-08-03) but `ContractorPhone` 4.8% and `ContractorEmail` 0.5%. Below any useful threshold. |
| West Fargo ND Residential Civil Site Permitting | `ResidentPhone` and `ResidentEmail` are **28/28 = 100%** — exactly the right schema (genuine resident phone+email intake) — but the layer holds **28 rows total**. Pattern worth watching, not ingestable volume. |
| `Permit_Issued_Last_30_Days` on org `SCwJH1pD8WSn5T5y` | 41 rows, both contact columns 0 filled. |
| Butler County KS `Permits_Premium` | **Not new** — already named as known ground. Re-verified live (Jobsite layer 937 rows, phone 100%, owner_phone 46.9%, owner_email 27.2%, max CreationDate today, per-trade contact sub-layers). Listed so it is not double-counted. |

### 4.5 Structural dead ends carried forward (unchanged, do not re-probe)

- **Houston TX** — three independent channels checked (Public Works DCAT 185 datasets, MyCity DCAT 173, CKAN `package_search`). No address-level permits. 2.3M people; Phase-4 scraper only.
- **Rhode Island** — every municipality on OpenGov ViewPoint; `api-east.viewpointcloud.com/v2/<tenant>/records` returns **403** to anonymous callers (only `/recordTypes` is open). Partnership path documented in `opengov-viewpoint-partnership-2026-05-07.md`.
- **Maine · North Dakota · West Virginia · Mississippi** — no municipal permit API found by any method.
- **Vermont** — Act 250 is live (8,278 records) but the layer has **no date field whatsoever**, so it cannot satisfy freshness scoring or even be ordered. `vt-act250-statewide.yml` references `Status_Date`, which does not exist.

### 4.6 Method traps worth carrying into the next run

1. **`col <> ''` returns 0 for every column on Oracle/SDE-backed ArcGIS layers.** Use `IS NOT NULL`. This one artifact nearly caused a working 58%-fill phone column to be deleted from the catalog.
2. **ArcGIS Hub's `q` parameter ignores state qualifiers.** "building permits Georgia", "…Arkansas" and "…Tennessee" returned byte-identical result sets dominated by DC, Ontario and Maricopa. Same for AGO `bbox` and Hub `filter[extent]` — three "New England" hits were in Washington, Alberta and Ontario. **Always verify the owning org.**
3. **What actually works:** (a) pull a jurisdiction's DCAT-US feed at `/api/feed/dcat-us/1.1.json` — proves a negative for an entire city in one request; (b) enumerate an org's full service list at `/arcgis/rest/services?f=json`; (c) for web-app-only datasets, fetch `/sharing/rest/content/items/<id>/data` and regex out `rest/services` URLs — that is the **only** way Evansville was reached.
4. **A service named for a permitting app is usually the basemap for that app**, not the records. Madison's `ELAM` folder contains `ELAM_Edibles`. List the layers before believing the name.
5. **Always pair a non-null count with a distinct count.** The distinct count is the only thing separating a real contact field from one office number stamped on 84k rows.
6. **Check for projected coordinates in columns named LATITUDE/LONGITUDE.** Three of 23 confirmed sources ship UTM metres or State Plane feet under those exact names.

---

## 5. In-repo configs that are broken (highest-value finding in this document)

These are derived from reading the shipped config files against the field lists captured from
live responses in this run. **Each needs one confirming probe before rewriting** — the config
files were read directly; the upstream field lists came from the verifier's probes.

| Config | Problem |
|---|---|
| **`scripts/_sidecar_loaders/configs/detroit-mi.yml`** | Points at `services2.arcgis.com/CyVvlIiUfRBmMQuu/.../Building_Permits_Applications_view` — **Virginia Beach, VA**. Zero Michigan rows. Repoint to `bseed_trades_permits` (+ the building and demolition siblings) and re-file the old URL under VA. Its field map (`PermitNumber`, `StreetAddress`, `WorkDesc`, `EstimatedCost`, `Applicant`, `ContractorName`) also does not match the BSEED schema (`record_id`, `address`, `work_description`, `owner_name`, …). |
| **`scripts/_sidecar_loaders/configs/minneapolis-mn.yml`** | Correct URL (`CCS_Permits`), **wrong field names**. Config maps `StreetAddress`, `Zip`, `WorkDesc`, `EstimatedCost`, `Applicant`, `ContractorName`. The layer's real fields are `Display`, `APN`, `comments`, `value`, `applicantName`, `fullName`. At least **6 of 11 mapped names do not exist** — an `outFields` request naming a non-existent field returns HTTP 400 on ArcGIS. Plausible mechanical cause of MN = 2 rows. |
| **`scripts/_sidecar_loaders/configs/orlando-fl.yml`** | Correct dataset (`ryhf-m453`), **wrong field names**. Config maps `applicationnumber`, `applieddate`, `issueddate`, `address`, `zipcode`, `worksummary`, `declaredvalue`, `applicantname`, `contractorname`, `applicationtype`, `status`. The real columns are `permit_number`, `processed_date`, `issue_permit_date`, `permit_address`, `parcel_number`, `location`, `property_owner_name`, `contractor_name`, `contractor_phone_number`, `worktype`. Only `worktype` matches. Socrata 400s on an unknown `$select` column. |
| `scripts/_sidecar_loaders/configs/nashville-tn.yml` | Field map is **correct** and `status: verified` — but TN has 170 rows, so the loader has never landed data. Execution gap, not a config bug. Minor: `limit: 200` against a server `maxRecordCount: 1000` makes a full backfill ~5× more requests than needed. |
| `scripts/_sidecar_loaders/configs/knoxville-tn.yml` | Targets a layer frozen since 2025-05-13, owned by an urban-history research account, not the city. Downgrade to `historical_only`. |
| `scripts/_sidecar_loaders/configs/nashua-nh.yml` | Targets a June-2025 one-time snapshot, 14 months stale, marked `status: verified`. Correct the status. |
| `scripts/_sidecar_loaders/configs/henderson-nv.yml` | Points at `opendata.cityofhenderson.com/resource/fpc9-568j.json`, which now 302-redirects and serves no JSON — Henderson migrated off Socrata to ArcGIS. Repoint to the two OpenDevPermits MapServer layers in §3. **Do not delete the contact claim** (§0, item 3). |
| `scripts/_sidecar_loaders/configs/bozeman-mt.yml` | Correct and verified — but ingests **layer 1 only**. Layers 0 and 2 are fully disjoint (`APPLICATION_NUMBER` intersection = 0) and carry the same 100% contractor email + phone. Layer 0 is ~3.5 weeks fresher. The comment block already flags that `CONTRACTOR_EMAIL`/`CONTRACTOR_PHONE_1` land in `raw_json` with **no extractor built** — that extractor is still the missing piece. |
| `scripts/_sidecar_loaders/configs/atlanta-energov.yml` | Dead placeholder — `loader: energov` against `aca-prod.accela.com/atlanta_ga`, and its own comment admits Atlanta runs Accela, not Tyler EnerGov. Atlanta's Accela already mirrors to a live public ArcGIS feed (§3), so the scrape path is unnecessary. Repoint or delete. |
| Seed row `arcgis_atlanta` (migration `00014`) | Endpoint `https://dpcd.coaplangis.opendata.arcgis.com/datasets/permits/FeatureServer/0` is a Hub landing-page pattern, not a queryable service, with invented field names (`PERMIT_NUMBER`, `ISSUE_DATE`, `ESTIMATED_VALUE`). Mark `deprecated` in favour of `arcgis_atlanta_ga_permits`. The same pattern applies to the other 11 `arcgis_*` seed rows in `00014` (`arcgis_durham`, `arcgis_tampa`, `arcgis_sanjose`, `arcgis_houston`, `arcgis_aurora`, `arcgis_fairfax`, `arcgis_stpete`, `arcgis_knoxville`, `arcgis_arlington`) — all use the same fabricated `opendata.arcgis.com/datasets/permits/FeatureServer/0` shape. Worth a batch audit. |

---

## 6. Claimed by a hunter but NOT independently re-probed

These came out of the regional agents and look promising, but **no second agent re-fetched
them in this run**, so they are not confirmed and are deliberately **excluded from the SQL**.
Probe before inserting. Ranked by expected value.

| Candidate | ST | Claimed | Why it matters |
|---|---|---|---|
| Memphis / Shelby County — **Opendatasoft** `datamidsouth.org` | TN | 10,873 rows, rolling 15mo, contractor name 76.7%, lat/lon, ZIP, cost | **Resolves the "Memphis mid-migration, revisit in 30-60 days" note** — Shelby landed on Opendatasoft, not Socrata. Needs a new generic ODS loader (`/api/explore/v2.1/catalog/datasets/<id>/records`), reusable across every ODS portal nationwide. |
| Fayetteville AR — City Permits | AR | 57,542 rows, live today | **The only live Arkansas permit endpoint found.** AR has 1 row. Trap: `max(ISSUEDATE)` = 2026-09-11 (data-entry error) — clamp `<= now()`. |
| WA L&I Intent + Affidavit Project Details | WA | ~62k / ~52k **distinct contractor emails**, ~47k distinct phones | Largest single free contractor-contact pool found anywhere in the run. |
| Miami-Dade `contractor_daily_data` | FL | 21,978 rows, phone 99.3%, email 45.5% | Same ArcGIS org as the Miami-Dade permit feed Henri already ingests — joins by name/number to backfill contact onto existing FL leads. |
| Minneapolis Active Rental Licenses | MN | owner phone 86.6%, owner email 84.3%, 23,412 properties | **Property-owner phone AND email keyed to a street address** — the exact shape of the binding constraint. Caveat: landlords, not owner-occupants. |
| New Orleans non-commercial STR licenses | LA | 1,185 properties, phone 100% / email 100%, one unique value each | "Non-commercial" in NOLA means owner-occupied. Highest-purity homeowner contact found; tiny. |
| Shaler Township PA (Survey123-backed) | PA | owner phone 86.8%, owner email 75.5%, 1,071 rows | **The pattern is the find**: municipalities running permit intake on ArcGIS Survey123 publish the raw submission table including every contact field. Worth a dedicated national sweep. |
| Austin Subdivision Cases `s7gx-9m54` | TX | owner phone 79.6% with 3,992 distinct | One of very few feeds with an OWNER phone above 70% and a distinct count proving it is per-owner. Grain is subdivision-plat, not per-house. |
| Wyandotte County KS ROW Permits | KS | applicant phone/email 94.3%, owner phone 73.3% | KS has 3,247 rows. Caveat: on ROW permits the "owner" is frequently a utility, not a homeowner. |
| Dallas TX Building Permits FY2023-24 | TX | 14,336 rows, phone 100% (~7% junk), email 86.8% | Not lead flow — the missing **contractor phone/email dictionary** for Dallas, joinable to the live Dallas ROW feed. |
| Detroit BSEED **Building** + **Demolition** permits | MI | 46,375 / 16,232 rows | Demolition carries owner 99.9% + contractor 99.2%. Building has **no contact fields** — the BSEED family is *not* uniformly contact-rich. |
| NY DOL Contractor Registry `i4jv-zkey` · Mold `ikqx-ispy` | NY | phone 99.8% (13,629 distinct) · 97.6% | Statewide; registry also carries **debarment dates** = a contractor-trust signal at onboarding. NY is Henri's #3 state with no contractor-phone source. |
| TX TDLR All Licenses `7358-krk7` | TX | phone 10.1% but **85,805 distinct** | The filled subset is ~one unique phone per licensee. `owner_telephone` is the *same value duplicated* — do not double-count. |
| Richardson TX COs · Mecklenburg NC Address Intake · Leon County FL · Cleveland OH contractors · Montgomery MD builders · NYC SBS · Delaware DNREC septic/well · Salt Lake Co flood · MO DNR asbestos · Orlando STR + ROW · Austin Plan Review + Zoning | — | see the area reports | Smaller contact-enrichment rosters. Note two honest limits already found: Richardson's *Owner* columns are near-empty (1.9%/0.4%) — claim applicant/tenant only; Austin's Zoning file has only 26 cases in 90d, so it is a static dictionary, not a feed. |
| Nashua NH `PermitAreaToAGO` · Tulsa County OK · Douglas County NV · Milwaukee WI · Charleston SC new construction · St Louis Sprinkler · Nashville contractor roster | — | see the area reports | Thin or stale but they are the *only* thing in their jurisdiction. Douglas County NV is structurally interesting: it **republishes its Accela records as a plain anonymous ArcGIS MapServer**, which disproves "NV is all-in on Accela" as a blanket statement — the other NV Accela counties are worth re-probing for the same pattern before anyone builds a scraper. |

---

## 7. Honest closing — what is still uncovered, and can free data fix it

### What this sweep actually changes

| State | Rows today | Confirmed addressable here | Note |
|---|---:|---:|---|
| MN | 2 | **401,377** | Minneapolis. Config exists; field map is wrong. |
| MI | 79 | **117,481** | Detroit BSEED. Config points at Virginia Beach. |
| TN | 170 | **146,755** | Nashville ×3. Config exists and is correct; never ran. |
| IN | 728 | **153,036** | Evansville. Archive-grade; feed stalled 36 days. |
| GA | 2,033 | **51,891** | Atlanta (32,594 construction) + Johns Creek. |
| MO | 2,428 | ~14,000/yr | St Louis city ×3, rolling 30d — must poll daily. |
| SC | 450 | 3,778 | Greenville city only, ~1,461/yr. |
| NV | 0 | 36,906 | Henderson only. Clark County still closed. |
| UT | 0 | 12,619 | Greater Salt Lake MSD. SLC proper still Accela-only. |
| MT | 0 | ~255 addresses live | Bozeman ×3. Tiny, but 100% contractor email + phone. |
| AZ | 24,569 | 155,662 | Mesa alone = 6.3× the state's current total. |
| FL | 110,207 | 1,105,918 | Orlando. Config exists; field names wrong. |
| NC | 289,979 | 183,319 | Raleigh — best contact payload in the run. Confirm no overlap with existing NC ingest before wiring. |
| CA | 615,647 | 187,439 | Elk Grove. Depth, not coverage. Ingest for the phone column only. |
| IL | 76,961 | 33,217 | Naperville — enrichment, negligible coverage. |

**The dominant finding is not discovery, it is execution.** Nashville, Minneapolis, Detroit,
Orlando, Bozeman and Henderson were all *already in the repo* as configs. Four are broken
(wrong host, wrong field names), one has never run, one ingests 1 of 3 available layers. The
same pattern held in the earlier run for Portland OR (119 rows against 1.4M available) and Las
Vegas. **Fixing six config files is worth more than another week of endpoint hunting.**

### States still genuinely dark after everything

| State | Status | Fixable with free public data? |
|---|---|---|
| **WY** (15 rows) | Cody, pop ~10,000, is the **only** jurisdiction in the state with a live anonymous endpoint. Cheyenne, Casper, Gillette, Sheridan, Laramie, Teton all unreachable or ViewPoint. | **No.** Scraper or commercial feed. |
| **WI** (8 rows) | Milwaukee CKAN is the only live feed statewide: 164 permits in 90d, no trade permits, no contacts. Madison is Accela + SSRS. Green Bay is credentialed. | **No** at any useful volume. |
| **RI** (1) · **VT** (1) · **ME** (1) | RI is 100% OpenGov ViewPoint (403 anonymous). VT's Act 250 has no date field. ME has no municipal API at all. | **No.** RI needs the ViewPoint partnership; VT and ME need scrapers. |
| **ND** (30,787) · **SD** (25,012) | Counts look healthy but come from parcel-adjacent sources; Bismarck's permit feed has 1.3% owner phone and Fargo/Grand Forks publish nothing structured. | Marginal. |
| **OK** (0) | OKC behind Incapsula. Tulsa County's only feed is 11 months stale, has **no address field at all** (parcel number only), and no contacts. Norman/Edmond/Moore all dead. | **No.** OKC needs a headless-browser bypass. |
| **NH** (0) | Nashua's street-opening feed (~650/yr, 5.5% company name) is the only live thing in the state, and the configured building-permit layer is a 14-month-old snapshot. Manchester, Concord, Portsmouth, Dover: nothing. | **No** at useful volume. |
| **MS · WV** | No municipal permit API found by any method across multiple sessions. | **No.** Substitute parcel/lien layers only. |
| **KS** (3,247) · **NE** (7,662) | Wyandotte County ROW is the only contact-bearing find; Butler County was already known. | Partially — county-level only. |
| **AR** (1) | Fayetteville (~57k rows) is claimed but **not re-probed**. Little Rock is behind an expired TLS cert and its datasets read as aggregate. | **Probably yes for Fayetteville**, no for the rest. |

### The two biggest holes, stated plainly

**Houston is still closed.** Three independent channels checked; none publishes address-level
permits. 2.3M people, the 4th-largest US city, and it cannot be reached with a free anonymous
API. It needs `permits.houstontx.gov` — Phase-4 scrape territory. **TX is not "mostly dark"**
after the earlier run (~530k addressable rows across 12 endpoints) — but its largest city is,
and San Antonio, Fort Worth, Austin and Collin CAD were already catalogued. Lubbock, Laredo,
Waco, Garland, Amarillo, Odessa and Denton have no city permit API; Lubbock and Waco run Tyler
EnerGov and expose only the empty GIS scaffolding around it.

**Clark County NV is still closed.** ~80–120k permits/yr — the highest-value single
jurisdiction still missing nationally — confirmed Accela-only by four independent probes now,
with the county's own GIS host failing TLS hostname verification. Henderson opens NV, but
Henderson is ~2,300 residential + ~600 commercial permits/yr against Clark County's ~100k.

### On the phone-fill ceiling

Henri's phone fill is ~1%. This run adds five sources with genuinely populated phone at
meaningful volume — Raleigh (83.1%), Orlando (73.9%), Elk Grove (66.3%), Naperville (91.5%),
Mesa (18.3% → 42.6% recent) — plus Bozeman and Henderson at low volume.

**Every one of them is contractor-side, not homeowner-side.** There is no owner-phone column on
any of the 23 confirmed sources. The homeowner-phone leads found in this run are Minneapolis
Rental Licenses (86.6%, but landlords), New Orleans non-commercial STR (100%, but 1,185
properties) and Shaler Township PA (86.8%, but 1,071 rows) — all **unverified**, all narrow.
This is consistent with, and does not improve on, the v2 catalog's conclusion: **free-data
homeowner phone-fill caps nationally around 8–12%**, and the NG911 `Res_Phone` theory is now
definitively dead (measured empty on five layers including West Virginia's own statewide file,
which CLAUDE.md currently calls gold).

What the contractor-side phone *is* worth: trade attribution, competitive intelligence, and —
arguably the largest unclaimed value in this document — **~20,000 distinct contractor phone/email
pairs across Raleigh, Orlando, Mesa, Elk Grove and Naperville, which is Henri's own
customer-acquisition list for five metros.** Henri needs 5 contractors at $149/mo to launch.

**Moving homeowner phone past ~12% requires paid data (Apollo, ~$49/mo).** No further free-data
research will change that. The remaining free-data work is not discovery — it is six config
fixes, one Opendatasoft loader, one JSON adapter for St Louis, and a Bozeman contact extractor.
