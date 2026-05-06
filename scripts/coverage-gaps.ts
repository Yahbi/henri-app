/**
 * Coverage gap analyzer for Henri's permit pipeline.
 *
 * Cross-references three things:
 *   1. permit_sources         — endpoints we've configured (any enabled state)
 *   2. permits                — rows we've actually ingested
 *   3. US reference catalog   — 50 states + 5 territories + top 200 cities
 *                                by population (from Census 2020)
 *
 * Outputs a markdown gap report to stdout AND writes a CSV at
 * `docs/studies/coverage-gaps-YYYY-MM-DD.csv` for the founder to review.
 *
 * Why it matters:
 *   "Full US coverage" is the user's stated goal. Without this report it's
 *   impossible to answer "which top-100 city is Henri blind to?". The
 *   gap CSV becomes the input to `scripts/discover-sources.ts` which then
 *   tries systematic URL patterns to fill those holes.
 *
 * Usage:
 *   pnpm coverage:gaps
 *   pnpm coverage:gaps --top=300        # widen the city ceiling
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}
const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

const arg = (k: string, def: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : def;
};
const TOP_N = Number(arg("top", "200"));

/* ── US reference catalog ───────────────────────────────────────────
 *
 * 50 states + DC + 5 inhabited territories + 200 most-populous cities
 * (Census 2020 ACS estimates, rounded; only used for ranking gaps so
 * exact figures don't matter — we don't render them in any UI).
 *
 * Adding a city here is the cheap way to widen the gap report; the
 * importer + discover script don't read this list, so changes are safe. */
type City = { name: string; state: string; pop: number };

const STATES_AND_TERRITORIES: Array<{ code: string; name: string; isTerritory: boolean }> = [
  { code: "AL", name: "Alabama", isTerritory: false },
  { code: "AK", name: "Alaska", isTerritory: false },
  { code: "AZ", name: "Arizona", isTerritory: false },
  { code: "AR", name: "Arkansas", isTerritory: false },
  { code: "CA", name: "California", isTerritory: false },
  { code: "CO", name: "Colorado", isTerritory: false },
  { code: "CT", name: "Connecticut", isTerritory: false },
  { code: "DE", name: "Delaware", isTerritory: false },
  { code: "FL", name: "Florida", isTerritory: false },
  { code: "GA", name: "Georgia", isTerritory: false },
  { code: "HI", name: "Hawaii", isTerritory: false },
  { code: "ID", name: "Idaho", isTerritory: false },
  { code: "IL", name: "Illinois", isTerritory: false },
  { code: "IN", name: "Indiana", isTerritory: false },
  { code: "IA", name: "Iowa", isTerritory: false },
  { code: "KS", name: "Kansas", isTerritory: false },
  { code: "KY", name: "Kentucky", isTerritory: false },
  { code: "LA", name: "Louisiana", isTerritory: false },
  { code: "ME", name: "Maine", isTerritory: false },
  { code: "MD", name: "Maryland", isTerritory: false },
  { code: "MA", name: "Massachusetts", isTerritory: false },
  { code: "MI", name: "Michigan", isTerritory: false },
  { code: "MN", name: "Minnesota", isTerritory: false },
  { code: "MS", name: "Mississippi", isTerritory: false },
  { code: "MO", name: "Missouri", isTerritory: false },
  { code: "MT", name: "Montana", isTerritory: false },
  { code: "NE", name: "Nebraska", isTerritory: false },
  { code: "NV", name: "Nevada", isTerritory: false },
  { code: "NH", name: "New Hampshire", isTerritory: false },
  { code: "NJ", name: "New Jersey", isTerritory: false },
  { code: "NM", name: "New Mexico", isTerritory: false },
  { code: "NY", name: "New York", isTerritory: false },
  { code: "NC", name: "North Carolina", isTerritory: false },
  { code: "ND", name: "North Dakota", isTerritory: false },
  { code: "OH", name: "Ohio", isTerritory: false },
  { code: "OK", name: "Oklahoma", isTerritory: false },
  { code: "OR", name: "Oregon", isTerritory: false },
  { code: "PA", name: "Pennsylvania", isTerritory: false },
  { code: "RI", name: "Rhode Island", isTerritory: false },
  { code: "SC", name: "South Carolina", isTerritory: false },
  { code: "SD", name: "South Dakota", isTerritory: false },
  { code: "TN", name: "Tennessee", isTerritory: false },
  { code: "TX", name: "Texas", isTerritory: false },
  { code: "UT", name: "Utah", isTerritory: false },
  { code: "VT", name: "Vermont", isTerritory: false },
  { code: "VA", name: "Virginia", isTerritory: false },
  { code: "WA", name: "Washington", isTerritory: false },
  { code: "WV", name: "West Virginia", isTerritory: false },
  { code: "WI", name: "Wisconsin", isTerritory: false },
  { code: "WY", name: "Wyoming", isTerritory: false },
  { code: "DC", name: "District of Columbia", isTerritory: false },
  // Territories
  { code: "PR", name: "Puerto Rico", isTerritory: true },
  { code: "VI", name: "U.S. Virgin Islands", isTerritory: true },
  { code: "GU", name: "Guam", isTerritory: true },
  { code: "AS", name: "American Samoa", isTerritory: true },
  { code: "MP", name: "Northern Mariana Islands", isTerritory: true },
];

