import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── GET /api/outreach — outreach history + stats for the current contractor ─── */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch outreach queue items (most recent 50) */
    const { data: outreachRows, error: oErr } = await supabase
      .from("outreach_queue")
      .select(
        `
        id,
        lead_id,
        channel,
        subject,
        body,
        status,
        scheduled_for,
        sent_at,
        delivered_at,
        opened_at,
        replied_at,
        bounced_at,
        external_id,
        created_at,
        leads!inner ( address )
      `
      )
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (oErr) {
      console.error("Outreach queue fetch error:", oErr);
      return Response.json(
        { error: "Failed to fetch outreach data" },
        { status: 500 }
      );
    }

    const items = outreachRows ?? [];

    /* Compute stats from fetched items — including delivery tracking */
    let totalSent = 0;
    let totalOpened = 0;
    let totalReplied = 0;
    const sentStatuses = new Set(["sent", "delivered", "opened", "replied"]);

    for (const item of items) {
      if (sentStatuses.has(item.status)) {
        totalSent += 1;
      }
      if (item.opened_at) {
        totalOpened += 1;
      }
      if (item.replied_at) {
        totalReplied += 1;
      }
    }

    const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) / 100 : 0;
    const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) / 100 : 0;

    /* Fetch follow-up sequences */
    const { data: sequences, error: sErr } = await supabase
      .from("follow_up_sequences")
      .select("id, name, trigger_status, steps, active, created_at")
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false });

    if (sErr) {
      console.error("Sequences fetch error:", sErr);
      // Non-blocking — still return outreach data
    }

    /* Shape recent items for the client */
    const recent = items.map((item) => {
      // Cast is necessary because Supabase's generated type for the
      // `leads(…)` join returns the full row while we only need `address`;
      // narrowing avoids pulling the whole generated Lead type through here.
      const lead = item.leads as unknown as { address: string } | null;
      return {
        id: item.id,
        lead_id: item.lead_id,
        address: lead?.address ?? "Unknown",
        channel: item.channel,
        subject: item.subject,
        status: item.status,
        scheduled_for: item.scheduled_for,
        sent_at: item.sent_at,
        created_at: item.created_at,
      };
    });

    return Response.json({
      stats: {
        total_sent: totalSent,
        open_rate: openRate,
        reply_rate: replyRate,
      },
      recent,
      sequences: sequences ?? [],
    });
  } catch (err) {
    console.error("Outreach GET error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─── POST /api/outreach — queue a new outreach message ─── */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { lead_id, channel, template_name, message } = body as {
      lead_id?: string;
      channel?: string;
      template_name?: string;
      message?: string;
    };

    if (!lead_id || !channel || !message) {
      return Response.json(
        { error: "lead_id, channel, and message are required" },
        { status: 400 }
      );
    }

    if (!["sms", "email"].includes(channel)) {
      return Response.json(
        { error: "channel must be 'sms' or 'email'" },
        { status: 400 }
      );
    }

    /* Look up lead to get recipient info */
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, contractor_id, phone, email")
      .eq("id", lead_id)
      .eq("contractor_id", user.id)
      .single();

    if (leadErr || !lead) {
      return Response.json(
        { error: "Lead not found or not yours" },
        { status: 404 }
      );
    }

    const recipient =
      channel === "sms"
        ? lead.phone ?? "unknown"
        : lead.email ?? "unknown";

    const { data: outreach, error: insertErr } = await supabase
      .from("outreach_queue")
      .insert({
        contractor_id: user.id,
        lead_id,
        channel,
        recipient,
        subject: template_name ?? null,
        body: message,
        scheduled_for: new Date().toISOString(),
        status: "queued",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Outreach insert error:", insertErr);
      return Response.json(
        { error: "Failed to queue outreach" },
        { status: 500 }
      );
    }

    return Response.json(
      { success: true, outreach_id: outreach.id },
      { status: 201 }
    );
  } catch (err) {
    console.error("Outreach POST error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
