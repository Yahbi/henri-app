import Twilio from "twilio";
import { logger } from "@/lib/logger";
import type { LeadData } from "@/types/leads";

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

export async function sendLeadSMS(
  to: string,
  leadData: LeadData
): Promise<{ success: boolean; messageId: string | null }> {
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
