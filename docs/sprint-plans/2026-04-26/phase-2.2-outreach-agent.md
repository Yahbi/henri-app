# Phase 2.2 — Outreach Agent (per-lead AI personalization)

**Effort**: 1 week
**Prereqs**: Phase 1.5 outreach template editor + per-trade copy library deployed
**Status**: Pending

## Context

Templates produce identical SMS for every Hartford CT roofing lead. Real-world response rates lift 2–3x when the first sentence references the homeowner's specific permit context (scope, value, neighborhood). An LLM can do this at $0.0005/send.

## Foundation already shipping

- `/api/ai/draft-reply/route.ts` — existing pattern: LLM call with deterministic fallback
- Phase 1.5 templates (after deployment) — these become the fallback when LLM fails
- `/api/messages/send` — existing send pipeline through Twilio + Resend

## Scope

### A. Prompt design + cost model (Day 1)

```ts
const SYSTEM_PROMPT = `
Personalize this outreach SMS for a contractor reaching out to a
homeowner about their permit. Keep the contractor's voice and CTA.
DO NOT add new claims or promises. DO NOT exceed 160 chars (1 SMS).
DO reference: permit scope, permit value if mentioned, neighborhood
if mentioned. Output the SMS body only — no preamble, no quotes.
`.trim();
```

Use Claude Haiku. Cost: ~$0.0005/SMS at 100 tokens in + 50 tokens out.

### B. Pipeline integration (Days 2–3)

Insert ONCE during outreach send, not per render:

```ts
// /api/messages/send
const personalized = await personalizeOutreachSMS({
  template: chosenTemplate.body,
  lead,
  contractor,
  budgetMs: 800,
});
const finalBody = personalized ?? chosenTemplate.body; // fallback
```

Latency budget: 800ms. Twilio's tolerance is 10s but we want to hit the wedge contract bullet #5 ("speed-to-lead is mechanical"). LLM timeout → use template verbatim.

### C. Quality + safety gates (Days 4–5)

- Validate output: length ≤ 160 chars, no URLs added, no profanity, no tokens like `{{...}}` left unrendered
- Compare against template: if Levenshtein distance > 80% of template length, reject (LLM hallucinated)
- A/B mode: 50% of sends use LLM, 50% use template. Track close rate per cohort.
- Per-contractor opt-out: `profiles.ai_personalization_enabled` boolean column (default true)

### D. Telemetry + iteration (Days 6–7)

- Log every personalization: `outreach_personalizations` table with `template_id, lead_id, original, personalized, cost_estimate, latency_ms`
- Daily Slack summary: % personalized, avg cost, cohort close-rate diff
- After 60 days of data: tune prompt based on what improved close rates

## Files

**New**:
- `src/lib/agents/outreach-personalizer.ts`
- `src/lib/agents/__tests__/outreach-personalizer.test.ts`
- `supabase/migrations/00048_outreach_personalizations.sql` (telemetry table)

**Modified**:
- `src/app/api/messages/send/route.ts` — insert the personalization call
- `src/lib/sequences/engine.ts` — accept optional personalized body

## Verification

- Tests: 12+ unit tests including length cap, URL injection rejection, fallback on LLM timeout
- Manual: send a roofing template to a real Hartford lead — observe the SMS includes specific scope reference
- Cost test: 1000 simulated sends, verify total cost < $1
- Latency test: p99 < 800ms under load (cron sends 500 messages within a 280s deadline)

## Out of scope

- Email-channel personalization (different prompt, different latency budget — Phase 2.2.1)
- Multi-language support (Spanish, Mandarin) — needs separate prompts per language
- Real-time personalization based on weather, news, season — too speculative for v1

## Security considerations

Per the audit's [05 F2](docs/audits/2026-04-26/05-security.md):
1. Wrap inputs in delimiters
2. Schema-validate LLM output
3. Block URL injection (regex strip + reject)
4. Rate-limit per contractor: max 100 personalizations / hour
