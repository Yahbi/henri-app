import { NextRequest, NextResponse } from "next/server";
import Twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * Twilio Status Callback Webhook
 *
 * POST /api/webhooks/twilio
 *
 * Receives delivery status updates for SMS messages sent through Henri.
 * Updates the outreach_queue table with delivery, read, and failure status.
 *
 * Twilio status progression: queued → sent → delivered → read
 * Error statuses: failed, undelivered
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the form-encoded body
    const formData = await request.formData();
    const messageSid = formData.get("MessageSid") as string | null;
    const messageStatus = formData.get("MessageStatus") as string | null;
    const errorCode = formData.get("ErrorCode") as string | null;

    if (!messageSid || !messageStatus) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate Twilio signature
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = request.headers.get("x-twilio-signature") ?? "";
      const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`;

      // Build params object from form data
      const params: Record<string, string> = {};
      formData.forEach((value, key) => {
        params[key] = String(value);
      });

      const isValid = Twilio.validateRequest(authToken, signature, url, params);
      if (!isValid) {
        logger.error("Twilio webhook invalid signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    // Map Twilio status to our tracking columns
    const updates: Record<string, unknown> = {};

    switch (messageStatus) {
      case "delivered":
        updates.status = "delivered";
        updates.delivered_at = now;
        break;
      case "read":
        updates.status = "opened";
        updates.opened_at = now;
        // Also set delivered_at if not already set
        updates.delivered_at = now;
        break;
      case "failed":
      case "undelivered":
        updates.status = "failed";
        updates.bounce_reason = errorCode ? `Twilio error ${errorCode}` : "Delivery failed";
        updates.bounced_at = now;
        break;
      default:
        // queued, sent, sending — no update needed, we already track "sent"
        return NextResponse.json({ status: "ok", action: "ignored" });
    }

    // Update the outreach_queue row by external_id (message SID)
    const { error } = await supabase
      .from("outreach_queue")
      .update(updates)
      .eq("external_id", messageSid);

    if (error) {
      logger.error("Twilio webhook DB update error", { error: error.message });
    }

    return NextResponse.json({ status: "ok", messageSid, messageStatus });
  } catch (err) {
    logger.error("Twilio webhook error", { error: String(err) });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
