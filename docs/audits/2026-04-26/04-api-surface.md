# 04 — API surface

## TL;DR

98 route handlers under `src/app/api/`. Auth gating is **mostly correct**: every cron route validates `CRON_SECRET`, every webhook verifies vendor signatures, dashboard routes use `requireContractor()`. The two pressing gaps: **(1)** several POST/PATCH handlers accept JSON bodies without Zod-validating them (`/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role`); **(2)** the `agents/` namespace (3 routes: `ziplock`, `lead-scorer`, `permit-scraper`) has no per-file documentation explaining who calls them and what auth gate they rely on.

## Score

**WATCH** — gates are right, validation is uneven.

## Surface map (top-level groups)

| Group | Count | Purpose |
|---|---|---|
| `api/cron/*` | 15 | Vercel-scheduled background work (score, scrape, enrich, follow-ups, permits, etc.) |
| `api/webhooks/*` | 5 | Stripe, Twilio (×2), Resend, Supabase |
| `api/leads/*` | 4 | Lead CRUD, map, count, notes, activity |
| `api/permits/*` | 2 | Live + history |
| `api/contractors/*` | 2 | Profile + search |
| `api/territories/*` | 3 | List, detail, analytics |
| `api/billing/*`, `api/checkout/*`, `api/billing-portal/*` | 3 | Stripe-adjacent flows |
| `api/intake/*`, `api/messages/*`, `api/notifications/*`, `api/outreach/*`, `api/reviews/*`, `api/quotes/*`, `api/estimates/*`, `api/financing/*`, `api/storm/*`, `api/feedback/*`, `api/referrals/*` | ~30 | Domain CRUD |
| `api/overlays/*` | 6 | FEMA, NWS alerts, census, weather, SPC, permits |
| `api/intelligence/*`, `api/market-intel/*`, `api/analytics/*` | ~5 | Aggregations |
| `api/agents/*` | 3 | `ziplock`, `lead-scorer`, `permit-scraper` (purpose unclear from naming) |
| `api/dev/*` | ~3 | `switch-role`, `auto-login`, `is-god-mode` (NODE_ENV-gated) |
| `api/admin/*` | 1+ | God-mode gated |
| `api/auth/*`, `api/profile/*`, `api/exclusivity/*`, `api/license/*`, `api/licenses/*`, `api/compliance/*`, `api/permit-events/*`, `api/interviews/*`, `api/enrichment/*` | various | Misc |

Total: 98 route files.

## Findings

### F1 — `/api/intake/route.ts` accepts user input without Zod validation

- **Severity**: High
- **File**: `src/app/api/intake/route.ts`
- **Why it matters**: Per security-agent: destructures body fields without schema validation; relies on optional chaining. Fields `description`, `trade`, `budget_range`, `timeline` are client-controlled and passed downstream to `findMatches()` and database insert. If a homeowner submits `description: "<script>alert(1)</script>"`, it stores in DB unchanged. If `trade` is `undefined`, the matching engine receives undefined.
- **Recommendation**: Add a Zod schema at the top of the file:
  ```ts
  const IntakeBody = z.object({
    description: z.string().min(1).max(2000),
    trade: z.enum(["roofing", "hvac", "plumbing", "electrical", "solar", "adu", "general"]),
    budget_range: z.string().optional(),
    timeline: z.string().optional(),
    zip: z.string().regex(/^\d{5}$/),
  });
  const body = IntakeBody.parse(await req.json());
  ```
  Replace destructure with `body.description`, etc. Apply same pattern to other POST routes.

### F2 — `/api/billing/change-plan/route.ts` validates plan loosely

- **Severity**: High
- **File**: `src/app/api/billing/change-plan/route.ts`
- **Why it matters**: Per security-agent: accepts `plan` from JSON body with simple string check (`if (!plan || !PLAN_PRICES[plan])`). This works at runtime (the lookup is the gate) but invites bugs: what if someone passes `plan: { toString() { return "founder" } }`? The `!PLAN_PRICES[plan]` check coerces to string. Edge case, but easy to harden with Zod.
- **Recommendation**:
  ```ts
  const ChangePlanBody = z.object({
    plan: z.enum(["founder", "starter", "pro", "enterprise"]),
  });
  ```

### F3 — `/api/dev/switch-role/route.ts` accepts `role` without schema

- **Severity**: Medium (gated to dev only)
- **File**: `src/app/api/dev/switch-role/route.ts`
- **Why it matters**: Per security-agent: dev-only, gated by `NODE_ENV !== "production"` AND god-mode email allowlist. So in production this route returns 404. But in dev it accepts arbitrary role strings. If a dev typo'd `role: "admin"` it'd silently fail at the DB write rather than fail-loud at validation.
- **Recommendation**: Add `z.enum(["contractor", "homeowner"])` validation. Even dev-only routes benefit from fail-loud.

### F4 — `/api/agents/{ziplock,lead-scorer,permit-scraper}` undocumented

- **Severity**: Medium
- **File**: `src/app/api/agents/*/route.ts`
- **Why it matters**: The `agents/` namespace has 3 routes with names that suggest internal RPC: `ziplock` (zip code locking?), `lead-scorer` (an alternative entrypoint to the cron scorer?), `permit-scraper` (an alternative entrypoint to `/cron/scrape`?). Per architecture audit, no top-of-file comment explains: who calls these, what auth gate, what side effects, whether they're invoked by an LLM agent (which would be a prompt-injection surface) or by internal cron.
- **Recommendation**: Add a 4-line block comment to each:
  ```ts
  /**
   * Caller: [who invokes this — cron / internal RPC / LLM agent / human]
   * Auth gate: [CRON_SECRET / requireContractor / god-mode email / none]
   * Side effects: [DB writes / external API calls / file writes]
   * Idempotent: [yes/no]
   */
  ```
  If they're LLM-agent invocations, surface to `05-security.md`.