/** Top 200 US cities by 2020 Census population (rounded). Used only
 *  to rank gaps — the discover script also reads this. Adding rows is
 *  trivial; this list isn't a contract. */
const TOP_CITIES: City[] = [
  { name: "New York", state: "NY", pop: 8336000 },
  { name: "Los Angeles", state: "CA", pop: 3979000 },
  { name: "Chicago", state: "IL", pop: 2693000 },
  { name: "Houston", state: "TX", pop: 2320000 },
  { name: "Phoenix", state: "AZ", pop: 1680000 },
  { name: "Philadelphia", state: "PA", pop: 1584000 },
  { name: "San Antonio", state: "TX", pop: 1547000 },
  { name: "San Diego", state: "CA", pop: 1424000 },
  { name: "Dallas", state: "TX", pop: 1343000 },
  { name: "San Jose", state: "CA", pop: 1021000 },
  { name: "Austin", state: "TX", pop: 978000 },
  { name: "Jacksonville", state: "FL", pop: 911000 },
  { name: "Fort Worth", state: "TX", pop: 909000 },
  { name: "Columbus", state: "OH", pop: 898000 },
  { name: "Indianapolis", state: "IN", pop: 876000 },
  { name: "Charlotte", state: "NC", pop: 873000 },
  { name: "San Francisco", state: "CA", pop: 881000 },
  { name: "Seattle", state: "WA", pop: 753000 },
  { name: "Denver", state: "CO", pop: 727000 },
  { name: "Washington", state: "DC", pop: 705000 },
  { name: "Nashville", state: "TN", pop: 692000 },
  { name: "Oklahoma City", state: "OK", pop: 655000 },
  { name: "El Paso", state: "TX", pop: 681000 },
  { name: "Boston", state: "MA", pop: 692000 },
  { name: "Portland", state: "OR", pop: 654000 },
  { name: "Las Vegas", state: "NV", pop: 651000 },
  { name: "Detroit", state: "MI", pop: 670000 },
  { name: "Memphis", state: "TN", pop: 651000 },
  { name: "Louisville", state: "KY", pop: 617000 },
  { name: "Baltimore", state: "MD", pop: 593000 },
  { name: "Milwaukee", state: "WI", pop: 590000 },
  { name: "Albuquerque", state: "NM", pop: 560000 },
  { name: "Tucson", state: "AZ", pop: 548000 },
  { name: "Fresno", state: "CA", pop: 542000 },
  { name: "Mesa", state: "AZ", pop: 518000 },
  { name: "Sacramento", state: "CA", pop: 525000 },
  { name: "Atlanta", state: "GA", pop: 506000 },
  { name: "Kansas City", state: "MO", pop: 495000 },
  { name: "Colorado Springs", state: "CO", pop: 478000 },
  { name: "Miami", state: "FL", pop: 467000 },
  { name: "Raleigh", state: "NC", pop: 474000 },
  { name: "Omaha", state: "NE", pop: 478000 },
  { name: "Long Beach", state: "CA", pop: 463000 },
  { name: "Virginia Beach", state: "VA", pop: 449000 },
  { name: "Oakland", state: "CA", pop: 433000 },
  { name: "Minneapolis", state: "MN", pop: 429000 },
  { name: "Tulsa", state: "OK", pop: 401000 },
  { name: "Arlington", state: "TX", pop: 398000 },
  { name: "Tampa", state: "FL", pop: 399000 },
  { name: "New Orleans", state: "LA", pop: 390000 },
  { name: "Wichita", state: "KS", pop: 389000 },
  { name: "Cleveland", state: "OH", pop: 372000 },
  { name: "Bakersfield", state: "CA", pop: 384000 },
  { name: "Aurora", state: "CO", pop: 379000 },
  { name: "Anaheim", state: "CA", pop: 350000 },
  { name: "Honolulu", state: "HI", pop: 345000 },
  { name: "Santa Ana", state: "CA", pop: 332000 },
  { name: "Riverside", state: "CA", pop: 331000 },
  { name: "Corpus Christi", state: "TX", pop: 326000 },
  { name: "Lexington", state: "KY", pop: 323000 },
  { name: "Henderson", state: "NV", pop: 320000 },
  { name: "Stockton", state: "CA", pop: 312000 },
  { name: "Saint Paul", state: "MN", pop: 308000 },
  { name: "Cincinnati", state: "OH", pop: 303000 },
  { name: "St. Louis", state: "MO", pop: 301000 },
  { name: "Pittsburgh", state: "PA", pop: 300000 },
  { name: "Greensboro", state: "NC", pop: 296000 },
  { name: "Lincoln", state: "NE", pop: 289000 },
  { name: "Anchorage", state: "AK", pop: 288000 },
  { name: "Plano", state: "TX", pop: 287000 },
  { name: "Orlando", state: "FL", pop: 287000 },
  { name: "Irvine", state: "CA", pop: 281000 },
  { name: "Newark", state: "NJ", pop: 281000 },
  { name: "Toledo", state: "OH", pop: 270000 },
  { name: "Durham", state: "NC", pop: 278000 },
  { name: "Chula Vista", state: "CA", pop: 274000 },
  { name: "Fort Wayne", state: "IN", pop: 270000 },
  { name: "Jersey City", state: "NJ", pop: 292000 },
  { name: "St. Petersburg", state: "FL", pop: 263000 },
  { name: "Laredo", state: "TX", pop: 262000 },
  { name: "Madison", state: "WI", pop: 269000 },
  { name: "Chandler", state: "AZ", pop: 261000 },
  { name: "Buffalo", state: "NY", pop: 256000 },
  { name: "Lubbock", state: "TX", pop: 258000 },
  { name: "Scottsdale", state: "AZ", pop: 258000 },
  { name: "Reno", state: "NV", pop: 255000 },
  { name: "Glendale", state: "AZ", pop: 253000 },
  { name: "Gilbert", state: "AZ", pop: 254000 },
  { name: "Winston-Salem", state: "NC", pop: 247000 },
  { name: "North Las Vegas", state: "NV", pop: 246000 },
  { name: "Norfolk", state: "VA", pop: 244000 },
  { name: "Chesapeake", state: "VA", pop: 242000 },
  { name: "Garland", state: "TX", pop: 240000 },
  { name: "Irving", state: "TX", pop: 240000 },
  { name: "Hialeah", state: "FL", pop: 233000 },
  { name: "Fremont", state: "CA", pop: 230000 },
  { name: "Boise", state: "ID", pop: 228000 },
  { name: "Richmond", state: "VA", pop: 230000 },
  { name: "Baton Rouge", state: "LA", pop: 220000 },
  { name: "Spokane", state: "WA", pop: 222000 },
  { name: "Des Moines", state: "IA", pop: 214000 },
  { name: "Tacoma", state: "WA", pop: 217000 },
  { name: "San Bernardino", state: "CA", pop: 215000 },
  { name: "Modesto", state: "CA", pop: 214000 },
  { name: "Fontana", state: "CA", pop: 209000 },
  { name: "Santa Clarita", state: "CA", pop: 213000 },
  { name: "Birmingham", state: "AL", pop: 209000 },
  { name: "Oxnard", state: "CA", pop: 209000 },
  { name: "Fayetteville", state: "NC", pop: 211000 },
  { name: "Moreno Valley", state: "CA", pop: 208000 },
  { name: "Rochester", state: "NY", pop: 205000 },
  { name: "Glendale", state: "CA", pop: 204000 },
  { name: "Huntington Beach", state: "CA", pop: 200000 },
  { name: "Salt Lake City", state: "UT", pop: 200000 },
  { name: "Grand Rapids", state: "MI", pop: 199000 },
  { name: "Amarillo", state: "TX", pop: 200000 },
  { name: "Yonkers", state: "NY", pop: 200000 },
  { name: "Aurora", state: "IL", pop: 198000 },
  { name: "Montgomery", state: "AL", pop: 198000 },
  { name: "Akron", state: "OH", pop: 197000 },
  { name: "Little Rock", state: "AR", pop: 197000 },
  { name: "Huntsville", state: "AL", pop: 200000 },
  { name: "Augusta", state: "GA", pop: 196000 },
  { name: "Worcester", state: "MA", pop: 185000 },
  { name: "Mobile", state: "AL", pop: 188000 },
  { name: "Knoxville", state: "TN", pop: 187000 },
  { name: "Tallahassee", state: "FL", pop: 194000 },
  { name: "Overland Park", state: "KS", pop: 195000 },
  { name: "Shreveport", state: "LA", pop: 187000 },
  { name: "Tempe", state: "AZ", pop: 195000 },
  { name: "Brownsville", state: "TX", pop: 183000 },
  { name: "Cape Coral", state: "FL", pop: 194000 },
  { name: "McKinney", state: "TX", pop: 195000 },
  { name: "Frisco", state: "TX", pop: 200000 },
  { name: "Ontario", state: "CA", pop: 175000 },
  { name: "Vancouver", state: "WA", pop: 184000 },
  { name: "Providence", state: "RI", pop: 179000 },
  { name: "Garden Grove", state: "CA", pop: 171000 },
  { name: "Sioux Falls", state: "SD", pop: 184000 },
  { name: "Oceanside", state: "CA", pop: 174000 },
  { name: "Chattanooga", state: "TN", pop: 181000 },
  { name: "Fort Lauderdale", state: "FL", pop: 182000 },
  { name: "Rancho Cucamonga", state: "CA", pop: 177000 },
  { name: "Santa Rosa", state: "CA", pop: 178000 },
  { name: "Port St. Lucie", state: "FL", pop: 195000 },
  { name: "Tempe", state: "AZ", pop: 180000 },
  { name: "Ontario", state: "CA", pop: 175000 },
  { name: "Eugene", state: "OR", pop: 172000 },
  { name: "Springfield", state: "MO", pop: 169000 },
  { name: "Salem", state: "OR", pop: 174000 },
  { name: "Pembroke Pines", state: "FL", pop: 171000 },
  { name: "Cary", state: "NC", pop: 170000 },
  { name: "Fort Collins", state: "CO", pop: 169000 },
  { name: "Lancaster", state: "CA", pop: 158000 },
  { name: "Hayward", state: "CA", pop: 159000 },
  { name: "Palmdale", state: "CA", pop: 156000 },
  { name: "Salinas", state: "CA", pop: 156000 },
  { name: "Alexandria", state: "VA", pop: 159000 },
  { name: "Lakewood", state: "CO", pop: 156000 },
  { name: "Springfield", state: "MA", pop: 153000 },
  { name: "Pasadena", state: "TX", pop: 152000 },
  { name: "Sunnyvale", state: "CA", pop: 152000 },
  { name: "Pomona", state: "CA", pop: 151000 },
  { name: "Macon", state: "GA", pop: 153000 },
  { name: "Escondido", state: "CA", pop: 152000 },
  { name: "Killeen", state: "TX", pop: 153000 },
  { name: "Naperville", state: "IL", pop: 148000 },
  { name: "Joliet", state: "IL", pop: 147000 },
  { name: "Bellevue", state: "WA", pop: 144000 },
  { name: "Rockford", state: "IL", pop: 146000 },
  { name: "Savannah", state: "GA", pop: 145000 },
  { name: "Paterson", state: "NJ", pop: 145000 },
  { name: "Torrance", state: "CA", pop: 145000 },
  { name: "Bridgeport", state: "CT", pop: 144000 },
  { name: "McAllen", state: "TX", pop: 142000 },
  { name: "Mesquite", state: "TX", pop: 140000 },
  { name: "Syracuse", state: "NY", pop: 142000 },
  { name: "Midland", state: "TX", pop: 146000 },
  { name: "Pasadena", state: "CA", pop: 141000 },
  { name: "Murfreesboro", state: "TN", pop: 152000 },
  { name: "Miramar", state: "FL", pop: 140000 },
  { name: "Dayton", state: "OH", pop: 140000 },
  { name: "Fullerton", state: "CA", pop: 142000 },
  { name: "Olathe", state: "KS", pop: 140000 },
  { name: "Orange", state: "CA", pop: 139000 },
  { name: "Thornton", state: "CO", pop: 142000 },
  { name: "Roseville", state: "CA", pop: 145000 },
  { name: "Denton", state: "TX", pop: 141000 },
  { name: "Waco", state: "TX", pop: 138000 },
  { name: "Surprise", state: "AZ", pop: 144000 },
  { name: "Carrollton", state: "TX", pop: 139000 },
  { name: "West Valley City", state: "UT", pop: 137000 },
  { name: "Charleston", state: "SC", pop: 138000 },
  { name: "Warren", state: "MI", pop: 134000 },
  { name: "Hampton", state: "VA", pop: 137000 },
  { name: "Gainesville", state: "FL", pop: 134000 },
  { name: "Visalia", state: "CA", pop: 137000 },
  { name: "Coral Springs", state: "FL", pop: 133000 },
  { name: "Columbia", state: "SC", pop: 133000 },
  { name: "Cedar Rapids", state: "IA", pop: 137000 },
  { name: "Sterling Heights", state: "MI", pop: 132000 },
  { name: "New Haven", state: "CT", pop: 130000 },
  { name: "Stamford", state: "CT", pop: 134000 },
  { name: "Concord", state: "CA", pop: 129000 },
  { name: "Kent", state: "WA", pop: 132000 },
  { name: "Santa Clara", state: "CA", pop: 128000 },
  { name: "Elizabeth", state: "NJ", pop: 130000 },
  { name: "Round Rock", state: "TX", pop: 126000 },
  { name: "Thousand Oaks", state: "CA", pop: 126000 },
  { name: "Lafayette", state: "LA", pop: 125000 },
  { name: "Athens", state: "GA", pop: 126000 },
  { name: "Topeka", state: "KS", pop: 125000 },
  { name: "Simi Valley", state: "CA", pop: 125000 },
  { name: "Fargo", state: "ND", pop: 124000 },
  { name: "Norman", state: "OK", pop: 124000 },
  { name: "Columbia", state: "MO", pop: 124000 },
];

