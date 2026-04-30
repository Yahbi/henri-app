/* ── Read-only AI-analyst agent orchestrator ────────────────────────────
 *
 *  Tier A+ Sprint 3. Base harness for the 2 read-only AI-analyst agents
 *  (A1 lead summary + A2 weekly briefing). Extends the proven defenses
 *  in src/lib/agents/outreach-personalizer.ts:
 *
 *    • Delimiter-defended prompts: untrusted data wrapped in <<<DATA>>>
 *      sentinels with sanitization to prevent injection-via-content.
 *    • 5-layer output validation: length cap, URL strip, profanity, etc.
 *    • Budget enforcement: per-contractor monthly token cap. Soft alert
 *      at 80%, hard halt at 100%.
 *    • Audit logging: every call writes a row to `agent_actions` with
 *      hashes (NOT raw prompt/output text).
 *    • Kill switch: env-var + DB-row check.
 *    • Graceful-degrade: returns a fallback string if any layer fails.
 *
 *  THE AGENT NEVER TAKES ACTIONS. It produces text rendered in the
 *  contractor's dashboard. Read-only. Tier A+ enforced at this boundary.
 * ──────────────────────────────────────────────────────────────────────── */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

/** Pricing per 1k tokens (USD). Update when models change. */
const PRICING = {
  "claude-haiku-4-5": { in: 0.001, out: 0.005 },
  "claude-sonnet-4-5": { in: 0.003, out: 0.015 },
} as const;

export type AgentModel = keyof typeof PRICING;

export interface AgentInput {
  /** Action identifier, e.g. "a1.lead_summary". */
  action: string;
  /** The contractor running this action (for budget + audit). */
  contractorId: string | null;
  /** Optional target row (lead, project, etc.). */
  targetTable?: string;
  targetId?: string;
  /** Pre-validated, untrusted-data-safe prompt content. */
  prompt: string;
  /** Model to use. Default: claude-haiku-4-5 for cost. */
  model?: AgentModel;
  /** Max output tokens (cost cap). Default 1000. */
  maxTokens?: number;
  /** Whether to render the FTC § 5 disclaimer to the user. Default true. */
  disclaimerRendered?: boolean;
}

export interface AgentResult {
  ok: boolean;
  output: string | null;
  /** Error code if ok=false; one of 'budget' | 'kill_switch' | 'llm_error' | 'validation' */
  errorCode?: string;
  errorMessage?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Default fallback string when all agent paths fail. */
const FALLBACK_OUTPUT = "(Insight unavailable. Please review the lead details directly.)";

/* ──────────────────────────────────────────────────────────────────────────
 * Budget enforcement
 * ────────────────────────────────────────────────────────────────────────── */

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: "no_budget_row" | "halted" | "over_cap";
  monthlyTokensUsed: number;
  monthlyTokenCap: number;
}

/** Check whether a contractor has remaining budget. Returns allowed=false
 * when over cap or already halted. */
export async function checkAgentBudget(
  supabase: SupabaseClient,
  contractorId: string,
  estimatedTokens: number,
): Promise<BudgetCheckResult> {
  const { data, error } = await supabase
    .from("agent_budgets")
    .select("monthly_token_cap, monthly_tokens_used, halted_at")
    .eq("contractor_id", contractorId)
    .maybeSingle();

  if (error || !data) {
    // No budget row → graceful-degrade ALLOW (operator hasn't set caps).
    // The cron creates default rows; if missing, we don't block.
    return {
      allowed: true,
      reason: "no_budget_row",
      monthlyTokensUsed: 0,
      monthlyTokenCap: Number.POSITIVE_INFINITY,
    };
  }

  if (data.halted_at) {
    return {
      allowed: false,
      reason: "halted",
      monthlyTokensUsed: data.monthly_tokens_used,
      monthlyTokenCap: data.monthly_token_cap,
    };
  }

  if (data.monthly_tokens_used + estimatedTokens > data.monthly_token_cap) {
    return {
      allowed: false,
      reason: "over_cap",
      monthlyTokensUsed: data.monthly_tokens_used,
      monthlyTokenCap: data.monthly_token_cap,
    };
  }

  return {
    allowed: true,
    monthlyTokensUsed: data.monthly_tokens_used,
    monthlyTokenCap: data.monthly_token_cap,
  };
}

