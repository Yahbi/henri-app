/* ── Henri Lead Scoring Engine — Barrel Export ───────────────────────────── */

export {
  calculateScore,
  buildSignals,
  SCORE_COMPONENT_MAX,
  type ScoringSignals,
  type ScoreResult,
  type Urgency,
  type ScoreCalibration,
  type TradeWeightRow,
  type StageModifierRow,
} from "./model";

export {
  getSeasonalFactor,
  getSeasonLabel,
} from "./seasonal";
