/**
 * Import the most-recent permits from the legacy `permits.db` SQLite
 * (30 GB, 24.3M rows on desktop) into Supabase `permits` table —
 * in TIME-WINDOW WAVES, most-recent first.
 *
 * Strategy:
 *   - Break the import into N waves, each covering a date range.
 *     Wave 1 = last WAVE_DAYS (default 30); wave 2 = the 30 days
 *     before that; etc.
 *   - Within each wave: SELECT rows with `issue_date` in that window,
 *     capped at WAVE_LIMIT (default 100k). Upsert to Supabase in
 *     500-row batches with `onConflict: id, ignoreDuplicates: true`.
 *   - Print per-wave summary. Sleep WAVE_PAUSE_MS between waves so the
 *     operator (or quota monitor) can abort cleanly.
 *
 * Env knobs:
 *   - LEGACY_PERMITS_DB   path to permits.db (default desktop dump)
 *   - WAVE_DAYS           width of each wave in days (default 30)
 *   - WAVE_COUNT          how many waves to run (default 6 = ~6 months)
 *   - WAVE_LIMIT          max rows per wave (default 100_000)
 *   - WAVE_PAUSE_MS       pause between waves (default 2000)
 *   - START_OFFSET_DAYS   skip the first N days (default 0 = start at today)
 *
 * Why waves, not a single 500k batch:
 *   - Lets us monitor quota use and stop early if we're burning budget.
 *   - Recency is the useful signal — scorer's `score_freshness` drops
 *     to 0 past 30 days, so wave 1 delivers almost all the value.
 *   - Supabase PostgREST + write-amplification: smaller bursts are
 *     kinder to the node.
 *
 * Safe to re-run: dedup via `permits.id` primary key with
 * `ignoreDuplicates: true`.
 */
import { createClient } from "@supabase/supabase-js";
import BetterSqlite3 from "better-sqlite3";
import { createHash } from "crypto";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const LEGACY_DB =
  process.env.LEGACY_PERMITS_DB ??
  "C:/Users/yabis/Desktop/Data Henri 3/permits.db";
const WAVE_DAYS = Number(process.env.WAVE_DAYS ?? 30);
const WAVE_COUNT = Number(process.env.WAVE_COUNT ?? 6);
const WAVE_LIMIT = Number(process.env.WAVE_LIMIT ?? 100_000);
const WAVE_PAUSE_MS = Number(process.env.WAVE_PAUSE_MS ?? 2000);
const START_OFFSET_DAYS = Number(process.env.START_OFFSET_DAYS ?? 0);
const BATCH = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Legacy DB stores missing dates/numbers as empty strings. Coerce to null. */
function nullIfBlank<T>(v: T): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map free-form legacy permit_type strings to our canonical enum:
 *   residential | commercial | demolition | renovation |
 *   new_construction | addition | repair | other
 */
function mapPermitType(raw: string | null): string {
  if (!raw) return "other";
  const t = raw.toLowerCase();
  if (/demo(lition)?|teardown/.test(t)) return "demolition";
  if (/new\s*(const|build|bldg|structure)|ground\s*up/.test(t)) return "new_construction";
  if (/addition|add[-\s]on/.test(t)) return "addition";
  if (/reno|remodel|alter/.test(t)) return "renovation";
  if (/repair|roof|re-roof|fix|replace/.test(t)) return "repair";
  if (/resid|dwelling|single[-\s]*family|multi[-\s]*family|sfr|duplex|townhouse|apartment/.test(t)) return "residential";
  if (/comm(ercial)?|retail|office|warehouse|industrial|hotel|restaurant/.test(t)) return "commercial";
  return "other";
}

/**
 * Map free-form legacy status to our enum:
 *   submitted | approved | issued | final | expired | revoked
 */
function mapPermitStatus(raw: string | null): string {
  if (!raw) return "submitted";
  const s = raw.toLowerCase();
  if (/revoke/.test(s)) return "revoked";
  if (/expire/.test(s)) return "expired";
  if (/final|complete|closed|cofo|c\s*of\s*o/.test(s)) return "final";
  if (/issued|active|open/.test(s)) return "issued";
  if (/approved|ready|ok/.test(s)) return "approved";
  return "submitted";
}

/** Truncate + validate 5-digit US ZIP. */
function zipOrNull(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\d{5}/);
  return m ? m[0] : null;
}

/**
 * Deterministic UUID-v5ish derivation from legacy id.
 * Same legacy id ⇒ same UUID every time, so re-runs dedupe cleanly via
 * the `permits.id` primary key + ignoreDuplicates upsert.
 */
