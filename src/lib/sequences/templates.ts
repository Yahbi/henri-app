/* ── Follow-Up Sequence Templates ─────────────────────────────────────────── */
/*  Data-driven definitions for automated outreach sequences.                 */
/*  Each template is a series of timed steps sent on behalf of a contractor.  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SequenceStep {
  /** Hours after the previous step (or after the trigger for step 0). */
  delayHours: number;
  channel: "sms" | "email";
  /** Email subject line. Ignored for SMS. */
  subject?: string;
  /** Message body with {variable} placeholders. */
  template: string;
  /**
   * Condition that must be true for this step to fire:
   *  - "no_response" — lead status has not advanced past its initial value
   *  - "no_contact"  — lead has never been contacted (contacted_at is null)
   *  - "always"      — send regardless (default)
   */
  condition?: "no_response" | "no_contact" | "always";
}

export type SequenceTrigger =
  | "new_lead"
  | "quote_sent"
  | "no_response_48h"
  | "won_followup";

export interface SequenceTemplate {
  id: string;
  name: string;
  trigger: SequenceTrigger;
  steps: SequenceStep[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  1. New Lead Nurture                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const newLeadNurture: SequenceTemplate = {
  id: "new_lead_nurture",
  name: "New Lead Nurture",
  trigger: "new_lead",
  steps: [
    {
      delayHours: 0,
      channel: "sms",
      condition: "always",
      template:
        "Hi, this is {company}. We noticed a recent {trade} project at {address}. " +
        "We'd love to offer a free estimate. Reply YES or call us at {phone}.",
    },
    {
      delayHours: 24,
      channel: "email",
      condition: "no_response",
      subject: "Free {trade} Estimate for {address}",
      template:
        "Hello,\n\n" +
        "We noticed a {trade} permit was recently filed for {address}, and we wanted to reach out.\n\n" +
        "{company} specializes in {trade} work across the {city} area, and we would be happy to " +
        "provide a complimentary on-site inspection and detailed estimate at no cost to you.\n\n" +
        "Our team is available this week and can work around your schedule. Simply reply to this email " +
        "or give us a call at {phone} to set up a convenient time.\n\n" +
        "We look forward to hearing from you.\n\n" +
        "Best regards,\n{company}",
    },
    {
      delayHours: 72,
      channel: "sms",
      condition: "no_response",
      template:
        "Just following up on the {trade} project at {address}. We have availability this week " +
        "for a free assessment. Would you like to schedule a visit?",
    },
    {
      delayHours: 168,
      channel: "email",
      condition: "no_response",
      subject: "Last chance: Free {trade} assessment",
      template:
        "Hello,\n\n" +
        "We reached out a few days ago about the {trade} project at {address} and wanted to " +
        "follow up one last time.\n\n" +
        "We understand schedules get busy. If you are still considering the project, our offer " +
        "for a free on-site assessment stands. We have helped many homeowners in {city} with " +
        "similar {trade} work and would love the opportunity to earn your business.\n\n" +
        "Feel free to reach out anytime at {phone} or reply to this email.\n\n" +
        "All the best,\n{company}",
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  2. Quote Follow-Up                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const quoteFollowUp: SequenceTemplate = {
  id: "quote_follow_up",
  name: "Quote Follow-Up",
  trigger: "quote_sent",
  steps: [
    {
      delayHours: 24,
      channel: "sms",
      condition: "always",
      template:
        "Hi {name}, just wanted to make sure you received our estimate for the {trade} work " +
        "at {address}. If you have any questions at all, feel free to reply here or call {phone}.",
    },
    {
      delayHours: 72,
      channel: "email",
      condition: "no_response",
      subject: "Your {trade} estimate -- valid for 14 days",
      template:
        "Hello {name},\n\n" +
        "Thank you for considering {company} for your {trade} project at {address}.\n\n" +
        "We wanted to let you know that the estimate we sent is valid for 14 days. It includes " +
        "a detailed breakdown of materials, labor, and timeline so you can make an informed decision.\n\n" +
        "If you would like to discuss the scope, explore different options, or schedule a start date, " +
        "we are happy to help. Just reply to this email or call us at {phone}.\n\n" +
        "Thank you,\n{company}",
    },
    {
      delayHours: 168,
      channel: "sms",
      condition: "no_response",
      template:
        "Quick reminder -- your {trade} estimate for {address} expires soon. We would love to get " +
        "started on your project. Let us know if you have any questions.",
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  3. Win Celebration                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const winCelebration: SequenceTemplate = {
  id: "win_celebration",
  name: "Win Celebration",
  trigger: "won_followup",
  steps: [
    {
      delayHours: 0,
      channel: "sms",
      condition: "always",
      template:
        "Great news! We are excited to work on your {trade} project at {address}. " +
        "Our team will be in touch shortly to schedule the work. Thank you for choosing {company}.",
    },
    {
      delayHours: 720,
      channel: "email",
      condition: "always",
      subject: "How is your {trade} project going?",
      template:
        "Hello {name},\n\n" +
        "It has been about a month since we started the {trade} work at {address}, " +
        "and we wanted to check in.\n\n" +
        "Your satisfaction is our top priority. If everything looks great, we would truly appreciate " +
        "a brief review -- it helps other homeowners in {city} find quality contractors.\n\n" +
        "And if there is anything that needs attention, please do not hesitate to reach out at {phone}. " +
        "We stand behind our work.\n\n" +
        "Thank you,\n{company}",
    },
    {
      delayHours: 2160,
      channel: "sms",
      condition: "always",
      template:
        "Hi {name}, it has been a few months since your {trade} project at {address}. " +
        "If you need any follow-up work or have a new project in mind, we are here for you. -- {company}",
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  4. Re-engagement (No Response 48h)                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const reEngagement: SequenceTemplate = {
  id: "re_engagement",
  name: "Re-engagement",
  trigger: "no_response_48h",
  steps: [
    {
      delayHours: 0,
      channel: "email",
      condition: "always",
      subject: "Still available for your {trade} project at {address}",
      template:
        "Hello,\n\n" +
        "We reached out recently about the {trade} project at {address} and have not heard back yet. " +
        "We completely understand -- these decisions take time.\n\n" +
        "We are still available and would be happy to provide a free, no-obligation estimate at " +
        "your convenience. Whether you have questions about the process, timeline, or cost, " +
        "our team is here to help.\n\n" +
        "Give us a call at {phone} or simply reply to this email.\n\n" +
        "Warm regards,\n{company}",
    },
    {
      delayHours: 96,
      channel: "sms",
      condition: "no_response",
      template:
        "Last follow-up: We still have availability for your {trade} project at {address}. " +
        "Spots are filling up this month. Reply or call {phone} to schedule a free estimate. -- {company}",
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Exports                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
  newLeadNurture,
  quoteFollowUp,
  winCelebration,
  reEngagement,
];

/** Look up a template by its id. */
export function getTemplate(id: string): SequenceTemplate | undefined {
  return SEQUENCE_TEMPLATES.find((t) => t.id === id);
}

/** Look up all templates for a given trigger. */
export function getTemplatesForTrigger(
  trigger: SequenceTrigger
): SequenceTemplate[] {
  return SEQUENCE_TEMPLATES.filter((t) => t.trigger === trigger);
}
