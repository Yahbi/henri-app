# Henri.

**Permit-driven contractor lead-gen SaaS.** Beta, Founder tier capped at 100 slots.

## Stack

- **Next.js 16** (Turbopack in dev / webpack in prod) + React 19 + Tailwind v4 (CSS-first config)
- **Supabase** (Postgres + RLS + service-role pattern)
- **Stripe** (subscriptions + webhooks), **Twilio** (SMS + missed-call), **Resend** (email)
- **OpenAI** (homeowner intake chat + draft-reply)
- **Mapbox** + **MapLibre GL** + **PMTiles** (zoning vector tiles)
- **Vitest** for tests. **Vercel** for deploy + cron.

## Local development

```bash
pnpm install
cp .env.local.example .env.local       # fill in Supabase / Stripe / Twilio / Resend / OpenAI keys
pnpm dev                                # http://localhost:3000 (Turbopack)
pnpm tsc --noEmit                       # typecheck
pnpm lint                               # ESLint, --max-warnings=0 in CI
pnpm test                               # 144 vitest tests, ~700ms
pnpm truthfulness                       # CLAUDE.md contract scan
pnpm migrate                            # apply pending Supabase migrations
```

Founder dev login (god-mode bypass of onboarding):

1. Set `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1` in `.env.local`.
2. Open `/login`, click **Dev Login (owner)**.
3. The `DEV: y.abismuth@gmail.com` chip appears in the bottom-right with a **Contractor / Homeowner** role-switcher.

## Architecture in one paragraph

Two user types: **homeowner** (free) and **contractor** (paid). Homeowner flow: `/portal` → `/signup?role=homeowner` → `/homeowner` → AI chat intake. Contractor flow: `/contractors` → `/signup?role=contractor` → `/onboarding/{license,plan,payment,territory}` → `/dashboard`. Auth + role-gating live in `src/middleware.ts` + `src/lib/auth/requireContractor.ts`. The dashboard is contractor-only. Permit data flows through 15 Vercel cron jobs (`/api/cron/{score,scrape,permits,enrich,follow-ups,blast-worker,...}`). Lead scoring is deterministic (no LLM) — see `src/lib/scoring/`. The 13-source enrichment orchestrator lives in `src/lib/enrichment/orchestrator.ts`.

## Key files

- `CLAUDE.md` — **Read first.** Brand rules, pricing source-of-truth, the 6-bullet wedge contract, code patterns, migration discipline, verification gate, files-not-to-touch list.
- `AGENTS.md` — Next.js 16 breaking-changes warning. Read before writing route code.
- `src/middleware.ts` + `src/proxy.ts` — auth + role gating. Load-bearing.
- `src/lib/scoring/` — 6-signal lead scorer (deterministic).
- `src/lib/exclusivity/locks.ts` — wedge bullet #1 (one contractor per permit per trade for 14 days).
- `src/lib/enrichment/orchestrator.ts` — 13-source enrichment pipeline (4 phases, parallel + sequential mix).
- `src/lib/capacity/types.ts` — wedge bullet #3 (capacity-fit filtering).
- `supabase/migrations/` — additive-only, idempotent. See [docs/audits/2026-04-26/02-data-layer.md](./docs/audits/2026-04-26/02-data-layer.md).

## Deploy

Vercel-native. Cron schedules in `vercel.json`. Migrations applied via:

```bash
pnpm migrate                      # uses scripts/apply-pending-migrations.ts
# or paste supabase/_pending-bundle.sql into the web SQL editor
```

## Verification gate (run before saying "done")

```bash
pnpm tsc --noEmit                 # typecheck
pnpm lint --max-warnings=0        # 0 warnings
pnpm test                         # 144/144
pnpm truthfulness                 # CLAUDE.md contract
pnpm build                        # next build (webpack)
```

CI runs all of these on every PR — see `.github/workflows/ci.yml`.

## Audits + docs

- `docs/audits/henri-audit-2026-04-26.md` — most recent senior-engineer audit (12 dimensions, top-10 priorities, scorecard).
- `docs/battlecards/henri-battlecard-2026-04-24.html` — competitive battlecard (Angi, HomeAdvisor, Thumbtack, AccuLynx, Construction Monitor, BuildZoom).
- `docs/permit-catalog/` — per-source data catalog.
- `docs/RLS.md` — RLS policy reference.

## Slash commands (Claude Code)

Project-specific commands in `.claude/commands/`:

- `/migrate` — apply pending Supabase migrations
- `/truthfulness-scan` — scan for fabricated metrics
- `/wedge-status` — wedge contract readiness report
- `/launch-checklist` — full pre-launch audit
- `/verify` — typecheck + build + smoke-test
- `/dev-login` — authenticate dev server as founder via god-mode
- `/restart-dev` — clean stop + start of Next.js dev server
- `/scorer-run` — manually trigger the lead-scoring cron
- `/sources-probe` — re-qualify enabled permit sources
- `/permit-history` — print all permits for an address
- `/feedback-read` — print local `.henri-feedback.jsonl` inbox
- `/ship` — commit + push after `/verify` passes
- `/roadmap` — current phase status
- `/audit` — re-run the senior-engineer audit (12 dimensions)
- `/godmode-preview` — start dev server + auto-tour the dashboard

## What's not committed (per CLAUDE.md "Files not to touch")

- Plan files in `~/.claude/plans/` — user-local, not in repo.
- `.env.local` — secrets, never check in.
- `supabase/_pending-bundle.sql` — generated by `pnpm migrate`, treat as ephemeral.

## Brand contract (mini-summary, full version in CLAUDE.md)

- Brand name: "Henri." (with period) in logos/navs; "Henri" without period in body copy.
- Primary color: `#D4886A` (terracotta). Never `#E8916A`.
- Typography: **Fraunces** (serif, never `font-bold`) for headings; **DM Sans** for body.
- No emojis. Use SVG icons (`lucide-react`) or text labels.
- Google OAuth only (no GitHub, no Apple).
- All UI components from `@/components/ui/*` primitives — never re-implement.
- No invented metrics. No CSV export. No fake testimonials.
