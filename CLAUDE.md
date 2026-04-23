@AGENTS.md

# Henri. — Project Rules

> Authoritative rules for Claude. Violations are bugs, even when they ship.
> When a rule and a user request conflict, quote the rule and ask.

---

## Brand (non-negotiable)
- Brand name is **Henri.** (with period) in all logos/navs. Body copy uses "Henri" without period.
- Primary color: `#D4886A` (darker terracotta). Never use `#E8916A`.
- Typography: Fraunces (serif, `font-heading font-normal`) for headings. DM Sans for body. Never use `font-bold` on Fraunces headings.
- No emojis anywhere in code, copy, logs, or UI. Use SVG icons (lucide-react) or text labels.
- Google OAuth only. No GitHub, no Apple.
- All components ship from `@/components/ui/*` primitives (Button, Card, Dialog, Input, Select, Badge, Skeleton, Toast, FocusTrap, ExpandableBanner). Never re-implement from scratch.

## Pricing (source of truth)
- Founder: $149/mo, 3 ZIPs (Beta, limited to 100, price locked)
- Starter: $749/mo, 5 ZIPs
- Pro: $1,499/mo, 12 ZIPs (Most popular)
- Enterprise: $2,555/mo, 20 ZIPs
- 24-hour free trial, credit card required
- No refunds (digital product)
- No CSV export on any plan

## Policies
- Territory changes: next billing cycle only, if available
- Licensing: required, verified daily, leads paused if expired
- Cancellation: anytime, effective end of cycle
- Never reveal data sourcing methods (no LADBS, no API names, no "scraping")
- Cancel anytime + no-lock-in + data-export footer must appear on Settings → Billing

## Truthfulness (contractors + homeowners)
- **Never invent metrics.** No "18.4x ROI," no "26% close rate," no "4,200 homeowners matched" unless we actually have that data. If a number can't be proven from a live query or a cited source, it doesn't ship.
- **Size the claim to the current state.** We have ~925k permits across 46 states; headline "900k+ permits across 45+ states" is honest. Do not round up.
- **Fabricated stats are auto-rejected in code review.** Historical numbers kept as code comments so the next version knows where the old lie used to live.
- **Transparent scoring.** Every lead-detail drawer must show the 6-signal breakdown. Never hide "why this score" behind a height gate.

## Architecture
- Two user types: homeowner (free) and contractor (paid)
- Homeowner flow: /portal → /signup?role=homeowner → /homeowner → Henri AI chat
- Contractor flow: /contractors → /signup?role=contractor → /onboarding (license → plan → payment → territory) → /dashboard
- Dashboard is contractor-only. **Do not add new top-level tabs.** Deepen existing tabs (see the wedge/FSM plan at `~/.claude/plans/distributed-growing-quiche.md`).
- Route protection via middleware (role-based redirects).
- Contractor-only API routes gate with `requireContractor(supabase)` from `src/lib/auth/requireContractor.ts`. No exceptions.
- All new DB tables: `contractor_id uuid REFERENCES profiles(id)` + RLS self-policy + `created_at` / `updated_at` + `moddatetime` trigger. Same pattern as `leads`, `estimates`, `territories`.

## Wedge contract (Phase 0a+ — the reason contractors pick Henri)
1. **Exclusivity is enforced on the enriched packet, not the data.** Public permit records stay public. Henri gates contact info + scored urgency + outreach bundle. One contractor per permit per trade for a 14-day window (migration `00031`). Auto-release after 72h of no outreach logged ("use-it-or-lose-it").
2. **Confidence is transparent.** Never hide why a lead scored 65 vs 85. The 6 score signals (`permit_freshness`, `permit_value`, `contact_completeness`, `zip_demand`, `homeowner_engagement`, `historical_conversion`) render in the drawer with their weights, values, and detail reasons.
3. **Capacity is respected.** Contractor sets radius / value band / start window / max-active-jobs in Settings → Capacity. Out-of-envelope leads are hidden from the Leads tab with a clear "N filtered out, widen to see" counter. Never silently drop rows.
4. **Outreach is permit-specific.** Templates reference the actual permit # + scope + address. Generic spam templates get removed.
5. **Speed-to-lead is mechanical.** Missed-call text-back via Twilio fires within 10s. Auto-fire outreach-on-lead-create is opt-in per contractor.
6. **Competitive intel is coarse.** "N other contractors are watching this permit" shows a bucketed count (`1-2`, `3-5`, `5+`), never names. Discourages racing.

