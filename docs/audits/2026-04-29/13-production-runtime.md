# 13 — Production runtime (NEW domain — first audit post-launch)

## TL;DR

`https://meethenri.com` is **live and serving HTTP 200** with full security-header set, valid Let's Encrypt cert, version `56715fa` (matches latest commit). `/api/health` confirms DB ok (684ms latency), Resend ok, Stripe/Twilio/OpenAI all reporting `unconfigured` (expected — see [11-build-and-deploy.md F2](./11-build-and-deploy.md)). DNS state has stale GoDaddy/Outlook records remaining in the Cloudflare zone (cosmetic but implies email routes through Outlook which is false). Four launch tokens were exposed in chat history during the launch sprint and require rotation.

## Score

**WATCH** — NEW domain (no prior audit).

## Findings

### F1. HEALTHY — Production endpoint live with full security-header set
**Endpoint**: `https://meethenri.com/`
**Captured**: 2026-04-29 07:34:15 UTC

```
HTTP/1.1 200 OK
Server: Vercel
Cache-Control: public, max-age=0, must-revalidate
Etag: "a7aff3237b2fff4f0db6064b72893b1f"
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com https://cdn.vercel.sh https://*.vercel-insights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' blob: data: https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.openai.com https://nominatim.openstreetmap.org https://api.mapbox.com https://*.cartocdn.com https://*.vercel-insights.com; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com; object-src 'none'; base-uri 'self'; upgrade-insecure-requests
```

**Severity**: Low (positive finding)
**Why it matters**: Every recommendation from the 2026-04-28 audit's Security domain shipped as deployed code. CSP allowlist is correct for the actual third-party surface (Stripe + Supabase + OpenAI + Mapbox + Nominatim + Vercel Insights). HSTS at max 2y with preload list. `frame-ancestors 'none'` is the strict version of X-Frame-Options. No `X-Powered-By` leak.
**Recommended fix**: None for security headers. Optional: drop `'unsafe-inline'` from `style-src` once Tailwind v4 supports CSP-strict mode.
**Delta tag**: NEW.

### F2. HEALTHY — `/api/health` returns ok with version + service status
**Endpoint**: `https://meethenri.com/api/health`
**Response**:
```json
{
  "status": "ok",
  "version": "56715fa",
  "uptime_seconds": 0,
  "timestamp": "2026-04-29T07:34:17.250Z",
  "services": {
    "database": { "status": "ok", "latency_ms": 684 },
    "stripe": { "status": "unconfigured", "error": "STRIPE_SECRET_KEY unset" },
    "twilio": { "status": "unconfigured", "error": "TWILIO_* env unset" },
    "resend": { "status": "ok" },
    "openai": { "status": "unconfigured", "error": "OPENAI_API_KEY unset" }
  }
}
```

**Severity**: Low (positive finding)
**Why it matters**: Health endpoint reports the version (matches `git log -1 --format=%h` = `56715fa`), DB latency (684ms — see F4 for analysis), and per-service env-var status. Clean separation between "infrastructure issue" (DB down, e.g.) and "feature unconfigured" (Stripe key missing). `uptime_seconds: 0` indicates a cold start, which is expected for an idle Hobby project's first request after cache eviction.
**Recommended fix**: None for the endpoint itself. See [11-build-and-deploy.md F2](./11-build-and-deploy.md) for wiring missing env vars.
**Delta tag**: NEW.

### F3. ISSUE — 7 production env vars unset (post-launch hardening required)
**Severity**: High
**Why it matters**: Per F2, four services report `unconfigured`:
- Stripe: 5 missing vars (key + webhook secret + 4 price IDs); blocks billing flow
- Twilio: 3 missing vars; blocks SMS + missed-call text-back wedge bullet #5 mechanism
- OpenAI: 1 missing var; degrades draft-reply and chat-refine to canned-reply fallback
- Sentry DSN: 1 missing var; Sentry SDK installed and wired but events not aggregated until DSN is set

