/**
 * Local Voter-File Lookup (free-bulk path)
 * ─────────────────────────────────────────────────────────────────────────────
 * Sibling to `voter-registration.ts`, which is the vendor-API scaffold. This
 * module is the actual live integration that resolves phone / owner_name
 * against the per-state tables (`voter_fl`, `voter_nc`, `voter_oh`) populated
 * by `scripts/ingest-voter-{fl,nc,oh}.ts`.
 *
 * Why two modules:
 *   • voter-registration.ts is the vendor API path (TargetSmart / L2 etc.)
 *     — still a scaffold because we haven't picked a vendor and there are
 *     legal/compliance hoops for the 50-state file.
 *   • voter-file.ts (this file) is the three states that publish the file
 *     for free with permissive re-use terms: FL, NC, OH. No network call,
 *     no vendor. The only cost is the Supabase storage of the ingested rows.
 *
 * Usage in the enrichment cron:
 *
 *   import { lookupLocalVoterFile } from "@/lib/enrichment/voter-file";
 *
 *   const hit = await lookupLocalVoterFile({
 *     state: "FL",
 *     address: lead.address,
 *     zip: lead.zip,
 *     lastName: parsedSurname ?? undefined,
 *   });
 *   if (hit?.phone) {
 *     // stamp lead.phone / contact_source / contact_confidence
 *   }
 *
 * Returns null (never throws) when:
 *   • state is outside the supported set
 *   • address or zip is missing
 *   • the per-state table doesn't exist yet (migration 00041 not applied)
 *   • the Supabase query errors out for any reason (network, RLS, etc.)
 *
 * This module uses the service-role admin client — the per-state tables
 * have RLS enabled with no permissive policy, so the anon/authenticated
 * paths return nothing. That's intentional: enrichment is a server-side
 * cron concern, never something the browser should reach directly.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export interface VoterFileLookupArgs {
  /** 2-letter US state code. Anything other than FL/NC/OH returns null. */
  state: string;
  /** Street address as stored on the lead / permit. We normalize it
   *  identically to the ingest scripts before matching. */
  address: string;
  /** 5-digit ZIP. Required — a ZIP-less lookup is unacceptably slow and
   *  ambiguous, so we short-circuit to null. */
  zip: string | null | undefined;
  /** Optional parsed surname. When supplied, raises the confidence of the
   *  returned match from 0.7 → 0.9 by requiring last_name to line up. */
  lastName?: string;
}

export interface VoterFileLookupResult {
  phone: string | null;
  owner_name: string | null;
  /** Stable string so the caller can stamp leads.contact_source. */
  source: "voter_fl_local" | "voter_nc_local" | "voter_oh_local";
  /** 0.9 if address + last-name both match, 0.7 if address only. */
  confidence: number;
}

type SupportedState = "FL" | "NC" | "OH";

const SUPPORTED: ReadonlyArray<SupportedState> = ["FL", "NC", "OH"];

const TABLE_BY_STATE: Record<SupportedState, string> = {
  FL: "voter_fl",
  NC: "voter_nc",
  OH: "voter_oh",
};

const SOURCE_BY_STATE: Record<SupportedState, VoterFileLookupResult["source"]> = {
  FL: "voter_fl_local",
  NC: "voter_nc_local",
  OH: "voter_oh_local",
};

/** Match the normalization in scripts/ingest-voter-{fl,nc,oh}.ts: uppercase
 *  and collapse internal whitespace. Keep this in sync with those scripts,
 *  or the LIKE prefix match below will silently miss. */
function normalizeAddress(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function strip5Zip(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const m = t.match(/^(\d{5})/);
  return m ? m[1]! : t.slice(0, 5);
}

/** Escape the % / _ / \ chars that Postgres interprets in a LIKE pattern.
 *  Lead addresses really shouldn't contain any of these, but when they do
 *  the unescaped wildcard would match too broadly (or, for `\`, fail). */
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Soundex (phonetic) code for a surname. Catches variant spellings:
 *   Smith / Smyth / Smithe → all map to S530
 *   Gonzales / Gonzalez    → G524
 *   O'Brien / OBrien       → O165
 *
 * Useful for the voter-file fallback match when the EXACT last name
 * from a permit's applicant_name doesn't hit a row, but a phonetically-
 * equivalent spelling exists in the voter file. Low-complexity
 * implementation of the standard American Soundex (1918). */
function soundex(input: string): string | null {
  if (!input) return null;
  const s = input
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!s) return null;
  const first = s[0];
  const map: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3",
    L: "4",
    M: "5", N: "5",
    R: "6",
  };
  let out = first;
  let prev = map[first] ?? "";
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const ch = s[i];
    const code = map[ch] ?? "";
    // H and W don't break the "consecutive identical codes collapse"
    // rule — but we simplify: skip them entirely.
    if (ch === "H" || ch === "W") continue;
    if (code && code !== prev) out += code;
    prev = code;
  }
  return out.padEnd(4, "0").slice(0, 4);
}

interface VoterFileRow {
  phone: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  name_suffix: string | null;
  residence_address: string | null;
  last_name_lower: string | null;
}