## Delivery patterns
- **Feature-flags before migrations.** Every new DB column/table ships with a graceful-degrade fallback so the UI keeps rendering before the SQL lands. Match the patterns in `src/app/api/feedback/route.ts` (DB insert best-effort + email fallback + local JSONL) and `src/app/api/exclusivity/route.ts` (table-missing → empty summary + no badges).
- **Migrations are additive-only.** Never drop or rename existing columns without a dual-write release first. Keep the old column populated while the new one rolls out.
- **All hooks run unconditionally.** Never place `useState` / `useEffect` / custom hooks below a conditional early-return. Rules-of-hooks violations crash the dashboard.
- **Every new component that does I/O has a cancellation-safe `useEffect`.** Use the ref-cancelled pattern from `useEnrichment` / `usePermitHistory` / `useExclusivity`.
- **Client-side fallback first.** When adding a new jsonb column, add the read path (with type-guard) BEFORE adding it to the SELECT list in `useLeads`. An unknown-column error breaks the whole fetch.

## Code Patterns
- Supabase client: `src/lib/supabase/client.ts` (browser), `src/lib/supabase/server.ts` (server components + route handlers), `src/lib/supabase/admin.ts` (service role — RLS bypass, cron-only).
- Lead types: `src/types/lead.ts`. Lead hook: `src/hooks/useLeads.ts`. User hook: `src/hooks/useUser.ts`.
- Dashboard tabs: `src/app/(dashboard)/dashboard/`. Marketing pages: `src/app/(marketing)/` with per-page navs (PortalNav, ContractorNav).
- Scoring engine: `src/lib/scoring/` — deterministic math, no LLM. Signal breakdown writer lives in `src/lib/scoring/signals.ts`.
- Exclusivity: `src/lib/exclusivity/locks.ts` — acquire / release / summarize. Graceful-degrades when migration 00031 isn't applied.
- Capacity filter: `src/lib/capacity/types.ts` — pure client-side filter, always shows "N hidden" counter.
- Permit history: `/api/permits/history` + `usePermitHistory` hook. Always renders in the Lead detail drawer (no height gate).

## Migrations
- Location: `supabase/migrations/NNNNN_description.sql`. Monotonic numbering.
- Apply path when Supabase CLI + `SUPABASE_ACCESS_TOKEN` are available: `pnpm migrate` (see `.claude/commands/migrate.md`).
- Fallback apply path: paste into https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new.
- Every migration is idempotent (`IF NOT EXISTS`, `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for enums). Re-run must be safe.

## Verification gate (run before saying "done")
1. `pnpm tsc --noEmit` — typecheck clean.
2. `pnpm build` or the local dev server (via `mcp__Claude_Preview__preview_start`) renders the changed surface.
3. Click the feature in the preview — don't just read source.
4. Check server logs (`mcp__Claude_Preview__preview_logs`) for 4xx/5xx, scraper deadlocks, or statement timeouts.
5. Never commit without the user explicitly asking. Never push to main / force-push.

## Files not to touch without explicit approval
- `src/middleware.ts` / `src/proxy.ts` — role-gating is load-bearing
- `supabase/combined-migrations.sql` — generated; edit source migrations instead
- `vercel.json` — cron schedules; gate changes behind a one-line reason + revert plan
- Brand tokens in `src/app/globals.css` — the palette is locked

## Plan files
- Active plan: `~/.claude/plans/distributed-growing-quiche.md` — trade-native FSM + wedge.
- Always read before starting a new session. Never let an obsolete plan mislead the work.
