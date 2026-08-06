#!/usr/bin/env node
/**
 * Register the verified CKAN permit feeds discovered 2026-08-06.
 *
 * WHY THESE ARE HAND-SEEDED RATHER THAN AUTO-DISCOVERED
 * /api/cron/discover-sources walks the Socrata Discovery catalog and the
 * ArcGIS Hub catalog — both of which are GLOBAL indexes with one queryable
 * endpoint each. CKAN has no equivalent: every portal is an independent
 * install, so there is nothing to page through. Discovery there means knowing
 * the portal exists first.
 *
 * Probing 31 candidate domains found only 6 live CKAN APIs, and only 3 of
 * those are US municipalities with permit data (the rest were Ontario,
 * Ireland and the UK). That is a small enough set to enumerate by hand, and
 * hand-mapping the fields is strictly better than auto-detection here because
 * these schemas are idiosyncratic — San Jose uses SCREAMING_CASE, WPRDC uses
 * snake_case, Boston uses lowercase.
 *
 * EVERY FIELD BELOW WAS READ OFF A LIVE ROW on 2026-08-06, not from
 * documentation. Row counts are the `total` reported by datastore_search.
 *
 * Deliberately EXCLUDED after inspection:
 *   - WPRDC "City of Pittsburgh Permit Summary (archive)" — ~60 separate
 *     yearly slices of 600-1,300 rows each, inconsistent column names across
 *     them (PERMIT NUMBER / PERMITNUMBER / Permit No. / Permit #). Superseded
 *     by the single PLI Permits feed below.
 *   - Anything that is a violations, plumber-registration or assessment feed.
 *     They match a "permit" text search but are not permits.
 *
 * Run:  node scripts/_seed-ckan-permit-sources.mjs [--dry-run]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ── env ────────────────────────────────────────────────────────────── */
function loadEnvLocal() {
  const out = {};
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* fall through to process.env */
  }
  return out;
}
const env = { ...loadEnvLocal(), ...process.env };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run `npx vercel env pull .env.local` first.");
  process.exit(1);
}

const DRY = process.argv.includes("--dry-run");
const ds = (host, id) =>
  `https://${host}/api/3/action/datastore_search?resource_id=${id}`;