function composeOwnerName(row: VoterFileRow): string | null {
  const parts = [row.first_name, row.middle_name, row.last_name, row.name_suffix]
    .map((x) => (x ?? "").trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(" ");
}

/**
 * Look up a voter-file row by address + zip, optionally tightened by
 * last name. Never throws. Returns null on any failure path so the
 * caller can keep enriching without a branch on error handling.
 */
export async function lookupLocalVoterFile(
  args: VoterFileLookupArgs,
): Promise<VoterFileLookupResult | null> {
  const stateCode = (args.state ?? "").toUpperCase().trim();
  if (!stateCode || !SUPPORTED.includes(stateCode as SupportedState)) {
    return null;
  }
  const table = TABLE_BY_STATE[stateCode as SupportedState];
  const source = SOURCE_BY_STATE[stateCode as SupportedState];

  const address = normalizeAddress(args.address ?? "");
  const zip = strip5Zip(args.zip ?? "");
  if (!address || !zip) return null;

  // Build a prefix LIKE against the normalized column. The ingest scripts
  // already wrote UPPER normalized addresses, so LIKE 'NNN MAIN ST%'
  // anchors on the left and the (zip, lower(address)) index satisfies
  // the query via an index range scan.
  const prefix = `${escapeLike(address)}%`;
  const lastName = (args.lastName ?? "").trim().toLowerCase();

  let client;
  try {
    client = createAdminClient();
  } catch (err) {
    // Missing env vars, bad config — never crash the enrichment pass.
    logger.warn("voter-file.lookupLocalVoterFile: admin client init failed", {
      state: stateCode,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  try {
    let query = client
      .from(table)
      .select(
        "phone, first_name, middle_name, last_name, name_suffix, residence_address",
      )
      .eq("residence_zip", zip)
      .ilike("residence_address", prefix)
      .limit(1);

    if (lastName) {
      // ilike on last_name keeps this simple without a functional index;
      // for exact match with the (lower(last_name), zip) index we'd need
      // to filter via RPC. ilike still benefits from the btree prefix
      // scan on residence_zip, which is the dominant filter.
      query = query.ilike("last_name", lastName);
    }

    const { data, error } = await query;

    if (error) {
      const msg = error.message ?? "";
      // Migration not applied yet → table doesn't exist. Graceful-degrade
      // silently on the first few calls; log once so the operator knows
      // to run `pnpm migrate`.
      if (/does not exist|relation .* does not exist/i.test(msg)) {
        logger.warn(
          "voter-file.lookupLocalVoterFile: table missing (run migration 00041)",
          { state: stateCode, table },
        );
        return null;
      }
      logger.warn("voter-file.lookupLocalVoterFile: query error", {
        state: stateCode,
        error: msg,
      });
      return null;
    }

    // Phonetic fallback: if the exact-last-name match returned nothing
    // AND we had a last name to filter on, retry without the last-name
    // filter but post-filter the result set by Soundex equality. Catches
    // common variants (Smith / Smyth, Gonzales / Gonzalez). Only runs
    // when the first query returned empty, so zero cost when the exact
    // match was sufficient.
    if ((!data || data.length === 0) && lastName) {
      const targetCode = soundex(lastName);
      if (targetCode) {
        const { data: fallback } = await client
          .from(table)
          .select(
            "phone, first_name, middle_name, last_name, name_suffix, residence_address",
          )
          .eq("residence_zip", zip)
          .ilike("residence_address", prefix)
          .limit(5);                 // small set — we'll filter by soundex in JS
        const phoneticMatch = (fallback ?? []).find((r) => {
          const rowLast = (r.last_name as string | null) ?? "";
          return rowLast && soundex(rowLast) === targetCode;
        });
        if (phoneticMatch) {
          const rawRow = phoneticMatch as Record<string, unknown>;
          const row: VoterFileRow = {
            phone: (rawRow.phone as string | null) ?? null,
            first_name: (rawRow.first_name as string | null) ?? null,
            middle_name: (rawRow.middle_name as string | null) ?? null,
            last_name: (rawRow.last_name as string | null) ?? null,
            name_suffix: (rawRow.name_suffix as string | null) ?? null,
            residence_address: (rawRow.residence_address as string | null) ?? null,
            last_name_lower: null,
          };
          return {
            phone: row.phone,
            owner_name: composeOwnerName(row),
            source,
            // Phonetic match gets lower confidence (0.75) — not a
            // spelling-identical hit, just an audibly-equivalent one.
            confidence: 0.75,
          };
        }
      }
    }

    if (!data || data.length === 0) return null;

    const rawRow = data[0] as Record<string, unknown>;
    const row: VoterFileRow = {
      phone: (rawRow.phone as string | null) ?? null,
      first_name: (rawRow.first_name as string | null) ?? null,
      middle_name: (rawRow.middle_name as string | null) ?? null,
      last_name: (rawRow.last_name as string | null) ?? null,
      name_suffix: (rawRow.name_suffix as string | null) ?? null,
      residence_address: (rawRow.residence_address as string | null) ?? null,
      last_name_lower: null,
    };

    // Confidence: 0.9 if we filtered by last name (the tighter match),
    // 0.7 when we only matched on address + zip.
    const confidence = lastName ? 0.9 : 0.7;

    return {
      phone: row.phone,
      owner_name: composeOwnerName(row),
      source,
      confidence,
    };
  } catch (err) {
    logger.warn("voter-file.lookupLocalVoterFile: unexpected throw", {
      state: stateCode,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
