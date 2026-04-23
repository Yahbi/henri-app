---
description: Comprehensive pre-launch audit. Truthfulness + typecheck + build + security + performance + legal.
---

Run before pointing `henri.app` at production or flipping the site live for the Beta 100. Each step is independent and non-destructive.

## 1. Code integrity
- `/typecheck` — must print `TYPECHECK_OK`
- `pnpm build` — must complete without errors; note bundle size deltas
- `/verify` — full smoke-test against the preview — must print `VERIFY_OK`

## 2. Truthfulness
- `/truthfulness-scan` — must print `TRUTHFULNESS_OK`
- Manually walk the landing page, pricing page, and Intel tab one more time looking for anything that "sounds impressive but can't be cited"

## 3. Data + migrations
- `/wedge-status` — every active phase's migrations show `ok`
- `/roadmap` — every `◐` has a reason (env key pending, waitlisted, post-launch)
- No `permit_sources.error_count=99` rows in disabled production ZIPs that should be enabled
- `permits.total` ≥ 500k and growing at the expected daily rate (≥10k/day)

## 4. Security + RLS
- Every new table from `00031+` migrations has RLS enabled + a self-policy:
  ```
  grep -rE "ENABLE ROW LEVEL SECURITY|CREATE POLICY" supabase/migrations/000{31,32,33,34,35,36}*.sql
  ```
- Every new `/api/*` route imports `requireContractor` or is explicitly public (intake, webhooks):
  ```
  grep -L "requireContractor\\|export async function GET.*\\/health" src/app/api/**/route.ts | head
  ```
- `.env.local` is in `.gitignore` (verify: `git check-ignore .env.local`)
- Supabase service role key not leaked into any client bundle: `grep -r "SUPABASE_SERVICE_ROLE_KEY" src/app src/components src/lib | grep -v "createAdminClient\\|server\\|admin"`

## 5. Performance
- Lead list renders in <2s on cold fetch for the god-mode owner (131k leads):
  ```
  time curl -s -b /tmp/c.txt 'http://localhost:3000/api/leads?limit=50' -o /dev/null
  ```
- Map overlay fetches return <10s on cold:
  ```
  time curl -s -b /tmp/c.txt 'http://localhost:3000/api/leads/map?days=30&limit=2000' -o /dev/null
  ```
- `pnpm build` output: no client chunk >600KB before gzip (Next will warn)

## 6. Legal / compliance
- Terms of Service page (`/terms`) exists + references `henri.app` (not `henri.com` or `henriapp.com`)
- Privacy policy (`/privacy`) exists + lists the data we collect (permit filings, contractor profiles, homeowner intakes)
- Acceptable-use page (`/acceptable-use`) mentions TCPA + CAN-SPAM
- No CSV export anywhere on the paid plans (CLAUDE.md — "No CSV export on any plan")
- No refund promises anywhere (CLAUDE.md — "No refunds (digital product)")

## 7. Ops
- All Vercel crons in `vercel.json` have valid schedules
- `CRON_SECRET` set in production env
- Stripe webhook endpoint matches the Stripe dashboard config
- Resend domain (`henri.app`) verified in Resend dashboard
- Supabase `feedback` table exists (run `/migrate` if not)

## Final readout
Print a 7-line checklist:
```
[✓] Code integrity
[✓] Truthfulness
[◐] Data + migrations  (00031 still pending apply)
[✓] Security + RLS
[✓] Performance
[✓] Legal
[✓] Ops

LAUNCH_READY: <YES | BLOCKED on ‹1-line reason›>
```
