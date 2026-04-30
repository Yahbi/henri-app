# 05 — Security

## TL;DR

LLM injection defenses (S1+S2+S6) UNCHANGED and HEALTHY in shipped code. Stripe webhook signature-then-parse-then-idempotent pattern UNCHANGED. CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy all live in production (verified via `curl -I https://meethenri.com/`). **NEW Critical finding**: Resend live API key hardcoded in `scripts/_deploy-vercel.ts:136` plus the same key was exposed in chat history during the launch sprint. Token rotation is overdue. Service-role isolation, env-var handling, role-gating all healthy.

## Score

**ISSUE** — REGRESSED vs 2026-04-28 (was HEALTHY). The launch automation introduced one new critical issue (hardcoded production API key). Everything in the shipped Next.js app is otherwise stable.

## Findings

### F1. CRITICAL — Resend live API key hardcoded in deploy script
**File**: `scripts/_deploy-vercel.ts:136`
**Severity**: Critical
**Why it matters**: A live production Resend API key is embedded as a string literal in a TypeScript file in the repo. The same token value was also pasted into the chat transcript during the launch session. Any of the following would expose it:
- `git add scripts/_deploy-vercel.ts && git commit && git push` (file is untracked today; nothing prevents that)
- A teammate cloning the repo from a backup that includes `scripts/_*.ts`
- The chat transcript itself if shared
- A `cat scripts/_*.ts` from a compromised dev machine

The exposed key has full Resend send permissions on the `meethenri.com` sender identity — an attacker can send emails as Henri (phishing, password-reset spam, brand impersonation).

**Recommended fix** (do all four):
1. **Rotate**: revoke the existing key at https://resend.com/api-keys → generate a fresh one → update Vercel env `RESEND_API_KEY`
2. **Refactor the deploy script**: change line 136 from string-literal to `process.env.RESEND_API_KEY ?? throwIfMissing("RESEND_API_KEY")`
3. **Gitignore the launch automation scripts**: add `scripts/_deploy-vercel.ts`, `scripts/_setup-cloudflare-dns.ts`, `scripts/_supabase-management.ts` to `.gitignore` (or move them into a `.gitignored/` folder)
4. **Audit git history**: `git log --all -p -- scripts/_deploy-vercel.ts` to confirm no prior commit accidentally embedded the key. If found, treat as a full credential leak — rotate again after rewriting history.

~15 min total.
**Delta tag**: NEW.

### F2. HEALTHY — Three other launch tokens exposed in chat history (rotation overdue)
**Severity**: High
**Why it matters**: Launch session summary records 4 tokens pasted into chat:
- Cloudflare API token (full DNS + Email Routing scope on the meethenri.com zone)
- Vercel personal-access token (full project + env mutation scope)
- Supabase access token (project management + DB management scope)
- Resend API key (covered in F1)

Chat transcripts can be exported, shared, or breached. None are in source code (verified for the deploy script in F1; the others are in scripts that read from `process.env.*`). They are, however, in long-term chat history.

**Recommended fix**:
- Cloudflare: revoke at https://dash.cloudflare.com/profile/api-tokens
- Vercel: revoke at https://vercel.com/account/tokens
- Supabase: revoke at https://supabase.com/dashboard/account/tokens
- Resend: handled in F1

Once revoked, generate fresh ones only when needed; don't paste them into chat. Use 1Password / Bitwarden / Vercel UI directly.
**Delta tag**: NEW.

### F3. HEALTHY — LLM injection defenses S1 + S2 + S6 confirmed
**Files**:
- `src/app/api/ai/draft-reply/route.ts` (lines 29–33: delimiter sanitize; 130–137: output filter)
- `src/app/api/chat/refine/route.ts` (lines 106–107: per-answer sanitize; 162–171: output-pattern reject)

**Severity**: Low (positive finding)
**Why it matters**: Yesterday's audit confirmed these defenses; today's pass re-confirms them in place. Both routes use named-delimiter wrapping (`<<<REVIEW>>>`, `<<<ANSWER N>>>`), strip those delimiters from user input, cap input length via Zod, and reject LLM outputs containing URLs/phones/tool-call markers. Fallback to canned-reply on filter rejection.
**Recommended fix**: None. Reference these as the pattern for any future LLM-touching route.
**Delta tag**: UNCHANGED.

