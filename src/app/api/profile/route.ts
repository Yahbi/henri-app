import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logger } from "@/lib/logger";
import type { ContractorProfileUpdate } from "@/types/profile";

/* ── Updatable fields whitelist ── */
const UPDATABLE_FIELDS: (keyof ContractorProfileUpdate)[] = [
  "company_name",
  "full_name",
  "bio",
  "trade",
  "specialties",
  "years_experience",
  "phone",
  "profile_public",
  "service_area",
  // G3 fix (2026-04-27): wedge bullet #5 (10-second missed-call SMS)
  // depends on this column being populated. Adding it to the
  // whitelist makes the new Settings UI work end-to-end.
  "twilio_tracked_number",
];

/* ── PATCH body schema ──
 * Mirrors UPDATABLE_FIELDS above. Deliberately not `.strict()`: the
 * whitelist loop in the handler already drops unknown keys, and strict mode
 * would 400 any client that echoes back read-only fields from a prior GET. */
const ProfilePatchSchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(120)
    .optional(),
  full_name: z.string().max(120).nullish(),
  bio: z.string().max(500, "Bio must be 500 characters or fewer").nullish(),
  trade: z.string().max(80).nullish(),
  specialties: z
    .array(z.string().max(80))
    .max(10, "Maximum 10 specialties allowed")
    .nullish(),
  years_experience: z.number().int().min(0).max(100).nullish(),
  phone: z.string().max(40).nullish(),
  profile_public: z.boolean().optional(),
  service_area: z.string().max(200).nullish(),
  twilio_tracked_number: z.string().max(40).nullish(),
});

/* ─── GET /api/profile — return full contractor profile with computed fields ─── */
export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    /* Fetch the profile row */
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        `
        id, email, full_name, company_name, bio, trade,
        service_area, specialties, years_experience,
        portfolio_photos, profile_public, phone,
        twilio_tracked_number,
        plan, role, onboarding_completed, created_at,
        avg_rating, review_count, response_time_h
      `
      )
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    /* Compute jobs_completed from leads where status = 'won' */
    const { count: jobsCompleted } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", user.id)
      .eq("status", "won");

    const result = {
      ...profile,
      specialties: profile.specialties ?? [],
      portfolio_photos: profile.portfolio_photos ?? [],
      profile_public: profile.profile_public ?? false,
      avg_rating: profile.avg_rating ?? 0,
      review_count: profile.review_count ?? 0,
      response_time_h: profile.response_time_h ?? null,
      jobs_completed: jobsCompleted ?? 0,
    };

    return NextResponse.json(
      { profile: result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("profile.get failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── PATCH /api/profile — update contractor profile ─── */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    /* ── Validate ──
     * Zod first. Previously a malformed payload threw out of
     * `request.json()` (500 instead of 400), and `"key" in body` threw a
     * TypeError whenever the body parsed to null. The schema settles shape
     * and bounds in one pass; the phone block below still runs because
     * E.164 coercion is a transform, not a constraint. */
    const parsedBody = ProfilePatchSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }
    const body: Record<string, unknown> = { ...parsedBody.data };

    // twilio_tracked_number — accept E.164 (`+14155551234`) or null/empty
    // (clear the field). Defensive normalization happens here so the DB
    // never sees mixed formats. Empty string → null.
    if ("twilio_tracked_number" in body) {
      const raw = body.twilio_tracked_number as string | null | undefined;
      if (raw === null || raw === "" || raw === undefined) {
        body.twilio_tracked_number = null;
      } else if (typeof raw !== "string") {
        return NextResponse.json(
          { error: "Phone number must be a string" },
          { status: 400 }
        );
      } else {
        // Strip non-digits except leading + and reformat to E.164.
        // US-default: prepend +1 if user typed 10 digits.
        const trimmed = raw.trim();
        const digits = trimmed.replace(/[^\d+]/g, "");
        let e164: string;
        if (digits.startsWith("+")) {
          e164 = digits;
        } else if (/^\d{10}$/.test(digits)) {
          e164 = `+1${digits}`;
        } else if (/^1\d{10}$/.test(digits)) {
          e164 = `+${digits}`;
        } else {
          return NextResponse.json(
            { error: "Phone must be 10 digits or E.164 format (+15551234567)" },
            { status: 400 }
          );
        }
        if (!/^\+\d{10,15}$/.test(e164)) {
          return NextResponse.json(
            { error: "Phone must be a valid E.164 number" },
            { status: 400 }
          );
        }
        body.twilio_tracked_number = e164;
      }
    }

    /* ── Build update payload (whitelist only) ── */
    const update: Record<string, unknown> = {};
    for (const key of UPDATABLE_FIELDS) {
      if (key in body) {
        update[key] = body[key];
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    /* ── Persist ── */
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update(update)
      .eq("id", user.id)
      .select(
        `
        id, email, full_name, company_name, bio, trade,
        service_area, specialties, years_experience,
        portfolio_photos, profile_public, phone,
        twilio_tracked_number,
        plan, role, onboarding_completed, created_at,
        avg_rating, review_count, response_time_h
      `
      )
      .single();

    if (updateError) {
      logger.error("profile.update failed", {
        message: updateError.message,
      });
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 }
      );
    }

    /* Compute jobs_completed */
    const { count: jobsCompleted } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", user.id)
      .eq("status", "won");

    const result = {
      ...updated,
      specialties: updated.specialties ?? [],
      portfolio_photos: updated.portfolio_photos ?? [],
      profile_public: updated.profile_public ?? false,
      avg_rating: updated.avg_rating ?? 0,
      review_count: updated.review_count ?? 0,
      response_time_h: updated.response_time_h ?? null,
      jobs_completed: jobsCompleted ?? 0,
    };

    return NextResponse.json({ profile: result });
  } catch (err) {
    logger.error("profile.patch failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
