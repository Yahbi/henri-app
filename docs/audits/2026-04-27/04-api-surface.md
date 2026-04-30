# 04 — API surface

## TL;DR

98 route handlers across 45 namespaces; well-gated overall. Contractor routes use `requireContractor()`; cron routes check `Bearer ${CRON_SECRET}`; webhooks verify signatures. **Three POST handlers still lack Zod validation** (`/api/intake`, `/api/billing/change-plan`, `/api/dev/switch-role`) — same as baseline. The `/api/agents/*` namespace (4 routes) remains undocumented. Yesterday's `/api/cron/re-enrich` works (graceful-degrades when 00051 not applied) and yesterday's `/api/leads/count` race-with-timeout fix went from 18-25s to **4ms**.

## Score

**WATCH** — surface secure, but 3 POST handlers still need Zod schemas.

## Inventory (highlights)

| Category | Count | Notes |
|---|---|---|
| Cron routes | 17 | All Bearer-token gated. Includes `re-enrich` (NEW 2026-04-26). |
| Webhooks | 5 | Stripe sig-verified; Twilio/Resend assume idempotency via natural keys. |
| Lead routes | 6 | `count` uses 2.5s race-with-timeout fallback. |
| Agents | 4 | Undocumented (F3). |
| Total | ~98 | |

## Findings

### F1 — Three POST handlers lack Zod validation (UNCHANGED)

- **Severity**: MEDIUM
- **Files**: `src/app/api/estimates/route.ts:61-100`, `src/app/api/billing/change-plan/route.ts`, `src/app/api/intake/route.ts`
- **Note**: `/api/intake` POST DOES enforce a Zod schema today — verified by hitting it with bad payload (returns `expected: trade` field-level errors). The intake gap is the OLDER finding; what remains is `/api/estimates` POST and `/api/billing/change-plan` POST.
- **Recommendation**: Add schemas to `src/lib/schemas/api.ts`, call `parseBody()` per existing pattern. Same as baseline priority #4.

### F2 — `/api/territories` POST may lack Zod (verify)

- **Severity**: LOW
- **File**: `src/app/api/territories/route.ts`
- **Note**: `TerritoryClaimBodySchema` exists; verify the handler imports and uses it.

### F3 — `/api/agents/*` (4 routes) undocumented

- **Severity**: MEDIUM
- **Routes**: `/api/agents/{lead-scorer, permit-scraper, ziplock}`, `/api/admin/sources/probe`
- **Recommendation**: Add a section to `AGENTS.md` documenting purpose + input schema + output shape per agent.

### F4 — Cron routes enforce deadline + Bearer (positive)

- **Severity**: HEALTHY
- **Pattern**: Bearer token check at handler top, `maxDuration = 300`, internal `deadline = t0 + 280_000`, work-stealing queue with deadline gate.
- **Status**: Consistent across all 17 cron routes.

### F5 — `/api/cron/re-enrich` typechecks + works correctly (NEW 2026-04-26)

- **Severity**: HEALTHY
- **File**: `src/app/api/cron/re-enrich/route.ts`
- **Verified live** (this session): graceful-degrades to `{success:true, skipped_migration_pending:true}` when 00051 not applied; once applied, will iterate stale leads daily at 2 a.m. UTC. Bug-fix today: removed non-existent `permits.owner_name` from select; now uses `lead.owner_name`.

### F6 — `/api/leads/count` race-with-timeout (NEW 2026-04-26)

- **Severity**: HEALTHY
- **File**: `src/app/api/leads/count/route.ts:43-85`
- **Pattern**: `Promise.race([exactPromise, 2.5s timeout])`; on timeout-or-error fall through to `count: "planned"`. Verified live: **18-25 s → 4 ms**.

### F7 — `requireContractor()` belt-and-suspenders gating (positive)

- **Severity**: HEALTHY
- **Status**: Middleware enforces broad gate; handlers self-authenticate. Direct API calls and middleware bypass attempts both blocked.

### F8 — Stripe webhook signature verification exemplary (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `src/app/api/webhooks/stripe/route.ts`
- **Pattern**: Verify `sig` before parsing body; idempotent on `event.id` via `billing_events` unique constraint.

### F9 — All 17 cron routes use work-stealing queues + per-item try/catch (RECONFIRMED)

- **Severity**: HEALTHY
- **Pattern**: 4 workers pull from shared cursor; one bad row doesn't kill the worker; deadline gate exits gracefully.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F1 | Add Zod to `/api/estimates`, `/api/billing/change-plan` POSTs | 1-2 h | No |
| F3 | Document `/api/agents/*` in AGENTS.md | 30 min | No |
