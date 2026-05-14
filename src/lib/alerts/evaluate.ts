/**
 * Module 14 — alert_rules evaluator.
 *
 * Pure function: input rule + lead → AlertHit | null. No DB calls,
 * no I/O. Composer-style — the caller (score cron, intake handler)
 * fetches enabled rules for the contractor + supplies a lead
 * projection, then iterates `evaluateRule(rule, lead)` to collect
 * hits.
 *
 * Architectural note (per plan §AA.2):
 *   - Territory membership is NOT re-checked here. Upstream callers
 *     only invoke the evaluator on leads they've already routed to
 *     the matching contractor (via the round-robin in the score
 *     cron, or the matched_contractor_id in the intake handler).
 *     Adding a second territory check would couple this module to
 *     the territories table for no real safety gain.
 */

import type {
  AlertRule,
  AlertEvaluationLead,
  AlertHit,
  HighScoreCriteria,
  PermitNoContractorCriteria,
  HomeownerMatchCriteria,
  StageChangeCriteria,
} from "./types";

/* -------------------------------------------------------------------------- */
/*  Public entry points                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Test a single rule against a lead. Returns an `AlertHit` when the
 * rule matches, otherwise null. Disabled rules return null.
 */
export function evaluateRule(
  rule: AlertRule,
  lead: AlertEvaluationLead,
): AlertHit | null {
  if (!rule.enabled) return null;
  if (rule.contractor_id !== lead.contractor_id) return null;

  const matched = matchByKind(rule, lead);
  if (!matched) return null;

  const subject = renderSubject(rule, lead);
  const body = renderBody(rule, lead);
  return { rule, lead, subject, body };
}

/**
 * Test every rule against every lead. Convenience wrapper around
 * `evaluateRule`. Returns hits in the same order as `rules`.
 */
export function evaluateRules(
  rules: AlertRule[],
  leads: AlertEvaluationLead[],
): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const rule of rules) {
    for (const lead of leads) {
      const hit = evaluateRule(rule, lead);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

/* -------------------------------------------------------------------------- */
/*  Per-kind matchers                                                         */
/* -------------------------------------------------------------------------- */

function matchByKind(rule: AlertRule, lead: AlertEvaluationLead): boolean {
  switch (rule.kind) {
    case "high_score":
      return matchHighScore(rule.criteria as HighScoreCriteria, lead);
    case "permit_no_contractor":
      return matchPermitNoContractor(
        rule.criteria as PermitNoContractorCriteria,
        lead,
      );
    case "homeowner_match":
      return matchHomeownerMatch(rule.criteria as HomeownerMatchCriteria, lead);
    case "stage_change":
      return matchStageChange(rule.criteria as StageChangeCriteria, lead);
    default:
      return false;
  }
}

function matchHighScore(c: HighScoreCriteria, lead: AlertEvaluationLead): boolean {
  const threshold = c.min_score ?? 75;
  if (lead.score < threshold) return false;
  if (c.trades && c.trades.length > 0) {
    if (!lead.trade) return false;
    const want = c.trades.map((t) => t.toLowerCase());
    if (!want.includes(lead.trade.toLowerCase())) return false;
  }
  return true;
}

function matchPermitNoContractor(
  c: PermitNoContractorCriteria,
  lead: AlertEvaluationLead,
): boolean {
  // Stage gate — only leads stamped by the classifier as
  // `permit_filed_no_contractor` qualify. The migration 00090 comment
  // says "null zip = all my territories"; we add the stage gate so a
  // hot lead in the right ZIP doesn't fire this rule unless it really
  // is a contractor-less permit.
  if (lead.opportunity_stage !== "permit_filed_no_contractor") return false;
  if (c.zip && c.zip.trim()) {
    if (!lead.zip) return false;
    if (lead.zip !== c.zip) return false;
  }
  return true;
}

function matchHomeownerMatch(
  c: HomeownerMatchCriteria,
  lead: AlertEvaluationLead,
): boolean {
  if (!lead.is_homeowner_intake) return false;
  if (c.trades && c.trades.length > 0) {
    if (!lead.trade) return false;
    const want = c.trades.map((t) => t.toLowerCase());
    if (!want.includes(lead.trade.toLowerCase())) return false;
  }
  return true;
}

function matchStageChange(
  c: StageChangeCriteria,
  lead: AlertEvaluationLead,
): boolean {
  // `to` is the only required field; null/empty means "any
  // transition" which the migration spec doesn't allow but we treat
  // as a no-op (no fire) to avoid spam.
  if (!c.to) return false;
  if (lead.opportunity_stage !== c.to) return false;
  if (c.from && c.from.trim()) {
    if (lead.previous_stage !== c.from) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Subject + body renderers                                                  */
/* -------------------------------------------------------------------------- */

function renderSubject(rule: AlertRule, lead: AlertEvaluationLead): string {
  const addr = lead.address ?? "your territory";
  switch (rule.kind) {
    case "high_score":
      return `New ${lead.score}+ score lead — ${addr}`;
    case "permit_no_contractor":
      return `Permit filed without a contractor — ${addr}`;
    case "homeowner_match":
      return `Homeowner request matches your trade — ${addr}`;
    case "stage_change":
      return `Stage change — ${addr}`;
    default:
      return `New lead alert — ${addr}`;
  }
}

function renderBody(rule: AlertRule, lead: AlertEvaluationLead): string {
  const trade = lead.trade ? `${lead.trade} ` : "";
  const addr = lead.address ?? "an address in your territory";
  const score = lead.score;
  const scope = lead.permit_description ? ` Scope: ${lead.permit_description}.` : "";

  switch (rule.kind) {
    case "high_score":
      return `A new ${trade}lead at ${addr} just scored ${score}/100. Open it in Henri to see the full breakdown and reach out before another contractor watches it.${scope}`;
    case "permit_no_contractor":
      return `A ${trade}permit was filed at ${addr} with no contractor listed yet. The homeowner is still hiring. Open it in Henri.${scope}`;
    case "homeowner_match":
      return `A homeowner submitted a ${trade}project at ${addr} that matches your trade. Score ${score}. Open it in Henri to view the full project + reach out.${scope}`;
    case "stage_change":
      return `A ${trade}lead at ${addr} just moved to ${lead.opportunity_stage}. Score ${score}.${scope}`;
    default:
      return `A new lead is available at ${addr}. Score ${score}.${scope}`;
  }
}
