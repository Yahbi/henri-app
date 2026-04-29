import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { wasProcessed, markProcessed } from "@/lib/webhooks/idempotency";

/**
 * Verify a Svix-formatted webhook signature (used by Resend).
 *
 * Header format:  `svix-id`, `svix-timestamp`, `svix-signature`
 *   Signature value:  "v1,<base64(hmac_sha256)>" (space-separated list allowed)
 *   Signed payload:   `${svix-id}.${svix-timestamp}.${raw_body}`
 *
 * The secret is stored as `whsec_<base64>` — we strip the prefix and decode.
 */
function verifySvixSignature(
  payload: string,
  headers: Headers,
  secret: string,
): boolean {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject timestamps older than 5 minutes (prevents replay attacks)
  const ts = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBuf = Buffer.from(rawSecret, "base64");

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = createHmac("sha256", keyBuf)
    .update(signedContent)
    .digest("base64");

  // svix-signature header may contain multiple values: "v1,sig1 v1,sig2"
  const sigs = svixSignature.split(" ");
  for (const sig of sigs) {
    const [version, value] = sig.split(",");
    if (version !== "v1" || !value) continue;
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(value);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Resend Webhook Endpoint
 *
 * POST /api/webhooks/resend
 *
 * Receives email delivery events from Resend.
 * Updates outreach_queue with delivery, open, click, and bounce status.
 *
 * Resend event types:
 *   email.sent, email.delivered, email.delivery_delayed,
 *   email.complained, email.bounced, email.opened, email.clicked
 */

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    // Bounce-specific
    bounce?: {
      message: string;
    };
  };
}

export async function POST(request: NextRequest) {
  try {
    // Read the raw body once — JSON parsing happens after signature verify so
    // we can hash the exact bytes Resend signed.
    const rawBody = await request.text();

    // Validate webhook signature if secret is configured
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (webhookSecret) {
      const ok = verifySvixSignature(rawBody, request.headers, webhookSecret);
      if (!ok) {
        logger.warn("Resend webhook signature verification failed");
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    } else if (process.env.NODE_ENV === "production") {
      // Fail closed in production — never accept unsigned webhooks
      logger.error("RESEND_WEBHOOK_SECRET not configured in production");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
    }

    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(rawBody) as ResendWebhookEvent;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const emailId = event.data?.email_id;

    if (!emailId) {
      return NextResponse.json({ error: "Missing email_id" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    // Audit priority #7 (2026-04-28): Svix-shaped idempotency. Resend
    // (via Svix) sends every event with a `svix-id` header that's
    // guaranteed unique per delivery; replays carry the same ID. We
    // dedupe on (svix-id, type) since one email can have multiple
    // distinct events (delivered → opened → clicked).
    const svixId = request.headers.get("svix-id") ?? emailId;
    const idempotencyKey = `${svixId}:${event.type}`;
    const seen = await wasProcessed(supabase, "resend", idempotencyKey);
    if (seen) {
      return NextResponse.json({
        ok: true,
        skipped: "duplicate",
        emailId,
        eventType: event.type,
      });
    }

    const updates: Record<string, unknown> = {};

    switch (event.type) {
      case "email.delivered":
        updates.status = "delivered";
        updates.delivered_at = now;
        break;

      case "email.opened":
        updates.status = "opened";
        updates.opened_at = now;
        break;

      case "email.clicked":
        // Clicked implies opened — update both if opened_at not yet set
        updates.opened_at = now;
        break;

      case "email.bounced":
        updates.status = "bounced";
        updates.bounced_at = now;
        updates.bounce_reason = event.data.bounce?.message ?? "Email bounced";
        break;

      case "email.complained":
        updates.status = "bounced";
        updates.bounced_at = now;
        updates.bounce_reason = "Spam complaint";
        break;

      default:
        // email.sent, email.delivery_delayed — no update needed
        return NextResponse.json({ status: "ok", action: "ignored" });
    }

    // Update outreach_queue by external_id (Resend email ID)
    const { error } = await supabase
      .from("outreach_queue")
      .update(updates)
      .eq("external_id", emailId);

    if (error) {
      logger.error("Resend webhook DB update error", { error: error.message });
    }

    await markProcessed(supabase, "resend", idempotencyKey, {
      event_type: event.type,
      raw_meta: { emailId, type: event.type },
    });

    return NextResponse.json({ status: "ok", emailId, eventType: event.type });
  } catch (err) {
    logger.error("Resend webhook error", { error: String(err) });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
