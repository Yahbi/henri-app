# 05 — Security

## TL;DR

Security improved measurably. `instrumentation.ts:52` was hardened yesterday with a `Function`-constructor wrapper to hide the optional `@sentry/nextjs` import from static analysis — eliminates spurious build warnings. `/api/intake` POST now Zod-gated (verified live). Service-role key remains isolated to server-only modules. Stripe webhook signature verification + idempotency intact. Two persistent gaps from baseline: **no CSP header** and **LLM prompt-injection surface unaudited** (`/api/ai/draft-reply`, `ChatIntakeModal`).

## Score

**WATCH** — input validation gaps mostly closed; CSP + LLM audit still open.

## Findings

### F1 — Input validation: `/api/intake` Zod-gated (verified live)

- **Severity**: RESOLVED for `/api/intake` (was HIGH at baseline)
- **File**: `src/app/api/intake/route.ts`
- **Verified**: Hit live with bad payload `{project_type:"roofing"}`, got response `{"error":"Invalid intake body","issues":[{"expected":"string","path":["trade"],...}]}` — Zod gating active.
- **Status**: Closed for `/api/intake`. `/api/estimates` and `/api/billing/change-plan` POSTs remain (see 04 F1).

### F2 — LLM prompt-injection surface unaudited

- **Severity**: HIGH (unchanged from baseline)
- **Files**: `src/app/api/ai/draft-reply/route.ts:67-75`, `src/components/portal/ChatIntakeModal.tsx`
- **Why**: User input interpolated into Claude prompts via string concatenation. Inputs are length-bounded but not delimiter-wrapped.
- **Recommendation**: Author `docs/audits/2026-04-27/05a-llm-safety.md` checking: input wrapped in `<<<...>>>` delimiters with system-prompt guardrails; output sanitized; user-description fields HTML-escaped before display.

### F3 — Service-role key isolated (RECONFIRMED)

- **Severity**: HEALTHY
- **Files**: `src/lib/supabase/admin.ts`, scripts only
- **Status**: Grep on `'use client'` files for service-role usage returns clean.

### F4 — Env validation rejects insecure CRON_SECRET defaults (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `src/lib/env.ts:39, 52-57`
- **Allowlist**: `["dev_cron_secret_change_in_production", "change_me", "secret", "test"]` triggers boot-time error in prod.

### F5 — Security headers: most present, CSP missing

- **Severity**: MEDIUM
- **File**: `next.config.ts`
- **What ships**: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **What's missing**: Content-Security-Policy (default-src, script-src, etc.)
- **Recommendation**: Add CSP to `next.config.ts headers()` array. Tune origins per actual scripts (Mapbox, Vercel-analytics, Anthropic, Supabase).

### F6 — Stripe webhook signature verification + idempotency (RECONFIRMED)

- **Severity**: HEALTHY
- **File**: `src/app/api/webhooks/stripe/route.ts:1-80`
- **Status**: `stripe.webhooks.constructEvent()` before any parsing; idempotency via `billing_events` unique constraint on `stripe_event_id`.

### F7 — No CSRF defense on mutating GETs (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: All mutations are POST/PATCH/DELETE; no GET side-effects observed.

### F8 — Cookies httpOnly + secure + sameSite (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Set by Supabase SSR helpers.

### F9 — `instrumentation.ts` hardened against static analysis (NEW 2026-04-26)

- **Severity**: RESOLVED (was untracked at baseline)
- **File**: `instrumentation.ts:52-59`
- **What changed**: Dynamic import of `@sentry/nextjs` is now wrapped in a `Function`-constructor to escape Turbopack's static analysis. Without this, fresh clones flooded the dev server with "Module not found" warnings even though the runtime gate ensures the code never executes.
- **Status**: Properly wired. Once `SENTRY_DSN` is set in Vercel env, every `logger.error()` automatically forwards to Sentry.

### F10 — God-mode bypass not yet logged

- **Severity**: LOW
- **Files**: `src/lib/auth/god-mode.ts`, `src/middleware.ts`
- **Recommendation**: Add `logger.warn("god-mode bypass invoked", { email, path })` so leaks are visible in structured logs.

### F11 — No hardcoded secrets in source (RECONFIRMED)

- **Severity**: HEALTHY
- **Status**: Grep for `eyJ`, `sk_live_`, `whsec_` returns no source hits.

## Recommendations summary

| # | Action | Effort | Blocker |
|---|---|---|---|
| F2 | Author 05a-llm-safety.md, audit prompt surfaces | 3 h | No |
| F5 | Add CSP header to `next.config.ts` | 1 h | No |
| F10 | Add structured log on god-mode bypass | 30 min | No |