### F5 — Cron route `/api/cron/blast-worker` runs every 5 minutes

- **Severity**: Low
- **File**: `vercel.json`, `src/app/api/cron/blast-worker/route.ts`
- **Why it matters**: 5-minute cadence is the fastest cron in the schedule. If the route ever exceeds 60s or holds DB locks across the boundary, two instances could overlap. The reliability audit confirms deadline enforcement is in place for `/cron/enrich` (280s buffer vs 300s max), but `blast-worker` wasn't sampled.
- **Recommendation**: Confirm `blast-worker` has either (a) p99 < 60s based on Vercel logs, or (b) explicit deadline enforcement matching the `enrich` pattern. If neither, add the 280s deadline.

### F6 — `/api/permits/live` is rate-limited; some peer routes are not

- **Severity**: Medium
- **File**: `src/app/api/permits/live/route.ts` vs `src/app/api/leads/map/route.ts`, `/api/leads/count/route.ts`
- **Why it matters**: Per reliability-agent: `/api/permits/live` uses `src/lib/utils/rate-limit.ts`. But other expensive routes (the map endpoint that shapes thousands of GeoJSON features, the count endpoint that hits the leads table) don't appear to. A bored crawler probing `/api/leads/map` could hammer Supabase.
- **Recommendation**: Audit which routes consume DB CPU per call. Add `applyRateLimit(req, { limit: 60, window: 60_000 })` to: `/api/leads/map`, `/api/leads/count`, `/api/intelligence`, `/api/storm`, `/api/overlays/*`. The rate-limit module already exists; this is wiring, not new code.

### F7 — Webhook idempotency is inconsistent across vendors

- **Severity**: Medium
- **File**: `src/app/api/webhooks/{stripe,twilio,resend,supabase}/route.ts`
- **Why it matters**: Per security-agent: Stripe is idempotent on `event.id` via the `billing_events` unique constraint. Are Twilio (missed-call SMS responses), Resend (delivery webhooks), and Supabase (DB triggers) idempotent? Twilio re-delivers webhooks on 5xx; Resend retries on transient failures.
- **Recommendation**: Confirm each non-Stripe webhook either (a) has a unique constraint preventing duplicate side-effects, or (b) is naturally idempotent (e.g., setting a column to a known value). Document the strategy in a top-of-file comment per webhook.

### F8 — Total of 98 routes — high but tractable

- **Severity**: Nitpick (informational)
- **File**: `src/app/api/`
- **Why it matters**: 98 routes is a lot for a Beta-stage product. Many are CRUD wrappers that could be flat-out replaced by a Supabase client call from the React Query layer (RLS already gates). For example: `/api/leads/[id]/notes` and `/api/leads/[id]/activity` are thin wrappers around `supabase.from("leads").update({notes})`. They exist for centralized auth/validation but at the cost of round-trip latency and duplicated code.
- **Recommendation**: Audit the 98 route catalog: which routes do meaningful server-side work (validation, side effects beyond DB write, vendor API calls), and which are pass-through? Pass-through routes can move to client-side Supabase calls under RLS, freeing engineers from maintaining 98 separate handlers.

### F9 — `/api/leads/route.ts` exists alongside `/api/leads/map/route.ts` etc.

- **Severity**: Nitpick
- **File**: `src/app/api/leads/route.ts`
- **Why it matters**: With React Query + `useLeads` calling Supabase directly via the browser client, what is `/api/leads/route.ts` for? Sometimes server-side aggregation (e.g., `count(*)` queries that PostgREST handles awkwardly), sometimes legacy code path. A reader can't tell without opening the file.
- **Recommendation**: Add a top-of-file comment to every route in `/api/leads/*` describing its purpose and which client(s) call it.

### F10 — Supabase client matrix correctly partitioned

- **Severity**: Nitpick (positive)
- **File**: `src/lib/supabase/{client,server,admin}.ts`
- **Why it matters**: Per `CLAUDE.md`: `client.ts` for browser, `server.ts` for server components + route handlers, `admin.ts` for service role (RLS bypass, cron-only). Per security-agent: no service-role usage in client components. The boundary holds.
- **Recommendation**: None. Add a top-of-file comment in each of the three files re-iterating "use this when X" so future contributors don't pick the wrong client.

## What's working well

- **Auth gating is comprehensive**: every cron checks `CRON_SECRET`; every webhook verifies signature; every dashboard route uses `requireContractor()`.
- **Stripe webhook is exemplary**: signature verified BEFORE parsing, idempotent on `event.id`, no client-controlled customer/subscription IDs read from request body.
- **Dev routes are doubly-gated**: `NODE_ENV !== "production"` AND god-mode email allowlist. No accidental production exposure.
- **No service-role key in client components** (confirmed by grep).
- **Hardcoded `NEXT_PUBLIC_APP_URL`** in `/api/checkout/route.ts` for post-payment redirect — prevents attacker-controlled `Origin` header from redirecting to a malicious domain.
