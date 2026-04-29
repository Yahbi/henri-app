import OpenAI from "openai";
import { logger } from "@/lib/logger";
import type { Permit, ScoredPermit, Urgency } from "@/types/permits";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM_PROMPT = `You are a lead scoring AI for construction contractors. Score permits 0-100 based on: value (higher=better), recency (newer=better), permit type match, location. Return JSON: {"score": number, "reasoning": string, "urgency": "hot" | "warm" | "cold"}.`;

interface ScoreResult {
  score: number;
  reasoning: string;
  urgency: Urgency;
}

function deriveUrgency(score: number): Urgency {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  if (score >= 25) return "cool";
  return "cold";
}

export async function scorePermit(permit: Permit): Promise<ScoreResult> {
  const userPrompt = JSON.stringify({
    permit_type: permit.permit_type,
    status: permit.status,
    description: permit.description,
    address: permit.address,
    city: permit.city,
    state: permit.state,
    estimated_value: permit.estimated_value,
    issue_date: permit.issue_date,
  });

  try {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 256,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const parsed = JSON.parse(content) as {
      score?: number;
      reasoning?: string;
      urgency?: string;
    };

    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const urgency = deriveUrgency(score);

    return {
      score,
      reasoning: parsed.reasoning ?? "No reasoning provided",
      urgency,
    };
  } catch (error) {
    logger.error("Error scoring permit", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      score: 0,
      reasoning: "Scoring failed due to an error",
      urgency: "cold",
    };
  }
}

export async function scoreBatch(
  permits: Permit[]
): Promise<ScoredPermit[]> {
  const CONCURRENCY_LIMIT = 5;
  const results: ScoredPermit[] = [];

  for (let i = 0; i < permits.length; i += CONCURRENCY_LIMIT) {
    const batch = permits.slice(i, i + CONCURRENCY_LIMIT);

    const scored = await Promise.all(
      batch.map(async (permit) => {
        const result = await scorePermit(permit);
        return {
          ...permit,
          ...result,
        };
      })
    );

    results.push(...scored);
  }

  return results;
}
