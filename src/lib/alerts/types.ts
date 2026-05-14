/**
 * Module 14 — alert_rules type model.
 *
 * Schema source: supabase/migrations/00090_saved_hidden_alerts_calibration.sql
 * (table at line 136, comment block at line 142 documents the four
 * allowed kinds + criteria-jsonb shapes).
 *
 * The DB column `criteria` is jsonb-typed; this module gives it real
 * TypeScript so the evaluator can pattern-match per-kind without
 * hand-rolled string-key checks. Adding a new rule kind goes:
 *   1. Add to AlertRuleKind union
 *   2. Add a Criteria<Kind> shape
 *   3. Add a matcher in evaluate.ts
 *   4. Add a fixture test
 */

export type AlertRuleKind =
  | "high_score"
  | "permit_no_contractor"
  | "homeowner_match"
  | "stage_change";

export type AlertRuleChannel = "email" | "sms" | "none";

/** Criteria shape per kind — matches the comment block in migration 00090.
 *  All fields optional so partially-filled rules still compile; the
 *  matcher in evaluate.ts treats missing fields as "no constraint". */
export interface HighScoreCriteria {
  /** Numeric threshold; lead.score must be >= this. Default 75. */
  min_score?: number;
  /** Optional trade allowlist; null/empty = all trades. */
  trades?: string[] | null;
}

export interface PermitNoContractorCriteria {
  /** Optional ZIP allowlist; null = any ZIP in contractor's territories. */
  zip?: string | null;
}

export interface HomeownerMatchCriteria {
  /** Optional trade allowlist; null/empty = any trade. */
  trades?: string[] | null;
}

export interface StageChangeCriteria {
  /** Stage the lead was in. Optional — null/empty = any source stage. */
  from?: string | null;
  /** Stage the lead transitioned INTO. Required. */
  to?: string | null;
}

export type AlertCriteria =
  | HighScoreCriteria
  | PermitNoContractorCriteria
  | HomeownerMatchCriteria
  | StageChangeCriteria;

/** A row from the `alert_rules` table, post-jsonb-parse. */
export interface AlertRule {
  id: string;
  contractor_id: string;
  kind: AlertRuleKind;
  criteria: AlertCriteria;
  enabled: boolean;
  channel: AlertRuleChannel;
  last_fired_at: string | null;
  fire_count: number;
}

/** A minimal projection of a Lead/intake row that the evaluator needs.
 *  Decoupled from the full Lead type so the evaluator stays a pure
 *  function — easy to fixture-test without DB joins. */
export interface AlertEvaluationLead {
  id: string;
  contractor_id: string;
  score: number;
  trade: string | null;
  zip: string | null;
  address: string | null;
  /** Permit number rendered in the alert subject for context. */
  permit_number?: string | null;
  /** Permit description for the alert body. */
  permit_description?: string | null;
  /** Module 1 — opportunity_stage at the moment of evaluation. */
  opportunity_stage: string | null;
  /** Module 1 — populated by the homeowner intake handler when a
   *  homeowner-submitted lead is what triggered evaluation. The
   *  homeowner_match matcher needs this signal. */
  is_homeowner_intake?: boolean;
  /** Stage transition from `OLD.opportunity_stage` to
   *  `NEW.opportunity_stage`. Only populated when the trigger source
   *  is a stage_change (i.e. the score cron observed a transition). */
  previous_stage?: string | null;
}

/** A successful match — one rule + lead pair that should fire. */
export interface AlertHit {
  rule: AlertRule;
  lead: AlertEvaluationLead;
  /** Render-ready subject + body for email; for SMS the body alone
   *  is used (subject ignored). */
  subject: string;
  body: string;
}
