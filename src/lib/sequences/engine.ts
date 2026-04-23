/* ── Sequence Engine ──────────────────────────────────────────────────────── */
/*  Manages the lifecycle of automated follow-up sequences:                   */
/*    - Starting a sequence for a lead                                        */
/*    - Processing due steps on a cron tick                                   */
/*    - Condition evaluation and variable interpolation                       */
/* ────────────────────────────────────────────────────────────────────────── */

import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate, type SequenceStep } from "./templates";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ProcessingResult {
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
}

interface SequenceRow {
  id: string;
  lead_id: string;
  contractor_id: string;
  sequence_template_id: string;
  current_step: number;
  status: string;
  variables: Record<string, string>;
  steps: SequenceStep[];
  started_at: string;
  created_at: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Interpolation                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Replace `{variable}` tokens in a template string with the corresponding
 * values from the variables map. Unmatched tokens are left as-is.
 */
export function interpolate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Condition Checking                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Evaluate whether a step's condition is satisfied for a given lead.
 *
 * - "always"       -> always true
 * - "no_response"  -> lead status is still "new" (has not advanced)
 * - "no_contact"   -> lead's contacted_at is null
 */
export function checkCondition(
  condition: string | undefined,
  lead: { status?: string; contacted_at?: string | null }
): boolean {
  if (!condition || condition === "always") return true;

  if (condition === "no_response") {
    return lead.status === "new";
  }

  if (condition === "no_contact") {
    return !lead.contacted_at;
  }

  // Unknown condition — fail safe by skipping
  return false;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Start a Sequence                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Start a follow-up sequence for a lead.
 *
 * Creates a `follow_up_sequences` row and, if the first step has delayHours 0,
 * immediately enqueues it into `outreach_queue`.
 *
 * @returns The id of the created sequence row, or null on failure.
 */
export async function startSequence(
  leadId: string,
  contractorId: string,
  templateId: string,
  variables: Record<string, string>
): Promise<string | null> {
  const template = getTemplate(templateId);
  if (!template) {
    console.error(`Sequence template "${templateId}" not found`);
    return null;
  }

  const supabase = createAdminClient();

  // Guard: do not create a duplicate active sequence of the same template for the same lead
  const { count: existing } = await supabase
    .from("follow_up_sequences")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("sequence_template_id", templateId)
    .in("status", ["active", "paused"]);

  if (existing && existing > 0) {
    return null;
  }

  const now = new Date();

  // Insert the sequence row
  const { data: seq, error: seqError } = await supabase
    .from("follow_up_sequences")
    .insert({
      lead_id: leadId,
      contractor_id: contractorId,
      sequence_template_id: templateId,
      name: template.name,
      trigger_status: template.trigger,
      steps: template.steps,
      variables,
      current_step: 0,
      status: "active",
      started_at: now.toISOString(),
    })
    .select("id")
    .single();

  if (seqError || !seq) {
    console.error("Failed to create sequence:", seqError);
    return null;
  }

  // Enqueue the first step if it fires immediately (delayHours === 0)
  const firstStep = template.steps[0];
  if (firstStep && firstStep.delayHours === 0) {
    await enqueueStep({
      sequenceId: seq.id,
      leadId,
      contractorId,
      stepIndex: 0,
      step: firstStep,
      variables,
      baseTime: now,
    });
  }

  return seq.id;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Process Due Steps                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Main cron workhorse. Iterates all active sequences and processes steps
 * whose scheduled time has arrived.
 */
export async function processDueSteps(): Promise<ProcessingResult> {
  const supabase = createAdminClient();
  const result: ProcessingResult = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  // Fetch all active sequences
  const { data: sequences, error: seqError } = await supabase
    .from("follow_up_sequences")
    .select("id, lead_id, contractor_id, sequence_template_id, current_step, status, variables, steps, started_at, created_at")
    .eq("status", "active");

  if (seqError) {
    console.error("Failed to fetch active sequences:", seqError);
    return result;
  }

  if (!sequences || sequences.length === 0) return result;

  const now = new Date();

  for (const seq of sequences as SequenceRow[]) {
    result.processed++;

    const steps = seq.steps as SequenceStep[];
    if (!Array.isArray(steps) || steps.length === 0) {
      // Invalid sequence — mark completed
      await updateSequenceStatus(supabase, seq.id, "completed");
      continue;
    }

    const currentIndex = seq.current_step ?? 0;

    // All steps done?
    if (currentIndex >= steps.length) {
      await updateSequenceStatus(supabase, seq.id, "completed");
      continue;
    }

    const currentStep = steps[currentIndex];

    // Calculate when this step is due
    const scheduledAt = computeStepTime(seq.started_at, steps, currentIndex);
    if (now < scheduledAt) {
      // Not due yet
      continue;
    }

    // Fetch the lead to check conditions
    const { data: lead } = await supabase
      .from("leads")
      .select("id, status, contacted_at, owner_name, owner_first, address, city, trade, phone, email")
      .eq("id", seq.lead_id)
      .single();

    if (!lead) {
      console.error(`Lead ${seq.lead_id} not found for sequence ${seq.id}`);
      result.errors++;
      await updateSequenceStatus(supabase, seq.id, "cancelled");
      continue;
    }

    // Check the step condition
    const conditionMet = checkCondition(currentStep.condition, lead);

    if (!conditionMet) {
      // Lead progressed — mark sequence as completed early
      await updateSequenceStatus(supabase, seq.id, "completed_early");
      result.skipped++;
      continue;
    }

    // Determine recipient
    const recipient =
      currentStep.channel === "sms"
        ? lead.phone ?? null
        : lead.email ?? null;

    if (!recipient) {
      // No valid contact for this channel — skip this step, advance
      result.skipped++;
      const nextIndex = currentIndex + 1;
      if (nextIndex >= steps.length) {
        await updateSequenceStatus(supabase, seq.id, "completed");
      } else {
        await supabase
          .from("follow_up_sequences")
          .update({ current_step: nextIndex })
          .eq("id", seq.id);
      }
      continue;
    }

    // Build the variables map (merge saved variables with fresh lead data)
    const vars: Record<string, string> = {
      ...seq.variables,
      name: lead.owner_first ?? lead.owner_name ?? "there",
      address: lead.address ?? "",
      city: lead.city ?? "",
      trade: lead.trade ?? "construction",
    };

    // Enqueue the outreach item
    const enqueued = await enqueueStep({
      sequenceId: seq.id,
      leadId: seq.lead_id,
      contractorId: seq.contractor_id,
      stepIndex: currentIndex,
      step: currentStep,
      variables: vars,
      baseTime: now,
      sendImmediately: true,
    });

    if (enqueued) {
      result.sent++;

      // Advance the step counter
      const nextIndex = currentIndex + 1;
      if (nextIndex >= steps.length) {
        await updateSequenceStatus(supabase, seq.id, "completed");
      } else {
        await supabase
          .from("follow_up_sequences")
          .update({ current_step: nextIndex })
          .eq("id", seq.id);
      }
    } else {
      result.errors++;
    }
  }

  return result;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Cancel a Sequence                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Cancel an active sequence and all its pending outreach items.
 */
export async function cancelSequence(sequenceId: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { error: seqErr } = await supabase
    .from("follow_up_sequences")
    .update({ status: "cancelled" })
    .eq("id", sequenceId);

  if (seqErr) {
    console.error("Failed to cancel sequence:", seqErr);
    return false;
  }

  // Cancel all pending outreach items for this sequence
  await supabase
    .from("outreach_queue")
    .update({ status: "cancelled" })
    .eq("sequence_id", sequenceId)
    .eq("status", "queued");

  return true;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

interface EnqueueParams {
  sequenceId: string;
  leadId: string;
  contractorId: string;
  stepIndex: number;
  step: SequenceStep;
  variables: Record<string, string>;
  baseTime: Date;
  /** When true, scheduled_for is set to now (for steps processed in cron). */
  sendImmediately?: boolean;
}

async function enqueueStep(params: EnqueueParams): Promise<boolean> {
  const {
    sequenceId,
    leadId,
    contractorId,
    stepIndex,
    step,
    variables,
    baseTime,
    sendImmediately,
  } = params;

  const supabase = createAdminClient();

  const body = interpolate(step.template, variables);
  const subject = step.subject ? interpolate(step.subject, variables) : null;

  // Determine the recipient from variables
  const recipient =
    step.channel === "sms" ? variables.phone ?? "" : variables.email ?? "";

  const scheduledFor = sendImmediately
    ? new Date().toISOString()
    : new Date(
        baseTime.getTime() + step.delayHours * 60 * 60 * 1000
      ).toISOString();

  const { error } = await supabase.from("outreach_queue").insert({
    lead_id: leadId,
    contractor_id: contractorId,
    sequence_id: sequenceId,
    step_index: stepIndex,
    channel: step.channel,
    recipient,
    subject,
    body,
    status: "queued",
    scheduled_for: scheduledFor,
  });

  if (error) {
    console.error(
      `Failed to enqueue step ${stepIndex} for sequence ${sequenceId}:`,
      error
    );
    return false;
  }

  return true;
}

/**
 * Compute the absolute time a step is due based on the sequence start time
 * and the cumulative delay of all preceding steps.
 *
 * Step 0 fires at start + step[0].delayHours.
 * Step 1 fires at start + step[0].delayHours + step[1].delayHours.
 * etc.
 */
function computeStepTime(
  startedAt: string,
  steps: SequenceStep[],
  targetIndex: number
): Date {
  const start = new Date(startedAt);
  let totalHours = 0;
  for (let i = 0; i <= targetIndex; i++) {
    totalHours += steps[i].delayHours;
  }
  return new Date(start.getTime() + totalHours * 60 * 60 * 1000);
}

async function updateSequenceStatus(
  supabase: ReturnType<typeof createAdminClient>,
  sequenceId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from("follow_up_sequences")
    .update({ status })
    .eq("id", sequenceId);

  if (error) {
    console.error(
      `Failed to update sequence ${sequenceId} to "${status}":`,
      error
    );
  }
}