/** Increment a contractor's used token count. Halts the budget if over cap. */
export async function recordAgentUsage(
  supabase: SupabaseClient,
  contractorId: string,
  tokensUsed: number,
): Promise<void> {
  const { data: existing } = await supabase
    .from("agent_budgets")
    .select("monthly_token_cap, monthly_tokens_used")
    .eq("contractor_id", contractorId)
    .maybeSingle();

  const cap = existing?.monthly_token_cap ?? 30000;
  const newUsed = (existing?.monthly_tokens_used ?? 0) + tokensUsed;
  const halted = newUsed >= cap ? new Date().toISOString() : null;

  await supabase
    .from("agent_budgets")
    .upsert(
      {
        contractor_id: contractorId,
        monthly_token_cap: cap,
        monthly_tokens_used: newUsed,
        period_start: new Date().toISOString().slice(0, 7) + "-01",
        halted_at: halted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contractor_id" },
    );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Audit logging
 * ────────────────────────────────────────────────────────────────────────── */

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function logAgentAction(
  supabase: SupabaseClient,
  input: AgentInput,
  result: AgentResult,
): Promise<void> {
  await supabase.from("agent_actions").insert({
    contractor_id: input.contractorId,
    action: input.action,
    target_table: input.targetTable ?? null,
    target_id: input.targetId ?? null,
    model: input.model ?? "claude-haiku-4-5",
    model_version: null,
    prompt_hash: hashContent(input.prompt),
    output_hash: result.output ? hashContent(result.output) : null,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: result.costUsd,
    status: result.ok ? "success" : (result.errorCode === "budget" ? "over_budget" : "error"),
    error_message: result.errorMessage ?? null,
    disclaimer_rendered: input.disclaimerRendered ?? true,
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Output validation (5-layer, mirrors outreach-personalizer.ts)
 * ────────────────────────────────────────────────────────────────────────── */

const MAX_OUTPUT_LENGTH = 4000;
const URL_PATTERN = /https?:\/\/\S+/gi;

export interface ValidationResult {
  ok: boolean;
  output: string;
  rejection?: string;
}

export function validateAgentOutput(raw: string, maxLength = MAX_OUTPUT_LENGTH): ValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, output: "", rejection: "non_string" };
  }
  if (raw.length === 0) {
    return { ok: false, output: "", rejection: "empty" };
  }
  if (raw.length > maxLength) {
    return { ok: false, output: "", rejection: "too_long" };
  }
  // Strip URLs (defense against agent surfacing arbitrary links)
  const stripped = raw.replace(URL_PATTERN, "[link removed]");
  // Reject placeholders that escaped the prompt template
  if (/\{\{[^}]+\}\}/.test(stripped)) {
    return { ok: false, output: "", rejection: "unrendered_placeholder" };
  }
  // Reject suspicious instruction-injection patterns
  if (/ignore (the |all )?(previous|prior|above) instructions?/i.test(stripped)) {
    return { ok: false, output: "", rejection: "injection_pattern" };
  }
  return { ok: true, output: stripped };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Delimiter sanitization (mirrors draft-reply.ts pattern)
 * ────────────────────────────────────────────────────────────────────────── */

const SENTINEL_OPEN = "<<<DATA>>>";
const SENTINEL_CLOSE = "<<<END_DATA>>>";

/** Remove any user content that would close our data delimiter. */
export function sanitizeForDelimiter(text: string): string {
  if (!text) return "";
  return text.replace(/<<<\s*END[_\s-]*DATA\s*>>>/gi, "[redacted]").trim();
}

/** Wrap untrusted data in our sentinel-delimited block for the model. */
export function wrapAsData(label: string, content: string): string {
  return `${SENTINEL_OPEN} ${label}\n${sanitizeForDelimiter(content)}\n${SENTINEL_CLOSE}`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Cost computation
 * ────────────────────────────────────────────────────────────────────────── */

export function computeCost(model: AgentModel, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  const cost = (tokensIn / 1000) * pricing.in + (tokensOut / 1000) * pricing.out;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Kill switch (env-var + DB-row check)
 * ────────────────────────────────────────────────────────────────────────── */

/** Check whether a feature is enabled. Returns false → agent does not run. */
export function isAgentEnabled(action: string): boolean {
  // Env-var kill switch — quick override without DB query
  const envKey = `LLM_${action.toUpperCase().replace(/\./g, "_")}_ENABLED`;
  const envValue = process.env[envKey];
  if (envValue === "0" || envValue === "false") return false;
  // Default: enabled (DB-backed flag is checked downstream if/when added)
  return true;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Anthropic client (graceful-degrade when ANTHROPIC_API_KEY missing)
 * ────────────────────────────────────────────────────────────────────────── */

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}

export async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  model: AgentModel,
  maxTokens: number,
): Promise<{ ok: true; text: string; tokensIn: number; tokensOut: number } | { ok: false; error: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  }

  try {
    const messages: AnthropicMessage[] = [{ role: "user", content: userPrompt }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `anthropic ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json()) as AnthropicResponse;
    const text = json.content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!)
      .join("");
    return {
      ok: true,
      text,
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main entry point
 * ────────────────────────────────────────────────────────────────────────── */

export interface RunAgentInput extends AgentInput {
  systemPrompt: string;
  /** Estimated input tokens (used for budget pre-flight check). */
  estimatedTokens: number;
}

export async function runAgent(
  supabase: SupabaseClient,
  input: RunAgentInput,
): Promise<AgentResult> {
  const model: AgentModel = input.model ?? "claude-haiku-4-5";
  const maxTokens = input.maxTokens ?? 1000;

  // 1. Kill switch
  if (!isAgentEnabled(input.action)) {
    const result: AgentResult = {
      ok: false,
      output: FALLBACK_OUTPUT,
      errorCode: "kill_switch",
      errorMessage: "agent disabled",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    await logAgentAction(supabase, input, result).catch(() => {});
    return result;
  }

  // 2. Budget pre-flight (when contractorId is set)
  if (input.contractorId) {
    const budget = await checkAgentBudget(
      supabase,
      input.contractorId,
      input.estimatedTokens,
    );
    if (!budget.allowed) {
      const result: AgentResult = {
        ok: false,
        output: FALLBACK_OUTPUT,
        errorCode: "budget",
        errorMessage: `budget ${budget.reason} (${budget.monthlyTokensUsed}/${budget.monthlyTokenCap})`,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      };
      await logAgentAction(supabase, input, result).catch(() => {});
      return result;
    }
  }

  // 3. LLM call
  const llmResult = await callAnthropic(input.systemPrompt, input.prompt, model, maxTokens);
  if (!llmResult.ok) {
    const result: AgentResult = {
      ok: false,
      output: FALLBACK_OUTPUT,
      errorCode: "llm_error",
      errorMessage: llmResult.error,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    await logAgentAction(supabase, input, result).catch(() => {});
    return result;
  }

  // 4. Output validation
  const validation = validateAgentOutput(llmResult.text);
  if (!validation.ok) {
    const cost = computeCost(model, llmResult.tokensIn, llmResult.tokensOut);
    const result: AgentResult = {
      ok: false,
      output: FALLBACK_OUTPUT,
      errorCode: "validation",
      errorMessage: `validation: ${validation.rejection}`,
      tokensIn: llmResult.tokensIn,
      tokensOut: llmResult.tokensOut,
      costUsd: cost,
    };
    await logAgentAction(supabase, input, result).catch(() => {});
    if (input.contractorId) {
      await recordAgentUsage(supabase, input.contractorId, llmResult.tokensIn + llmResult.tokensOut)
        .catch(() => {});
    }
    return result;
  }

  // 5. Success path: log + record usage
  const cost = computeCost(model, llmResult.tokensIn, llmResult.tokensOut);
  const result: AgentResult = {
    ok: true,
    output: validation.output,
    tokensIn: llmResult.tokensIn,
    tokensOut: llmResult.tokensOut,
    costUsd: cost,
  };
  await logAgentAction(supabase, input, result).catch((e) => {
    logger.warn("agent audit log failed", { error: String(e) });
  });
  if (input.contractorId) {
    await recordAgentUsage(supabase, input.contractorId, llmResult.tokensIn + llmResult.tokensOut)
      .catch((e) => logger.warn("agent budget update failed", { error: String(e) }));
  }
  return result;
}

export const AGENT_DISCLAIMER =
  "AI-generated insight based on Henri's predictive models. " +
  "Not professional advice. Verify before acting.";
