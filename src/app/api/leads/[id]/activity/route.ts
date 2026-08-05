import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { requireContractor } from "@/lib/auth/requireContractor";
import { isUuid } from "@/lib/validation/params";

/* ── Types ── */

export interface ActivityEvent {
  id: string;
  type:
    | "created"
    | "status_change"
    | "outreach"
    | "quote"
    | "note"
    | "sequence"
    | "notification";
  title: string;
  description: string | null;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/* ── Helpers ── */

function makeId(prefix: string, suffix: string): string {
  return `${prefix}_${suffix}`;
}

/**
 * Parse timestamped notes from the leads.notes field.
 * Expected format: "[ISO_DATE] note text\n[ISO_DATE] note text"
 * Falls back to a single entry if no timestamps are found.
 */
function parseNotes(notes: string | null, leadId: string): ActivityEvent[] {
  if (!notes || notes.trim() === "") return [];

  const events: ActivityEvent[] = [];
  const timestampedPattern = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*(.+)$/;

  const lines = notes.split("\n").filter((l) => l.trim() !== "");

  let hasTimestamps = false;

  for (const line of lines) {
    const match = line.match(timestampedPattern);
    if (match) {
      hasTimestamps = true;
      events.push({
        id: makeId("note", match[1]),
        type: "note",
        title: "Note added",
        description: match[2].trim(),
        timestamp: match[1],
      });
    }
  }

  /* If no timestamped entries found, treat the whole field as a single note */
  if (!hasTimestamps && notes.trim()) {
    events.push({
      id: makeId("note", leadId),
      type: "note",
      title: "Note",
      description: notes.trim(),
      timestamp: new Date(0).toISOString(), // unknown time — will sort to bottom
    });
  }

  return events;
}

/* ── GET /api/leads/[id]/activity ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Malformed lead id" }, { status: 400 });
    }
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    /* Verify ownership of the lead */
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select(
        "id, contractor_id, status, notes, contacted_at, quoted_at, won_at, created_at"
      )
      .eq("id", id)
      .eq("contractor_id", user.id)
      .single();

    if (leadErr || !lead) {
      return NextResponse.json(
        { error: "Lead not found or not yours" },
        { status: 404 }
      );
    }

    const events: ActivityEvent[] = [];

    /* ── 1. Lead created ── */
    events.push({
      id: makeId("created", lead.id),
      type: "created",
      title: "Lead created",
      description: "This lead was added to your pipeline.",
      timestamp: lead.created_at,
    });

    /* ── 2. Status change timestamps ── */
    if (lead.contacted_at) {
      events.push({
        id: makeId("status_contacted", lead.id),
        type: "status_change",
        title: "Marked as contacted",
        description: "Lead status changed to contacted.",
        timestamp: lead.contacted_at,
        metadata: { status: "contacted" },
      });
    }

    if (lead.quoted_at) {
      events.push({
        id: makeId("status_quoted", lead.id),
        type: "status_change",
        title: "Quote sent",
        description: "Lead status changed to quoted.",
        timestamp: lead.quoted_at,
        metadata: { status: "quoted" },
      });
    }

    if (lead.won_at) {
      events.push({
        id: makeId("status_won", lead.id),
        type: "status_change",
        title: "Lead won",
        description: "This lead was marked as won.",
        timestamp: lead.won_at,
        metadata: { status: "won" },
      });
    }

    /* ── 3. Outreach sent ── */
    const { data: outreachRows } = await supabase
      .from("outreach_queue")
      .select("id, channel, subject, status, sent_at, created_at")
      .eq("lead_id", id)
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false });

    for (const row of outreachRows ?? []) {
      const channelLabel = row.channel === "sms" ? "SMS" : "Email";
      const wasSent = row.status === "sent";
      events.push({
        id: makeId("outreach", row.id),
        type: "outreach",
        title: wasSent
          ? `${channelLabel} sent`
          : `${channelLabel} ${row.status}`,
        description: row.subject ?? null,
        timestamp: row.sent_at ?? row.created_at,
        metadata: {
          channel: row.channel,
          outreach_status: row.status,
          outreach_id: row.id,
        },
      });
    }

    /* ── 4. Quotes ── */
    const { data: quoteRows } = await supabase
      .from("quotes")
      .select(
        "id, status, amount, description, created_at, sent_at, accepted_at, declined_at"
      )
      .eq("lead_id", id)
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false });

    for (const q of quoteRows ?? []) {
      /* Quote created */
      events.push({
        id: makeId("quote_created", q.id),
        type: "quote",
        title: "Quote created",
        description: q.description ?? null,
        timestamp: q.created_at,
        metadata: {
          quote_id: q.id,
          amount: q.amount,
          quote_status: q.status,
        },
      });

      /* Quote sent */
      if (q.sent_at) {
        events.push({
          id: makeId("quote_sent", q.id),
          type: "quote",
          title: "Quote sent to homeowner",
          description: q.amount ? `Amount: $${q.amount}` : null,
          timestamp: q.sent_at,
          metadata: { quote_id: q.id, quote_status: "sent" },
        });
      }

      /* Quote accepted */
      if (q.accepted_at) {
        events.push({
          id: makeId("quote_accepted", q.id),
          type: "quote",
          title: "Quote accepted",
          description: q.amount ? `Accepted amount: $${q.amount}` : null,
          timestamp: q.accepted_at,
          metadata: { quote_id: q.id, quote_status: "accepted" },
        });
      }

      /* Quote declined */
      if (q.declined_at) {
        events.push({
          id: makeId("quote_declined", q.id),
          type: "quote",
          title: "Quote declined",
          description: null,
          timestamp: q.declined_at,
          metadata: { quote_id: q.id, quote_status: "declined" },
        });
      }
    }

    /* ── 5. Notes ── */
    const noteEvents = parseNotes(lead.notes, lead.id);
    events.push(...noteEvents);

    /* ── 6. Follow-up sequences ── */
    const { data: sequenceRows } = await supabase
      .from("follow_up_sequences")
      .select("id, name, active, trigger_status, created_at")
      .eq("lead_id", id)
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false });

    for (const seq of sequenceRows ?? []) {
      events.push({
        id: makeId("sequence", seq.id),
        type: "sequence",
        title: seq.active ? "Sequence started" : "Sequence completed",
        description: seq.name ?? `Triggered on ${seq.trigger_status}`,
        timestamp: seq.created_at,
        metadata: {
          sequence_id: seq.id,
          active: seq.active,
          trigger_status: seq.trigger_status,
        },
      });
    }

    /* ── 7. Notifications referencing this lead ── */
    const { data: notifRows } = await supabase
      .from("notifications")
      .select("id, type, title, body, created_at, metadata")
      .eq("user_id", user.id)
      .contains("metadata", { lead_id: id })
      .order("created_at", { ascending: false });

    for (const n of notifRows ?? []) {
      events.push({
        id: makeId("notification", n.id),
        type: "notification",
        title: n.title,
        description: n.body ?? null,
        timestamp: n.created_at,
        metadata: {
          notification_type: n.type,
          ...(n.metadata as Record<string, unknown> | null),
        },
      });
    }

    /* ── Sort DESC (newest first) ── */
    events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json(
      { events, lead_id: id },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    logger.error("Lead activity GET error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch lead activity" },
      { status: 500 }
    );
  }
}
