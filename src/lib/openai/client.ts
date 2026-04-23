import OpenAI from "openai";

/**
 * Shared OpenAI client instance.
 * Uses OPENAI_API_KEY from environment. Returns null when key is not set
 * so callers can gracefully degrade (e.g., fall back to static responses).
 */
export function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
