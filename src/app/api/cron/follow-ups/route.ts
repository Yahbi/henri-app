import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  processDueSteps,
  startSequence,
  getTemplatesForTrigger,
} from "@/lib/sequences";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* -------------------------------------------------------------------------- */
/*  Follow-ups Cron                                                           */
/*  1. Process sequence engine (advance steps, enqueue due outreach)          */
/*  2. Auto-start "new_lead" sequences for recently-assigned leads            */
/*  3. Send queued outreach entries whose scheduled_for has passed            */
/* -------------------------------------------------------------------------- */

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  let outreachProcessed = 0;
  let outreachSent = 0;
  let outreachFailed = 0;
  let newSequencesStarted = 0;

  try {
    /* -------------------------------------------------------------------- */
    /*  Part 1 — Process sequence engine (advance steps, enqueue outreach)  */
    /* -------------------------------------------------------------------- */

    const sequenceStats = await processDueSteps();

    /* -------------------------------------------------------------------- */
    /*  Part 2 — Auto-start "new_lead" sequences for recent leads           */
    /* -------------------------------------------------------------------- */

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Find leads assigned in the last hour that are still "new"
    const { data: recentLeads, error: leadsError } = await supabase
      .from("leads")
      .select(
        "id, contractor_id, status, address, city, trade, owner_name, owner_first, phone, email"
      )
      .eq("status", "new")
      .gte("created_at", oneHourAgo)
      .not("contractor_id", "is", null);

    if (leadsError) {
      logger.error("Failed to query recent leads", { error: String(leadsError) });
    }

    const newLeadTemplates = getTemplatesForTrigger("new_lead");

    for (const lead of recentLeads ?? []) {
      if (!lead.contractor_id) continue;

      // Fetch contractor profile for company name and phone
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_name, phone, email, trade")
        .eq("id", lead.contractor_id)
        .single();

      if (!profile) continue;

      const variables: Record<string, string> = {
        company: profile.company_name ?? "Our Team",
        phone: profile.phone ?? "",
        email: lead.email ?? "",
        name: lead.owner_first ?? lead.owner_name ?? "there",
        address: lead.address ?? "",
        city: lead.city ?? "",
        trade: lead.trade ?? profile.trade ?? "construction",
      };

      for (const template of newLeadTemplates) {
        const seqId = await startSequence(
          lead.id,
          lead.contractor_id,
          template.id,
          variables
        );
        if (seqId) newSequencesStarted++;
      }
    }

    /* -------------------------------------------------------------------- */
    /*  Part 3 — Send queued outreach items whose time has come             */
    /* -------------------------------------------------------------------- */

    const now = new Date().toISOString();

    const { data: queuedIds, error: queueError } = await supabase
      .from("outreach_queue")
      .select("id")
      .eq("status", "queued")
      .lte("scheduled_for", now);

    if (queueError) {
      logger.error("Failed to fetch outreach queue", { error: String(queueError) });
      return NextResponse.json(
        { error: "Failed to fetch outreach queue" },
        { status: 500 }
      );
    }

    for (const { id: itemId } of queuedIds ?? []) {
      // Atomic claim — only this worker processes the item if status is still 'queued'
      const { data: claimed } = await supabase
        .from("outreach_queue")
        .update({ status: "processing" })
        .eq("id", itemId)
        .eq("status", "queued")
        .select("id, lead_id, contractor_id, channel, body, subject, recipient, scheduled_for")
        .single();

      if (!claimed) continue; // another worker already claimed it

      const item = claimed;
      outreachProcessed++;

      try {
        let success = false;
        let externalId: string | null = null;

        if (item.channel === "sms" && item.recipient) {
          // Module 7 wiring — gate the send through the hygiene module.
          // Follow-up items don't carry an intake_id directly today; the
          // gate falls through to quiet-hours-only protection. When
          // future follow-ups carry intake_id metadata, the consent gate
          // will fire too.
          const { checkOutreachAllowed } = await import("@/lib/outreach/hygiene");
          // best-effort ZIP from the joined lead/intake metadata
          const recipientZip = (item as Record<string, unknown>).zip as string | null ?? null;
          const intakeId = (item as Record<string, unknown>).homeowner_intake_id as string | null ?? null;
          const decision = await checkOutreachAllowed({
            channel: "sms",
            homeowner_intake_id: intakeId,
            zip: recipientZip,
          });
          if (!decision.allowed) {
            logger.info("follow-ups SMS refused by hygiene gate", {
              recipient: item.recipient.replace(/\d/g, "*"),
              reason: decision.reason,
              detail: decision.detail,
            });
            success = false;
            externalId = null;
          } else {
            const client = (await import("twilio")).default(
              process.env.TWILIO_ACCOUNT_SID!,
              process.env.TWILIO_AUTH_TOKEN!
            );

            const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
              ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`
              : undefined;

            const message = await client.messages.create({
              body: item.body,
              from: process.env.TWILIO_FROM_NUMBER ?? "",
              to: item.recipient,
              ...(callbackUrl ? { statusCallback: callbackUrl } : {}),
            });

            success = !!message.sid;
            externalId = message.sid;
          }
        } else if (item.channel === "email" && item.recipient) {
          const { Resend } = await import("resend");
          const resend = new Resend(process.env.RESEND_API_KEY!);

          const fromEmail =
            process.env.RESEND_FROM_EMAIL ?? "leads@meethenri.com";

          const { data: emailData, error: emailError } = await resend.emails.send({
            from: fromEmail,
            to: item.recipient,
            subject: item.subject ?? "Message from your contractor",
            text: item.body,
          });

          success = !emailError;
          externalId = emailData?.id ?? null;
        } else {
          throw new Error(
            `No valid recipient for channel "${item.channel}"`
          );
        }

        if (success) {
          outreachSent++;
          await supabase
            .from("outreach_queue")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              ...(externalId ? { external_id: externalId } : {}),
            })
            .eq("id", item.id);
        } else {
          throw new Error("Send returned unsuccessful");
        }
      } catch (err) {
        outreachFailed++;
        logger.error("Outreach item failed", { itemId: item.id, error: String(err) });
        await supabase
          .from("outreach_queue")
          .update({ status: "failed" })
          .eq("id", item.id);
      }
    }

    return NextResponse.json({
      success: true,
      sequences: {
        processed: sequenceStats.processed,
        stepsSent: sequenceStats.sent,
        stepsSkipped: sequenceStats.skipped,
        stepErrors: sequenceStats.errors,
      },
      newSequencesStarted,
      outreach: {
        processed: outreachProcessed,
        sent: outreachSent,
        failed: outreachFailed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Follow-ups cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
