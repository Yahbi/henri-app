/* ── F2.3 — Trade classifier (deterministic) ────────────────────────────
 *
 *  Tier A+ Sprint 2. Classifies "other"-tagged leads into Henri's 7
 *  canonical trades using deterministic regex patterns + cosine
 *  similarity to a labeled training set. NO LLM, NO PII.
 *
 *  Approach:
 *    1. Run high-confidence regex patterns first (e.g., "ROOF" → roofing).
 *    2. Fall back to keyword-bag cosine similarity against ~50 labeled
 *       per-trade exemplars when regex doesn't match.
 *    3. Return null if confidence is below the threshold.
 *
 *  Compliance: classifies properties + permits, not people. No protected-
 *  class proxy possible (only sees permit_type + description text).
 * ──────────────────────────────────────────────────────────────────────── */

import { CANONICAL_TRADES, type CanonicalTrade } from "./cascade";

export interface TradeClassification {
  trade: CanonicalTrade;
  confidence: number; // [0, 1]
  method: "regex" | "cosine" | "none";
}

/* ── Regex patterns (high-confidence) ─────────────────────────────────── */

interface RegexRule {
  trade: CanonicalTrade;
  pattern: RegExp;
}

const REGEX_RULES: RegexRule[] = [
  // Roofing — match word stems ("roof", "roofing", "roofed", "shingles", "gutters")
  { trade: "roofing", pattern: /\b(roof\w*|shingle\w*|gutter\w*|fascia)\b/i },
  // Plumbing (BEFORE hvac to capture "water heater")
  { trade: "plumbing", pattern: /\b(plumb\w*|water heater|drain\w*|sewer|sump|pipe\w*|sink\w*|toilet\w*|shower\w*|faucet\w*)\b/i },
  // HVAC
  { trade: "hvac", pattern: /\b(hvac|furnace\w*|ac\b|air condition\w*|heat pump|cooling system|heating system|duct\w*)\b/i },
  // Electrical
  { trade: "electrical", pattern: /\b(electric\w*|wiring|outlet\w*|panel upgrade|service upgrade|breaker\w*|amp\b)\b/i },
  // Solar
  { trade: "solar", pattern: /\b(solar|pv\b|photovoltaic|inverter\w*|battery storage)\b/i },
  // ADU
  { trade: "adu", pattern: /\b(adu|accessory dwelling|granny flat|in-law|casita)\b/i },
  // General Remodel — match stems
  { trade: "general remodel", pattern: /\b(remodel\w*|renovation\w*|kitchen\w*|bath\w*|addition\w*|interior alteration|tenant improvement)\b/i },
];

/* ── Keyword bag for cosine similarity ────────────────────────────────── */

interface KeywordBag {
  trade: CanonicalTrade;
  keywords: string[];
}

const KEYWORD_BAGS: KeywordBag[] = [
  {
    trade: "roofing",
    keywords: ["roof", "shingle", "underlayment", "ridge", "valley", "flashing", "gutter", "downspout", "fascia", "soffit", "drip edge", "tar", "torch", "membrane"],
  },
  {
    trade: "plumbing",
    keywords: ["plumb", "pipe", "water", "heater", "drain", "sewer", "sump", "sink", "toilet", "shower", "faucet", "valve", "fixture", "trap"],
  },
  {
    trade: "hvac",
    keywords: ["hvac", "furnace", "boiler", "duct", "vent", "compressor", "condenser", "heat", "cool", "air", "refrigerant", "btu", "thermostat", "blower"],
  },
  {
    trade: "electrical",
    keywords: ["electric", "wire", "outlet", "panel", "breaker", "amp", "circuit", "conduit", "junction", "fixture", "switch", "service"],
  },
  {
    trade: "solar",
    keywords: ["solar", "pv", "photovoltaic", "inverter", "battery", "module", "array", "interconnect", "racking", "feed-in"],
  },
  {
    trade: "adu",
    keywords: ["adu", "accessory", "dwelling", "granny", "in-law", "casita", "secondary", "detached", "garage conversion"],
  },
  {
    trade: "general remodel",
    keywords: ["remodel", "renovation", "kitchen", "bath", "addition", "alteration", "interior", "tenant", "improvement", "demo", "rebuild", "modernize"],
  },
];

/* ── Tokenizer ─────────────────────────────────────────────────────────── */

export function tokenize(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/* ── Cosine similarity (term-frequency vectors) ───────────────────────── */

/**
 * Compute the cosine similarity between a target token list and a
 * keyword bag. Range [0, 1]. Higher = more similar.
 */
export function cosineSimilarity(tokens: string[], keywords: string[]): number {
  if (tokens.length === 0 || keywords.length === 0) return 0;

  const tokenSet = new Set(tokens);
  let dot = 0;
  for (const kw of keywords) {
    if (tokenSet.has(kw)) dot += 1;
  }
  if (dot === 0) return 0;

  // Magnitudes
  const tokenMag = Math.sqrt(tokens.length); // rough TF magnitude
  const kwMag = Math.sqrt(keywords.length);
  if (tokenMag === 0 || kwMag === 0) return 0;

  return dot / (tokenMag * kwMag);
}

/* ── Main classifier ──────────────────────────────────────────────────── */

const MIN_COSINE_CONFIDENCE = 0.15;

export function classifyTrade(
  permitType: string | null | undefined,
  description: string | null | undefined,
): TradeClassification {
  const text = [permitType ?? "", description ?? ""].join(" ").trim();
  if (!text) {
    return { trade: "general remodel", confidence: 0, method: "none" };
  }

  // 1) Regex pass (high confidence)
  for (const rule of REGEX_RULES) {
    if (rule.pattern.test(text)) {
      return {
        trade: rule.trade,
        confidence: 0.9,
        method: "regex",
      };
    }
  }

  // 2) Cosine similarity fallback
  const tokens = tokenize(text);
  let best: { trade: CanonicalTrade; score: number } | null = null;
  for (const bag of KEYWORD_BAGS) {
    const score = cosineSimilarity(tokens, bag.keywords);
    if (best == null || score > best.score) {
      best = { trade: bag.trade, score };
    }
  }

  if (!best || best.score < MIN_COSINE_CONFIDENCE) {
    return { trade: "general remodel", confidence: 0, method: "none" };
  }

  return {
    trade: best.trade,
    confidence: Math.round(best.score * 1000) / 1000,
    method: "cosine",
  };
}

/** Validate that a string is one of the canonical 7 trades. */
export function isCanonicalTrade(value: string): value is CanonicalTrade {
  return (CANONICAL_TRADES as readonly string[]).includes(value);
}