### F4. HEALTHY — Stripe webhook is exemplary
**File**: `src/app/api/webhooks/stripe/route.ts`
**Severity**: Low (positive finding)
**Why it matters**: Signature verified BEFORE `req.json()` parse. Idempotent on `event.id`. Referral-credit insert ordered before coupon creation (B3 race fix from prior session). The `billing_events` table provides a backup dedup layer keyed on `stripe_event_id`.
**Recommended fix**: None. Optionally migrate the dedup logic to use the new `src/lib/webhooks/idempotency.ts` module for consistency, but it's working correctly today and the abstraction would be cosmetic.
**Delta tag**: UNCHANGED.

### F5. HEALTHY — Production security headers verified live
**File**: `next.config.ts:48–62` + `curl -I https://meethenri.com/`
**Severity**: Low (positive finding)
**Why it matters**: Live production response includes:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()`
- `Content-Security-Policy:` full directive set with explicit allowlists for `js.stripe.com`, `*.supabase.co`, `api.openai.com`, `nominatim.openstreetmap.org`, `api.mapbox.com`, `*.cartocdn.com`, `*.vercel-insights.com`; `frame-ancestors 'none'`; `object-src 'none'`; `upgrade-insecure-requests`

The `Server: Vercel` header is present (information disclosure but unavoidable on Vercel). No `X-Powered-By` leak.

**Recommended fix**: None. Optional hardening: drop `'unsafe-inline'` from `style-src` once Tailwind v4 stops requiring it (current Tailwind config emits inline styles in dev that Production builds don't strictly need).
**Delta tag**: UNCHANGED.

### F6. HEALTHY — Service-role isolation intact
**File**: `src/lib/supabase/admin.ts`
**Severity**: Low (positive finding)
**Why it matters**: Service-role client only imported from server-only modules (cron routes, webhook routes, agent endpoints). Never reaches the browser bundle. Spot-checked the 5 new routes and the 14 unvalidated POSTs — none of them import `admin.ts` inappropriately.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F7. HEALTHY — Env-var handling rejects insecure CRON_SECRETs
**File**: `src/lib/env.ts:39–62`
**Severity**: Low (positive finding)
**Why it matters**: `requireEnv()` throws in production for missing or known-insecure CRON_SECRET values (`dev_cron_secret_change_in_production`, `change_me`, `secret`, `test`). Production deploy generated a fresh 32-byte hex token. Boolean `hasStripe()`, `hasTwilio()`, etc. allow graceful-degrade paths without throwing.
**Recommended fix**: None.
**Delta tag**: UNCHANGED.

### F8. WATCH — Stale GoDaddy DNS records remain in Cloudflare zone
**Severity**: Low (cosmetic, security-adjacent)
**Why it matters**: Per launch summary, the meethenri.com Cloudflare zone imported ~13 legacy DNS records when domain control transferred from GoDaddy. Apex MX → outlook.com, SPF including secureserv.net, autodiscover/lync/msoid/sip/pay CNAMEs, _sipfederationtls/_sip._tls SRV records. Cosmetic but: (a) implies Henri uses Outlook for email which we don't, (b) MX → outlook.com would receive bounces that we'd never see, (c) SPF including secureserv permits a domain we don't control. The audit was unable to verify Cloudflare zone state without the API token re-authorized.
**Recommended fix**: User to delete the legacy records via the Cloudflare dashboard. ~5 min. The active records (A → 76.76.21.21, CNAME www → cname.vercel-dns.com, MX send → feedback-smtp.us-east-1.amazonses.com, TXT send SPF, DKIM via Resend) should remain.
**Delta tag**: NEW (was launch carryover, never previously audited).

## Verdict

Security in shipped code is HEALTHY across all standard surfaces. F1 (hardcoded Resend key) is the lone Critical issue and lifts the domain to ISSUE-level. Once F1 + F2 are resolved (~30 min combined), the domain returns to HEALTHY.
