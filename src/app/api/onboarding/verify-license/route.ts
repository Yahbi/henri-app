/**
 * POST /api/onboarding/verify-license
 *
 * Cross-checks a contractor's claimed (state, license_number) against
 * the public roster in `state_license_rosters` (Wave 2.B Phase 2) AND —
 * when `persist: true` — records the verdict on the caller's
 * `contractor_licenses` row using the service-role client.
 *
 * Body: {
 *   state: "TX",
 *   license_number: "12345",
 *   persist?: boolean,      // false/absent = probe only, no write
 *   license_id?: uuid       // which of the caller's rows to stamp
 * }
 *
 * Returns one of:
 *   - found    + business_name + license_status + expire_date
 *   - missing  (state IS in our roster but no matching license)
 *   - skipped  (state NOT in our roster — show manual-review prompt)
 *
 * ─── Why the server owns the write ──────────────────────────────────────
 * This route used to be a read-only probe: it returned the verdict and
 * the BROWSER persisted it, computing `verified` client-side and calling
 * `.from("contractor_licenses").insert({ verified: … })` on the browser
 * Supabase client. `contractor_licenses` only has row-scoped RLS
 * (licenses_insert_own / licenses_update_own, 00010:44-53), and RLS gates
 * ROWS, not COLUMNS — so a contractor could set `verified: true` on their
 * own row straight from the console and self-award the "Licensed" badge
 * that /api/contractors/search and /api/contractors/[id] publish to
 * homeowners.
 *
 * Two changes close that:
 *   1. Migration 00127 blocks every non-service-role session from setting
 *      or changing verified / verification_status / last_checked_at /
 *      expiry_date / raw_response / contractor_id.
 *   2. This route performs the roster check AND the write, with the
 *      service-role admin client, taking `contractor_id` from the
 *      SESSION — never from the request body, which would be an IDOR.
 *
 * The browser now writes only the user-declared fields (number, state,
 * type, holder name); everything a homeowner is shown comes from here.
 *
 * Auth: any signed-in user (this fires during onboarding, before role
 * finalization).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiError } from "@/lib/log";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  state: z.string().length(2),
  license_number: z.string().min(1).max(50),
  /** Probe-only by default — the debounced keystroke check must not write. */
  persist: z.boolean().optional(),
  /** Which of the CALLER'S rows to stamp. Always re-scoped to the session
   *  user below, so a stolen id from another contractor resolves to
   *  nothing rather than to their row. */
  license_id: z.string().uuid().optional(),
});

type VerifyStatus = "found" | "missing" | "skipped" | "error";

interface VerifyMatch {
  business_name: string | null;
  license_type: string | null;
  license_status: string | null;
  issue_date: string | null;
  expire_date: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
}

interface VerifyResponse {
  status: VerifyStatus;
  state: string;
  license_number: string;
  /** Human-readable explanation. */
  message: string;
  /** When status='found': matching roster row fields. */
  match?: VerifyMatch;
  /** Source registry name + last_run_at, when status='skipped' tells
   *  the user which states ARE supported. */
  available_states?: string[];
  /** Persist mode only — whether the verdict actually reached the DB. */
  persisted?: boolean;
  /** Persist mode only — the `verification_status` now stored on the row,
   *  or null when nothing was written. The onboarding UI reports THIS
   *  rather than assuming the probe verdict was saved. */
  verification_status?: string | null;
}

/** `verification_status` values written for each verdict. All four are
 *  members of the CHECK constraint only AFTER migration 00123 widens it —
 *  see persistVerdict() for what happens before that. */
const STATUS_FOR: Record<Exclude<VerifyStatus, "error">, string> = {
  found: "verified_state_roster",
  skipped: "manual_review",
  missing: "missing_in_roster",
};

/** `expiry_date` is a DATE column. The roster's `expire_date` is free-form
 *  upstream text, so anything that isn't an ISO date is dropped rather
 *  than handed to Postgres. */
function asDateOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

/**
 * Stamp the roster verdict onto the caller's licence row.
 *
 * Runs on the service-role client, which is the only role migration 00127
 * lets through to these columns. The row is resolved from the SESSION
 * user id in every branch — `license_id` is only ever an additional
 * filter, never the sole one.
 *
 * Best-effort by design: a failure here leaves the row unverified, which
 * is the safe direction, and must not fail onboarding. In particular,
 * until migration 00123 widens the `verification_status` CHECK, all three
 * values in STATUS_FOR violate it and this write raises — the licence is
 * still saved (the browser wrote the declared fields), it simply carries
 * no badge until 00123 lands.
 */
