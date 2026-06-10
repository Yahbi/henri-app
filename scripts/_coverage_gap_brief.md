# Coverage-gap research brief (2026-06-09)

Henri ingests US building permits into `permit_sources` (12k+ rows) and needs
maximum ZIP coverage with CONSTANTLY-FRESH data. Find LIVE machine-readable
permit endpoints. LIVE-PROBE every URL (HTTP 200 + real permit records + a
record dated within the last 60 days unless noted historical). Unprobed URLs
are worthless — prior research found ~50% of guessed URLs dead.

## Already covered (do NOT re-report)
- NJ DCA statewide Socrata `w9se-dmra` (2.7M)
- VT Act 250 ArcGIS statewide
- NYC DOB `ipu4-2q9a` + DOB NOW `rbx6-tga4`, Chicago `ydr8-5enu`,
  SF DBI `i98e-djp9`, Philly Carto SQL, Dallas `e7gq-4sah`,
  Austin TX, LA (data.lacity.org), New Orleans `gk94-9m35`, Boston `ga54-wzas`
- Detroit MI, Minneapolis + St. Paul MN, Nashville + Knoxville TN ArcGIS,
  Bozeman MT, Nashua NH, Salt Lake City UT (frozen Socrata),
  Henderson NV Socrata, Las Vegas NV ArcGIS, Sedgwick + Butler Co KS,
  Lincoln NE, Sioux Falls SD, Little Rock AR, Portland ME (eTRAKiT scraper),
  Jackson MS stopgap, Albuquerque + Santa Fe NM, Tulsa OK stopgap,
  Cheyenne + Casper WY stopgaps, Tampa FL ("City of Tampa, FL Buildings" —
  STALE since 2026-04-22, a replacement/repair endpoint IS wanted)
- Phase-4 scraper configs exist (do not re-report as new): Clark Co NV,
  Las Vegas NV, Reno NV, Washoe NV, North Las Vegas, Sparks, SLC Accela,
  Missoula MT, OKC, Teton WY, Henderson EnerGov

## Known dead-end states (prior research found NO public permit API)
RI (all OpenGov ViewPoint/Auth0), MS, ND, WV. KS mostly vendor SPA
(Johnson Co AIMS 403s direct REST). AK (only Anchorage backlog),
HI (Honolulu frozen), ID (Boise planning trackers only).

## What to hunt (in priority order)
1. NEW statewide/multi-jurisdiction aggregators (NJ-DCA-style). Recheck WA,
   OR, CT, DE, MD, MA, NY-state, PA, MI, CO, MN, AZ — any state open-data
   portal that newly publishes a permits dataset (2025-2026 launches).
2. Replacement endpoint for Tampa FL / Hillsborough County (current feed
   stale since 2026-04-22). Check Tampa open-data ArcGIS hub, Hillsborough
   County ArcGIS, and Accela citizen portals. This unblocks the only
   territory-holding contractor today.
3. Top-30 US metros sanity sweep: for each, confirm a live permit API
   exists (Socrata / ArcGIS / Tyler / CKAN / Carto). Report any metro
   where you find a NEW endpoint not in the covered list above.
4. The dead-end states: anything NEW since May 2026 for RI / MS / ND / WV /
   KS / AK / HI / ID (new open-data launches, county GIS hubs, BLDS feeds).

## Output format (strict — your final message)
A JSON array, one object per VERIFIED endpoint:
{
  "id": "city-or-county-state",
  "state": "XX",
  "jurisdiction": "City of ...",
  "url": "https://... (the actual queryable API URL, not a landing page)",
  "loader_kind": "socrata|arcgis|energov|accela|ckan|carto|csv",
  "probe_status": "HTTP code + record count seen",
  "newest_record": "YYYY-MM-DD",
  "est_annual_volume": "number or range",
  "has_contact_fields": "owner/contractor name/phone/email columns seen, or none",
  "notes": "field names for permit#/type/status/address/date/value, quirks"
}
Plus a short DEAD-ENDS list (jurisdiction + why) so we do not re-probe.
No prose report — the JSON array IS the deliverable.