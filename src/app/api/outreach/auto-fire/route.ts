import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";
import { z } from "zod";

/**
 * /api/outreach/auto-fire — Phase 0a wedge #6.
 *
 *   GET  → { enabled: boolean, template_id: string|null, channel: 'email'|'sms' }
 *   PUT  → persist the contractor's auto-fire-on-lead-create preference
 *
 * Stored as `profiles.outreach_auto_fire` jsonb (added opportunistically
 * — if the column isn't there yet we surface `migrationPending: true`
 * and the UI disables the toggle with a clear message).
 *
 * When the toggle is on AND a matching template exists, the scorer's
 * lead-create path fires the first outreach within ~60s of ingest,
 * matching the wedge-#6 "speed-to-lead" promise.
 */

const SaveSchema = z.object({
  enabled: z.boolean(),
  template_id: z.string().uuid().nullish(),
  channel: z.enum(["email", "sms"]).default("email"),
});

function colMissing(msg: string | null | undefined): boolean {
  return !!msg && /outreach_auto_fire|Could not find the column|schema cache/i.test(msg);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { data, error } = await supabase
      .from("profiles")
      .select("outreach_auto_fire")
      .eq("id", gate.user.id)
      .single();

    if (error) {
      if (colMissing(error.message)) {
        return NextResponse.json({
          enabled: false,
          template_id: null,
          channel: "email",
          migrationPending: true,
        });
      }
      throw new Error(error.message);
    }

    const raw = data?.outreach_auto_fire as
      | { enabled?: boolean; template_id?: string | null; channel?: "email" | "sms" }
      | null;
    return NextResponse.json({
      enabled: !!raw?.enabled,
      template_id: raw?.template_id ?? null,
      channel: raw?.channel ?? "email",
    });
  } catch (err) {
    logApiError("outreach.auto-fire.get", err);
    return NextResponse.json({ enabled: false, template_id: null, channel: "email" });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const body = SaveSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { error } = await supabase
      .from("profiles")
      .update({ outreach_auto_fire: body.data })
      .eq("id", gate.user.id);

    if (error) {
      if (colMissing(error.message)) {
        return NextResponse.json(
          {
            error:
              "Auto-fire preferences not yet enabled. Add the `outreach_auto_fire jsonb` column on profiles.",
            migrationPending: true,
          },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, ...body.data });
  } catch (err) {
    logApiError("outreach.auto-fire.put", err);
    return NextResponse.json({ error: "Failed to save preference" }, { status: 500 });
  }
}
