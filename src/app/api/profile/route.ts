import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
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
];

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
    console.error("profile.get failed", {
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

    const body = await request.json();

    /* ── Validate ── */

    // company_name is required if provided (cannot be set to empty)
    if ("company_name" in body && (!body.company_name || !body.company_name.trim())) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    // bio max 500 chars
    if (body.bio && typeof body.bio === "string" && body.bio.length > 500) {
      return NextResponse.json(
        { error: "Bio must be 500 characters or fewer" },
        { status: 400 }
      );
    }

    // specialties max 10 items
    if (body.specialties && Array.isArray(body.specialties) && body.specialties.length > 10) {
      return NextResponse.json(
        { error: "Maximum 10 specialties allowed" },
        { status: 400 }
      );
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
        plan, role, onboarding_completed, created_at,
        avg_rating, review_count, response_time_h
      `
      )
      .single();

    if (updateError) {
      console.error("profile.update failed", {
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
    console.error("profile.patch failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
