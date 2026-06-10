import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";

/**
 * GET /api/settings/export — contractor data export (JSON).
 *
 * Closes the 2026-04-27 gap where the Settings → Billing footer's
 * data-export sentence had to be removed because no export existed
 * (CLAUDE.md requires the cancel-anytime + no-lock-in + data-export
 * footer on Billing; the truthfulness rule requires the feature to be
 * real before the copy ships). This is the real feature.
 *
 * Format is deliberately JSON, not CSV — "No CSV export on any plan"
 * is a pricing-policy rule. JSON serves the no-lock-in promise (your
 * data is yours) without creating the bulk-spreadsheet resale vector
 * the CSV rule exists to prevent.
 *
 * Scope: the caller's own rows only. Uses the standard server client,
 * so RLS enforces ownership even if a filter regressed.
 */

const ROW_CAP = 5000;

export async function GET() {
  const supabase = await createClient();
  const gate = await requireContractor(supabase);
  if (gate.response) return gate.response;
  const userId = gate.user.id;

  const [profileRes, territoriesRes, leadsRes, estimatesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, email, full_name, company_name, phone, role, plan, trade, license_number, license_state, created_at",
      )
      .eq("id", userId)
      .single(),
    supabase
      .from("territories")
      .select("zip, status, slot_number, claimed_at, created_at")
      .eq("contractor_id", userId),
    supabase
      .from("leads")
      .select("*")
      .eq("contractor_id", userId)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP),
    supabase
      .from("estimates")
      .select("*")
      .eq("contractor_id", userId)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP),
  ]);

  // Estimates table may not exist in older environments — degrade to [].
  const estimates = estimatesRes.error ? [] : (estimatesRes.data ?? []);

  if (profileRes.error) {
    return NextResponse.json(
      { error: "Export failed — please try again" },
      { status: 500 },
    );
  }

  const exportedAt = new Date().toISOString();
  const body = {
    format: "henri-export.v1",
    exported_at: exportedAt,
    row_cap_per_table: ROW_CAP,
    profile: profileRes.data,
    territories: territoriesRes.data ?? [],
    leads: leadsRes.data ?? [],
    estimates,
    counts: {
      territories: territoriesRes.data?.length ?? 0,
      leads: leadsRes.data?.length ?? 0,
      estimates: estimates.length,
    },
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="henri-export-${exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
