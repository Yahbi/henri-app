import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";

/**
 * GET /api/permit-events?permit_id=<uuid>
 *
 * Returns every `permit_events` row for the given permit, oldest first
 * so the drawer timeline renders chronologically. Permit events are
 * readable by any authenticated user (same public-to-authenticated
 * contract as `permits` itself — see migration 00031 RLS policy).
 *
 * Graceful-degrades when migration 00031 isn't applied: returns an
 * empty events list + `migrationPending: true`. The drawer then
 * synthesizes stages client-side from `permits.status` + dates.
 */

function tableMissing(msg: string | null | undefined): boolean {
  return !!msg && /Could not find the table|does not exist|schema cache/i.test(msg);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { searchParams } = new URL(request.url);
    const permitId = searchParams.get("permit_id");
    if (!permitId) {
      return NextResponse.json({ error: "Missing permit_id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("permit_events")
      .select("id, event_type, occurred_at, source, notes")
      .eq("permit_id", permitId)
      .order("occurred_at", { ascending: true })
      .limit(100);

    if (error) {
      if (tableMissing(error.message)) {
        return NextResponse.json({ events: [], migrationPending: true });
      }
      throw new Error(error.message);
    }
    return NextResponse.json(
      { events: data ?? [] },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (err) {
    logApiError("permit-events.get", err);
    return NextResponse.json({ events: [] });
  }
}
