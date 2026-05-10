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
- **Passwordless sign-in only.** Two providers: Google OAuth + magic-link email (Supabase Email OTP). No GitHub, no Apple, no passwords stored. Brand rule amended 2026-04-29 (Pro upgrade enabled email OTP) to unblock contractors on Outlook / Yahoo / corporate email — preserves the "no passwords to leak" trust posture. Login + signup forms wire both paths via `supabase.auth.signInWithOAuth({provider: "google"})` and `supabase.auth.signInWithOtp({email})`. Both flows route through `/auth/callback` (`exchangeCodeForSession` handles OAuth codes and OTP codes identically).
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
- **Size the claim to the current state.** Live Supabase counts (audit 2026-05-03): **1,416,065 permits**, **231,110 leads**, **38 states** with active ingest pipelines, **15 states** with scored leads. Headline copy on `/`, `/contractors`, and TerritoryMapPreview is "**1.4M+ permits across 30+ US states**" — both rounded DOWN. Earlier "900k+" was stale; true count had drifted +500k since the 2026-04-30 audit. Do not round up. When permits.total crosses 1.5M, bump to "1.5M+" and update Hero.tsx + TerritoryMapPreview.tsx + contractors/page.tsx in the same commit.
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
1. **Exclusivity is enforced on the enriched packet, not the data.** Public permit records stay public. Henri gates contact info + scored urgency + outreach bundle. One contractor per permit per trade — the lock stays active until the contractor explicitly releases it (won/declined) or the permit becomes stale. **2026-05-05 policy update:** removed the previous 14-day window and 72h auto-forfeit ("use-it-or-lose-it"). Both were already absent from user-facing copy on 2026-04-30 because no UI acquired locks and no cron enforced the forfeit; today's commit retires them in code too. The wedge promise is now simply "one contractor at a time per permit; release when you're done." Migration `00031` schema unchanged — `window_end` is filled with a 10-year sentinel, `forfeit_deadline` matches.
2. **Confidence is transparent.** Never hide why a lead scored 65 vs 85. The 6 score signals (`permit_freshness`, `permit_value`, `contact_completeness`, `zip_demand`, `homeowner_engagement`, `historical_conversion`) render in the drawer with their weights, values, and detail reasons.
3. **Capacity is respected.** Contractor sets radius / value band / start window / max-active-jobs in Settings → Capacity. Out-of-envelope leads are hidden from the Leads tab with a clear "N filtered out, widen to see" counter. Never silently drop rows. *Phase 0a — only `value_min` / `value_max` are enforced client-side (`src/lib/capacity/types.ts`).* The radius / start-window / max-active-jobs filters land in **Phase A**, when the scorer applies them server-side and the lead shape carries `miles_from_home`, `est_start_date`, and the contractor active-jobs count is plumbed through. The "N filtered out" counter is mandatory **regardless of which dimensions are active** — never silently drop rows.
4. **Outreach is permit-specific.** Templates reference the actual permit # + scope + address. Generic spam templates get removed.
5. **Speed-to-lead is mechanical.** When Twilio is provisioned (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` set in Vercel env), a missed call to the contractor's tracked number fires the `/api/webhooks/twilio-missed-call` handler, which sends an SMS with lead context within a few seconds of the call. Auto-fire outreach-on-lead-create is opt-in per contractor. The webhook + handler shipped 2026-04-27 (G3 fix); pending Twilio account provisioning, the webhook 200s but doesn't send an SMS — gracefully degrades, see route.ts for the env-gating logic.
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
- **Numbering gaps are intentional, not missing files.** Two known gaps as of 2026-04-30:
  - `00038` — skipped during the 2026-04-22 phase-3 RLS pass (the planned migration was folded into `00037` + `00039` to avoid a triple round-trip apply).
  - `00048`–`00049` — skipped during the 2026-04-26 audit pass (the planned migrations were superseded by `00050` + `00051` after the audit reshaped the schema). The numbers were left empty rather than re-shuffled to keep prior commit hashes stable.
  Postgres doesn't care about gaps — numbering is for human ordering only. If you reach this section because an audit flagged the gaps, the gap is intentional. Do not "fill" them with new migrations.

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

## MCP servers

```yaml
mcp_servers:
  - name: supabase
    command: npx
    args:
      - "-y"
      - "@supabase/mcp-server-supabase@latest"
      - "--access-token"
      - "${SUPABASE_ACCESS_TOKEN}"
  - name: claude-preview
    command: npx
    args:
      - "-y"
      - "@anthropic-ai/claude-preview-mcp@latest"
```

**Sentry MCP** (post-launch, after `pnpm add @sentry/nextjs` + `SENTRY_DSN`):

```yaml
  - name: sentry
    command: npx
    args:
      - "-y"
      - "@sentry/mcp-server@latest"
      - "--auth-token"
      - "${SENTRY_AUTH_TOKEN}"
```

User-level MCP config alternatively goes in `~/.local/share/claude/config.json` (Windows: `%USERPROFILE%\.local\share\claude\config.json`).

## Enigma plugin (marketplace install)

Install once via Claude Code:

```
/plugin marketplace add https://github.com/enigma-io/enigma-claude-plugins.git
/plugin install enigma-api@enigma-plugins
```

Set `ENIGMA_API_KEY` in your shell profile (NOT `.env.local` — it's a personal token, not a project secret):

```bash
# macOS / Linux
export ENIGMA_API_KEY=<your-personal-token>
# Windows PowerShell
[Environment]::SetEnvironmentVariable("ENIGMA_API_KEY", "<your-token>", "User")
```

Then `/plugin marketplace list` to confirm. The Enigma plugin's tools become available like any other MCP server.

## Sentry setup (audit-04-30 fix #1 runbook)

Code is fully wired (server-side `instrumentation.ts`, client-side `instrumentation-client.ts`, logger sink at `src/lib/logger.ts:101`, `@sentry/nextjs ^10.50.0` in deps). Activation requires only env vars.

**One-time setup:**

1. **Create Sentry account** (free tier, 5k events/mo) at https://sentry.io/signup/. Pick "Next.js" as platform.
2. **Create a project** for `meethenri.com` — copy the DSN. It looks like `https://abc123@o456.ingest.sentry.io/789`.
3. **Add DSN to `.env.local`** (for dev testing) — append:
   ```bash
   # Sentry — server-side error capture (instrumentation.ts)
   SENTRY_DSN=https://YOUR_DSN_HERE
   # Sentry — client-side error capture (instrumentation-client.ts).
   # Same DSN as server-side; the NEXT_PUBLIC_ prefix exposes it to the
   # browser bundle (intentional — Sentry's threat model accepts public DSNs).
   NEXT_PUBLIC_SENTRY_DSN=https://YOUR_DSN_HERE
   ```
4. **Add DSN to `.env.example`** (no secret — placeholder only) — same lines but with `https://YOUR_DSN_HERE`.
5. **Set both env vars in Vercel**: dashboard → Project Settings → Environment Variables → add `SENTRY_DSN` (Production scope) and `NEXT_PUBLIC_SENTRY_DSN` (Production + Preview). Trigger a redeploy.
6. **Verify**: hit a known-error path (e.g. malformed POST to a Zod-validated route or click a known crash boundary). Within 30s, the event lands in your Sentry project's Issues tab.

**Optional later:**
- `SENTRY_AUTH_TOKEN` — only needed for source-map uploads (better stack traces). Set up via `npx @sentry/wizard` if/when stack traces feel useful.
- Tune `tracesSampleRate` from 0.1 once you have a Sentry usage baseline.

**Why two env vars**: Next.js inlines `NEXT_PUBLIC_*` to the client bundle (server can read `SENTRY_DSN` privately). Both should be the same Sentry project DSN.

## Enrichment-source env vars (free-tier APIs added 2026-04-26)

Set in `.env.local` (development) and Vercel env (production). All optional — modules graceful-degrade to null when unset.

| Env var | Source | Free quota | Used by |
|---|---|---|---|
| `WEATHERSTACK_API_KEY` | weatherstack.com | 100/mo | `src/lib/enrichment/weatherstack.ts` (storm context per ZIP) |
| `NUMVERIFY_API_KEY` | numverify.com | 100/mo | `src/lib/enrichment/numverify.ts` (phone validation + line type) |
| `CLOUDMERSIVE_API_KEY` | cloudmersive.com | 800/mo | `src/lib/enrichment/cloudmersive.ts` (phone + address validation) |
| `APOLLO_API_KEY` | apollo.io | metered (~750/mo) | `src/lib/enrichment/apollo.ts` (contractor-only B2B principal lookup; gated on applicant_classification === "contractor") |

Cache TTLs are tuned per source:
- WeatherStack: 1h (weather changes hourly)
- Numverify: 30 days (phone metadata is static)
- Cloudmersive: 30 days (same)
- Apollo: 90 days (B2B principal data is very stable)

Free tier discipline:
- Always check `process.env.X_API_KEY` before calling
- Cache before hitting the wire
- Never throw — return null on error so the orchestrator continues

## Henri toolkit plugin (local)

`my-plugin/` ships 5 Henri-specific skills as a portable Claude Code plugin:

- `audit` — re-run the senior-engineer audit
- `wedge-verify` — verify all 6 wedge contract bullets in code
- `godmode-preview` — auto-tour the dashboard via god-mode dev login
- `apply-migrations` — apply pending Supabase migrations
- `truthfulness-scan` — scan for fabricated metrics + pricing forgeries

Test locally:

```bash
claude --plugin-dir ./my-plugin
```

Distribute by copying the directory to a marketplace repo or a teammate's `my-plugin/` path.

## claude-code-templates installs (2026-04-27)

Installed via `npx claude-code-templates@latest` to close audit gaps. Lives under `.claude/`:

**Agents** (`.claude/agents/*.md`)
- `llm-redteam-specialist` — closes audit F2 (`/api/ai/draft-reply` + `ChatIntakeModal` injection surface unaudited)
- `api-security-audit` — closes audit 04 F1 (2 POST handlers without Zod)
- `refactoring-specialist` — for the 1,028-LOC `ChatIntakeModal` + 1,004-LOC `LeadDetailDrawer`
- `test-engineer` — for the 5 untested critical modules (orchestrator, signals, locks, useLeads, re-enrich)
- `playwright-tester` — E2E coverage
- `postgresql-dba` — for the 133k-row leads table query tuning
- `ai-engineer` — for the LLM mining + outreach personalizer

**Commands** (`.claude/commands/*.md`)
- `supabase-type-generator` — closes the 53 `as unknown as` casts (auto-generates `src/types/database.ts`)
- `supabase-schema-sync` — keeps types ↔ migrations in sync
- `supabase-security-audit` — RLS policy audit
- `supabase-performance-optimizer` — Supabase-specific perf tuning
- `optimize-database-performance` — general SQL perf
- `performance-audit` — reusable perf audit
- `ci-pipeline` — fills the `no-CI` audit gap

**Hooks** (`.claude/hooks/*.py` — wired into `.claude/settings.local.json`)
- `secret-scanner.py` — blocks commits with AWS / OpenAI / Anthropic / Google / Stripe / Supabase keys
- `dangerous-command-blocker.py` — blocks `rm -rf /`, `dd of=/dev/*`, fork bombs, etc.

**Skills** (`.claude/skills/*/SKILL.md`)
- `supabase-postgres-best-practices` — RLS + Postgres rules
- `postgresql-optimization` — query tuning
- `react-best-practices` / `nextjs-app-router-patterns` — React 19 + Next 16
- `tanstack-query-expert` — `useLeads` / `useLeadCount` patterns
- `tailwind-design-system` — Tailwind v4 (we just hit a parser bug)
- `shadcn` — `src/components/ui/*` is shadcn-derived
- `zod-validation-expert` — closes Zod gaps on POST handlers
- `figma-implement-design` — for any future design-handoff
- `prompt-engineering` / `rag-engineer` — LLM prompts in `/api/ai/draft-reply`
- `pdf-processing` / `spreadsheet` — branded estimates + permit archive

**Failed to install** (registry didn't have these):
- `automation/lint-on-save`, `automation/nextjs-code-quality-enforcer` (hooks)
- One Tier 2 skill missing `SKILL.md`

**Did NOT install** (irrelevant to Henri's stack):
- All Azure / Microsoft / Shopify / Flutter / iOS / mobile / Kubernetes / Terraform / GraphQL items
- Any neon-* / mongodb / redis / power-bi / snowflake (Henri is pure Postgres/Supabase)

## Supabase plan + accepted-risk findings (2026-04-29)

Henri is on **Free plan** as of 2026-04-29. Live data: 1.4M permits + 165K leads → **~3-4 GB DB**, exceeding Free's 500 MB ceiling. Grace period ends 26 May 2026; **Pro upgrade ($25/mo) required by then**.

**Pro-gated security features deferred until upgrade:**
- `auth_leaked_password_protection` (HaveIBeenPwned check on signup) — Pro-only. Toggle returns "Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up." Documented as accepted-risk WARN until upgrade.

**Extension-owned advisor findings (cannot fix without superuser):**
- ~~`spatial_ref_sys` RLS disabled~~ → **CLOSED 2026-05-06 via migration 00080.** PostGIS was installed in `public` (migration 00001) but turned out to be dead code — the only dependent column (`permits.location`, `geography(Point,4326)`) was empty across all 1,414,624 permit rows, and no migration or src/ code used any spatial function. `DROP EXTENSION postgis CASCADE` removed `spatial_ref_sys`, `geography_columns`, `geometry_columns`, and the empty `permits.location` column in one shot. Advisor finding `rls_disabled_in_public` for `spatial_ref_sys` is now mechanically impossible (the table no longer exists). If a future feature needs PostGIS, install it in the `extensions` schema (`CREATE EXTENSION postgis SCHEMA extensions`) so `spatial_ref_sys` doesn't re-land in `public`.
- `st_estimatedextent(...)` 3 PostGIS variants (SECURITY DEFINER, anon/authenticated callable) — also gone after migration 00080's `DROP EXTENSION postgis CASCADE`.

**Intentional design (documented in 00059/00060 migrations):**
- `claim_territory`, `release_territory`, `get_or_create_referral_code` — SECURITY DEFINER, EXECUTE granted to authenticated only. Called from authenticated app routes; intentional.
- `get_zip_availability` — SECURITY DEFINER, EXECUTE allowed for anon (public ZIP-availability widget on `/portal`).
- `intakes_insert_anon` / `reviews_insert` policies use `WITH CHECK (true)` — public homeowner intake + token-based review submission. Mitigated by app-layer rate limiter in `/api/intake` (5/hr/IP) + token validation in `/api/reviews`.
- `ppp_loans`, `voter_fl/nc/oh` RLS-enabled-no-policy — service-role cron writes only, no policy-gated reads needed (service-role bypasses RLS).

**Migrations 00056–00060 (audit-04-29):**
- 00056: `cost_benchmarks` RLS hole (CRITICAL — closed)
- 00057: `zip_demand_scores` RLS hole + 2 functions with mutable search_path (CRITICAL/HYGIENE — closed)
- 00058: Initial SECURITY DEFINER role-revokes (superseded by 00059)
- 00059: Real fix — REVOKE EXECUTE FROM PUBLIC + GRANT to authenticated (closed 7 functions)
- 00060: Lock `contractor_leaderboard` materialized view to service-role

## Hooks status (2026-04-27 mid-session): the claude-code-templates install shipped 4 Vercel bash hooks (`vercel-environment-sync`, `vercel-auto-deploy`, etc.) with broken single-quote escaping that fired a syntax error on EVERY `Edit` call, blocking every edit. Stripped them out via `python -c json.del('hooks')` and re-added only the 2 working Python hooks (`secret-scanner.py`, `dangerous-command-blocker.py`). If you ever re-install Vercel hooks via `claude-code-templates`, double-check the `bash -c 'INNER'` quoting before they reach `.claude/settings.local.json`.

## Karpathy guidelines + ECC install (2026-04-27)

Layered on top of the claude-code-templates install. Two GitHub repos:

**`forrestchang/andrej-karpathy-skills`** — 1 skill, all-relevant
- `.claude/skills/karpathy-guidelines/` — Four behavioral principles for LLM coding (Think Before Coding · Simplicity First · Surgical Changes · Goal-Driven Execution). Directly addresses: silent assumption-making, overcomplication, unnecessary edit creep, missing success criteria. Trigger automatically when writing/reviewing/refactoring code.

**`affaan-m/everything-claude-code`** — filtered to 21 relevant items (out of 48 agents / 79 commands / 183 skills)

Agents (`.claude/agents/`)
- `architect.md` / `code-architect.md` — system + code design
- `code-reviewer.md` — PR reviews
- `database-reviewer.md` — Postgres-specific reviews
- `typescript-reviewer.md` — Henri is TS
- `security-reviewer.md` — security audits
- `performance-optimizer.md` — perf
- `refactor-cleaner.md` — for the 1k-LOC files
- `pr-test-analyzer.md` — PR test gap analysis

Commands (`.claude/commands/`)
- `code-review.md` — local diff or PR review
- `harness-audit.md` — audit the .claude/ harness itself
- `review-pr.md` — multi-agent PR review
- `test-coverage.md` — coverage analysis

Skills (`.claude/skills/`)
- `nextjs-turbopack` — direct match, we just hit a Turbopack 16.2.3 parser bug
- `postgres-patterns` — Postgres tuning + RLS
- `prompt-optimizer` — for `/api/ai/draft-reply` + outreach personalizer
- `claude-api` — Anthropic SDK patterns
- `e2e-testing` — Playwright POM + flaky-test handling
- `security-review` — auth/input/secrets/endpoint patterns
- `security-scan` — scans `.claude/` for vulnerabilities
- `api-design` — REST patterns for the 98 API routes

**Skipped from ECC** (not Henri's stack): cpp-* / csharp-* / flutter-* / go-* / java-* / kotlin-* / rust-* / python-testing / healthcare-reviewer / springboot-security / laravel-security / perl-* / swift-* / defi-amm-security / llm-trading-agent-security / django-security / golang-testing.

**Total `.claude/` inventory now**: 16 agents · 28 commands · 22 skills · 2 hooks (Python only).

## Knowledge Work Plugins + Anthropic official plugins (2026-04-27)

Two marketplaces registered (visible via `claude plugin marketplace list`):
- `anthropics/knowledge-work-plugins` — 11 role-based plugins
- `anthropics/claude-plugins-official` — internal Anthropic plugins

**Knowledge Work plugins installed** (all 11):
- `productivity` — TASKS.md, memory, daily workflows
- `sales` — lead research, call prep, pipeline review, outreach drafts
- `customer-support` — ticket triage, response drafts, KB articles
- `product-management` — specs, roadmap, sprint planning, stakeholder updates
- `marketing` — content drafts, campaigns, brand voice review, SEO audits
- `legal` — NDA triage, contract review, compliance, risk assessment
- `finance` — journal entries, reconciliation, financial statements (Stripe revenue analysis)
- `data` — SQL writing, dataset analysis, dashboard building
- `enterprise-search` — cross-source search, daily/weekly digests
- `bio-research` — installed for completeness; NOT relevant to Henri
- `cowork-plugin-management` — for customizing the above plugins

**Official plugins installed** (8 of 30):
- `code-review` — multi-agent PR review with confidence scoring
- `code-simplifier` — refactoring agent
- `commit-commands` — `/commit`, `/push`, `/create-pr` git workflow
- `feature-dev` — full feature dev workflow (explore → design → review)
- `frontend-design` — UI/UX implementation skill
- `pr-review-toolkit` — specialist agents (comments, tests, error handling, type design, code quality, simplification)
- `security-guidance` — hook that warns on command injection / XSS / unsafe patterns
- `claude-md-management` — keeps this file (CLAUDE.md) audited and current

**NOT installed** (irrelevant):
- All LSP plugins (`clangd-lsp`, `csharp-lsp`, `gopls-lsp`, `jdtls-lsp`, `kotlin-lsp`, `lua-lsp`, `php-lsp`, `pyright-lsp`, `ruby-lsp`, `rust-analyzer-lsp`) — Henri is TS/JS only
- Meta-tools (`example-plugin`, `playground`, `hookify`, `plugin-dev`, `agent-sdk-dev`, `mcp-server-dev`) — not building plugins/SDK
- Output styles (`learning-output-style`, `explanatory-output-style`) — preference, can install later
- `math-olympiad`, `ralph-loop`, `session-report`, `skill-creator` — niche

**Total active plugins**: 19 (verify with `claude plugin list`).

The user-level scope means these are available across all sessions, not just Henri. Henri-specific commands (`audit`, `migrate`, `verify`, etc.) live in `.claude/commands/` at the project level and take precedence on slash-name conflicts.

## Polydao curation install (2026-04-27)

Per the polydao tweet "I FOUND 1,116 CLAUDE CODE SKILLS FROM 500+ REPOS" — added curated repos that aren't in the official marketplaces:

**16 ACCCT skills** (`rohitg00/awesome-claude-code-toolkit`, copied to `.claude/skills/`):
- `accessibility-wcag` · `api-design-patterns` · `authentication-patterns` · `ci-cd-pipelines`
- `database-optimization` · `frontend-excellence` · `llm-integration` · `mcp-development`
- `nextjs-mastery` · `performance-optimization` · `postgres-optimization` · `security-hardening`
- `tdd-mastery` · `testing-strategies` · `typescript-advanced` · `claude-memory-kit`

**4 Lev Nikolaevich plugins** (`levnikolaevich/claude-code-skills` marketplace) — registered as `levnikolaevich-skills-marketplace`:
- `codebase-audit-suite` — 20 specialized auditors (security, build, code-quality, dead-code, observability, concurrency, lifecycle, test, dependencies, etc.)
- `optimization-suite` — performance profiler / dependency upgraders / code modernization / bundle optimizer / benchmark compare
- `documentation-pipeline` — docs auditor + doc generator
- `project-bootstrap` — scaffolding, Docker, CI/CD setup

**1 MCP server** (`@levnikolaevich/hex-graph-mcp` via npx) — registered to `~/.claude.json` for this project:
- Indexes Henri's 68k LOC into a SQLite code graph via tree-sitter AST
- 14 tools: `find_symbols`, `inspect_symbol`, `find_references`, `find_implementations`, `trace_paths`, etc.
- Game-changer for refactoring the 1,028-LOC `ChatIntakeModal` and 1,004-LOC `LeadDetailDrawer` — semantic blast-radius analysis before any change

**Skipped**:
- ACCCT: aws-cloud-patterns / django / docker / golang / kubernetes / microservices / mobile / redis / rust / springboot / websocket-realtime (not Henri's stack)
- Lev: agile-workflow / community-engagement / setup-environment (not relevant for solo founder)

**Final inventory** (verify via `claude plugin list` and `ls .claude/`):
- **24 active plugins** across 5 marketplaces (knowledge-work-plugins · claude-plugins-official · levnikolaevich-skills-marketplace · timescale/pg-aiguide · plus pre-existing user-level Apollo / common-room / brand-voice / etc.)
- **39 project skills** in `.claude/skills/` (filtered subset from claude-code-templates + Karpathy + ECC + ACCCT + official Supabase)
- **16 project agents** in `.claude/agents/`
- **28 project commands** in `.claude/commands/`
- **2 Python hooks** in `.claude/hooks/` (secret-scanner + dangerous-command-blocker)
- **2 new MCP** servers: `hex-graph-mcp` (semantic code graph) + `pg-aiguide-docs` (Tigerdata Postgres docs MCP at `https://mcp.tigerdata.com/docs`)

## aitmpl.com curation install (2026-04-27 evening)

After inspecting [aitmpl.com](https://www.aitmpl.com/plugins) plugin directory, two stack-perfect additions for Henri:

**`timescale/pg-aiguide`** — registered as `aiguide` marketplace, installed `pg@aiguide` plugin
- Postgres MCP server + skill from Timescale (via Tigerdata)
- Version-aware semantic search across the official Postgres manual
- Curated, opinionated Postgres best-practices skills
- Direct value: every Postgres-touching change in Henri (migrations, indexes, query tuning, RLS policies) gets official Postgres docs context for free

**`supabase/agent-skills` (official Supabase team)** — copied `supabase` skill to `.claude/skills/supabase-official`
- Trigger: "ANY task involving Supabase" (Database, Auth, Edge Functions, Storage, Realtime, RPC)
- Maintained by Supabase's own engineering team
- Direct value: closes the gap where claude-code-templates' generic `supabase-postgres-best-practices` skill was Postgres-only — this one covers the FULL Supabase surface area Henri uses (auth, RLS, RPC, realtime, edge)

**Considered but skipped** (already covered or overkill):
- Claude Mem (session context capture) — partially covered by Henri's CLAUDE.md + memory plugin
- Claude Octopus / Claude Code Plugins Plus Skills — aggregator-style mega-installs, would saturate context
- Claude Hud (context-usage HUD) — nice-to-have, not load-bearing
- Knowledge Work Plugins / Claude Plugins Official — already installed earlier this session
- Senior {Frontend,Backend,Fullstack,Reviewer} skills from aitmpl.com — already loaded at user scope

## Sidecar canonical-data-layer (2026-05-01, Wave 1.5 + 2.A + 2.B)

The 14-day data-acquisition plan from `~/.claude/plans/whats-the-14-days-purring-papert.md` is fully shipped. Built 18 sidecar tables + 16 cron routes + 8 migrations on top of Henri's existing permits/leads infra. Service-role-write only, RLS-on-no-policies (matches accepted-risk pattern from voter_*, ppp_loans).

**Migrations 00069–00076**:
- 00069: weather_swdi_hail / wind / tornado, liens_courtlistener, foreclosures_fha, quakes_usgs (Wave 1)
- 00070: risk_nri_county, risk_nri_tract, svi_tracts, demo_acs_zcta (Wave 2.A)
- 00071: claims_disasters_fema, triggers_news_gdelt, mortgages_hmda (Wave 2.B Phase 1)
- 00072: SWDI lat/lng precision bump from numeric(8,5) → numeric(10,7) (Wave 1.5 fix; collapsing 33k radar pixels into 1k via 5-decimal precision)
- 00073: claims_nfip, claims_ia, zip_crosswalk_hud, state_license_rosters, contractor_license_sources (Wave 2.B Phase 2)
- 00074: verified-live state license endpoint URLs (TX/NY/WA/OR seeded after per-state probe)
- 00075: source_kind 'csv' added; AZ ROC re-enabled with `${YYYY-MM-DD}` placeholder URL pattern
- 00076: cron_runs audit log (per-execution forensic trail for silent-failure detection)

**Cron routes** (all under `/api/cron/`, all CRON_SECRET-Bearer-auth, all wrapped with `logCronRun` helper):
- Wave 1: swdi-events, courtlistener-liens, usgs-quakes, hud-reo, census-geocode
- Wave 2.A: fema-nri, cdc-svi, census-acs (Sunday weekly)
- Wave 2.B.1: openfema-declarations, gdelt-triggers, hmda-rotate (daily, hmda rotates state/year)
- Wave 2.B.2: openfema-nfip (year rotator 1978-current), openfema-ia (disaster rotator), state-licenses-rotate (most-overdue picker), hud-zipxw (Sunday weekly)
- Ops: cron-runs-cleanup (daily, 30-day retention)

**Scoring engine extensions** (`src/lib/scoring/model.ts` + `signals.ts`):
- Two new optional ScoringSignals fields: `stormProximity24h` (0-100), `recentLienCount`
- Two additive boosters: `storm` (0-5), `lien` (0-3) — fold into total via `Math.min(100, …)` so existing 75/50/25 urgency thresholds stay stable
- SCORE_SIGNAL_ORDER renders 8 rows in the drawer breakdown but the 2 boosters carry `optional: true` and only render when scored >0 (keeps drawer clean for leads with no nearby storm/lien)
- Score cron pre-fetches SWDI events from last 24h + lien counts by state-prefix once per run, then does in-memory bbox + haversine per permit (avoids 5,000 round-trips). Graceful-degrade — when sidecar tables are empty, signals fall through to null and boosters stay 0.

**Lead drawer surfaces** (`/api/leads/[id]/context` + `PropertyContextSection.tsx`):
- New "Recent storm signatures (25mi · 30d)" panel — hail / wind / tornado from migration 00069 SWDI tables
- New "Payment-distress filings nearby (90d)" panel — CourtListener mechanic-lien dockets, linked to the upstream URL when available
- Both panels graceful-hide when their data is empty — no empty-card noise

**Admin observability** (`/dashboard/settings/data-health`):
- God-mode-only freshness panel for all 17 sidecar tables: total rows, last 24h inserts, last ingest timestamp, status chip (ok / stale / empty / error)
- Per-row "Run now" button → POST /api/admin/data-health/trigger fires the cron server-to-server with CRON_SECRET (browser never sees it). UI shows pulled / inserted / duration_ms inline.
- "Trigger all needy" button — sequentially fires every cron whose status is non-ok. Workflow shortcut after deploys.
- Recent-run mini-chips per cron from cron_runs (last 5, green/red/amber). Hover tooltip: trigger mode / timestamp / duration / inserted / error.

**State license endpoint registry** (`contractor_license_sources` table):
- Drives `/api/cron/state-licenses-rotate` — picks the most-overdue enabled state per daily run.
- 5 verified-live: TX TDLR (socrata), NY NYC DCWP (socrata), WA L&I (socrata), OR CCB (socrata), AZ ROC (csv with date-substitution).
- 4 disabled with documented reasons: CA CSLB (ASP-postback only), FL DBPR (CSV-only 668MB — sidecar work), IL IDFPR (PDF-only), NC NCLBGC (email-request only), GA SOS (paid roster).
- New states get added by INSERTing a row with field_map mapping our canonical schema → upstream column names. The rotator's existing CSV/Socrata/ArcGIS/scrape dispatch picks it up on next run.

**Trigger script**: `scripts/trigger-data-crons.ts` — reads CRON_SECRET from .env.local, hits all 11 main routes sequentially with 2s pacing. CLI fallback for the dashboard "Trigger all needy" button.

**Test coverage** (Wave 1.5):
- `src/lib/scoring/__tests__/scoring.test.ts` — 13 new booster-path cases (null → 0, magnitude tiers, sum-cap-at-100, factor strings)
- `src/lib/scoring/__tests__/signals.test.ts` — 4 new optional-row visibility cases
- All 66 scoring tests pass; 640 total in repo

**Known gaps left as follow-up work**:
- HMDA full historical back-fill — currently rotates one state per day across 52 states × 7 years = ~12 months to fully populate. Faster path: deploy `henri_production/` Python sidecar to a $5/mo Hetzner VM.
- Wave 3 Track-B platform adapters (Accela ACA, eTRAKiT, Cloudpermit) — need Playwright + ASP.NET ViewState scraping. ~4-8 engineering weeks.
- FL DBPR (state contractor licenses) — 668MB CSV, doesn't fit Vercel's 280s budget. Sidecar VM work.
- OpenGov ViewPoint — migrated to GraphQL+Auth0; old REST endpoint dead. Needs Playwright + Auth0 token interception.
- 4 dead-end states (CA, IL, NC, GA) — no public bulk endpoint exists. Needs scraper or paid roster.

**User actions still required**:
- `CL_TOKEN` env var in Vercel (free token at courtlistener.com → Profile → API). Without it, `liens_courtlistener` stays empty.
- Per-state research budget if we want to grow beyond the 5 enabled state license sources (most state license boards don't ship public APIs).

## Wave 2.C + post-data wiring (2026-05-02)

After ingesting ~308k canonical sidecar rows we did a full gap audit and shipped everything Henri-app-side that USES the data. Most of the data was sitting in tables unused. Closing that gap was the work today.

**Migrations 00077–00078**:
- 00077: `code_violations` (long-format multi-jurisdiction Socrata: NYC DOB / Chicago / SF) + `wildfires_nifc` (current-year NIFC ArcGIS)
- 00078: 4 starter outreach templates with disaster-context tokens

**3 new cron routes** (`/api/cron/`):
- `code-violations` (daily 08:00 UTC) — 90-day rolling window from 3 verified-live Socrata feeds
- `nifc-wildfires` (daily 08:30 UTC) — current-year fire incidents, IRWIN ID dedup
- `activate-arcgis-sources` (daily 07:00 UTC) — flips 50 of the 2,364 newly-imported ArcGIS endpoints from `enabled=false` → `enabled=true` per day, NC/SC/TN/VA wedge states first. ~47 days to fully ramp.

**6 stopgap permit endpoints** added directly to `permit_sources` (probed live 2026-05-02): Little Rock AR, Portland ME, Jackson MS, Albuquerque + Santa Fe NM, Tulsa OK, Cheyenne + Casper WY. Closes the AR/ME/MS/NM/OK/WY coverage gap from the v5 audit. All 8 have `discovered_via='six_state_stopgap_2026-05-02'`.

**Scoring engine extensions** (commit `028ab20`):
- 5 additive boosters total: storm 5 + lien 3 + nri 3 + nfip 2 + quake 2 = 15 pts max
- All cap into the 100-pt total via Math.min so urgency thresholds (75/50/25) hold
- Score cron pre-fetches risk_nri_county / claims_nfip / quakes_usgs once per run, in-memory bbox+haversine per permit
- All graceful-degrade — null signals = 0 boost, no behavior change when sidecars empty

**Lead drawer surfaces** (commit `028ab20`):
- 6 panels in `PropertyContextSection`: derived equipment + neighborhood + storm + SWDI + liens + NRI + NFIP + recent FEMA disasters
- All graceful-hide when the data is empty

**Admin sub-pages under `/dashboard/settings`** (commit `a9791cf`):
- `/data-health` — 19-table freshness panel + recent-run mini-chips + manual triggers + "trigger all needy"
- `/news-triggers` — GDELT pre-permit news signals (459 articles, filterable by query + window)
- `/foreclosures-reo` — FHA REO listings (622 pre-listing-prep leads, filterable by state/ZIP)
- All godmode-only via `isGodModeEmail()`

**Onboarding license cross-check** (commit `d7d4f24`):
- `POST /api/onboarding/verify-license` cross-checks (state, license_number) against `state_license_rosters`
- 5 supported states (TX/NY/WA/OR/AZ); 45 fall through to manual review
- Inline status pill in `/onboarding/license` form (debounced 700ms)
- On submit: stamps `verified=true` + `verification_status='verified_state_roster'` when match found

**Outreach disaster-context tokens** (commit `278868e`):
- 7 new tokens: `{{nfip_claim_count}}` / `{{nri_risk_score}}` / `{{nri_risk_tier}}` / `{{recent_disaster_id}}` / `{{recent_disaster_title}}` / `{{storm_count_30d}}` / `{{lien_count_90d}}`
- Token regex extended `[a-z0-9_]+` so digit-suffixed names match
- 24 new tests in `src/lib/outreach/__tests__/tokens.test.ts` (first test file for the package)

**Test coverage additions today**:
- `src/lib/outreach/__tests__/tokens.test.ts` — 24 cases (resolver invariants + KNOWN_TOKENS surface + zero-count guards)
- `src/lib/admin/__tests__/cron-log.test.ts` — 5 cases (`detectTrigger` HTTP standard semantics)
- `src/lib/auth/__tests__/god-mode.test.ts` — 13 cases (allowlist + env-var override + lockdown)

**Total inventory after 2026-05-02**:
- 21 sidecar tables (was 18) + cron_runs audit log
- 19 cron routes (was 16)
- ~308k rows ingested + ongoing autonomous fill
- 712 unit tests passing (was 640 at session start, +72)
- 5 score boosters / 6 lead-drawer panels / 3 admin sub-pages / 1 onboarding cross-check / 7 outreach tokens / 4 starter templates

**Henri-app utilization of sidecar data after this session**:
| Sidecar | Surfaces using it |
|---|---|
| weather_swdi_* | Score booster + drawer panel + outreach token |
| liens_courtlistener | Score booster + drawer panel + outreach token |
| risk_nri_county/tract | Score booster + drawer panel + outreach token |
| claims_nfip | Score booster + drawer panel + outreach token |
| claims_disasters_fema | Drawer panel + outreach token |
| quakes_usgs | Score booster |
| state_license_rosters | Onboarding cross-check (TX/NY/WA/OR/AZ) |
| triggers_news_gdelt | `/dashboard/settings/news-triggers` admin page |
| foreclosures_fha | `/dashboard/settings/foreclosures-reo` admin page |
| code_violations *(new)* | Pending wiring — daily 08:00 UTC fill starts tomorrow |
| wildfires_nifc *(new)* | Pending wiring — daily 08:30 UTC fill starts tomorrow |
| claims_ia | Drawer panel (via disaster declarations) |
| mortgages_hmda | None yet (sparse) |
| demo_acs_zcta | None yet (Sunday cron) |

## Sidecar pruning (audit 2026-05-02 retrospective, migration 00079)

After Wave 2.C shipped we paused to audit which sidecars actually
reach the contractor surface (drawer / scoring / outreach / onboarding)
vs. which were collected-but-never-read. Six tables were dropped:

| Dropped sidecar | Cron unscheduled | Reason |
|---|---|---|
| `svi_tracts` | `cdc-svi` | CDC SVI Socrata feed deprecated; ATSDR ArcGIS endpoint requires auth |
| `demo_acs_zcta` | `census-acs` | 236k rows but zero readers in src/ — demographics belong in onboarding capacity_prefs, not per-lead |
| `mortgages_hmda` | `hmda-rotate` | 2 rows after weeks of state-rotation; rotator approach too slow for Vercel cron, defer to Hetzner sidecar |
| `zip_crosswalk_hud` | `hud-zipxw` | HUD requires authenticated form download; stateless cron can't reauthenticate |
| `code_violations` | `code-violations` | 11k rows ingested today but no drawer/scoring/outreach consumer; pause until consumer ships |
| `wildfires_nifc` | `nifc-wildfires` | 603 rows ingested today but no drawer/scoring/outreach consumer; pause until consumer ships |

Cron route files at `src/app/api/cron/{cdc-svi,census-acs,hmda-rotate,hud-zipxw,code-violations,nifc-wildfires}/route.ts` are kept on disk for fast re-enable when the consumer side is built. They're just removed from `vercel.json` schedule + the admin-trigger ALLOWED set + the data-health freshness panel.

**Post-prune inventory**:
- 15 sidecar tables (was 21)
- 13 cron routes (was 19) — 6 unscheduled but kept on disk
- Score booster math unchanged (only NRI fires regularly anyway; the 5 boosters max 15 pts)
- Score realism: top score in production is 61/100, hot threshold is 75. The cap is contact-completeness sparsity (39% owner_name, 1% phone), NOT a missing sidecar — adding more data sources won't move it. Next sprint focuses on contact enrichment (Numverify / Cloudmersive / Apollo) instead of new sources.

The pruning rationale lives in detail at `~/.claude/plans/whats-the-14-days-purring-papert.md` ("2026-05-02 retrospective" section).

## Hetzner Scrapling sidecar (2026-05-04, Wave 3 kickoff)

The 14-day plan's "Wave 2 Hetzner sidecar" finally shipped tonight. Scope: a $20/mo Hetzner VPS that runs Scrapling-driven loaders Henri's Vercel cron can't (Cloudflare-protected state portals, JS-rendered SPAs, voter file forms, hardened license rosters).

### Server inventory
- **Provider**: Hetzner Cloud
- **Project**: `henri-sidecar`
- **Server**: `henri-scrapling-sidecar`
- **Type**: **CCX13** (dedicated 2 vCPU / 8 GB RAM / 80 GB SSD) — €19.99/mo. CX22 wasn't available in HIL Oregon; CCX13 is dedicated CPU which actually wins for headless Chromium scraping.
- **Region**: 🇺🇸 Hillsboro OR (HIL, us-west) — closest Hetzner DC to Supabase's N. California region (~25ms RTT).
- **Public IPv4**: `5.78.152.250`
- **OS**: Ubuntu 24.04 LTS
- **Backups**: enabled (€0.90/mo, weekly)
- **Total cost**: ~$22/mo all-in.

### SSH access
- Key: `~/.ssh/henri_sidecar` (ed25519, passphrase-protected) on the founder's Windows machine.
- Public key fingerprint: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBMqeIPlyrjGT5IvCXg/yztHM6LtVqb/Rib3zK+lfogg henri-sidecar`
- User: `henri` (non-root, NOPASSWD sudo via cloud-init).
- Login command: `ssh -i $HOME\.ssh\henri_sidecar henri@5.78.152.250`
- Root SSH **disabled** (cloud-init hardening). Console-level fallback uses Hetzner's web serial console + the project SSH key.

### Cloud-config (the version that worked)
A previous cloud-config used `runcmd: useradd -G sudo henri` which created `henri` with a locked password — sudo prompted but no password existed. The fix was to use cloud-init's native `users:` directive with `sudo: ALL=(ALL) NOPASSWD:ALL`. The working YAML is committed at `scripts/_hetzner_cloud_config.yaml` for re-use when scaling out.

### Stack on the box
- `~/scrapling-env/` — Python 3.12 venv with Scrapling 0.4.7 + Playwright 1.x + Chromium + Firefox
- `~/.henri-sidecar.env` (chmod 600) — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SIDECAR_REGION`, `SIDECAR_HOSTNAME`
- `~/scrapling_loaders/` — Python loaders, one per source
- `~/scrapling_loaders/run.sh` — wrapper that sources env + activates venv + runs a loader, used by cron
- `~/scrapling-loaders.log` — append-only log (every cron fire writes one block)

### Pipeline (proven 2026-05-05 ~01:50 UTC)
```
Hetzner CCX13
  └─→ Scrapling Fetcher (with stealth headers)
       └─→ Austin Socrata API (data.austintexas.gov)
            └─→ JSON parse
                 └─→ map permit_class/work_class → Henri's permit_type enum
                      └─→ map status_current → Henri's permit_status enum
                           └─→ Supabase REST POST (/rest/v1/permits)
                                └─→ Prefer: resolution=merge-duplicates → idempotent upsert via uq_permits_source
                                     └─→ Henri permits table (1.4M+ rows, +50 from this loader)
```

First loader: `~/scrapling_loaders/load_austin.py`. Pulls 50 most recently issued Austin TX construction permits, maps to Henri schema, upserts. ~1 second wall time. Cron schedule: `30 */4 * * *` (every 4h at :30 past — 6 runs/day).

### What's confirmed working
- Cloudflare-protected pages: tested with `nopecha.com/demo/cloudflare`, `solve_cloudflare=True` solved the turnstile in 13 seconds.
- Supabase service-role write from external IP: tested with the Austin loader, status 201/200 on insert/update.
- Idempotent re-runs: second run returned 200 (PostgREST UPDATE) instead of 201 (CREATE). uq_permits_source dedup works.

### Phase scope (2-4 weeks for full nationwide coverage)
1. **Phase 1 — Generic Socrata loader (this session, IN PROGRESS)**: refactor Austin into config-driven loader. ~50 cities use Socrata; covers ~50% of US permit volume.
2. **Phase 2 — Generic Tyler EnerGov loader**: Tyler's REST `/api/v2/records` is consistent. ~80 cities (TX, GA, FL, NC). +30%.
3. **Phase 3 — Generic ArcGIS Open Data loader**: ~150 county portals. +10%.
4. **Phase 4 — Per-platform Scrapling stealth scrapers**: Accela ACA / eTRAKiT / Cloudpermit / SmartGov. Hardest, ~1 week per platform.

### Operational notes
- Loader logs: `tail -f ~/scrapling-loaders.log`
- Crontab: `crontab -l`
- DB writes go through `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS — same pattern as Vercel-side cron writers.
- The sidecar never serves user traffic; it's a one-way pipe (scrape → Supabase). If the box dies, Henri's UI keeps serving from existing data — no user-visible outage.
- **Service-role JWT was exposed in chat once** (2026-05-04 ~01:35 UTC during env-file setup debugging). Schedule a rotation via Supabase dashboard → Project Settings → API → "Reset service_role secret" when convenient. Then update `~/.henri-sidecar.env` on the box AND Vercel env AND any local `.env.local`.

## Pre-launch $0 push (2026-05-05)

Audit aligned the work to two tiers of launch blockers and rejected anything that costs money or is post-revenue scope. Goal: soft-launch to 5 contractors at $149/mo on a $0 marginal-spend stack. New artifacts shipped this session:

**TIER 1 (must-fix-before-charging) deliverables**:
- `scripts/cleanup-test-territories.sql` — two-step (preview → transactional DELETE) to drop the ~11,444 god-mode-claimed territories. Uses `god-mode.ts` allowlist (2 founder emails; extend array to 4 if more exist). Idempotent — safe to re-run.
- `e2e/onboarding-stripe.spec.ts` — Playwright smoke for `/signup → /onboarding/license → /plan → /payment → Stripe checkout → /territory → /dashboard`. Asserts no 5xx, no console errors, prices match source-of-truth ($149/$749/$1,499/$2,555), Stripe in test mode (`pk_test_` prefix), no password input field (passwordless brand rule). Full happy-path is sketched in a comment block; needs an auth bypass (`/api/dev/login-as`) or a Mailpit interceptor to run end-to-end.
- `scripts/_sidecar_loaders/UPLOAD.md` extended with §7 (Tyler EnerGov deploy), §8 ($0-tier API-key checklist for Vercel), §9 (NC + OH voter ingest one-liners). FL voter file deferred — public-records fee may apply.

**TIER 2 deliverables**:
- `scripts/_sidecar_loaders/load_energov.py` — Phase 2 nationwide-coverage loader. Generic Tyler EnerGov POST-search wrapper, mirrors `load_socrata.py` shape (YAML config in, normalized rows upserted to `permits` via PostgREST). Optional Cloudflare bypass via DynamicFetcher when a tenant is CF-fronted. Cron-ready: `0 */4 * * * load_energov.py --all-energov` (staggered :00 vs Socrata :30).
- `scripts/_sidecar_loaders/probe_energov.py` — companion probe. POSTs a default 7-day search payload, auto-locates the records array (`data` / `results` / `records` / `items`), prints all keys + the Tyler-canonical likely-fields. Used to fill a city's YAML without DevTools.
- `scripts/_sidecar_loaders/configs/atlanta-energov.yml` — starter config (`status: unverified`). Doc comment lists real Tyler EnerGov candidate cities to copy-paste-modify: Augusta GA, Savannah GA, Plano TX, Frisco TX, Lubbock TX, Greensboro NC, Cary NC, Wilmington NC, Tampa FL.

**Hunter free-tier protection (orchestrator change)**:
- `src/lib/enrichment/orchestrator.ts` line 651 — Hunter gate tightened. Previous gate `!result.email && businessName` fired on every enrichable lead, including homeowner permits (where `applicant_name` is the homeowner's personal name, treated as a fake "business name" and burning the 25/mo budget). New gate requires BOTH `applicant_classification === "contractor"` AND `ctx.contractor_name` (not the applicant_name fallback). Cuts Hunter calls ~95% so the 25/mo free tier lasts.

**The $0 enricher stack** (all wired in `orchestrator.ts`, all need only env-var provisioning):
| Vercel env var | Provider | Free quota |
|---|---|---|
| `HUNTER_API_KEY` | hunter.io | 25/mo (now score-gated) |
| `GOOGLE_PLACES_API_KEY` | console.cloud.google.com | $200/mo credit (~10k req) |
| `OPENCORPORATES_API_KEY` | opencorporates.com | 500/day |
| `FEC_API_KEY` | api.fec.gov/developers | 1,000/hour |
| `NUMVERIFY_API_KEY` | numverify.com | 100/mo |
| `CLOUDMERSIVE_API_KEY` | cloudmersive.com | 800/mo |
| `CL_TOKEN` | courtlistener.com | unlimited |

**Apollo (`APOLLO_API_KEY`) is intentionally deferred** — paid floor (~$49/mo cheapest). Plan: launch on NC + OH voter coverage (free phone source for those 2 states), prove revenue, fund Apollo from first MRR.

**Explicitly NOT done** (out of $0 launch scope per Tier-3 rejection list): Wave 3 platform adapters (Accela ACA / eTRAKiT / Cloudpermit), HMDA / SVI / ACS rotators (already pruned in 00079, staying pruned), LLM Layer 2 mining ($90/mo), FL voter file (public-records fee), MLS / insurance claims / consumer phone lists, tribal-land permits, Henri-on-Hetzner migration, refactor of LeadDetailDrawer / ChatIntakeModal, new top-level dashboard tabs, more cities beyond the 10 already configured (verify those 10 first), code violations / wildfires_nifc resurrection.

**Pre-launch action sequence (~6h, $0)**:
1. **Rotate the exposed service-role key FIRST** (per the 2026-05-04 note above — blocking for outside contractor signups). Update Hetzner env + Vercel env + `.env.local`.
2. Provision the 7 free-tier env vars (~20 min). Redeploy Vercel.
3. Run `cleanup-test-territories.sql` STEP 0 → confirm count → run STEP 1 transactionally.
4. SCP `_sidecar_loaders` → Hetzner per `UPLOAD.md`. Smoke-test Austin. Probe + verify the other 9 Socrata cities (only Austin carries the `# Verified working` marker — budget ~10 min/city).
5. Download NC + OH voter files in background; ingest while doing the Stripe E2E pass.
6. Run `pnpm exec playwright test e2e/onboarding-stripe.spec.ts` against staging.

## 16-stale-state research + Phase 3 ArcGIS loader (2026-05-06)

Filled the data gap for the 16 states listed in CLAUDE.md as "configured but stale" (ME, MI, MN, MS, MT, NV, NH, NJ, ND, OK, RI, TN, UT, VT, WV, WY). Methodology: 4 parallel research subagents, each covering 3-5 states with live HTTP probing of every reported URL. Full report at [docs/permit-catalog/16-stale-states-2026-05-06.md](docs/permit-catalog/16-stale-states-2026-05-06.md).

**Outcome**: 8 of 16 states now have at least one verified live API endpoint; the other 8 are confirmed scrape-or-skip territory (Phase 4 backlog).

**The single highest-value finding — NJ DCA statewide aggregator**:
- `https://data.nj.gov/resource/w9se-dmra.json` (Socrata)
- 2,744,640 permits, 60-month rolling window, ~600-700k/yr.
- N.J.A.C. 5:23-4.5(d) legally requires every NJ municipality to report monthly. One endpoint covers the entire state.
- Trade fee fields: `buildfee`, `plumbfee`, `electfee`, `firefee`, `elevfee` per record — direct trade attribution.
- Config: `nj-dca-statewide.yml`. Replaces all per-city NJ scraping (Newark, Jersey City, Paterson, Elizabeth, Edison are all included in DCA).

**The single highest-quality finding — Bozeman MT**:
- `https://gisweb.bozeman.net/arcgis/rest/services/Internal/Building_Permits/MapServer/1/query` (ArcGIS MapServer)
- ~720 active records / ~1.5-2k/yr — small volume but the only US dataset found that publishes `CONTRACTOR_EMAIL` AND `CONTRACTOR_PHONE_1` in the public REST response. Direct fix for Henri's 1%-phone-fill ceiling within MT territory.
- Config: `bozeman-mt.yml`. The contact fields land in `raw_json`; a follow-up `bozeman_contact_extractor` pass should mine them out.

**New configs shipped (10 total)**:
| Slug | State | Platform | Records |
|---|---|---|---:|
| `nj-dca-statewide` | NJ | Socrata | 2.7M |
| `detroit-mi` | MI | ArcGIS | 95k |
| `minneapolis-mn` | MN | ArcGIS | 392k |
| `st-paul-mn` | MN | ArcGIS | 318k (with contractor names) |
| `nashua-nh` | NH | ArcGIS | 8.8k |
| `vt-act250-statewide` | VT | ArcGIS MapServer | 8.3k (new construction only) |
| `salt-lake-city-ut` | UT | Socrata | 22.9k (HISTORICAL — frozen 2023-10-26) |
| `nashville-tn` | TN | ArcGIS | 29.2k |
| `knoxville-tn` | TN | ArcGIS | 13k + 95k apps |
| `bozeman-mt` | MT | ArcGIS MapServer | 720 active (~2k/yr, w/ contact info) |

**New loader: `scripts/_sidecar_loaders/load_arcgis.py`** — Phase 3 of nationwide coverage. Generic ArcGIS REST loader, mirrors `load_socrata.py` shape (YAML in, normalized rows upserted). Handles both FeatureServer and MapServer (same query syntax). Auto-converts ArcGIS epoch-millis timestamps to ISO dates. ArcGIS server pagination via `resultOffset`/`resultRecordCount`; surfaces `exceededTransferLimit` warnings.

Run modes:
```cron
15 */4 * * * /home/henri/scrapling_loaders/run.sh load_arcgis.py --all-arcgis >> /home/henri/scrapling-loaders.log 2>&1
```
(Stagger: Socrata `:30`, EnerGov `:00`, ArcGIS `:15` past the hour.)

**`load_socrata.py` --all filter tightened**: now filters to `loader: socrata` AND `status: verified`. Excludes `unverified` and `historical_only` configs from the cron rotation, so the SLC historical feed doesn't fire daily and unprobed cities don't 404 the cron logs. Run those manually by slug when needed.

**Confirmed dead-end states (no API; Phase 4 scrape territory or skip)**:
- **ME**: Portland uses Tyler eTRAKiT HTML-only; smaller towns Cloudpermit (auth-gated).
- **MS**: ENTIRE STATE walled. Jackson CKAN portal has no permits. Gulfport BS&A SaaS. Southaven/Hattiesburg/Biloxi Tyler EnerGov or no portal. Skip MS or use HUD county aggregate as proxy.
- **OK**: Oklahoma City has Incapsula bot wall on `gis.okc.gov` (might yield to Camoufox + 1hr spike). Tulsa hub has only zoning ordinances. Norman/Edmond/Broken Arrow login-walled.
- **NV**: Las Vegas Open Data ArcGIS frozen 2020 OR field-stripped to ObjectID. Clark County (the highest-leverage jurisdiction in the state, ~80-120k/yr) is Accela-only. Henderson is EnerGov internal API. **NV is all-in on Accela — Phase 4 work**.
- **ND**: No state aggregator. Fargo/Bismarck/Grand Forks all HTML/PDF/eSuite. Skip.
- **RI**: ENTIRELY OAuth-walled. Providence + Warwick + Cranston + Pawtucket all on OpenGov ViewPoint with Auth0 GraphQL. RIGIS state hub has 382 datasets, ZERO permit datasets. Skip or pursue OpenGov data partnership.
- **WV**: Charleston/Huntington no portals. Morgantown Cityworks. Skip entirely.
- **WY**: Cheyenne went all-OpenGov-ViewPoint June 2025. Casper civiclive. Jackson/Teton SmartGov (high-$ luxury market — Phase 4 candidate). Existing Henri "Cheyenne stopgap" entry is justified — no better source exists.

**Phase 4 scrape backlog (post-launch, when revenue funds it)**:
1. Clark County NV Accela (`aca-prod.accela.com/clarkco`) — ~80-120k/yr including Strip + residential solar
2. Las Vegas NV Accela (`aca-prod.accela.com/lasvegas`)
3. OKC Incapsula bypass + Accela
4. SLC Accela (`aca-prod.accela.com/SLCREF`) — replaces frozen Socrata
5. Henderson NV Tyler EnerGov SelfService
6. Reno + Washoe Accela
7. Jackson/Teton WY SmartGov
8. Cheyenne WY OpenGov (data partnership easier than scraping)
9. Portland ME Tyler eTRAKiT
10. Memphis TN — re-check 30-60 days (mid-migration off Socrata)

**Verification artifact: `scripts/verify-coverage.ts`** — post-ingestion verifier. Run after each cron pass to confirm per-state counts grew, ZIP fill increased, no regressions. Outputs `docs/studies/verify-coverage-YYYY-MM-DD.md` and exit 1 on failures (CI-friendly). Includes a snapshot diff vs. previous run that catches any state losing all permits between runs.

**Known scope limits** (set expectations honestly):
- "All states" — 8 of 16 stale states have no public permit API at all. Henri's reachable ceiling via APIs alone is ~42-46 states, not 50. The remaining 4-8 states require Phase 4 scrapers or paid commercial sources (BuildZoom / ConstructConnect / ATTOM).
- "All cities" — the US has ~19,500 incorporated municipalities. Only ~500-800 publish public permit APIs. Long-tail rural cities issue permits via paper applications stored in courthouse filing cabinets — physically inaccessible to any automation. Henri's reachable ceiling is the top ~800 cities by population, NOT all cities.
- "All ZIPs" — ~41,000 ZIPs total. ZIP fill within COVERED jurisdictions can reach >95% via geocoding the existing permit addresses. ZIP fill across all 41k is bounded by the city ceiling above.

**Pre-launch action sequence (additive to the 2026-05-05 sequence)**:
0. SCP updated `_sidecar_loaders/` to Hetzner (load_arcgis.py + 10 new YAMLs + patched load_socrata.py).
0a. Smoke-test each new config: `python load_arcgis.py detroit-mi`, `python load_socrata.py nj-dca-statewide`, etc.
0b. Add a separate ArcGIS cron line: `15 */4 * * * load_arcgis.py --all-arcgis`.
0c. Run NJ DCA backfill manually with date-filtered configs to walk 60 months of history.
0d. Run SLC historical once: `python load_socrata.py salt-lake-city-ut`.
0e. Verify with `npx tsx scripts/verify-coverage.ts` — confirm per-state row counts grew and Bozeman contractor email/phone landed in raw_json.

## Phase 4 stealth scrapers (2026-05-07)

Closed the Phase 4 backlog from the 2026-05-06 research doc. Built four new platform adapters to attack the dead-end states from the 16-state research (NV, OK, ME, WY) plus the SLC migration. All run on the existing Hetzner CCX13 box via Camoufox + Scrapling DynamicFetcher; no new infrastructure spend.

**New loaders shipped (4 total)**:
- `scripts/_sidecar_loaders/load_accela.py` — Accela ACA generic scraper. ASP.NET WebForms with __VIEWSTATE pagination. Handles 9 tenants in NV/UT/MT/OK with one Python file + 9 YAML configs. Highest-leverage of the four (Clark County alone is ~80-120k/yr).
- `scripts/_sidecar_loaders/load_etrakit.py` — Tyler eTRAKiT scraper. Older ASP.NET pattern; smaller deployment but unblocks ME entirely.
- `scripts/_sidecar_loaders/load_smartgov.py` — SmartGov scraper. Modern Angular SPA with both API + SPA-fallback paths.
- `scripts/_sidecar_loaders/load_energov_ss.py` — Tyler EnerGov SelfService scraper. Distinct from `load_energov.py` (which targets the public Tyler Portico API); SelfService is the modern citizen UI with an undocumented internal JSON API that requires Camoufox session cookies.

**12 new YAML configs (all status: unverified pending Hetzner smoke-test)**:

| Config | Loader | State | Estimated annual volume |
|---|---|---|---:|
| `clark-county-nv` | accela | NV | 80-120k (highest leverage in NV) |
| `las-vegas-nv` | accela | NV | 30-40k |
| `reno-nv` | accela | NV | 12-18k |
| `washoe-county-nv` | accela | NV | (unincorporated Reno+Sparks) |
| `north-las-vegas-nv` | accela | NV | 10-15k |
| `sparks-nv` | accela | NV | small |
| `slc-accela-ut` | accela | UT | replaces frozen Socrata |
| `missoula-mt` | accela | MT | ~5k |
| `oklahoma-city-ok` | accela | OK | ~25-35k (Incapsula-walled, cloudflare:true set) |
| `portland-me` | etrakit | ME | ~3-5k |
| `teton-county-wy` | smartgov | WY | small but very high $-value (luxury) |
| `henderson-nv` | energov_ss | NV | 15-20k |

**Total Phase 4 incremental annual volume**: ~180-275k permits/yr across 12 jurisdictions, mostly NV.

**Critical: status: unverified discipline**: every Phase 4 config ships with `status: unverified`. The new loaders' `--all-<platform>` modes filter to `status: verified` only — so the cron will NOT fire any of these until the operator explicitly marks them verified after a successful per-tenant smoke-test on the Hetzner box. This prevents the cron from generating noise on selectors that need adjustment.

**Per-tenant smoke-test workflow** (full runbook in `UPLOAD.md` §11):
```bash
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_accela.py clark-county-nv
# Inspect ~/accela-debug-CLARK-COUNTY-NV.html if form-fill failed.
# Adjust YAML field_* selectors to match.
# Once successful, edit YAML: status: unverified -> status: verified
```

**Phase 4 cron schedule** (added to `UPLOAD.md` §11):
- 03:00 UTC — Accela `--all-accela` (longest, ~5 min × 9 tenants = ~45 min)
- 03:30 UTC — eTRAKiT `--all-etrakit`
- 04:00 UTC — SmartGov `--all-smartgov`
- 04:30 UTC — EnerGov SelfService `--all-energov-ss`

Daily cadence (not 4-hourly like Socrata/ArcGIS) because headless-browser scrapers are slow and tenant-rate-limit-sensitive. Daily is enough — none of these jurisdictions issue more than ~500 permits/day.

**Hetzner box prep**: Phase 4 needs Playwright browser binaries installed in the venv:
```bash
source ~/scrapling-env/bin/activate
python -m playwright install chromium firefox
```

**OpenGov ViewPoint Cloud — explicitly NOT scraped**. Documented separately at `docs/permit-catalog/opengov-viewpoint-partnership-2026-05-07.md`. Three reasons:
1. Auth0-gated GraphQL with per-tenant client IDs and behavioral anti-automation. Cost-to-bypass is multi-week per tenant and unreliable.
2. ViewPoint's ToS explicitly prohibits automated bulk extraction. Unlike Accela/Tyler/SmartGov where the citizen portal is government-mandated public-records access (legal-defense argument under state open-records law), ViewPoint's ToS supersedes the municipal records baseline because data lives on ViewPoint-owned infrastructure. ToS-breach exposure for Henri AND derivative liability for the contractor customer.
3. Partnership path is well-documented (B2B data-licensing program at OpenGov, ~$500-2000/mo, includes real-time webhooks that would IMPROVE Henri's speed-to-lead wedge).

**Coverage delta if ViewPoint partnership is delayed past launch**: RI loses ~25-35k permits/yr (entire state); VT loses ~10-15k/yr (everything outside Act 250); WY loses ~3k/yr (Cheyenne post-June-2025 migration). Partnership push should be the very next data-investment dollar after first MRR lands (target $745/mo from 5 Founder-tier contractors).

**Honest status** of the 16 stale states after Phase 4 ships:

| State | Phase 1-3 (verified API) | Phase 4 (scraper, unverified) | Still uncovered |
|---|---|---|---|
| NJ | DCA statewide (2.7M) | — | — |
| MI | Detroit | — | other cities |
| MN | Minneapolis + St. Paul | — | other cities |
| TN | Nashville + Knoxville | — | Memphis (mid-migration) |
| MT | Bozeman | Missoula | Billings, Great Falls, Helena |
| NH | Nashua | — | Manchester (Cloudpermit) |
| VT | Act 250 statewide | — | Burlington (Tyler EnerGov no-API), all ViewPoint towns |
| UT | SLC (historical) | SLC Accela (live) | Salt Lake Co, Provo, all others |
| NV | — | Clark Co, LV, Reno, Washoe, NLV, Sparks, Henderson | Carson City |
| OK | — | OKC (Incapsula) | Tulsa, Norman, Edmond, Broken Arrow |
| ME | — | Portland | Cloudpermit towns |
| WY | — | Jackson/Teton | Casper, Laramie (still stopgap), Cheyenne (ViewPoint) |
| RI | — | — (ViewPoint partnership only) | ENTIRE STATE |
| MS | — | — | ENTIRE STATE (vendor SaaS only) |
| ND | — | — | ENTIRE STATE (no portals) |
| WV | — | — | ENTIRE STATE (no portals) |

**API + scrape coverage of the 16 stale states**: 12 of 16 have at least one path. 4 (RI, MS, ND, WV) remain genuinely uncovered without paid commercial sources.

**Files added/modified this session**:
- `scripts/_sidecar_loaders/load_accela.py` (new, ~280 LOC)
- `scripts/_sidecar_loaders/load_etrakit.py` (new, ~210 LOC)
- `scripts/_sidecar_loaders/load_smartgov.py` (new, ~240 LOC)
- `scripts/_sidecar_loaders/load_energov_ss.py` (new, ~220 LOC)
- 12 new configs in `scripts/_sidecar_loaders/configs/`
- `scripts/_sidecar_loaders/UPLOAD.md` — added §10 (ArcGIS, was missed) and §11 (Phase 4)
- `docs/permit-catalog/opengov-viewpoint-partnership-2026-05-07.md` (new)

## Audit + discovery tooling (2026-05-08)

Two operational tasks — auditing the existing 12k+ `permit_sources` rows for missing field mappings, and discovering new endpoints for the 18 underserved states — both require unattended-runtime tools, NOT in-chat HTTP work. The right shape: scripts that run on dev machine or Hetzner overnight, output CSVs, then companion scripts bulk-apply the CSV to Supabase. Built four new scripts + a starter candidate list.

**`scripts/_audit-field-mappings.ts`** — pulls every `permit_sources` row WHERE `enabled=true AND field_mapping_status='verified' AND discovered_via='production_grade_2026-04-29'`, probes each endpoint for a sample row (5 RPS with 200-400ms jitter, 5s timeout), runs heuristic chains to recommend `id_field / type_field / status_field / addr_field / date_field / value_field / desc_field / lat_field / lng_field`, and emits a CSV with one of these recommendations per row: `KEEP_AS_IS / UPDATE / DEAD_404 / DEAD_5XX / EMPTY / AUTH_REQUIRED / STALE_>90d`. Checkpoints every 500 rows. Resumable via `--resume`. Output: `docs/studies/henri_field_mappings_YYYY-MM-DD.csv`.

**`scripts/_apply-field-mappings.mjs`** — companion. Reads the CSV, issues bulk UPDATEs for `recommendation=UPDATE` rows. Other recommendations are reported but NOT auto-applied unless `--apply-disables` is passed (which flips `enabled=false` on dead/empty rows). Always supports `--dry-run`.

**`scripts/_discover-missing-permits.ts`** — reads a JSON candidate list (`scripts/_permit_candidates.json`), probes each URL for fresh permit data, applies rejection rules (4xx/5xx/captcha/auth/stale-90d/tiny-100), and emits a CSV with `verdict ∈ {ACCEPT, AUTH_REQUIRED, REJECT_*}` plus extracted field-presence flags (`has_owner_name / has_phone / has_email / has_lat_lng`). Output: `docs/studies/henri_missing_permits_YYYY-MM-DD.csv`.

**`scripts/_ingest-missing-permits.mjs`** — companion. Reads the CSV, upserts ACCEPT rows into `permit_sources` with `discovered_via='discovery_2026-05-08'`. With `--include-backlog`, also inserts AUTH_REQUIRED rows as `enabled=false` for the Phase 4 scrape backlog.

**`scripts/_permit_candidates.json`** — starter list, ~40 entries spanning the 18 underserved states (AK, HI, ID, KS, MS, ND, NE, RI, SD, WV, WY, ME, NM, OK, UT, VT, NH, MT, NV gaps). Hand-seeded from the 2026-05-06 + 2026-05-07 research findings + URL-pattern extrapolation for truly-empty states. **EVERY entry needs probing — many are educated-guess URLs.** Append more as research finds them.

**For the 7 dead-permit states (ME, MS, NH, OK, RI, UT, WV)**: candidate list seeds the **parcel/recorder layer** instead of permits (per the user's directive). Henri's wedge can absorb parcel data via the existing `parcels` enricher (`src/lib/enrichment/regrid-parcel.ts`); a state-level parcel ArcGIS layer covers the entire state in one endpoint, matching the NJ-DCA pattern.

### Runbook (typical session)

```bash
# A. Field-mapping audit of the 12k existing rows
npx tsx scripts/_audit-field-mappings.ts --limit=500     # smoke test first
npx tsx scripts/_audit-field-mappings.ts                 # full run (~60min wall)
node scripts/_apply-field-mappings.mjs docs/studies/henri_field_mappings_2026-05-08.csv --dry-run
node scripts/_apply-field-mappings.mjs docs/studies/henri_field_mappings_2026-05-08.csv
node scripts/_apply-field-mappings.mjs <csv> --apply-disables    # optional, flip dead rows off

# B. Discovery of new endpoints in the 18 underserved states
# Append more candidates to scripts/_permit_candidates.json first if research permits
npx tsx scripts/_discover-missing-permits.ts
node scripts/_ingest-missing-permits.mjs docs/studies/henri_missing_permits_2026-05-08.csv --dry-run
node scripts/_ingest-missing-permits.mjs docs/studies/henri_missing_permits_2026-05-08.csv --include-backlog
```

### Scope honesty

- **The audit script is correct but unverified-at-scale**. The heuristic chains cover the dominant ArcGIS + Socrata key patterns. Edge cases (custom CKAN deployments, idiosyncratic municipal endpoints) will land in `EMPTY` or `UPDATE` with sparse mappings. Spot-check the first 50 CSV rows manually before bulk-applying.
- **The candidate list is starter-quality, not exhaustive**. ~50% of entries are URL-pattern guesses (`opendata.<city>.gov/datasets/building-permits/api`) that need to be probed before they're trusted. The discovery script's `verdict` column does that work — if it returns `REJECT_404` for half the candidates, that's expected; the ACCEPT rows are the real yield. Iterate by appending candidates from probe failures with corrected URLs.
- **OpenGov ViewPoint stays out of scope** per the 2026-05-07 partnership doc. The discovery script will mark ViewPoint URLs `AUTH_REQUIRED` and `--include-backlog` is the right way to track them (not `--apply-disables`).

### Agent-3 expansion: parcel / lien / license-roster substitutes (2026-05-08 PM)

Three parallel research agents expanded `_permit_candidates.json` with live-probed findings for:
1. **AK / HI / ID** (Agent 1) — 2 ACCEPT_PLANNING_ONLY (Boise pipeline trackers), 1 STALE-but-valuable Honolulu Socrata schema, 7 Phase-4 backlog entries (Honolulu DPP highest-priority).
2. **KS / NE / SD** (Agent 2) — 3 ACCEPT (Sedgwick Co KS, **Butler Co KS gold-tier with electrician/plumber/HVAC phones**, Lincoln NE), 4 Phase-4 backlog (Overland Park EnerGov, Omaha + Rapid City + OKC Accela).
3. **ME / MS / NH / OK / RI / UT / WV** (Agent 3) — parcel/assessor/lien/license_roster substitutes for the 7 dead-permit states. Standout finds:
   - **UT State Construction Registry (SCR)** — every UT job >$5k files preliminary notice within 20 days. Returns project_address + owner + GC + sub + license. Search-only HTML, but described by the agent as "the GOLD STANDARD construction lead-gen data source nationally."
   - **WV ParcelSummary table** — 1.5M records with `Owner1`, `Owner2`, `NewOwner` (recent-transfer flag — strongest construction-leading-indicator), `DeedBook`, full assessor data. Closes WV in one endpoint.
   - **WV Site Address Points** — 1.05M records including `Res_Name + Res_Phone` (rare in 911 datasets — direct phone-fill source).
   - **UT LIR Parcels** — assessor companion with OWN_NAME / LAST_SALE_DT / BUILT_YR / BLDG_SQFT.
   - **UT DOPL** — downloadable monthly CSV of ALL active licenses (only state with bulk download).
   - **OK Canadian County** — 84k parcels, fresh 2026-04-30, displayField=owners_name.

**New `data_layer` field on candidates** marks the kind of data the endpoint serves:
- `permit` (default) — current behavior, inserts into `permit_sources` enabled=true
- `planning_pipeline` — Boise-style pre-permit signals; Phase 1 lead source for builders/GCs
- `parcel` / `assessor` — owner + sale + building characteristics for property-history enrichment
- `lien` — UCC + mechanic's-lien filings (UT SCR is the standout)
- `license_roster` — contractor license boards (UT DOPL has bulk CSV; rest are search-only)

**Script changes**:
- `_discover-missing-permits.ts` — CSV header now includes `data_layer` column. Default 'permit' if absent. `_skip: true` candidates filtered out (block-comment placeholders).
- `_ingest-missing-permits.mjs` — partitions ACCEPT and AUTH_REQUIRED buckets by `data_layer`. Permit entries flow through the existing path. Non-permit entries (parcel/assessor/lien/license_roster/planning_pipeline) are skipped by default; pass `--include-non-permit` to stage them in `permit_sources` with `enabled=false` and `discovered_via='non_permit_layer_<layer>_2026-05-08'` for a follow-up migration to dedicated tables (`parcel_sources`, `lien_sources`, etc.) when those exist.

**Known schema gap**: Henri's DB doesn't yet have separate tables for parcel/lien/license_roster sources. The `--include-non-permit` flag is a hold-pattern that captures the discovery in `permit_sources` (disabled) so the metadata isn't lost. A future migration will move these rows to proper tables and route them to:
- `parcel`/`assessor` → existing `regrid-parcel.ts` enricher (already in orchestrator.ts) — extend to read these new sources
- `license_roster` → `contractor-license.ts` enricher (already exists) — extend with bulk-roster ingest cron
- `lien` → new `lien_sources` table + `liens-courtlistener` cron pattern (mirrors the existing 00069 migration sidecar)
- `planning_pipeline` → score booster (low-urgency lead, scored as future-construction signal)

**Coverage delta after this session** (theoretical, pre-Hetzner-deploy):

| State | Before | After (verified ACCEPT) | Phase 4 backlog | Substitute layer |
|---|---|---|---|---|
| KS | 0 | Sedgwick Co + Butler Co (gold-tier phones) | Overland Park, Topeka | — |
| NE | 0 | Lincoln (Accela mirror) | Omaha Accela | — |
| SD | Sioux Falls only | Sioux Falls only | Rapid City Tyler EnerGov | — |
| AK | 0 | 0 | Anchorage MOA, Juneau CBJ | — |
| HI | 0 | Honolulu historical (frozen) | Honolulu DPP, Hawaii Co, Maui Co | — |
| ID | 0 | Boise planning trackers (pre-permit) | Boise Citizen Portal, Meridian | — |
| ME | 0 | 0 | Portland eTRAKiT | Maine parcels + PFR roster |
| MS | 0 | 0 | (none viable for permits) | Harrison Co parcels (borderline), MSBCL roster |
| NH | Nashua only | Nashua only | Manchester | NH parcels (stale), VGSI assessor, OPLC roster |
| OK | Tulsa stopgap | Tulsa stopgap | OKC Incapsula | Canadian Co parcels, CIB roster |
| RI | 0 | 0 | (ViewPoint partnership only) | RI CRB roster (strongest source), Providence VGSI |
| UT | SLC frozen | SLC frozen | SLC Accela | UT statewide parcels, LIR assessor, **SCR (gold), DOPL bulk CSV** |
| VT | Act 250 only | Act 250 only | (ViewPoint towns) | — |
| WV | 0 | 0 | (none viable for permits) | **WV ParcelSummary (1.5M, gold), Site Addresses (Res_Phone)** |
| WY | Cheyenne stopgap | Cheyenne stopgap | Jackson SmartGov | — |
| MT | Bozeman | Bozeman | Missoula Accela | — |
| NV | Henderson Socrata + Las Vegas ArcGIS | same | Clark Co + LV Accela + Henderson EnerGov + Reno + Sparks + NLV + Carson City | — |
| NJ | DCA statewide (2.7M) | DCA statewide (2.7M) | — | — |

**Honest verdict on the 18 underserved states**: 8 of 18 now have at least one verified ACCEPT-grade endpoint (KS, NE, SD partial, ID partial, NJ already, NV already, MT already, NH partial). The remaining 10 are dependent on Phase 4 scrapers OR substitute layers (parcel/lien/license). The substitute-layer strategy turns dead-permit-states into LIVE data via the parcel + license_roster + lien substitutes — this is the path forward for ME / MS / RI / UT / WV / OK / NH where direct permit APIs are structurally unavailable.

## Phase 5 substitute-layer ingest (2026-05-08 PM)

Closed the SCHEMA + LOADER gap that the discovery scripts left open. The 2026-05-08 AM session produced a candidate list with substitute-layer endpoints for 7 dead-permit states; the existing `--include-non-permit` flag staged them in `permit_sources` (enabled=false) as a hold pattern. Phase 5 ships proper tables + a real loader so those substitutes can flow into Henri's pipeline.

**New migrations**:
- `00085_parcels_sidecar.sql` — creates `parcel_sources` registry + `parcels_sidecar` data table. Mirrors the `contractor_license_sources` (00073) + `liens_county_recorder` (00084) pattern. Service-role-write only, RLS-enabled-no-policies. Seeds 7 verified ArcGIS endpoints (UT statewide + UT LIR + WV ParcelSummary + WV Site Addresses + OK Canadian County + ME parcels + MS Harrison Co), all `enabled=false` until per-source smoke-test on Hetzner verifies field_map correctness.
- `00086_lien_sources_ut_scr.sql` — creates `lien_sources` registry. Seeds the **UT State Construction Registry** (gold-standard preliminary-notice feed nationally — every $5k+ UT job files within 20 days, returns project + owner + GC + sub + license + amount) plus 6 UCC search portals (UT, ME, MS, NH, OK, RI, WV). All `phase4_scrape: true` since they need ASP.NET ViewState scrapers. ALSO appends 4 net-new contractor_license_sources (NH OPLC, RI CRB, MS State Board, WV DoL) — RI CRB is the strongest of the four (registers ALL residential contractors, returns phone).

**New table — `public.parcels_sidecar`** distinct from Henri's existing Regrid-sourced `public.parcels`:
- Captures STATE-SPECIFIC signals Regrid sometimes misses: `recent_transfer_at` (derived from WV's NewOwner field), `resident_phone` (rare — WV Site Addresses has it), full assessor breakdown.
- Read-path strategy: orchestrator should fall through to `parcels_sidecar` when Regrid returns null AND state ∈ {ME, MS, NH, OK, RI, UT, WV}. NOT yet wired in `regrid-parcel.ts` — follow-up task.

**New loader — `scripts/_sidecar_loaders/load_parcels_arcgis.py`**:
- Diverges from the Phase 1-3 YAML-config pattern. Reads enabled rows from `parcel_sources` Supabase table directly. The DB is the source of truth — operators can enable/disable sources via SQL without a redeploy.
- Stdlib + Supabase REST only. No new Hetzner dependencies.
- Pagination via ArcGIS `resultOffset` (capped at `--max-pages` × `--page-size`, default 25 × 2000 = 50k rows per run).
- Updates `parcel_sources.last_run_at` + `last_count` for cron observability.
- Smoke-test workflow: `DEBUG_HTML_DUMP=1 python load_parcels_arcgis.py UT-LIR-PARCELS --max-pages=3` to verify field_map before flipping `enabled=true`.

**Cron schedule** (added to UPLOAD.md §12): weekly Sunday 05:00 UTC. Parcel data refreshes quarterly upstream — daily is overkill, weekly catches up cleanly.

**What ships and what doesn't**:

| Phase 5 component | Status |
|---|---|
| Migration 00085 (parcel_sources + parcels_sidecar) | Ready to apply |
| Migration 00086 (lien_sources + UT SCR + 4 net-new rosters) | Ready to apply |
| `load_parcels_arcgis.py` (Phase 5 loader) | Ready to deploy |
| Per-source field_map verification | Operator work on Hetzner (~15 min/source × 7 = ~2 hours) |
| Read-side enricher integration (orchestrator.ts → parcels_sidecar) | NOT shipped — follow-up task |
| UT SCR scraper (gold-tier preliminary-notice feed) | NOT shipped — Phase 4 ASP.NET ViewState work, ~1 week |
| License-roster scrapers for NH/RI/MS/WV | NOT shipped — Phase 4 HTML-search scrapers |
| MS-only path (Harrison Co borderline-stale) | Marginal value; deprioritize |

**Coverage delta after Phase 5 + verification**:

| State | Before today | After 00085 + smoke-test |
|---|---|---|
| UT | SLC frozen Socrata only | UT-LIR (1.58M parcels w/ owner + last_sale + built_yr) |
| WV | 0 | WV-PARCEL-SUMMARY (1.5M, NewOwner flag) + WV-SITE-ADDRESSES (1.05M w/ Res_Phone) |
| OK | Tulsa stopgap | + Canadian Co (84k fresh parcels w/ owner) |
| ME | 0 | ME parcels (716k geometry, ADB join TBD) |
| MS | 0 | Harrison Co only (borderline) |
| NH | Nashua only | (Phase 5 doesn't add NH parcels — stale state aggregator. NH gap stays open.) |
| RI | 0 | (Phase 5 doesn't add RI parcels — no statewide aggregator exists. RI gap stays open.) |

**Net effect**: 4 of the 7 dead-permit states (UT, WV, OK, ME) get meaningful Phase 5 substitute coverage. NH + RI + MS remain genuinely thin and require either Phase 4 scrapers or commercial data partnerships (BuildZoom / ATTOM / Regrid premium tiers).

**Critical follow-up**: extend `src/lib/enrichment/regrid-parcel.ts` to read from `parcels_sidecar` as a fall-through when Regrid returns null AND state ∈ {UT, WV, OK, ME}. Without that read-side wiring, the data lands but never reaches the lead-gen pipeline. Match the existing Wave-2.C pattern of `lib/enrichment/<source>.ts` modules called from `orchestrator.ts`.

## Sprint Z + Phase AA + AA-2 + AA-3 (2026-05-09 → 2026-05-10)

Five full work blocks covering the wedge gap inventory in `~/.claude/plans/whats-the-14-days-purring-papert.md`. Detailed retrospectives there; this section is the navigation map for where things live in the codebase.

**Modules + tables (migrations 00085-00096):**

| # | Migration | What it ships |
|---|---|---|
| 00085 | parcels_sidecar | `parcel_sources` registry + `parcels_sidecar` data table (UT/WV/OK/ME/MS/NH/RI ~5M parcel rows pending Hetzner fill) |
| 00086 | lien_sources | UT SCR + 6 UCC search portals |
| 00087 | intent_columns | `leads.opportunity_stage` + `leads.reason_codes` + same on `homeowner_intakes` (Module 1) |
| 00088 | territory_tier_caps | `claim_territory` RPC enforces 3/5/12/20 caps server-side |
| 00089 | homeowner_consent | `homeowner_intakes.consent_given_at` + `consent_text_version` |
| 00090 | saved_hidden_alerts_calibration | `saved_leads`, `hidden_leads`, `score_trade_weights`, `score_stage_modifiers`, `alert_rules` |
| 00091 | stage_outreach_templates | 5 stage-specific seed templates (Module 12) |
| 00092 | stage_history | `stage_history` table + `record_stage_history()` trigger |
| 00093 | zip_pre_intent_aggregates | Pre-computed per-ZIP aggregate (was matview, converted to regular table after 8s timeout); `refresh_zip_pre_intent_aggregates()` SECURITY DEFINER helper |
| 00094 | leads_source_column | `leads.source` (default 'permit') + `leads.parcel_sidecar_uid` + 2 partial indexes |
| 00095 | check_constraints_aa3 | CHECK on `leads.source` (4 values), `alert_rules.kind` (4 kinds), `stage_history.changed_by_kind` (6 kinds) |
| 00096 | stage_history_backfill | One-shot INSERT — synthesise initial history row for every pre-trigger lead |

**New code modules:**

| Path | Purpose |
|---|---|
| `src/lib/intent/` | classify.ts, derive.ts, reason-codes.ts (69 codes), types.ts, stage-colors.ts (single-source palette) |
| `src/lib/alerts/` | types.ts, evaluate.ts (matchers per kind), dispatch.ts (Resend + sendLeadSMS) + 17 unit tests |
| `src/lib/scoring/__tests__/calibration.test.ts` | 9 tests covering trade weights + stage modifier + cap behaviour |
| `src/lib/outreach/hygiene.ts` | checkOutreachAllowed gate (consent + quiet-hours + suppression) |
| `src/lib/auth/trade-gating.ts` | resolveTradeGate per-tier trade-visibility |
| `src/lib/territory/plan-caps.ts` | tier → ZIP cap mapping used by 00088 RPC |
| `src/lib/enrichment/parcels-sidecar.ts` | read-side fall-through enricher |
| `src/components/dashboard/IntentChip.tsx` | stage chip + "for Xd" duration |
| `src/components/dashboard/LeadActionButtons.tsx` | Save + Hide actions in drawer |
| `src/components/analytics/StageHistogram.tsx` | reusable on intel + storm |
| `src/components/map/TerritoryStatusChip.tsx` | exclusivity primacy on map |
| `src/hooks/useSavedLeads.ts` + `useHiddenLeads.ts` | per-contractor sets for filter pills |

**New API routes (6):**
- `src/app/api/alerts/rules/route.ts` — Module 14 alert_rules CRUD (GET/POST/PATCH/DELETE)
- `src/app/api/cron/synthesize-pre-intent/route.ts` — parcel-synthesis cron (Sun 04:00 UTC)
- `src/app/api/cron/refresh-zip-aggregates/route.ts` — refresh `zip_pre_intent_aggregates` (Sun 03:00 UTC)
- `src/app/api/leads/[id]/save/route.ts` — saved_leads upsert
- `src/app/api/leads/[id]/hide/route.ts` — hidden_leads upsert
- `src/app/api/territories/status/route.ts` — territory + watcher buckets

**Renamed surface (Next 16 Turbopack route conflict fix):**
- `/dashboard/settings/notifications` → `/dashboard/settings/alerts` because the existing `(dashboard)/settings/notifications` (per-channel toggles) collapsed with the new alert_rules page inside the same route group. The pre-existing notifications page at `/settings/notifications` is unaffected.

**Vercel cron schedule (most still paused per Module 6):**
- `0 3 * * 0` `/api/cron/refresh-zip-aggregates` — Sunday 03:00 UTC
- `0 4 * * 0` `/api/cron/synthesize-pre-intent` — Sunday 04:00 UTC
- All other 36 historical schedules remain disabled. Manual trigger via `/api/admin/data-health/trigger` still works for any disabled cron.

**Operator runbooks (`scripts/`):**

| Script | Purpose |
|---|---|
| `_apply-migration-NN.mjs` (one per recent migration) | Idempotent re-apply via Mgmt API |
| `_apply-migrations-95-96.mjs` | Statement-by-statement application that survives the 8s timeout |
| `_backfill-intent.mjs` | Stamps `opportunity_stage` + `reason_codes` on every existing lead. Keyset-paginated (`--start-after-id=<uuid>` resumes from a known cursor). |
| `_populate-zip-aggregates-volume.mjs` | Chunked INSERT into `zip_pre_intent_aggregates` per ZIP-prefix (avoids the timeout that broke matview REFRESH) |
| `_populate-matview-chunked.mjs` | Adds the FILTER+ILIKE columns (adu_90d, remodel_180d) once volume rows exist |
| `_refresh-zip-aggregates.mjs` | Calls `refresh_zip_pre_intent_aggregates()` via Mgmt API + retries |
| `_check-mv.mjs`, `_probe-db-health.mjs`, `_verify-all-migrations.mjs`, `_verify-aborted-only.mjs` | Health probes for the operator |

**Operational state today (2026-05-10):**

| What | Status |
|---|---|
| Schema 00085-00096 | ✅ All 12 migrations applied + verified (26+ schema checks pass) |
| Backfill `opportunity_stage` | ⚠️ ~95k of 270k leads stamped. Resume with `--start-after-id` after Supabase project restart |
| `zip_pre_intent_aggregates` row count | ⚠️ 0 rows (Mgmt API timeouts blocked initial population). Run `_populate-zip-aggregates-volume.mjs` after restart |
| `stage_history` row count | ✅ Backfilled by 00096 to match every stamped lead |
| `parcels_sidecar` row count | ⚠️ Awaiting Hetzner sidecar fill of UT/WV/OK/ME loaders |
| Service-role JWT rotation | ⚠️ STILL PENDING (leaked 2026-05-04 in chat) |
| Sentry DSN, Twilio account, free-tier API keys | ⚠️ Pending operational provisioning |
| Supabase Pro upgrade | ⚠️ Due 2026-05-26; today's saturation is a preview of the Free-tier ceiling |

**Where to start the next session:** read `~/.claude/plans/whats-the-14-days-purring-papert.md` from the top — Phase Z gap inventory + AA + AA-2 + AA-3 retrospectives are all there. The most leveraged unblock is a Supabase project restart from the dashboard (drops orphaned queries, lets `_populate-zip-aggregates-volume.mjs` finish, lets the backfill resume past 95k).
