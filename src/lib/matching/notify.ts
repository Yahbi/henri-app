import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchCandidate } from "./engine";
import { sendLeadSMS } from "@/lib/twilio/sms";
import { sendLeadEmail } from "@/lib/resend/email";
import type { LeadData } from "@/types/leads";

interface IntakeInfo {
  id: string;
  zip: string;
  trade: string;
  description?: string;
  contact_name?: string;
  budget_range?: string;
  henri_score?: number;
}

/* ── Notify a single matched contractor about a new project request ── */

export async function notifyMatch(
  supabase: SupabaseClient,
  match: MatchCandidate,
  intake: IntakeInfo
): Promise<void> {
  const { contractorId, companyName } = match;
  const { id: intakeId, zip, trade, description } = intake;

  /* 1. Create an in-app notification */
  const { error: notifError } = await supabase.from("notifications").insert({
    user_id: contractorId,
    type: "match",
    title: `New project request: ${trade} in ZIP ${zip}`,
    body: description
      ? `A homeowner needs ${trade} work in ZIP ${zip}. "${description.slice(0, 120)}${description.length > 120 ? "..." : ""}"`
      : `A homeowner needs ${trade} work in ZIP ${zip}. View details and respond to win this project.`,
    read: false,
    metadata: { intake_id: intakeId },
  });

  if (notifError) {
    console.error(`Notification error for contractor ${contractorId}:`, notifError);
  }

  /* 2. Create a quote request so the contractor can respond */
  const { error: quoteError } = await supabase.from("quotes").insert({
    contractor_id: contractorId,
    intake_id: intakeId,
    trade,
    zip,
    description: description ?? `${trade} project in ZIP ${zip}`,
    contact_name: intake.contact_name ?? null,
    status: "requested",
  });

  if (quoteError) {
    console.error(`Quote creation error for contractor ${contractorId}:`, quoteError);
  }

  /* 3. Fetch contractor contact info for external notifications */
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, phone, sms_notifications")
    .eq("id", contractorId)
    .single();

  if (!profile) return;

  const urgency =
    (intake.henri_score ?? 70) >= 80
      ? "hot"
      : (intake.henri_score ?? 70) >= 60
        ? "warm"
        : ("cold" as const);

  const leadData: LeadData = {
    permitType: trade,
    address: `ZIP ${zip}`,
    city: "Los Angeles",
    state: "CA",
    description: description ?? null,
    estimatedValue: null,
    score: intake.henri_score ?? 70,
    urgency,
  };

  const notifications: Promise<unknown>[] = [];

  /* Send SMS if contractor has it enabled */
  if (profile.sms_notifications && profile.phone) {
    notifications.push(sendLeadSMS(profile.phone, leadData));
  }

  /* Send email */
  if (profile.email) {
    notifications.push(sendLeadEmail(profile.email, leadData));
  }

  if (notifications.length > 0) {
    Promise.allSettled(notifications).catch(console.error);
  }
}

/* ── Notify all matched contractors ── */

export async function notifyAllMatches(
  supabase: SupabaseClient,
  matches: MatchCandidate[],
  intake: IntakeInfo
): Promise<void> {
  const tasks = matches.map((match) => notifyMatch(supabase, match, intake));
  await Promise.allSettled(tasks);
}