async function persistVerdict(
  admin: ReturnType<typeof createAdminClient>,
  contractorId: string,
  args: {
    state: string;
    license: string;
    licenseId?: string;
    verdict: Exclude<VerifyStatus, "error">;
    match: VerifyMatch | null;
    payload: Record<string, unknown>;
  }
): Promise<{ persisted: boolean; verification_status: string | null }> {
  const { state, license, licenseId, verdict, match, payload } = args;

  /* Resolve the target row. Both branches are scoped to contractor_id, so
   * the worst a forged license_id can do is find nothing. */
  let targetId: string | null = null;

  if (licenseId) {
    const { data } = await admin
      .from("contractor_licenses")
      .select("id")
      .eq("id", licenseId)
      .eq("contractor_id", contractorId)
      .maybeSingle();
    targetId = (data?.id as string | undefined) ?? null;
  }

  if (!targetId) {
    /* Fall back to the row the caller just declared. Newest first so a
     * multi-state contractor's other licences are never overwritten. */
    const { data } = await admin
      .from("contractor_licenses")
      .select("id")
      .eq("contractor_id", contractorId)
      .eq("license_state", state)
      .eq("license_number", license)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    targetId = (data?.id as string | undefined) ?? null;
  }

  /* No row to stamp. The browser owns creating it (declared fields only);
   * if that write failed there is nothing to verify, and inventing a row
   * here would create a licence the contractor never submitted. */
  if (!targetId) return { persisted: false, verification_status: null };

  const verificationStatus = STATUS_FOR[verdict];

  const { error } = await admin
    .from("contractor_licenses")
    .update({
      verified: verdict === "found",
      verification_status: verificationStatus,
      last_checked_at: new Date().toISOString(),
      expiry_date: asDateOrNull(match?.expire_date),
      /* Roster values are better than the contractor's own typing when we
       * have them; both columns stay user-writable, so this is an
       * improvement on the claim rather than a gate over it. */
      ...(match?.license_type ? { license_type: match.license_type } : {}),
      ...(match?.business_name ? { holder_name: match.business_name } : {}),
      raw_response: payload,
    })
    .eq("id", targetId)
    .eq("contractor_id", contractorId);

  if (error) {
    logApiError("onboarding.verify-license.persist", error, {
      contractor_scoped: true,
      verdict,
    });
    return { persisted: false, verification_status: null };
  }

  return { persisted: true, verification_status: verificationStatus };
}

export async function POST(request: NextRequest) {
  try {
    // Auth — any signed-in user.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { status: "error", message: "Not signed in" },
        { status: 401 },
      );
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { status: "error", message: "Invalid body" },
        { status: 400 },
      );
    }
    const state = body.state.toUpperCase();
    const license = body.license_number.trim();

    // Service-role client — bypasses RLS on state_license_rosters, and is
    // the only role migration 00127 lets write the trust columns.
    const admin = createAdminClient();

    /* ── Step 1 — is this state actually represented in our roster? ── */
    const { data: source } = await admin
      .from("contractor_license_sources")
      .select("state_code, enabled, last_inserted, source_kind")
      .eq("state_code", state)
      .eq("enabled", true)
      .maybeSingle();

    let verdict: Exclude<VerifyStatus, "error">;
    let match: VerifyMatch | null = null;
    let message: string;
    let availableStates: string[] | undefined;

    if (!source) {
      // State not in our verified-live set. Tell the user we'll
      // manually review and what states ARE supported.
      const { data: enabled } = await admin
        .from("contractor_license_sources")
        .select("state_code")
        .eq("enabled", true)
        .order("state_code");
      availableStates = (enabled ?? [])
        .map((r) => r.state_code as string)
        .filter(Boolean);
      verdict = "skipped";
      message = `${state} not yet in our verified-live roster — manual review required.`;
    } else {
      /* ── Step 2 — exact license-number lookup. License numbers can have
       * formatting variance (leading zeros, dashes), so we try the raw
       * value first then a normalized variant. ── */
      const candidates = [license];
      const stripped = license.replace(/[^0-9A-Za-z]/g, "");
      if (stripped !== license) candidates.push(stripped);

      let row: Record<string, unknown> | null = null;
      for (const cand of candidates) {
        const { data } = await admin
          .from("state_license_rosters")
          .select(
            "business_name, license_type, license_status, issue_date, expire_date, city, zip, phone",
          )
          .eq("state_code", state)
          .eq("license_number", cand)
          .limit(1)
          .maybeSingle();
        if (data) {
          row = data as Record<string, unknown>;
          break;
        }
      }

      if (!row) {
        verdict = "missing";
        message = `License ${license} not found in ${state} roster. Double-check the number, or our roster may be a few days stale.`;
      } else {
        const str = (v: unknown) => (typeof v === "string" ? v : null);
        match = {
          business_name: str(row.business_name),
          license_type: str(row.license_type),
          license_status: str(row.license_status),
          issue_date: str(row.issue_date),
          expire_date: str(row.expire_date),
          city: str(row.city),
          zip: str(row.zip),
          phone: str(row.phone),
        };
        verdict = "found";
        message = `Verified — ${match.business_name || "license matched"} (${match.license_status || "active"})`;
      }
    }

    const response: VerifyResponse = {
      status: verdict,
      state,
      license_number: license,
      message,
      ...(match ? { match } : {}),
      ...(availableStates ? { available_states: availableStates } : {}),
    };

    /* ── Step 3 — persist, when the caller asked for it. The debounced
     * keystroke probe must NOT write, so this only runs on submit. ── */
    if (body.persist) {
      const { persisted, verification_status } = await persistVerdict(
        admin,
        user.id,
        {
          state,
          license,
          licenseId: body.license_id,
          verdict,
          match,
          payload: {
            status: verdict,
            message,
            match,
            checked_at: new Date().toISOString(),
            source: "state_license_rosters",
          },
        },
      );
      response.persisted = persisted;
      response.verification_status = verification_status;
    }

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    logApiError("onboarding.verify-license", err);
    return NextResponse.json(
      { status: "error", message: "Verification failed unexpectedly" },
      { status: 500 },
    );
  }
}
