# Phase 1.2 — Wire predictive rules into the cron scorer

**Effort**: 0.5d
**Prereqs**: migration 00045 applied (`cross_trade_suggestions` jsonb column on leads)
**Status**: Pending

## Context

The predictive rules engine ships at `src/lib/predictive/rules.ts` with 26 passing unit tests. The drawer surfacing ships via `CrossTradeOpportunities` component. The missing edge is the cron writer: `evaluateRules()` must be called during the scoring pass and its output written to `leads.cross_trade_suggestions`.

## Foundation already shipping

- `src/lib/predictive/rules.ts` — `evaluateRules(ctx)` returns `CrossTradeSuggestion[]`
- `supabase/migrations/00025_address_permit_history.sql` — per-property aggregation (the engine's required input)
- `supabase/migrations/00045_cross_trade_suggestions.sql` — column to write into

## Scope

In `src/app/api/cron/score/route.ts`:

1. After the existing 6-signal scoring writes, fetch the lead's address-permit-history:

   ```ts
   const { data: history } = await supabase
     .from("address_permit_history")
     .select("*")
     .eq("address_norm", normalizeAddress(lead.address, lead.zip))
     .single();
   ```

2. Call the engine:

   ```ts
   import { evaluateRules } from "@/lib/predictive/rules";
   const suggestions = evaluateRules({ lead, history: history ?? null });
   ```

3. Write to the new column, gated by env flag (graceful-degrade pattern):

   ```ts
   if (process.env.WRITE_CROSS_TRADE_SUGGESTIONS === "1") {
     await supabase
       .from("leads")
       .update({ cross_trade_suggestions: suggestions })
       .eq("id", lead.id);
   }
   ```

4. Update `useLeads.ts` `SELECT_WIDE` to include `cross_trade_suggestions` (already pattern-established in the wide/narrow retry-fallback). Update `mapLead` in `dashboard/page.tsx` to read `crossTradeSuggestions` via `Record<string,unknown>` cast.

## Files to modify

- `src/app/api/cron/score/route.ts` — invoke `evaluateRules()` per lead
- `src/hooks/useLeads.ts` — add `cross_trade_suggestions` to `COLUMNS_EXTENDED`
- `src/app/(dashboard)/dashboard/page.tsx` — `mapLead` reads the column
- `.env.local` / Vercel env — add `WRITE_CROSS_TRADE_SUGGESTIONS=1` once migration applies

## Verification

1. `pnpm tsc --noEmit` clean
2. `pnpm lint --max-warnings=0` clean
3. `pnpm test` — predictive tests still 26/26
4. **Manual**: open the LeadDetailDrawer for a real pool permit. Cross-trade Opportunities section should render with ≥1 suggestion (landscaping, confidence 75%).
5. **Manual**: re-run `pnpm score` — log output should include "wrote N cross-trade suggestions".

## Out of scope

- The "Forward" button in `CrossTradeOpportunities` is currently a no-op + state toggle. Wiring it to create a new leads row + route via the matching engine is a separate ~2-day effort (see roadmap §1.2 follow-up).
- LLM description-mining (Phase 2.1) layers on TOP of these rules — separate sprint.
