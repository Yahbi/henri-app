import Twilio from "twilio";
import { logger } from "@/lib/logger";
import type { LeadData } from "@/types/leads";
import { checkOutreachAllowed } from "@/lib/outreach/hygiene";

function getTwilioClient() {
  return Twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
  );
}

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER ?? "";

function formatLeadMessage(leadData: LeadData): string {
  const value = leadData.estimatedValue
    ? `$${leadData.estimatedValue.toLocaleString()}`
    : "N/A";

  const urgencyLabel =
    leadData.urgency === "hot"
      ? "HOT"
      : leadData.urgency === "warm"
        ? "WARM"
        : "NEW";

  return [
    `[Henri] ${urgencyLabel} Lead Alert!`,
    `Type: ${leadData.permitType}`,
    `Location: ${leadData.address}, ${leadData.city}, ${leadData.state}`,
    `Est. Value: ${value}`,
    `Score: ${leadData.score}/100`,
    leadData.description ? `Details: ${leadData.description.slice(0, 100)}` : "",
    `View in Henri: ${process.env.NEXT_PUBLIC_APP_URL}/dashboard/leads`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Module 7 wiring — `checkOutreachAllowed()` is now invoked before every
 * SMS send. Three gates fire in sequence: suppression (homeowner intake
 * withdrawn), consent (intake.consent_given_at NULL), and quiet-hours
 * (8am-9pm in lead's local timezone).
 *
 * Refusals return `{ success: false, refusedReason }` and are logged at
 * info level — caller can decide whether to bubble or swallow.
 */
export interface SendLeadSMSOptions {
  /** When the SMS targets a homeowner-intake-derived lead, pass the intake
   *  id so the hygiene gate can verify consent + withdraw status.
   *  Permit-derived leads (no intake) pass null. */
  homeownerIntakeId?: string | null;
  /** Lead ZIP — used by the quiet-hours gate to infer local timezone.
   *  When omitted, falls back to America/New_York. */
  zip?: string | null;
}

export async function sendLeadSMS(
  to: string,
  leadData: LeadData,
  opts: SendLeadSMSOptions = {},
): Promise<{ success: boolean; messageId: string | null; refusedReason?: string }> {
  // ── Module 7 hygiene gate ────────────────────────────────────────
  const decision = await checkOutreachAllowed({
    channel: "sms",
    homeowner_intake_id: opts.homeownerIntakeId ?? null,
    zip: opts.zip ?? leadData?.state ?? null,  // best-effort fallback to state
  });
  if (!decision.allowed) {
    logger.info("sendLeadSMS refused by hygiene gate", {
      to: to.replace(/\d/g, "*"), // mask phone in logs
      reason: decision.reason,
      detail: decision.detail,
    });
    return {
      success: false,
      messageId: null,
      refusedReason: decision.reason,
    };
  }

  try {
    const client = getTwilioClient();
    const message = await client.messages.create({
      body: formatLeadMessage(leadData),
      from: FROM_NUMBER,
      to,
    });

    return { success: true, messageId: message.sid };
  } catch (error) {
    logger.error("Twilio SMS error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, messageId: null };
  }
}
