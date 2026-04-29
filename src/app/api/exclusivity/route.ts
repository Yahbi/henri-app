import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";
import {
  acquireLock,
  releaseLock,
  summarizeLocksForContractor,
  summarizeWatchersByLead,
  type ExclusivityReleaseReason,
} from "@/lib/exclusivity/locks";
import { z } from "zod";

/**
 * /api/exclusivity — per-permit lock CRUD for contractors.
 *
 *   GET  ?lead_ids=a,b,c     → summary map per lead:
 *                                { lead_id, held_by_caller, ms_remaining,
 *                                  window_end, watchers_bucket }
 *                              watchers_bucket is the coarse competitive
 *                              intel from wedge contract #6: "1-2" /
 *                              "3-5" / "5+" / "0", never a raw count.
 *   POST { lead_id, trade? } → acquire (idempotent)
 *   DELETE ?lead_id=&reason= → release
 *
 * Contractor-gated. Graceful-degrades when migration 00031 hasn't been
 * applied (table missing → watchers bucket "0" + held_by_caller false).
 * Never hard-fails a lead-list render just because locks aren't live yet.
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("lead_ids") ?? "";
    const leadIds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
    if (leadIds.length === 0) return NextResponse.json({ locks: {} });

    // Run the two summarisers in parallel — they hit the same table but
    // with different filters (caller-specific vs all-contractors). At
    // 500 leads the round-trip dominates; parallelising saves ~40ms.
    const [lockMap, watcherMap] = await Promise.all([
      summarizeLocksForContractor(supabase, user.id, leadIds),
      summarizeWatchersByLead(supabase, user.id, leadIds),
    ]);

    const out: Record<string, unknown> = {};
    for (const lid of leadIds) {
      const lock = lockMap.get(lid);
      const watchers = watcherMap.get(lid);
      out[lid] = {
        lead_id: lid,
        held_by_caller: lock?.held_by_caller ?? false,
        ms_remaining: lock?.ms_remaining ?? 0,
        window_end: lock?.window_end ?? null,
        // Coarse bucket only — wedge contract #6 forbids raw counts.
        watchers_bucket: watchers?.bucket ?? "0",
      };
    }
    return NextResponse.json({ locks: out });
  } catch (err) {
    logApiError("exclusivity.get", err);
    return NextResponse.json({ locks: {} }); // never blocks caller
  }
}

const AcquireSchema = z.object({
  lead_id: z.string().uuid(),
  trade: z.string().max(60).nullish(),
  zip: z.string().max(5).nullish(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const body = AcquireSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const lock = await acquireLock(supabase, {
      lead_id: body.data.lead_id,
      contractor_id: user.id,
      trade: body.data.trade ?? null,
      zip: body.data.zip ?? null,
    });

    if (!lock) {
      return NextResponse.json(
        { ok: false, conflict: true, message: "Lead is locked by another contractor or feature not yet enabled." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, lock });
  } catch (err) {
    logApiError("exclusivity.post", err);
    return NextResponse.json({ error: "Failed to acquire lock" }, { status: 500 });
  }
}

const ReleaseReasons: readonly ExclusivityReleaseReason[] = [
  "expired",
  "declined",
  "won",
  "forfeit",
] as const;

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const { searchParams } = new URL(request.url);
    const lead_id = searchParams.get("lead_id");
    const reason = searchParams.get("reason") as ExclusivityReleaseReason | null;
    if (!lead_id || !reason || !ReleaseReasons.includes(reason)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    await releaseLock(supabase, { lead_id, contractor_id: user.id, reason });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logApiError("exclusivity.delete", err);
    return NextResponse.json({ error: "Failed to release lock" }, { status: 500 });
  }
}
