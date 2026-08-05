import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { personalizeOutreach } from "@/lib/agents/outreach-personalizer";
import { getMiningLlmClient } from "@/lib/predictive/openai-client";
import { MessageSendBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";
import type { Lead } from "@/types/lead";

/**
 * POST /api/messages/send
 * Body: { lead_id: string, channel: "sms"|"email", body: string, subject?: string }
 *
 * Sends a one-off outbound message to a lead. SMS via Twilio, email via
 * Resend. Appends a `[out]` entry to the lead's `notes` so the
 * /dashboard/messages thread reflects the new message (notes are still
 * the chat log until the `messages` table migration lands).
 *
 * Graceful degradation: if the provider env vars aren't set, the message
 * is still logged to notes so the UI shows activity, but ok=false and
 * provider_error is surfaced so the contractor knows it didn't leave
 * our system.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json().catch(() => null);
    const parsed = parseBody(MessageSendBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { lead_id: leadId, channel, body: text, subject } = parsed.data;

    const { data: lead } = await supabase
      .from("leads")
      .select(
        "id, phone, email, owner_name, notes, trade, permit_type, permit_description, permit_value, year_built, address, city, state, zip",
      )
      .eq("id", leadId)
      .eq("contractor_id", user.id)
      .single();
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Phase 2.2: Outreach Agent personalization. If LLM_OUTREACH_ENABLED=1
    // we rewrite the first sentence to reference permit-specific context
    // (scope, value, neighborhood, age). Fails closed — any LLM error
    // sends the original template verbatim. Wedge contract bullet #5
    // (speed-to-lead) preserved via 800ms timeout.
    let outreachSource: "llm" | "template-fallback" = "template-fallback";
    let textToSend = text;
    if (process.env.LLM_OUTREACH_ENABLED === "1") {
      const personalized = await personalizeOutreach(
        {
          template: text,
          lead: lead as unknown as Lead,
          channel: channel as "sms" | "email",
          budgetMs: 800,
        },
        // Reuse the mining client — same OpenAI instance, different prompt.
        getMiningLlmClient(),
      );
      textToSend = personalized.body;
      outreachSource = personalized.source;
    }

    let providerOk = false;
    let providerError: string | null = null;

    if (channel === "sms") {
      if (!lead.phone) {
        return NextResponse.json(
          { error: "Lead has no phone number on file" },
          { status: 400 },
        );
      }
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_FROM_NUMBER;
      if (!sid || !token || !from) {
        providerError = "Twilio not configured (TWILIO_ACCOUNT_SID / AUTH_TOKEN / FROM_NUMBER)";
      } else {
        try {
          const auth = Buffer.from(`${sid}:${token}`).toString("base64");
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                From: from,
                To: String(lead.phone),
                Body: textToSend,
              }).toString(),
            },
          );
          providerOk = res.ok;
          if (!res.ok) {
            logApiError("messages.send.twilio", {
              status: res.status,
              body: (await res.text().catch(() => "")).slice(0, 300),
            });
            providerError = "SMS provider rejected the message";
          }
        } catch (e) {
          logApiError("messages.send.twilio", e);
          providerError = "SMS provider unreachable";
        }
      }
    } else {
      // email
      if (!lead.email) {
        return NextResponse.json(
          { error: "Lead has no email on file" },
          { status: 400 },
        );
      }
      const resendKey = process.env.RESEND_API_KEY;
      const fromAddr = process.env.RESEND_FROM_EMAIL ?? "henri@meethenri.com";
      if (!resendKey) {
        providerError = "RESEND_API_KEY not configured";
      } else {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromAddr,
              to: [lead.email],
              subject: subject ?? "Message from your contractor",
              text: textToSend,
              /* 2026-04-30 canonical email policy: homeowner replies
               * route to support@meethenri.com — the monitored inbox —
               * instead of bouncing off henri@ unmonitored. The platform
               * is the broker; replies route to support and we forward
               * to the right contractor inbox. */
              reply_to: ["support@meethenri.com"],
            }),
          });
          providerOk = res.ok;
          if (!res.ok) {
            logApiError("messages.send.resend", {
              status: res.status,
              body: (await res.text().catch(() => "")).slice(0, 300),
            });
            providerError = "Email provider rejected the message";
          }
        } catch (e) {
          logApiError("messages.send.resend", e);
          providerError = "Email provider unreachable";
        }
      }
    }

    // Always log to notes so the UI reflects activity even when provider
    // is down. Prefix with [out channel YYYY-MM-DD] for regex parsers.
    const now = new Date().toISOString();
    // Log the ACTUAL sent text (post-personalization) so the contractor
    // can see what the homeowner received, not the original template.
    const entry = `[out ${channel} ${now.slice(0, 10)}${outreachSource === "llm" ? " AI" : ""}] ${textToSend}`;
    const joined = lead.notes ? `${lead.notes}\n${entry}` : entry;
    await supabase
      .from("leads")
      .update({ notes: joined })
      .eq("id", leadId)
      .eq("contractor_id", user.id);

    return NextResponse.json({
      ok: providerOk,
      channel,
      provider_error: providerError,
      logged_to_notes: true,
    });
  } catch (error) {
    logApiError("messages.send", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