/* ── the verified feeds ─────────────────────────────────────────────── */
const SOURCES = [
  {
    // 659,006 rows. The single largest CKAN permit feed found, and the reason
    // this script exists: Henri held 722 Massachusetts permits before it.
    // Carries a real `zip` column, which is what gates lead creation.
    source_key: "ckan:MA:boston-approved-building-permits",
    name: "Boston MA — Approved Building Permits",
    city: "Boston",
    state: "MA",
    endpoint: ds("data.boston.gov", "6ddcd912-32a0-43df-9908-63574f8c7e77"),
    id_field: "permitnumber",
    type_field: "worktype",
    status_field: "status",
    desc_field: "description",
    address_field: "address",
    date_field: "issued_date",
    value_field: "declared_valuation",
    lat_field: "y_latitude",
    lng_field: "x_longitude",
    rows: 659006,
  },
  {
    // 74,985 rows. Largest of San Jose's four permit datasets.
    // No zip column — the geocode cron resolves it from `address`.
    source_key: "ckan:CA:san-jose-expired-building-permits",
    name: "San Jose CA — Expired Building Permits",
    city: "San Jose",
    state: "CA",
    endpoint: ds("data.sanjoseca.gov", "df4b8461-0c7a-4d16-b85d-ff7f71c5fed5"),
    id_field: "FOLDERNUMBER",
    type_field: "SUBTYPEDESCRIPTION",
    status_field: "Status",
    desc_field: "WORKDESCRIPTION",
    address_field: "gx_location",
    date_field: "ISSUEDATE",
    value_field: null,
    lat_field: null,
    lng_field: null,
    rows: 74985,
  },
  {
    source_key: "ckan:CA:san-jose-active-building-permits",
    name: "San Jose CA — Active Building Permits",
    city: "San Jose",
    state: "CA",
    endpoint: ds("data.sanjoseca.gov", "761b7ae8-3be1-4ad6-923d-c7af6404a904"),
    id_field: "FOLDERNUMBER",
    type_field: "SUBTYPEDESCRIPTION",
    status_field: "Status",
    desc_field: "WORKDESCRIPTION",
    address_field: "gx_location",
    date_field: "ISSUEDATE",
    value_field: null,
    lat_field: null,
    lng_field: null,
    rows: 17487,
  },
  {
    source_key: "ckan:CA:san-jose-permits-under-inspection",
    name: "San Jose CA — Building Permits Under Inspection",
    city: "San Jose",
    state: "CA",
    endpoint: ds("data.sanjoseca.gov", "89ccdad9-7309-4826-a5f3-2fcf1fcb20fa"),
    id_field: "FOLDERNUMBER",
    type_field: "SUBTYPEDESCRIPTION",
    status_field: "Status",
    desc_field: "WORKDESCRIPTION",
    address_field: "gx_location",
    date_field: "ISSUEDATE",
    value_field: null,
    lat_field: null,
    lng_field: null,
    rows: 10627,
  },
  {
    // 64,101 rows, and the richest schema of the three portals: it is the only
    // permit feed in this batch carrying BOTH owner_name and contractor_name
    // alongside lat/lng. Henri's contact-completeness signal is the binding
    // constraint on lead quality, so an owner name per row is worth more here
    // than raw volume.
    source_key: "ckan:PA:pittsburgh-pli-permits",
    name: "Pittsburgh PA — PLI Permits",
    city: "Pittsburgh",
    state: "PA",
    endpoint: ds("data.wprdc.org", "f4d1177a-f597-4c32-8cbf-7885f56253f6"),
    id_field: "permit_id",
    type_field: "permit_type",
    status_field: null,
    desc_field: "work_description",
    address_field: "address",
    date_field: "issue_date",
    value_field: "total_project_value",
    lat_field: "latitude",
    lng_field: "longitude",
    rows: 64101,
  },
];

/* ── upsert ─────────────────────────────────────────────────────────── */
const rows = SOURCES.map((s) => ({
  source_key: s.source_key,
  // NOT NULL in permit_sources — the human-readable label the data-health
  // panel groups by.
  name: s.name,
  city: s.city,
  state: s.state,
  endpoint: s.endpoint,
  source_type: "ckan",
  id_field: s.id_field,
  type_field: s.type_field,
  status_field: s.status_field,
  desc_field: s.desc_field,
  address_field: s.address_field,
  date_field: s.date_field,
  value_field: s.value_field,
  lat_field: s.lat_field,
  lng_field: s.lng_field,
  enabled: true,
  // 'verified', not 'probed': every field was read off a live row rather than
  // guessed by the auto-detector.
  field_mapping_status: "verified",
  discovered_via: "ckan_probe_2026-08-06",
  notes: `CKAN datastore_search; ${s.rows.toLocaleString()} rows at discovery`,
}));

const total = SOURCES.reduce((n, s) => n + s.rows, 0);
console.log(`${rows.length} CKAN sources, ${total.toLocaleString()} permits at discovery`);
for (const s of SOURCES) {
  console.log(`  ${s.state}  ${s.city.padEnd(11)} ${String(s.rows).padStart(7)}  ${s.source_key}`);
}

if (DRY) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

const res = await fetch(
  `${URL_}/rest/v1/permit_sources?on_conflict=source_key`,
  {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      // merge-duplicates so a re-run refreshes the mapping instead of erroring.
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  },
);

if (!res.ok) {
  console.error(`\nFAILED  HTTP ${res.status}`);
  console.error((await res.text()).slice(0, 600));
  process.exit(1);
}
const back = await res.json();
console.log(`\nUpserted ${back.length} rows into permit_sources.`);
console.log("Next scrape run (:30 past the hour) will begin ingesting them.");
