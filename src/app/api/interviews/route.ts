import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";
import { z } from "zod";

/**
 * /api/interviews — validation-interview mini-CRM. Phase 0a.
 *
 *   GET              → author's interviews, newest first
 *   POST {payload}   → create
 *   PATCH {id,...}   → update
 *   DELETE ?id=...   → delete
 *
 * Authors can only see / touch their own rows (RLS enforced via
 * `interviews_*_own` policies from migration 00033). Graceful-degrades
 * when the table is missing — GET returns an empty list, writes return
 * 503 with a clear "migration pending" signal.
 */

const WriteSchema = z.object({
  contractor_name: z.string().min(1).max(120),
  contractor_company: z.string().max(200).nullish(),
  trade: z.string().max(60).nullish(),
  state: z.string().length(2).nullish(),
  years_in_business: z.number().int().min(0).max(100).nullish(),
  crew_size: z.number().int().min(0).max(500).nullish(),
  ranked_complaints: z
    .array(
      z.object({
        rank: z.number().int().min(1).max(10),
        pain: z.string().max(80),
        verbatim: z.string().max(2000).optional(),
      }),
    )
    .max(10)
    .nullish(),
  last_3_leads: z
    .array(
      z.object({
        source: z.string().max(60),
        cost: z.number().min(0).max(10000).optional(),
        outcome: z.enum([
          "not_reached",
          "reached_declined",
          "reached_quoted",
          "won",
          "lost",
          "unknown",
        ]).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .max(10)
    .nullish(),
  notes: z.string().max(10_000).nullish(),
  interviewed_at: z.string().datetime().optional(),
});

function tableMissing(msg: string | null | undefined): boolean {
  return !!msg && /Could not find the table|does not exist|schema cache/i.test(msg);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { data, error } = await supabase
      .from("contractor_interviews")
      .select("*")
      .order("interviewed_at", { ascending: false })
      .limit(200);

    if (error) {
      if (tableMissing(error.message)) {
        return NextResponse.json({ interviews: [], migrationPending: true });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ interviews: data ?? [] });
  } catch (err) {
    logApiError("interviews.get", err);
    return NextResponse.json({ interviews: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const body = WriteSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid payload", issues: body.error.issues }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("contractor_interviews")
      .insert({
        author_id: gate.user.id,
        contractor_name: body.data.contractor_name,
        contractor_company: body.data.contractor_company ?? null,
        trade: body.data.trade ?? null,
        state: body.data.state ?? null,
        years_in_business: body.data.years_in_business ?? null,
        crew_size: body.data.crew_size ?? null,
        ranked_complaints: body.data.ranked_complaints ?? null,
        last_3_leads: body.data.last_3_leads ?? null,
        notes: body.data.notes ?? null,
        interviewed_at: body.data.interviewed_at ?? new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (tableMissing(error.message)) {
        return NextResponse.json(
          { error: "Interview log not yet enabled. Apply migration 00033.", migrationPending: true },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, interview: data });
  } catch (err) {
    logApiError("interviews.post", err);
    return NextResponse.json({ error: "Failed to save interview" }, { status: 500 });
  }
}

const PatchSchema = WriteSchema.partial().extend({ id: z.string().uuid() });

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const body = PatchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid payload", issues: body.error.issues }, { status: 400 });
    }
    const { id, ...rest } = body.data;

    const { data, error } = await supabase
      .from("contractor_interviews")
      .update(rest)
      .eq("id", id)
      .eq("author_id", gate.user.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, interview: data });
  } catch (err) {
    logApiError("interviews.patch", err);
    return NextResponse.json({ error: "Failed to update interview" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { error } = await supabase
      .from("contractor_interviews")
      .delete()
      .eq("id", id)
      .eq("author_id", gate.user.id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logApiError("interviews.delete", err);
    return NextResponse.json({ error: "Failed to delete interview" }, { status: 500 });
  }
}
