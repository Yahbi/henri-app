/**
 * Outreach hygiene gate.
 *
 * Module 7 of the 18-module enhancement plan (2026-05-09 plan §9.7).
 *
 * Wraps any outreach send (SMS, email, queued call) with three checks:
 *   1. Suppression check — homeowner has not withdrawn the intake.
 *   2. Consent check — when the lead originated from a homeowner intake,
 *      consent_given_at must be non-null.
 *   3. Quiet-hours check — no contact before 8am or after 9pm in the
 *      lead's local timezone (best-effort; falls back to America/New_York
 *      when ZIP→tz lookup fails).
 *
 * Pure decision function — caller is responsible for actually sending
 * (or not). This file does no I/O beyond the optional intake lookup.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface OutreachContext {
  /** ZIP code where the lead lives — used for timezone inference. */
  zip?: string | null;
  /** When the lead originated from a homeowner intake, the intake id.
   *  Null for purely-permit-derived leads. */
  homeowner_intake_id?: string | null;
  /** Type of contact being attempted. Used for category-specific gates. */
  channel: "sms" | "email" | "call";
  /** Optional override clock for testing — defaults to Date.now(). */
  now?: Date;
}

export interface OutreachDecision {
  allowed: boolean;
  /** When `allowed=false`, machine-readable reason code: 'withdrawn',
   *  'no_consent', 'quiet_hours', 'unknown'. */
  reason?: string;
  /** Human-readable detail for the operator log. */
  detail?: string;
}

/** ZIP → timezone heuristic. Coarse but defensible for the 8am/9pm gate.
 *  Falls back to America/New_York when no match. */
function zipToTimezone(zip?: string | null): string {
  if (!zip || zip.length < 5) return "America/New_York";
  const prefix = zip.slice(0, 3);
  const n = parseInt(prefix, 10);
  if (!Number.isFinite(n)) return "America/New_York";
  // Crude bands — accurate to within 1 timezone for ~95% of US ZIPs.
  // Refine later with a proper hud_zip_crosswalk join.
  if (n >= 0 && n <= 119)   return "America/New_York";   // NE + parts of MA/NY
  if (n >= 120 && n <= 219) return "America/New_York";   // NY/NJ/PA
  if (n >= 220 && n <= 246) return "America/New_York";   // VA/WV/DC
  if (n >= 247 && n <= 268) return "America/New_York";   // VA/NC
  if (n >= 269 && n <= 297) return "America/New_York";   // NC/SC
  if (n >= 298 && n <= 319) return "America/New_York";   // GA
  if (n >= 320 && n <= 349) return "America/New_York";   // FL
  if (n >= 350 && n <= 369) return "America/Chicago";    // AL
  if (n >= 370 && n <= 397) return "America/Chicago";    // TN/MS
  if (n >= 398 && n <= 399) return "America/Chicago";    // GA edge
  if (n >= 400 && n <= 427) return "America/New_York";   // KY/OH
  if (n >= 430 && n <= 459) return "America/New_York";   // OH
  if (n >= 460 && n <= 479) return "America/New_York";   // IN
  if (n >= 480 && n <= 499) return "America/New_York";   // MI
  if (n >= 500 && n <= 528) return "America/Chicago";    // IA
  if (n >= 530 && n <= 549) return "America/Chicago";    // WI
  if (n >= 550 && n <= 567) return "America/Chicago";    // MN
  if (n >= 570 && n <= 588) return "America/Chicago";    // SD/ND
  if (n >= 590 && n <= 599) return "America/Denver";     // MT
  if (n >= 600 && n <= 629) return "America/Chicago";    // IL
  if (n >= 630 && n <= 658) return "America/Chicago";    // MO
  if (n >= 660 && n <= 679) return "America/Chicago";    // KS
  if (n >= 680 && n <= 693) return "America/Chicago";    // NE
  if (n >= 700 && n <= 715) return "America/Chicago";    // LA
  if (n >= 716 && n <= 729) return "America/Chicago";    // AR
  if (n >= 730 && n <= 749) return "America/Chicago";    // OK
  if (n >= 750 && n <= 799) return "America/Chicago";    // TX
  if (n >= 800 && n <= 816) return "America/Denver";     // CO
  if (n >= 820 && n <= 831) return "America/Denver";     // WY
  if (n >= 832 && n <= 838) return "America/Boise";      // ID
  if (n >= 840 && n <= 847) return "America/Denver";     // UT
  if (n >= 850 && n <= 865) return "America/Phoenix";    // AZ
  if (n >= 870 && n <= 884) return "America/Denver";     // NM
  if (n >= 889 && n <= 898) return "America/Los_Angeles"; // NV
  if (n >= 900 && n <= 961) return "America/Los_Angeles"; // CA
  if (n >= 970 && n <= 979) return "America/Los_Angeles"; // OR
  if (n >= 980 && n <= 994) return "America/Los_Angeles"; // WA
  if (n >= 995 && n <= 999) return "America/Anchorage";   // AK
  return "America/New_York";
}

/** Get the local hour in the given timezone. */
function localHourIn(zip: string | null | undefined, when: Date): number {
  const tz = zipToTimezone(zip);
  // Intl.DateTimeFormat is the cheapest correct path for tz-aware hour.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).formatToParts(when);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "12";
  const h = parseInt(hourStr, 10);
  // Some Node versions emit "24" for midnight in 24-hour mode; normalise.
  return h === 24 ? 0 : h;
}

/** Quiet-hours gate. No SMS/calls before 8am or after 9pm local. Email
 *  is permitted 24/7 (recipient pulls inbox at their convenience). */
function isQuietHour(zip: string | null | undefined, channel: "sms" | "email" | "call", when: Date): boolean {
  if (channel === "email") return false;
  const h = localHourIn(zip, when);
  return h < 8 || h >= 21;
}

/** Resolve allow/deny for one outreach attempt. */
export async function checkOutreachAllowed(ctx: OutreachContext): Promise<OutreachDecision> {
  const now = ctx.now ?? new Date();

  // 1 + 2. Homeowner intake suppression + consent — single SQL when intake_id present.
  if (ctx.homeowner_intake_id) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("homeowner_intakes")
      .select("status, consent_given_at")
      .eq("id", ctx.homeowner_intake_id)
      .maybeSingle();
    if (error) {
      // Conservative: when we can't verify, deny. Operator can override.
      return { allowed: false, reason: "unknown", detail: `intake lookup failed: ${error.message}` };
    }
    if (!data) {
      return { allowed: false, reason: "unknown", detail: "intake not found" };
    }
    const r = data as Record<string, unknown>;
    const status = (r.status as string) ?? "";
    if (status === "withdrawn" || status === "archived") {
      return { allowed: false, reason: "withdrawn", detail: `intake ${ctx.homeowner_intake_id} status=${status}` };
    }
    if (!r.consent_given_at) {
      return { allowed: false, reason: "no_consent", detail: `intake ${ctx.homeowner_intake_id} has no consent_given_at` };
    }
  }

  // 3. Quiet-hours (skipped for email).
  if (isQuietHour(ctx.zip, ctx.channel, now)) {
    return {
      allowed: false,
      reason: "quiet_hours",
      detail: `local hour ${localHourIn(ctx.zip, now)} in tz ${zipToTimezone(ctx.zip)} is outside 8am–9pm`,
    };
  }

  return { allowed: true };
}

// Internal exports for the test suite.
export const __test = { zipToTimezone, isQuietHour, localHourIn };