**Recommended fix**: See [11-build-and-deploy.md F2](./11-build-and-deploy.md) for the per-service playbook. Total time once Stripe Products + Webhook are configured: ~30 min.
**Delta tag**: NEW.

### F4. WATCH — Database latency 684ms is high for a health check
**Severity**: Low
**Why it matters**: 684ms is on the high side for what should be a single `select 1` style ping. Possible causes: cold start at the Supabase edge, Vercel function cold start, or the health check is doing more work than a ping (e.g., counting permits to confirm read access). Worth profiling once we have steady traffic.
**Recommended fix**: Read `src/app/api/health/route.ts` and confirm the DB check is a minimal `head: true` count. If it does heavier work, switch to a `head: true` count on a small reference table. ~5 min.
**Delta tag**: NEW.

### F5. WATCH — Stale GoDaddy/Outlook DNS records remain in Cloudflare zone
**Severity**: Low (cosmetic + deliverability-adjacent)
**Why it matters**: Per launch summary, the Cloudflare zone for `meethenri.com` imported a baker's-dozen legacy DNS records when the domain transferred from GoDaddy:
- Apex MX → outlook.com (could receive bounces that we'd never see; we use `send.meethenri.com` MX → Resend SES)
- SPF including `secureserv.net` (permits a GoDaddy-controlled domain to send as us)
- Autodiscover, Lync, MSOID, SIP, Pay CNAMEs (Outlook/Office 365 remnants)
- `_sipfederationtls` and `_sip._tls` SRV records (Lync remnants)
- `_domainconnect` CNAME (GoDaddy DNS bootstrap)

The active records (A apex → 76.76.21.21, CNAME www → cname.vercel-dns.com, MX `send.meethenri.com` → feedback-smtp.us-east-1.amazonses.com, TXT send SPF for Amazon SES, DKIM via Resend) work correctly alongside these legacy records.

**Recommended fix**: User to delete the legacy records via the Cloudflare dashboard (the API token used during launch was scoped POST-only and couldn't issue DELETE requests). ~5 min. Keep the active records.
**Delta tag**: NEW.

### F6. ISSUE — 4 launch tokens exposed in chat history
**Severity**: High
**Why it matters**: During the launch session, the following tokens were pasted into the chat transcript (per the session summary):
- Cloudflare API token (full DNS + Email Routing scope on the meethenri.com zone)
- Vercel personal-access token (full project + env mutation scope)
- Supabase access token (project management + DB management scope)
- Resend API key (also hardcoded in `scripts/_deploy-vercel.ts:136`, see [05-security.md F1](./05-security.md))

**Recommended fix**: Rotate all four. See [05-security.md F1 + F2](./05-security.md) for the rotation playbook.
**Delta tag**: NEW.

### F7. HEALTHY — TLS / cert state
**Severity**: Low (positive finding)
**Why it matters**: HTTPS responds with a Vercel-issued Let's Encrypt cert. HSTS preload header in place; the domain can be submitted to the Chrome HSTS preload list once we're confident in the deployment pipeline. `Server: Vercel` confirms the request reaches Vercel directly (no Cloudflare proxying — the apex A record is set to gray-cloud DNS-only, which is correct for Vercel-served origins).
**Recommended fix**: None for cert. Optional: submit to https://hstspreload.org once 30 days of stable HTTPS-only operation have elapsed.
**Delta tag**: NEW.

### F8. HEALTHY — Cron auth gate verified live
**Severity**: Low (positive finding)
**Why it matters**: Spot-checked `/api/cron/score`, `/api/cron/scrape`, `/api/cron/enrich` — all require `Authorization: Bearer <CRON_SECRET>`. CRON_SECRET is set in production (per launch summary, fresh 32-byte hex generated at deploy time). Vercel cron triggers carry the secret via a project-level env var injection.
**Recommended fix**: None.
**Delta tag**: NEW.

## Verdict

Production runtime is WATCH today. F1 + F2 + F7 + F8 are HEALTHY. F3 (env vars) and F6 (token rotation) are the two items that should clear before paid signups go live. F4 (DB latency profiling) and F5 (stale DNS cleanup) are cosmetic.
