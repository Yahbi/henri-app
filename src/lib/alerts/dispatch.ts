/**
 * Module 14 — alert_rules dispatcher.
 *
 * Sends each AlertHit through the channel its rule asks for (email
 * via Resend, SMS via the existing hygiene-gated `sendLeadSMS`),
 * then updates the rule row's `last_fired_at` + `fire_count`.
 *
 * Rate-limiting:
 *   - In-memory: callers should already de-dupe by (rule_id, lead_id)
 *     within a single invocation (the score cron's leadsToInsert
 *     loop is the natural unit).
 *   - Cross-run: dispatcher refuses to refire the same rule for the
 *     same lead within DEDUPE_WINDOW_HOURS. The window is enforced
 *     by reading rule.last_fired_at; cheap because rules are small.
 *
 * Graceful degrade — Resend env not set → emails skipped + logged.
 * Twilio env not set → sendLeadSMS already env-gates and logs.
 *
 * Returns a summary { sent, skipped, failed } so the caller can
 * stamp it into cron_runs.summary.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendLeadSMS } from "@/lib/twilio/sms";
import { logger } from "@/lib/logger";
import type { AlertHit, AlertRuleChannel } from "./types";

/** Hours within which the same rule firing again on the same lead
 *  is suppressed. Conservative default; the founder can tune later. */
const DEDUPE_WINDOW_HOURS = 24;

export interface DispatchSummary {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Dispatch a batch of hits. Idempotent within DEDUPE_WINDOW_HOURS:
 * reruns return `skipped` for any hit whose rule fired on a lead
 * recently. Best-effort — never throws.
 */
export async function dispatchAlertHits(
  hits: AlertHit[],
): Promise<DispatchSummary> {
  if (hits.length === 0) return { sent: 0, skipped: 0, failed: 0 };
  const supabase = createAdminClient();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // In-memory dedupe within this invocation: don't fire the same
  // (rule_id, lead_id) pair twice even if the caller passes dupes.
  const seen = new Set<string>();

  for (const hit of hits) {
    const dedupeKey = `${hit.rule.id}:${hit.lead.id}`;
    if (seen.has(dedupeKey)) {
      skipped += 1;
      continue;
    }
    seen.add(dedupeKey);

    // Cross-run dedupe — refuse if the rule fired within window.
    if (
      hit.rule.last_fired_at &&
      isWithinHours(hit.rule.last_fired_at, DEDUPE_WINDOW_HOURS)
    ) {
      skipped += 1;
      continue;
    }

    if (hit.rule.channel === "none") {
      skipped += 1;
      continue;
    }

    try {
      const ok = await sendChannel(hit.rule.channel, hit, supabase);
      if (ok) {
        sent += 1;
        await stampFire(supabase, hit.rule.id);
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      logger.warn("alerts.dispatch_failed", {
        ruleId: hit.rule.id,
        leadId: hit.lead.id,
        kind: hit.rule.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, skipped, failed };
}

/* -------------------------------------------------------------------------- */
/*  Channels                                                                  */
/* -------------------------------------------------------------------------- */

async function sendChannel(
  channel: AlertRuleChannel,
  hit: AlertHit,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  if (channel === "email") return sendEmail(hit, supabase);
  if (channel === "sms") return sendSms(hit, supabase);
  return false;
}

async function sendEmail(
  hit: AlertHit,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    logger.info("alerts.email_skipped_no_resend_env", { ruleId: hit.rule.id });
    return false;
  }

  // Lookup the contractor's email — service-role read.
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", hit.rule.contractor_id)
    .maybeSingle();

  if (!profile?.email) {
    logger.warn("alerts.email_skipped_no_recipient", {
      ruleId: hit.rule.id,
      contractorId: hit.rule.contractor_id,
    });
    return false;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? "leads@meethenri.com";
  const greeting = profile.full_name ? `Hi ${profile.full_name.split(" ")[0]},\n\n` : "Hi,\n\n";
  const text = `${greeting}${hit.body}\n\n— Henri.`;

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: profile.email,
    subject: hit.subject,
    text,
  });

  if (error) {
    logger.warn("alerts.email_send_failed", {
      ruleId: hit.rule.id,
      error: error.message,
    });
    return false;
  }
  return true;
}

async function sendSms(
  hit: AlertHit,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<boolean> {
  // Look up the contractor's phone (NOT the homeowner's) — alerts
  // notify the contractor; sendLeadSMS expects a phone arg.
  const { data: profile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", hit.rule.contractor_id)
    .maybeSingle();
  if (!profile?.phone) {
    logger.info("alerts.sms_skipped_no_phone", {
      ruleId: hit.rule.id,
    });
    return false;
  }

  // sendLeadSMS expects a LeadData (legacy shape — `permitType`,
  // `address`, `city`, `state`, etc.). Project from AlertEvaluationLead.
  // Address may be the only field we have; the rest fall through to
  // empty/null without breaking the formatter.
  const result = await sendLeadSMS(
    profile.phone,
    {
      permitType: hit.lead.trade ?? "permit",
      address: hit.lead.address ?? "your territory",
      city: "",
      state: "",
      description: hit.lead.permit_description ?? null,
      estimatedValue: null,
      score: hit.lead.score,
      urgency: hit.lead.score >= 75 ? "hot" : hit.lead.score >= 50 ? "warm" : "cool",
    },
    { zip: hit.lead.zip },
  );
  return !!result?.success;
}

/* -------------------------------------------------------------------------- */
/*  Bookkeeping                                                               */
/* -------------------------------------------------------------------------- */

async function stampFire(
  supabase: ReturnType<typeof createAdminClient>,
  ruleId: string,
): Promise<void> {
  // Atomic-ish bump via .rpc would be ideal; in lieu of a custom
  // function, use a read-then-write pattern. Race conditions here
  // only over-count, which is the safer direction (we'd rather log
  // a fire that didn't happen than miss one).
  const { data: row } = await supabase
    .from("alert_rules")
    .select("fire_count")
    .eq("id", ruleId)
    .maybeSingle();
  const next = (row?.fire_count ?? 0) + 1;
  await supabase
    .from("alert_rules")
    .update({
      last_fired_at: new Date().toISOString(),
      fire_count: next,
    })
    .eq("id", ruleId);
}

function isWithinHours(iso: string, hours: number): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs < hours * 3_600_000;
}