function legacyIdToUuid(legacyId: string): string {
  const h = createHash("sha1").update(`legacy-sqlite:${legacyId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)
  }${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

interface LegacyPermit {
  id: string;
  source_id: string | null;
  permit_number: string | null;
  permit_type: string | null;
  address: string | null;
  status: string | null;
  description: string | null;
  issue_date: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  applied_date?: string | null;
  estimated_value?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  applicant_name?: string | null;
  raw_json?: string | null;
}

(async () => {
  console.log(`opening ${LEGACY_DB} (readonly)...`);
  const db = new BetterSqlite3(LEGACY_DB, { readonly: true, fileMustExist: true });

  // Confirm columns match our assumption.
  const cols = db.prepare(`PRAGMA table_info(permits)`).all() as Array<{ name: string }>;
  const colSet = new Set(cols.map((c) => c.name));
  const hasCity = colSet.has("city");
  const hasState = colSet.has("state");
  const hasZip = colSet.has("zip");
  const hasValue = colSet.has("estimated_value");
  const hasLat = colSet.has("latitude");
  const hasLng = colSet.has("longitude");
  const hasRaw = colSet.has("raw_json");
  console.log(
    `  legacy columns: ${cols.length} total, city=${hasCity}, state=${hasState}, zip=${hasZip}, est_value=${hasValue}, lat/lng=${hasLat && hasLng}, raw_json=${hasRaw}`,
  );

  const stmt = db.prepare(
    `SELECT * FROM permits
      WHERE issue_date >= ? AND issue_date < ?
      ORDER BY issue_date DESC
      LIMIT ?`,
  );

  let grandOk = 0;
  let grandErrs = 0;
  const tAll = Date.now();

  for (let wave = 0; wave < WAVE_COUNT; wave++) {
    // Wave window: [startDays...endDays) ago, newest first.
    const startDaysAgo = START_OFFSET_DAYS + wave * WAVE_DAYS;
    const endDaysAgo = startDaysAgo + WAVE_DAYS;
    const startIso = new Date(Date.now() - endDaysAgo * 86_400_000).toISOString();
    const endIso = new Date(Date.now() - startDaysAgo * 86_400_000).toISOString();

    console.log(
      `\n=== Wave ${wave + 1}/${WAVE_COUNT}  (${startIso.slice(0, 10)} → ${endIso.slice(0, 10)}) ===`,
    );

    const rows = stmt.all(startIso, endIso, WAVE_LIMIT) as LegacyPermit[];
    console.log(`  selected ${rows.length.toLocaleString()} rows (cap ${WAVE_LIMIT.toLocaleString()})`);
    if (rows.length === 0) {
      console.log("  no rows in this window; moving on");
      continue;
    }

    let ok = 0;
    let errs = 0;
    const t0 = Date.now();
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows
        .slice(i, i + BATCH)
        .map((r) => {
          const legacyId = String(r.id);
          const city = nullIfBlank(r.city);
          const ev = numOrNull(r.estimated_value);
          return {
            // Legacy `id` is an integer string; our `permits.id` is UUID.
            // Derive a deterministic UUID so re-runs dedupe cleanly.
            id: legacyIdToUuid(legacyId),
            // source_city is NOT NULL + part of the unique index; fall
            // back to the legacy city or a sentinel.
            source_city: city ?? "legacy-sqlite",
            source_id: nullIfBlank(r.source_id) ?? legacyId,
            permit_number: nullIfBlank(r.permit_number),
            permit_type: mapPermitType(nullIfBlank(r.permit_type)),
            status: mapPermitStatus(nullIfBlank(r.status)),
            address: nullIfBlank(r.address),
            description: nullIfBlank(r.description),
            issued_date: nullIfBlank(r.issue_date),
            applied_date: nullIfBlank(r.applied_date),
            city,
            state: nullIfBlank(r.state),
            zip: zipOrNull(nullIfBlank(r.zip)),
            estimated_value: ev != null ? Math.round(ev) : null,
            applicant_name: nullIfBlank(r.applicant_name),
            raw_json: r.raw_json
              ? (typeof r.raw_json === "string" ? safeJson(r.raw_json) : r.raw_json)
              : null,
          };
        })
        // Skip rows missing both an id and any usable dedup key.
        .filter((r) => r.id && (r.permit_number || r.address));
      // The real dedup index is `(source_city, source_id)` — see
      // uq_permits_source in migration 00004. Using that as the conflict
      // target lets re-runs cleanly no-op on rows we've already pulled.
      const { error } = await s
        .from("permits")
        .upsert(chunk, { onConflict: "source_city,source_id", ignoreDuplicates: true });
      if (error) {
        console.warn(`  batch ${i}: ${error.message}`);
        errs += chunk.length;
      } else {
        ok += chunk.length;
      }
      if (i > 0 && i % 10_000 === 0) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(`    progress ${ok.toLocaleString()}/${rows.length.toLocaleString()} (${elapsed}s)`);
      }
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(
      `  wave ${wave + 1} done: ${ok.toLocaleString()} imported, ${errs.toLocaleString()} errored in ${elapsed}s`,
    );
    grandOk += ok;
    grandErrs += errs;

    if (wave < WAVE_COUNT - 1) {
      await sleep(WAVE_PAUSE_MS);
    }
  }

  db.close();
  const elapsedAll = Math.round((Date.now() - tAll) / 1000);
  console.log(
    `\nAll waves done. imported ${grandOk.toLocaleString()} (${grandErrs.toLocaleString()} errored) in ${elapsedAll}s`,
  );
})();

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
