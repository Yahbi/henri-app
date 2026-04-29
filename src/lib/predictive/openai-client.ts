/**
 * Production OpenAI-backed LlmClient for predictive description mining.
 *
 * Phase 2.1 cron-wiring. Wraps `getOpenAIClient()` (`src/lib/openai/
 * client.ts`) into the LlmClient interface that `mineDescription()`
 * expects. Returns the no-op client when OPENAI_API_KEY is missing
 * (graceful-degrade per CLAUDE.md).
 *
 * Model: GPT-4o-mini at low temperature for deterministic output.
 * Token budget: ~150 input + ~100 output = ~$0.0001/call.
 */

import { getOpenAIClient } from "@/lib/openai/client";
import { noopLlmClient, type LlmClient } from "./llm-mining";

/**
 * Returns a production LlmClient if OPENAI_API_KEY is set, otherwise
 * the noop fallback. Cron callers should always go through this
 * factory; never instantiate OpenAI directly.
 */
export function getMiningLlmClient(): LlmClient {
  const openai = getOpenAIClient();
  if (!openai) return noopLlmClient;

  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1, // low for deterministic JSON output
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      return completion.choices[0]?.message?.content ?? "";
    },
  };
}