/* ── Coverage probes ───────────────────────────────────────────── */

async function fetchAllSourcesCoverage(): Promise<{
  byState: Map<string, number>;
  byStateCity: Map<string, Set<string>>;
}> {
  const byState = new Map<string, number>();
  const byStateCity = new Map<string, Set<string>>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await s
      .from("permit_sources")
      .select("state, city")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("permit_sources page failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const st = (r.state ?? "").toUpperCase();
      if (!st) continue;
      byState.set(st, (byState.get(st) ?? 0) + 1);
      const ct = (r.city ?? "").trim();
      if (!ct) continue;
      const set = byStateCity.get(st) ?? new Set();
      set.add(ct.toLowerCase());
      byStateCity.set(st, set);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return { byState, byStateCity };
}

async function fetchPermitCoverage(): Promise<{
  byState: Map<string, number>;
  zipsPerState: Map<string, Set<string>>;
}> {
  // Distinct states from permits and a per-state zip count. Permits is
  // huge (~925k rows) — use PostgREST's group-by via the count() aggr
  // through select head=true with .neq("state", "") fan-out by state.
  // Cheaper path: scan distinct (state, zip) by paginating.
  const byState = new Map<string, number>();
  const zipsPerState = new Map<string, Set<string>>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await s
      .from("permits")
      .select("state, zip")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("permits page failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const st = (r.state ?? "").toUpperCase();
      if (!st) continue;
      byState.set(st, (byState.get(st) ?? 0) + 1);
      const z = (r.zip ?? "").trim().slice(0, 5);
      if (z) {
        const set = zipsPerState.get(st) ?? new Set();
        set.add(z);
        zipsPerState.set(st, set);
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset >= 50000) break; // sanity ceiling for the report
  }
  return { byState, zipsPerState };
}

/* ── Markdown + CSV emitters ───────────────────────────────────── */

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

(async () => {
  console.log("Pulling source coverage from permit_sources…");
  const sourceCov = await fetchAllSourcesCoverage();
  console.log("Pulling permit coverage from permits…");
  const permitCov = await fetchPermitCoverage();

  // 1. State-level gaps
  const stateRows: Array<{
    code: string;
    name: string;
    isTerritory: boolean;
    sources: number;
    permits: number;
    distinctZips: number;
    distinctCities: number;
    status: "missing" | "thin" | "ok";
  }> = [];
  for (const st of STATES_AND_TERRITORIES) {
    const sources = sourceCov.byState.get(st.code) ?? 0;
    const permits = permitCov.byState.get(st.code) ?? 0;
    const distinctZips = (permitCov.zipsPerState.get(st.code) ?? new Set()).size;
    const distinctCities = (sourceCov.byStateCity.get(st.code) ?? new Set()).size;
    const status: "missing" | "thin" | "ok" =
      sources === 0
        ? "missing"
        : sources < 3 || distinctZips < 100
          ? "thin"
          : "ok";
    stateRows.push({
      code: st.code,
      name: st.name,
      isTerritory: st.isTerritory,
      sources,
      permits,
      distinctZips,
      distinctCities,
      status,
    });
  }

  // 2. City-level gaps (top N cities with no source)
  const cityGaps: Array<{ city: string; state: string; pop: number }> = [];
  const seenCity = new Set<string>();
  for (const c of TOP_CITIES.slice(0, TOP_N)) {
    const k = `${c.state}:${c.name.toLowerCase()}`;
    if (seenCity.has(k)) continue;
    seenCity.add(k);
    const cities = sourceCov.byStateCity.get(c.state) ?? new Set();
    if (!cities.has(c.name.toLowerCase())) {
      cityGaps.push(c);
    }
  }
  cityGaps.sort((a, b) => b.pop - a.pop);

  // ── Emit markdown report ──
  const today = new Date().toISOString().slice(0, 10);
  const mdLines: string[] = [];
  mdLines.push(`# Henri permit-coverage gap report — ${today}\n`);
  mdLines.push(
    `Pulled from \`permit_sources\` (configured endpoints) and \`permits\` (ingested rows).\n`,
  );

  // States summary
  const missing = stateRows.filter((r) => r.status === "missing");
  const thin = stateRows.filter((r) => r.status === "thin");
  const ok = stateRows.filter((r) => r.status === "ok");
  mdLines.push(`## Summary\n`);
  mdLines.push(
    `- **${ok.length}** states/territories with OK coverage (≥3 sources & ≥100 distinct ZIPs ingested)`,
  );
  mdLines.push(`- **${thin.length}** states/territories with THIN coverage`);
  mdLines.push(`- **${missing.length}** states/territories with NO sources`);
  mdLines.push(
    `- **${cityGaps.length}** of the top ${TOP_N} US cities have ZERO source rows targeting them by name\n`,
  );

  // State table
  mdLines.push(`## States & territories\n`);
  mdLines.push(
    `| Code | Name | Sources | Permits | Distinct ZIPs | Distinct cities | Status |`,
  );
  mdLines.push(
    `|------|------|--------:|--------:|--------------:|----------------:|--------|`,
  );
  const sorted = [...stateRows].sort((a, b) => {
    const order = { missing: 0, thin: 1, ok: 2 } as const;
    return order[a.status] - order[b.status] || a.code.localeCompare(b.code);
  });
  for (const r of sorted) {
    const tag = r.isTerritory ? `${r.code} (territory)` : r.code;
    mdLines.push(
      `| ${tag} | ${r.name} | ${fmt(r.sources)} | ${fmt(r.permits)} | ${fmt(r.distinctZips)} | ${fmt(r.distinctCities)} | ${r.status.toUpperCase()} |`,
    );
  }
  mdLines.push("");

  // Top-N city gaps
  mdLines.push(`## Top-${TOP_N} cities with no targeted source\n`);
  if (cityGaps.length === 0) {
    mdLines.push(
      `_None — every top-${TOP_N} city already has at least one row in \`permit_sources\` whose city column matches by name._`,
    );
  } else {
    mdLines.push(`| City | State | Pop (≈) |`);
    mdLines.push(`|------|-------|--------:|`);
    for (const c of cityGaps.slice(0, 100)) {
      mdLines.push(`| ${c.name} | ${c.state} | ${fmt(c.pop)} |`);
    }
    if (cityGaps.length > 100) {
      mdLines.push(`| _…${cityGaps.length - 100} more_ |  |  |`);
    }
  }
  mdLines.push("");

  // Print to stdout
  const md = mdLines.join("\n");
  console.log("\n" + md);

  // ── Emit CSV (input for discover-sources.ts) ──
  const studiesDir = path.resolve(process.cwd(), "docs", "studies");
  fs.mkdirSync(studiesDir, { recursive: true });
  const csvPath = path.join(studiesDir, `coverage-gaps-${today}.csv`);
  const csv: string[] = [];
  csv.push("kind,code,name,state,pop,sources,permits,distinct_zips,distinct_cities,status");
  for (const r of stateRows) {
    csv.push(
      `state,${r.code},"${r.name.replace(/"/g, '""')}",,,${r.sources},${r.permits},${r.distinctZips},${r.distinctCities},${r.status}`,
    );
  }
  for (const c of cityGaps) {
    csv.push(
      `city,,"${c.name.replace(/"/g, '""')}",${c.state},${c.pop},0,0,0,0,missing`,
    );
  }
  fs.writeFileSync(csvPath, csv.join("\n"), "utf-8");
  console.log(`\nCSV written: ${csvPath}`);
  console.log(`(feed this into \`pnpm discover:sources --gaps=${csvPath}\`)`);
})();
