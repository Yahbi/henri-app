import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";

/**
 * /api/outreach/library — Phase 0a wedge #10.
 *
 *   GET  → list seed-library templates (is_library=true rows).
 *          Filterable by ?trade=roofing and ?channel=email|sms|both.
 *   POST → clone a library template into the caller's own templates.
 *
 * Seeds are inserted by migration 00032. Graceful-degrades when the
 * migration hasn't run (library flag column missing) → empty list.
 */

function libraryColumnMissing(msg: string | null | undefined): boolean {
  return !!msg && /is_library|trade|Could not find the column|schema cache/i.test(msg);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { searchParams } = new URL(request.url);
    const trade = searchParams.get("trade");
    const channel = searchParams.get("channel");

    let q = supabase
      .from("outreach_templates")
      .select("id, trade, channel, name, subject, body")
      .eq("is_library", true)
      .order("trade", { ascending: true })
      .order("channel", { ascending: true });

    if (trade) q = q.eq("trade", trade);
    if (channel) q = q.eq("channel", channel);

    const { data, error } = await q;
    if (error) {
      if (libraryColumnMissing(error.message)) {
        return NextResponse.json({ templates: [], migrationPending: true });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ templates: data ?? [] });
  } catch (err) {
    logApiError("outreach.library.get", err);
    return NextResponse.json({ templates: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const body = (await request.json()) as { template_id?: string; rename?: string };
    if (!body?.template_id) {
      return NextResponse.json({ error: "template_id is required" }, { status: 400 });
    }

    // Read the library row.
    const { data: lib, error: libErr } = await supabase
      .from("outreach_templates")
      .select("id, trade, channel, name, subject, body, is_library")
      .eq("id", body.template_id)
      .single();

    if (libErr) {
      if (libraryColumnMissing(libErr.message)) {
        return NextResponse.json(
          { error: "Library not yet enabled. Apply migration 00032.", migrationPending: true },
          { status: 503 },
        );
      }
      throw new Error(libErr.message);
    }
    if (!lib || !(lib as { is_library?: boolean }).is_library) {
      return NextResponse.json({ error: "Not a library template" }, { status: 400 });
    }

    // Clone into the contractor's own templates (contractor_id = auth.uid()).
    const { data: inserted, error: insertErr } = await supabase
      .from("outreach_templates")
      .insert({
        contractor_id: gate.user.id,
        trade: lib.trade,
        channel: lib.channel,
        name: body.rename?.trim() || lib.name,
        subject: lib.subject,
        body: lib.body,
        is_library: false,
      })
      .select()
      .single();

    if (insertErr) throw new Error(insertErr.message);
    return NextResponse.json({ ok: true, template: inserted });
  } catch (err) {
    logApiError("outreach.library.post", err);
    return NextResponse.json({ error: "Failed to copy template" }, { status: 500 });
  }
}
