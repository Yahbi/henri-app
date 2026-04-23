import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Trade-specific fallback question banks (used when OpenAI is unavailable)
const TRADE_QUESTIONS: Record<string, string[]> = {
  Roofing: [
    "How old is your current roof?",
    "Are there any visible leaks or staining on your ceiling?",
    "What roofing material do you currently have (shingle, tile, flat)?",
  ],
  HVAC: [
    "Is this a replacement of an existing system or a new install?",
    "What type of system are you looking for (central air, mini-split, heat pump)?",
    "How many square feet is the area you need to heat or cool?",
  ],
  Solar: [
    "Do you currently have any solar panels installed?",
    "What is your average monthly electricity bill?",
    "Do you own or rent your home?",
  ],
  Electrical: [
    "Is this for a panel upgrade, new circuits, or general wiring work?",
    "How old is your home's electrical panel?",
    "Are you experiencing any flickering lights or tripped breakers?",
  ],
  Plumbing: [
    "Is this an emergency repair or a planned renovation?",
    "What is the issue — leak, clog, pipe replacement, or fixture install?",
    "How old is the plumbing in your home?",
  ],
  ADU: [
    "Is this an attached or detached ADU?",
    "Do you already have architectural plans, or do you need design services?",
    "What will the ADU be used for — rental income, family, or personal use?",
  ],
  Addition: [
    "What type of addition — bedroom, bathroom, garage, or living space?",
    "Have you already obtained or applied for permits?",
    "Do you have any existing architectural drawings?",
  ],
  Foundation: [
    "Are you seeing any cracks in walls or floors?",
    "Is this for seismic retrofitting, leveling, or a new pour?",
    "Has a structural engineer assessed the foundation?",
  ],
  Windows: [
    "How many windows are you looking to replace?",
    "What frame material do you prefer — vinyl, wood, or aluminum?",
    "Are you prioritizing energy efficiency, noise reduction, or aesthetics?",
  ],
  Painting: [
    "Is this interior, exterior, or both?",
    "How many rooms or how many square feet need to be painted?",
    "Do you need surface prep or repair (drywall, wood rot, etc.)?",
  ],
  Landscaping: [
    "Are you looking for a full redesign or specific services like irrigation or sod?",
    "What is the approximate square footage of your outdoor space?",
    "Do you prefer drought-tolerant plants given your local climate?",
  ],
  "General Remodel": [
    "Which room or area are you remodeling?",
    "Do you have a design in mind, or do you need design consultation?",
    "Is the project primarily cosmetic or does it involve structural changes?",
  ],
};

const MAX_QUESTIONS = 3;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { trade, answers_so_far, question_index } = await req.json();

    // Stop after MAX_QUESTIONS
    if (question_index >= MAX_QUESTIONS) {
      return NextResponse.json({ done: true });
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;

    // Prefer OpenAI if available
    if (OPENAI_KEY) {
      const systemPrompt = `You are Henri, a friendly AI assistant helping homeowners describe their home improvement projects.
Ask exactly ONE focused follow-up question to better understand a ${trade} project.
The question should help a contractor prepare an accurate estimate.
Keep it conversational and under 20 words.
Do NOT repeat questions already asked.
Do NOT add explanatory text — just the question.`;

      const userContent = answers_so_far?.length > 0
        ? `So far the homeowner has told me:\n${answers_so_far.map((a: string, i: number) => `Q${i + 1}: ${a}`).join("\n")}\n\nAsk question ${question_index + 1} of ${MAX_QUESTIONS}.`
        : `This is the first follow-up question (${question_index + 1} of ${MAX_QUESTIONS}) for a ${trade} project.`;

      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 80,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
          }),
        });
        const data = await res.json();
        const question = data.choices?.[0]?.message?.content?.trim();
        if (question) {
          return NextResponse.json({ question });
        }
      } catch {
        // Fall through to static questions
      }
    }

    // Static fallback
    const questions = TRADE_QUESTIONS[trade] ?? TRADE_QUESTIONS["General Remodel"];
    const question = questions[question_index] ?? null;

    if (!question) {
      return NextResponse.json({ done: true });
    }

    return NextResponse.json({ question });
  } catch {
    return NextResponse.json({ done: true });
  }
}
