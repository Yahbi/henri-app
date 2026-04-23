/* ── Henri Lead Scoring Engine — Barrel Export ───────────────────────────── */

export {
  calculateScore,
  buildSignals,
  type ScoringSignals,
  type ScoreResult,
  type Urgency,
} from "./model";

export {
  getSeasonalFactor,
  getSeasonLabel,
} from "./seasonal";
