# Founder action checklist — what's left to charge $149/mo

Generated 2026-05-10 after the Sprint Z + Phase AA-1/2/3 PR (#1) opened against main.

The app is **code-complete**. Engineering work below is verified shipped:
- All 12 migrations 00085-00096 applied + verified
- Module 1 intent classifier with 69 reason codes
- Module 10 parcels_sidecar fall-through enricher (county-gis.ts:1244)
- Module 13 score calibration tables wired (score/route.ts:242-268, 796-800)
- Module 14 alert_rules evaluator wired inline (score/route.ts:1255-1303 + intake/route.ts:268-309)
- 145,226 / 270,149 leads stamped (100% of classifiable)
- 146,726 stage_history rows
- 7,033 zip_pre_intent_aggregates rows
- tsc 0, 801/801 vitest passing
- territories table at 9 rows (already clean — old "11k" snapshot was stale)

**What's left is operator work. Total ~3 hours of credentials + clicks.**

---

## Tier 1 — Security (do first, blocks accepting payments honestly)

### 1. Rotate the leaked service-role JWT — 10 minutes

The `SUPABASE_SERVICE_ROLE_KEY` was exposed in chat 2026-05-04. Anyone with that chat history can write to production. Until rotated, you cannot honestly tell a customer "your data is secure."

- Open https://app.supabase.com/project/ivfxylgoxgrxttknewsf/settings/api
- Click "Reset" next to "service_role secret" → copy the new value
- Update in 3 places:
  1. **Vercel** → Project Settings → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` → Save → trigger redeploy
  2. **Local** `.env.local` → `SUPABASE_SERVICE_ROLE_KEY=<new>`
  3. **Hetzner** SSH `henri@5.78.152.250`, edit `~/.henri-sidecar.env`, `SUPABASE_SERVICE_ROLE_KEY=<new>`, save (chmod stays 600)

Verify: `cd ~ && bash scrapling_loaders/run.sh load_socrata.py austin-tx --max-pages=1` on Hetzner; should still write to `permits` cleanly.

### 2. Provision Sentry DSN — 15 minutes

Code is wired since 2026-04-29 (`instrumentation.ts` + `instrumentation-client.ts`). Errors silently disappear in production until you do this.

- Sign up at https://sentry.io/signup/ (free tier covers 5k events/mo, more than you need pre-launch)
- Create project: pick "Next.js" platform → name "henri-app"
- Copy the DSN (looks like `https://abc123@o456.ingest.sentry.io/789`)
- **Vercel** → env vars → add both:
  - `SENTRY_DSN` = the DSN (Production scope)
  - `NEXT_PUBLIC_SENTRY_DSN` = the same DSN (Production + Preview)
- Trigger redeploy
- Verify: hit any known-error path (e.g., POST malformed JSON to `/api/leads/save`); within 30s the event lands in Sentry's Issues tab.

---

## Tier 2 — Wedge completion (provisioning only, no engineering)

### 3. Twilio account — 30 minutes + ~$20-50/mo

Wedge bullet #5 (missed-call text-back within 10s) is the speed-to-lead promise on the landing page. Webhook + handler shipped 2026-04-27 (`/api/webhooks/twilio-missed-call`). Without an account, the webhook 200s but no SMS fires.

- Sign up at https://www.twilio.com/try-twilio
- Buy one US local number ($1/mo + per-minute usage)
- Settings → API Keys → create one for Henri
- **Vercel** env vars (Production):
  - `TWILIO_ACCOUNT_SID` = AC... from console
  - `TWILIO_AUTH_TOKEN` = the auth token
  - `TWILIO_FROM_NUMBER` = the number you bought, in E.164 (`+15551234567`)
- Configure the Twilio number's "Voice → A Call Comes In" webhook → POST to `https://meethenri.com/api/webhooks/twilio-missed-call`
- Verify: call the Twilio number from your phone; let it ring out; SMS lands within ~10s.

### 4. Free-tier API keys (closes the contact-completeness gap) — 30 minutes total

The score cap is 61/100 today because phone fill is 0.78% and email fill is 0.0004%. Provisioning these brings the cap to 75+ (the hot threshold).

| Provider | Vercel env var | Sign-up URL | Notes |
|---|---|---|---|
| **Apollo** (B2B contractor email + phone) | `APOLLO_API_KEY` | https://app.apollo.io/#/signup | Free tier ~25/day; biggest single uplift since score-gate now limits to contractor-applicant subset |
| **Google Places** (business phone) | `GOOGLE_PLACES_API_KEY` | https://console.cloud.google.com → APIs → Places API | $200/mo credit auto-applied = ~10k req free |
| **Yelp Fusion** (business phone) | `YELP_API_KEY` | https://www.yelp.com/developers/v3/manage_app | 5k/day free |
| **Hunter.io** (email inference) | `HUNTER_API_KEY` | https://hunter.io/users/sign_up | 25/mo free; CLAUDE.md tightened gating to contractor-applicant only so the 25/mo lasts |
| **Numverify** (phone validation) | `NUMVERIFY_API_KEY` | https://numverify.com/product | 100/mo free |
| **Cloudmersive** (phone + addr validation) | `CLOUDMERSIVE_API_KEY` | https://cloudmersive.com/pricing-api | 800/mo free |
| **OpenCorporates** (LLC officer lookup) | `OPENCORPORATES_API_KEY` | https://api.opencorporates.com/documentation/api-accounts | 500/day free |
| **FEC** (donor cross-ref) | `FEC_API_KEY` | https://api.data.gov/signup/ | unlimited free |
| **CourtListener** (lien dockets) | `CL_TOKEN` | https://www.courtlistener.com/help/api/rest/ | unlimited free, requires account |

Add each to **Vercel** → env vars (Production), redeploy once at the end.

Verify: re-trigger the score cron via `/api/admin/data-health/trigger` and watch the score distribution mean climb. Sentry should not log new 4xx/5xx from any of these providers.

### 5. Census Geocoder run-to-completion — set + forget

Already wired (`/api/cron/census-geocode`); throttled by the Census rate limit, takes about 24 hours of cron wall-time to walk through the 76% of permits without ZIPs. Just keep it scheduled — there's nothing to do unless you want to monitor.

Verify: after 24h, `permits.zip` fill should climb from 24% → 60%+. Check via `/dashboard/settings/data-health`.

### 6. Optional: FL/NC/OH voter file ingest — 4-5 hours wall time

Three states publish phone numbers in their public voter rolls. Free, just requires manual download.

- Florida: https://dos.myflorida.com/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/ (form request)
- North Carolina: https://www.ncsbe.gov/results-data/voter-registration-data (bulk download)
- Ohio: https://www6.ohiosos.gov/ords/f?p=VOTERFTP (bulk download)

Once downloaded, ingest scripts already exist:
```
npx tsx scripts/ingest-voter-fl.ts /path/to/fl-voter-file.txt
npx tsx scripts/ingest-voter-nc.ts /path/to/nc-voter-file.csv
npx tsx scripts/ingest-voter-oh.ts /path/to/oh-voter-file.txt
```

Closes the consumer-phone gap on FL/NC/OH leads from 0.78% to ~12%.

---

## Tier 3 — Stripe end-to-end QA — 1 hour

Before charging anyone, walk the full onboarding on a fresh email + Stripe test card.

```bash
# In one terminal
pnpm dev

# In another, run the smoke test
pnpm exec playwright test e2e/onboarding-stripe.spec.ts --headed
```

Or manually:
1. Open `localhost:3000/contractors` in incognito
2. Click "Get started" → use a fresh email (e.g. `+test1@gmail.com` alias)
3. Go through `/onboarding/license → plan → payment → territory → /dashboard`
4. Use Stripe test card `4242 4242 4242 4242` (any future expiry, any CVC, any ZIP)
5. Confirm:
   - No 5xx in logs (`mcp__Claude_Preview__preview_logs`)
   - No console errors in browser devtools
   - All 4 prices on `/pricing` match `$149 / $749 / $1,499 / $2,555`
   - No password input field anywhere (passwordless brand rule)
   - Stripe checkout uses `pk_test_` (the test mode key)
   - Territory page loads without throwing

Fix anything that's broken. This is the gate before sending the soft-launch email.

---

## Tier 4 — Hetzner Phase-4 smoke tests — 3 hours, optional

12 ASP.NET / SmartGov / EnerGov SelfService scrapers ship with `status: unverified`. The cron will not fire them until you flip them to `verified` after a manual smoke-test. Each tenant needs ~15 min to verify.

```
ssh -i ~/.ssh/henri_sidecar henri@5.78.152.250
cd ~/scrapling_loaders
DEBUG_HTML_DUMP=1 python load_accela.py clark-county-nv
# inspect ~/accela-debug-CLARK-COUNTY-NV.html if form-fill failed
# adjust YAML field_* selectors, retry
# once successful, edit configs/clark-county-nv.yml: status: unverified -> status: verified
```

Repeat for: clark-county-nv, las-vegas-nv, reno-nv, washoe-county-nv, north-las-vegas-nv, sparks-nv, slc-accela-ut, missoula-mt, oklahoma-city-ok, portland-me, teton-county-wy, henderson-nv.

Highest-leverage first: **clark-county-nv** (~80-120k permits/yr alone).

Defer until after launch — Phase 1-3 endpoints already cover ~42 states and 1.4M+ permits.

---

## Soft-launch playbook — what to do after the above lands

1. Send 5 hand-picked contractors at $149/mo a "Founder cohort" email. CLAUDE.md "Founder tier locked-forever" pricing is exactly this mechanism.
2. Recoverable: $750-1,500/mo if anything breaks; refund + iterate.
3. Real signal from real users in week 1 is invaluable. Don't wait for "perfect."

The tier-2 expansions (Apollo at scale, Wave 3 platform adapters, Hetzner Phase 4) get funded from MRR, not from runway.

---

**Total time to charge $149/mo: ~3 operator hours, ~$70/mo in services (Twilio + paid API tiers).** Everything technical is built.
