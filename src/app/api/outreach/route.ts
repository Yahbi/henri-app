import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { OutreachQueueBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";
import { renderTemplate, type OutreachTokenContext } from "@/lib/outreach/tokens";

/* ─── GET /api/outreach — outreach history + stats for the current contractor ─── */
export async function GET() {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

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
      logger.error("Outreach queue fetch error", { error: oErr instanceof Error ? oErr.message : String(oErr) });
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

    /* Fetch follow-up sequences.
     * Capped at 50 (matching the outreach-queue cap above). This query was
     * previously unbounded: a contractor with 1,000 sequence rows shipped a
     * 1.8 MB JSON payload on every Outreach-tab load — each row carries a
     * `steps` JSONB blob — and nothing in the UI renders more than a recent
     * slice. The oversized response was also slow enough to intermittently
     * trip the hook's error path. */
    const { data: sequences, error: sErr } = await supabase
      .from("follow_up_sequences")
      .select("id, name, trigger_status, steps, active, created_at")
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (sErr) {
      logger.error("Sequences fetch error", { error: sErr instanceof Error ? sErr.message : String(sErr) });
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
    logger.error("Outreach GET error", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─── POST /api/outreach — queue a new outreach message ─── */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(OutreachQueueBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { lead_id, channel, template_name, message } = parsed.data;

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

    /* ── Resolve {{tokens}} BEFORE the body is persisted ───────────────────
     *
     * What was wrong: this handler enqueued `message` verbatim. A template
     * body like "Hi {{owner_first}}, about permit {{permit_number}}" was
     * written to outreach_queue.body with the braces intact, and the
     * follow-ups cron transmits `item.body` unchanged — so homeowners
     * received SMS/email containing the literal placeholder text. The
     * renderer in src/lib/outreach/tokens.ts already existed and was
     * correct, but nothing on the send path called it: its only callers
     * were its own unit tests, i.e. it was dead code.
     *
     * Why render at enqueue time rather than at transmit time: the body
     * the contractor sees in Outreach history is then byte-identical to
     * what was sent, and the cron's pre-send guard has a stable invariant
     * to assert (no double-brace placeholder may ever leave the queue).
     *
     * Both lookups below are deliberately best-effort — they must never
     * turn a send into a failure. Every field in OutreachTokenContext has
     * a documented fallback ("there" / "your property" / "your recent
     * permit"), and resolveTokens maps null/undefined/"" onto that
     * fallback, so a partial context still yields a readable sentence and
     * never the strings "undefined" or "null".
     */
    // `permit_filed_date` and `permit_age_days` used to be in this list.
    // NEITHER COLUMN EXISTS on public.leads (the real permit_* columns are
    // permit_description, permit_history, permit_id, permit_type,
    // permit_value). PostgREST rejects the WHOLE select when one column is
    // unknown, and the error was discarded below, so leadCtx came back null
    // for every request and every token fell through to its generic
    // fallback. Real outreach was going to homeowners as "Hi there, ... at
    // your property (#your recent permit) ... your project ... recently" —
    // which breaks the wedge rule that outreach is permit-specific.
    //
    // The age now comes off the embedded permit's issued_date, with the
    // lead's own created_at as a backstop for manually-added and
    // parcel-synthesized leads that have no permit row.
    const { data: leadCtxRow, error: leadCtxErr } = await supabase
      .from("leads")
      .select(
        "owner_first, owner_last, owner_name, address, city, state, zip, " +
          "trade, permit_value, permit_description, created_at, " +
          "permits ( permit_number, issued_date )"
      )
      .eq("id", lead_id)
      .eq("contractor_id", user.id)
      .single();

    // Never swallow this again. A failed context select does not fail the
    // request — the fallbacks still produce a sendable message — but it must
    // be visible, because the symptom (generic boilerplate reaching real
    // homeowners) looks like a copywriting problem rather than a query bug.
    if (leadCtxErr) {
      logger.warn("outreach.lead_context_failed", {
        lead_id,
        error: leadCtxErr.message,
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, company_name, phone")
      .eq("id", user.id)
      .single();

    /* The untyped Supabase client widens any embedded-select result to a
     * union that includes GenericStringError, so the row has to be narrowed
     * before use — same `as unknown as` pattern the GET handler above uses
     * for its `leads(…)` embed. Every field stays optional/nullable so the
     * fallback path in resolveTokens is what actually guarantees output
     * quality, not this cast. */
    const leadCtx = leadCtxRow as unknown as {
      owner_first?: string | null;
      owner_last?: string | null;
      owner_name?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      trade?: string | null;
      permit_value?: number | null;
      permit_description?: string | null;
      created_at?: string | null;
      permits?: {
        permit_number?: string | null;
        issued_date?: string | null;
      } | null;
    } | null;

    const permit = leadCtx?.permits ?? null;

    // 39% of leads carry owner_name but only some carry the split
    // owner_first, so fall back to the first whitespace-delimited token
    // rather than dropping straight to the "there" fallback.
    const ownerFirst =
      leadCtx?.owner_first ??
      (leadCtx?.owner_name
        ? leadCtx.owner_name.trim().split(/\s+/)[0] || null
        : null);

    // Age of the permit, preferred from the permit's own issued_date and
    // falling back to when the lead was created (manually-added and
    // parcel-synthesized leads have no permit row at all). A malformed or
    // absent date yields null/NaN, which formatContextValue turns into the
    // "recently" fallback — so this degrades to vague, never to "undefined".
    const ageSource =
      leadCtx?.permits?.issued_date ?? leadCtx?.created_at ?? null;
    const daysAgo = ageSource
      ? Math.round((Date.now() - new Date(ageSource).getTime()) / 86_400_000)
      : null;

    const addressFull = [
      leadCtx?.address,
      leadCtx?.city,
      [leadCtx?.state, leadCtx?.zip].filter(Boolean).join(" "),
    ]
      .filter((part) => !!part && String(part).trim() !== "")
      .join(", ");

    const tokenCtx: Partial<OutreachTokenContext> = {
      owner_first: ownerFirst,
      owner_last: leadCtx?.owner_last ?? null,
      address_short: leadCtx?.address ?? "",
      address_full: addressFull,
      city: leadCtx?.city ?? null,
      zip: leadCtx?.zip ?? null,
      permit_number: permit?.permit_number ?? null,
      permit_scope: leadCtx?.permit_description ?? null,
      days_ago: daysAgo,
      trade: leadCtx?.trade ?? null,
      permit_value: leadCtx?.permit_value ?? null,
      contractor_name: profile?.full_name ?? "",
      contractor_company: profile?.company_name ?? "",
      contractor_phone: profile?.phone ?? null,
    };

    // `subject` carries the template name today (the email sender reads
    // it as the Subject line), so it goes through the same renderer.
    const rendered = renderTemplate(
      { subject: template_name ?? null, body: message },
      tokenCtx
    );

    const { data: outreach, error: insertErr } = await supabase
      .from("outreach_queue")
      .insert({
        contractor_id: user.id,
        lead_id,
        channel,
        recipient,
        subject: rendered.subject || null,
        body: rendered.body,
        scheduled_for: new Date().toISOString(),
        status: "queued",
      })
      .select("id")
      .single();

    if (insertErr) {
      logger.error("Outreach insert error", { error: insertErr instanceof Error ? insertErr.message : String(insertErr) });
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
    logger.error("Outreach POST error", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
