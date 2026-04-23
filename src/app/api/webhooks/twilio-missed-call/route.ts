import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { createHmac } from "crypto";

/**
 * /api/webhooks/twilio-missed-call — Phase 0a wedge #6 (speed-to-lead).
 *
 * Twilio posts here when a call to a contractor's tracked number goes
 * unanswered or is missed.
 */

export const runtime = "nodejs";

/**
 * Validate a Twilio webhook signature.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map((k) => `${k}${params[k]}`).join("");
  const expected = createHmac("sha1", authToken)
    .update(url + paramStr)
    .digest("base64");
  return expected === signature;
}

interface TwilioWebhookBody {
  CallSid?: string;
  From?: string;
  To?: string;
  CallStatus?: string;     // 'no-answer' | 'busy' | 'failed' | 'canceled' | 'completed'
  CallDuration?: string;
  Direction?: string;
  Timestamp?: string;
}

// Parse Twilio's form-urlencoded webhook body into a typed object.
async function parseTwilioBody(request: NextRequest): Promise<TwilioWebhookBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as TwilioWebhookBody;
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out as TwilioWebhookBody;
}

export async function POST(request: NextRequest) {
  // Verify Twilio signature when auth token is configured.
  if (process.env.TWILIO_AUTH_TOKEN) {
    const signature = request.headers.get("x-twilio-signature") ?? "";
    const url = request.url;
    // Clone to read body for signature validation before parsing
    const rawText = await request.clone().text();
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(rawText)) params[k] = v;
    if (!validateTwilioSignature(process.env.TWILIO_AUTH_TOKEN, signature, url, params)) {
      logger.warn("twilio-missed-call: invalid signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  try {
    const body = await parseTwilioBody(request);

    // Gate: only act on missed / unanswered call statuses.
    const status = (body.CallStatus ?? "").toLowerCase();
    const isMissed = ["no-answer", "busy", "failed", "canceled"].includes(status);

    // Find the contractor whose tracked number was called (body.To).
    const admin = createAdminClient();
    let contractorId: string | null = null;
    try {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("twilio_tracked_number", body.To ?? "")
        .maybeSingle();
      contractorId = data?.id ?? null;
    } catch (e) {
      // Column may not exist yet — fall back to null. Not a fatal.
      logger.warn("twilio-missed-call: tracked-number lookup failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }

    // Record the event (best-effort — swallow table-missing).
    let eventId: string | null = null;
    let autoReplySent = false;
    if (contractorId) {
      try {
        const { data: event, error } = await admin
          .from("missed_call_events")
          .insert({
            contractor_id: contractorId,
            caller_number: body.From ?? null,
            received_at: new Date().toISOString(),
            raw_webhook_json: body as unknown as Record<string, unknown>,
          })
          .select("id")
          .single();
        if (!error && event) eventId = event.id;
        else if (error) logger.warn("missed_call_events insert failed", { message: error.message });
      } catch (e) {
        logger.warn("missed_call_events insert threw", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Auto-reply SMS (Twilio) — gated on env keys + a missed call.
    // No Twilio keys in .env.local today, so this path no-ops cleanly.
    if (
      isMissed &&
      body.From &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
    ) {
      try {
        const replyText =
          "Hi \u2014 sorry we missed you. This is Henri.\u202f" +
          "We'll text you back with a time to talk in the next few minutes.";
        const params = new URLSearchParams();
        params.set("From", process.env.TWILIO_FROM_NUMBER);
        params.set("To", body.From);
        params.set("Body", replyText);
        const auth = Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
        ).toString("base64");
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          },
        );
        if (res.ok) {
          autoReplySent = true;
          if (eventId) {
            await admin
              .from("missed_call_events")
              .update({ auto_reply_sent: true, reply_text: replyText })
              .eq("id", eventId);
          }
        } else {
          logger.warn("twilio auto-reply failed", { status: res.status });
        }
      } catch (e) {
        logger.warn("twilio auto-reply threw", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      recorded: !!eventId,
      auto_reply_sent: autoReplySent,
      reason: !contractorId
        ? "no matching contractor for 'To' number"
        : !isMissed
          ? `not a missed call (status=${status || "unknown"})`
          : !process.env.TWILIO_ACCOUNT_SID
            ? "Twilio env keys missing \u2014 recorded only"
            : "processed",
    });
  } catch (err) {
    logger.error("twilio-missed-call webhook failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    // Return 200 so Twilio doesn't retry the webhook 7 times for a
    // transient internal error. Our log captures the issue.
    return NextResponse.json({ ok: false, recorded: false, auto_reply_sent: false });
  }
}

// Twilio sometimes probes with GET first. Respond 200 so the console
// "URL test" shows green.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "twilio-missed-call" });
}
