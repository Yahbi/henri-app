# Henri deep audit — 2026-08-05

Eight dimensions audited against the live database. Top findings put through an adversarial
second pass that tried to refute them; four did not survive. Every number below is either a
query I ran in this session or a `file:line` I opened.

**Confidence markers used throughout:**

| Mark | Meaning |
|---|---|
| `[V]` | Survived an adversarial second pass that actively tried to refute it |
| `[Q]` | Re-verified by me with a live query during synthesis |
| `[1]` | Single-pass finding. Evidence is cited but nobody tried to break it |

---

## 1. Verdict

**Is Henri sellable at $149/mo today? No.**

Not because the software is broken — most of it works — but because the three things a
contractor pays for do not currently happen:

1. **There are no leads worth calling in the only market that has territories.** Tampa's nine
   claimed ZIPs hold 4,119 leads. Two of them have any contact method. Five have an owner name.
   The newest permit in those ZIPs was issued 2026-06-25, six weeks ago, and 74 of 3,992 permits
   are from the last 90 days. Top score in Tampa is 61. `[Q]`
2. **Outreach does not send.** 1,850 messages have been queued since May. Zero have been
   delivered. There is no scheduled worker (`vercel.json` schedules exactly two crons, neither is
   `follow-ups`; `cron_runs` has never recorded a `follow-ups` execution). All 1,850 rows have
   `recipient = 'unknown'`. The UI says "Message queued successfully." `[Q]`
3. **The urgency tier the product is sold on has never had a member.** Zero of 273,951 leads have
   ever been marked hot. Max score across the entire table is 69 against a threshold of 75. The
   Leads tab renders a permanent "Hot (75+)" filter that returns nothing, in every market, for
   every plan. `[Q]`

On top of that, three defects fire specifically on customer #1 and on nobody before them: the
Stripe duplicate-subscription guard is blind during a trial and every Henri checkout is a trial;
the licence-check cron erases a genuine roster verification within 24 hours of it being earned;
and Florida — the launch state — is advertised in-product as auto-verified while holding zero
roster rows.

### The two or three things between here and yes

**(a) Get a market with contact data, or sell a different market.**
Tampa's 0.12% owner-name fill is not the national picture — nationally it is 43.4%, and the best
ZIPs (DC 20002/20005/20011/20036) run 94–96%. A 350x gap in one metro is the signature of a
field-mapping bug in that source, not a thin market — the same class of defect as
`configs/detroit-mi.yml` serving Virginia Beach. **Probe the Tampa/Hillsborough source field_map
before concluding anything about the market.** If it is genuinely thin, sell DC-grade ZIPs
instead. This is hours of work, not weeks, and it is the single highest-leverage thing on this
list.

**(b) Make outreach actually send, and stop claiming it sent.**
Schedule the worker, reject sends with no resolvable recipient instead of writing the string
`"unknown"`, and purge the 1,850 orphans before the first run marks them all failed.

**(c) Close the three customer-#1 landmines.**
Stripe trial-status guard, licence-verification erasure, and the false "currently auto-verifying:
FL, OH, VA…" claim. All three are small fixes. All three are invisible until someone pays.

Everything else in this document can wait. None of it is what makes Henri unsellable today.

---

## 2. What is genuinely good

This project has real engineering strengths. They are worth naming because a fault list gives no
signal about what to protect.

**The truthfulness discipline is real where it has been applied, and it is why this audit works.**
`src/lib/license/verify.ts:14-31` carries a docstring that bluntly states the module contacts no
licensing board on any code path — and names the user-facing copy the old lie propagated into.
`ContractorsContent.tsx` documents each removed exclusivity claim with the date and reason rather
than deleting silently. The "42-template per-trade library" claim on the landing page carries the
query that proves it (verified: exactly 42). Without this habit I could not have distinguished
"was fixed" from "was never true" anywhere in the codebase.

**`src/lib/stats/us-states.ts:41` — `ACTIVE_STATE_MIN_PERMITS = 500`.** The raw data has AR, ME,
RI and VT at one permit each. Someone noticed that "46 states" would be a lie to a contractor in
Rhode Island and put a floor in rather than shipping the flattering number. Nobody asked for that.

**`src/app/api/cron/refresh-landing-stats/route.ts:155,232` refuses to publish an implausible
number** (<1M permits, <10 states, or a drifted `dataset_kind` vocabulary) and falls back to the
last known-good cache instead of zeroing the homepage. Very few codebases have a sanity gate on
their own marketing numbers.

**`supabase/migrations/00120_repair_objobj_permits.sql` is exemplary and its claims check out.**
It asserts 100% of the damaged rows carry `raw_json->'location_1'`; live count is 125,504 of
125,504. The batching rationale (8s statement timeout, one bounded batch per call), the GeoJSON
`[lng, lat]` ordering note, the `NULLIF` guard, and the termination argument are all correct. It
is idempotent and safe to run right now.

**The messaging write lane is the best code in the repo.** `append_homeowner_message` does the
read-and-append in a single UPDATE so a concurrent contractor write cannot be clobbered; it strips
CR/LF from the body specifically so a homeowner cannot forge an `[out]:` line and fabricate a quote
from their contractor; it re-checks ownership inside the SECURITY DEFINER body; and it RAISEs when
`ROW_COUNT <> 1` instead of returning quietly. The client then re-fetches and asserts the text
landed before clearing the draft.

**Error states are consistently distinguished from empty states.** The load-bearing
`.select("id")` in `api/intake/[id]/route.ts:205-237` turns a missing RLS UPDATE lane from a silent
success into a loud 500 with a support address. `api/homeowner/messages/route.ts:85-95` refuses to
render "No conversations yet" when the real state is "the SELECT lane is missing."

**The payment gate is defended in depth on the right column.** Client-side, API 402, and the
`claim_territory` RPC all key off `stripe_subscription_id` (webhook-written, post-payment) and not
`stripe_customer_id` (pre-payment). Someone got burned by this once and fixed it properly.
Migration 00127's trust-column trigger genuinely prevents a contractor from self-awarding the
Licensed badge from the browser console.

**`readSlots` in the territory page is the model for how to fix this codebase's signature bug.**
It parses the RPC payload defensively, fails *closed* on the display (renders "Unknown", never a
green check it cannot back up), and carries a comment naming the exact prior defect it replaced.

**The "N filtered out" contract is honoured broadly** — LeadsPanel surfaces four separate honest
counters (commercial-hidden, non-geocoded-hidden, user-hidden, capacity-filtered), plus intel,
outreach and permits pages. The capacity empty state even reads "All {N} leads are outside your
capacity envelope — widen to see them."

**Scoring math is sound and its recent fixes are real.** `reconcileComponents` (model.ts:482) uses
largest-remainder apportionment so the drawer rows sum exactly to the score circle after a stage
cap. The future-date guard correctly floors a 2084 issue date (there is one in the DB) to "Permit
date unknown" rather than clamping it to "Filed today." The 2026-06-21 freshness fix works — every
lead scored under current code is correct.

**Graceful degradation is real, not aspirational.** Every sidecar booster returns null on a missing
table and contributes 0. Verified: the `lien`, `nfip` and `quake` boosters have never appeared in
any `score_signals` payload and nothing broke. `score_signals` covers 273,639 of 273,951 leads with
a legacy-column fallback for the remainder.

**Accessibility is not an afterthought.** `OnboardingProgress` ships a real `role="progressbar"`
with `aria-valuenow`/`aria-valuetext`, `aria-current="step"`, sr-only step descriptions, and uses
`bg-cta text-cta-foreground` throughout per the contrast rule.

---

## 3. Findings, ranked by (impact × likelihood) / effort

Ranked for the question that matters: **what happens to customer #1.** Today the system holds
4 profiles, 0 third-party paying contractors, 0 Stripe events, 0 homeowner intakes and 0 contractor
licences `[Q]` — so "impact today" is near zero for almost everything here. That is not a reason to
relax; it means every defect below is untested against a real user and will be tested by the first
one.

### SHIP-BLOCKERS — do not charge anyone until these are closed

---

**B1. The "Hot (75+)" tier is a labelled bucket that has never had a member, in any market, ever.**
`[V]` `[Q]` · effort S

- Live: `SELECT count(*) FILTER (WHERE urgency='hot'), max(score) FROM leads` → **0 hot,
  max 69** across 273,951 leads.
- `src/lib/scoring/model.ts:522` — `if (total >= 75) return "hot"`.
- `src/components/dashboard/LeadsPanel.tsx:216` filters `score >= 75`; line 67 renders the filter
  chip unconditionally. `LeadDetailDrawer.helpers.tsx:84` has a "Hot Lead" label no lead can earn.
- `src/components/landing/HowItWorks.tsx:46` promises "Hot leads sort to the top" on the public
  site.
- `src/app/api/cron/score/route.ts:1359` gates the speed-to-lead SMS on `score >= 75`, so the
  flagship wedge notification has never fired.

**Consequence:** a contractor clicks Hot on day one, sees an empty list, and concludes the product
is empty. It is also a truthfulness violation — a tier is asserted in the UI and on the landing
page that cannot be shown to exist.

**Correction to an earlier claim:** the tier is *not* arithmetically impossible. An earlier finding
computed a 74-point ceiling and called it "one point short"; that computation omitted the five
score boosters entirely (`model.ts:585-591`), and live data shows boosters contributing up to
**18** points on 43,073 rows. Summing the actually-measured per-component maxima gives 79. So the
honest statement is: **reachable in principle, never reached in 273,951 leads.** Do not recalibrate
off the false ceiling.

**Do:** derive tier cutoffs from the live distribution, or hide the Hot filter while `max(score) <
75`. Do not leave a labelled bucket that is provably always empty. Change the SMS gate at
`score/route.ts:1359` to its own explicit constant in the same commit, so a threshold edit cannot
silently turn on outreach blasts.

---

**B2. Outreach has no worker. 1,850 messages queued since May, zero sent, every one addressed to
the literal string "unknown", and the UI reports success.** `[1]` `[Q]` · effort M

- `SELECT count(*), count(*) FILTER (WHERE status='queued'), count(*) FILTER (WHERE recipient IN
  ('unknown','')) FROM outreach_queue` → **1850 / 1850 / 1850**.
- `SELECT count(*) FROM cron_runs WHERE cron_path='follow-ups'` → **0**, all-time.
- `vercel.json` (read in full) schedules exactly two crons: `/api/cron/catchup` and
  `/api/cron/score`. `follow-ups` is not among them, and is not in the admin manual-trigger
  allow-list at `src/app/api/admin/data-health/trigger/route.ts:47-84`.
- `src/app/api/cron/follow-ups/route.ts:107` is the only code path anywhere that drains
  `outreach_queue`.
- The `"unknown"` originates at `src/app/api/outreach/route.ts:158-161` —
  `channel==="sms" ? lead.phone ?? "unknown" : lead.email ?? "unknown"` — and the route still
  returns 201 `{success:true}`.
- `src/app/(dashboard)/dashboard/outreach/page.tsx:449` renders the green "Message queued
  successfully" panel on that 201.

**Consequence:** a paying contractor composes a message, sends it, and is told it worked. It will
never be delivered — not now, not when a worker is eventually scheduled, because the rows carry no
address. Speed-to-lead, the wedge, is 0%.

**Do, in this order:** (1) reject the send with 422 when the resolved recipient is falsy, naming the
missing channel; (2) purge or re-address the 1,850 orphans; (3) only then schedule the worker and
add it to the admin trigger allow-list. Scheduling first turns 1,850 silent rows into 1,850 visible
failures on the contractor's screen.

*Not second-passed. I re-ran every query above myself; the code paths are read but were not
adversarially challenged.*

---

**B3. The duplicate-subscription guard cannot fire during a trial, and every Henri checkout is a
trial. A missed webhook has no recovery path.** `[V]` `[Q]` · effort M

- `src/lib/stripe/client.ts:59` — `...(options?.skipTrial ? {} : { trial_period_days: 1 })`. Every
  first subscription's Stripe status is `trialing`.
- `src/app/api/checkout/route.ts:73-77` queries `subscriptions.list({ status: "active" })`. Stripe's
  `status` filter is exact-match, so a `trialing` subscription is never returned. **The guard is
  dead for the entire 24-hour window it exists to protect.**
- Repo-wide, `stripe_subscription_id` has exactly one writer:
  `src/app/api/webhooks/stripe/route.ts:165`, inside `handleCheckoutCompleted`.
  `customer.subscription.created` is handled at :593 but does not write the pointer.
- The primary guard (`checkout/route.ts:57`), the territory prerequisite
  (`onboarding/territory/page.tsx:394-412`), the payment page's `alreadySubscribed`
  (`payment/page.tsx:61`) and `skipTrial` (`checkout/route.ts:125`) **all read that single
  webhook-written column.** When the webhook does not land, every one of them simultaneously reads
  "unpaid."
- `src/app/api/cron/billing-sync/route.ts:35` filters `.not("stripe_subscription_id","is",null)` —
  the reconciler can never heal a NULL. **There is no recovery path anywhere in the codebase.**
- Live: `billing_events` = **0 rows**; 0 of 4 profiles have a `stripe_customer_id`. `/api/checkout`
  has never run to completion. This is untested code on the money path.

**Consequence:** a contractor pays, the webhook fails or lags, they are bounced back to a payment
screen showing an unpaid state, they pay again, and both trials convert 24 hours later —
$298 to $5,110 depending on tier. The app retains only the second subscription id, so support
cannot see or cancel the first.

**Do:** (1) list with `status: "all"` and treat `active|trialing|past_due|unpaid` as
already-subscribed; (2) **remove the single point of failure** — put `{CHECKOUT_SESSION_ID}` in the
`success_url` (`checkout/route.ts:130`) and add a small server route that retrieves the session,
verifies `session.customer` matches the caller, and writes the pointer synchronously and
idempotently. Polling the profile does not help when the webhook never lands. (3) Add a second pass
to `billing-sync` over `stripe_customer_id IS NOT NULL AND stripe_subscription_id IS NULL` so the
stuck state self-heals.

---

**B4. The only market with territories has no sellable inventory, and the cause may be a mapping
bug rather than a thin market.** `[V]` `[Q]` · effort S to diagnose, M–L to fix

- Tampa's nine claimed ZIPs: `SELECT count(*), count(*) FILTER (WHERE phone IS NOT NULL OR email IS
  NOT NULL), count(*) FILTER (WHERE owner_name IS NOT NULL), max(score) FROM leads WHERE zip IN
  (...)` → **4,119 leads / 2 contactable / 5 with owner name / max score 61**.
- Same ZIPs on the permits side: newest `issued_date` **2026-06-25** (six weeks stale), **74** of
  3,992 permits inside 90 days.
- Nationally, `owner_name` fill is **43.4%** (119,058 of 273,951) and the best ZIPs run 94–96%.
  Tampa is roughly 350x worse than the national average.
- The adversarial pass tried to generalise the Tampa framing and could not: the "lead quality is
  unsellable" conclusion rests partly on an outlier. But it confirmed what *does* generalise —
  even the 96%-owner-name DC ZIPs show 0.0–0.4% phone fill and max score 61–62.

**Consequence:** a roofer pays $149, opens the Leads tab, finds 4,119 rows with two phone numbers
and 74 permits from this quarter, and churns inside the 24-hour trial. That is the actual churn
event, and it happens before any other defect on this list is reached.

**Do first (cheap, hours):** probe the Tampa/Hillsborough source's `field_map` for a dropped owner
column. A 350x gap against the national baseline in one metro is the same signature as
`configs/detroit-mi.yml` (labelled Michigan, served Virginia Beach) and `configs/orlando-fl.yml`
(mapped 10 columns that do not exist). **Do not conclude the market is thin until that is ruled
out.**

**Do not** ship the previously-proposed quality gate of ">=200 leads with a contact method" before
selling a territory. I tested it: of 11,003 ZIPs with leads, **zero** have 200, zero have 50, and
only 1,129 contain a single contactable lead. That gate blocks 100% of territory sales nationwide.
A floor on `owner_name` + deliverable address is achievable (94–96% in the best ZIPs) and actually
discriminates.

---

**B5. Post-intake sign-in mis-roles every homeowner as a contractor. The entire homeowner half of
the marketplace is closed behind a dropped query parameter.** `[V]` `[Q]` · effort S

- `src/components/portal/ChatIntakeModal.steps.tsx:589-591` navigates to
  `/login?redirect=…&role=homeowner`.
- `src/app/(auth)/login/page.tsx:63-66` and `:86-89` — both auth handlers set only
  `callback.searchParams.set("next", …)`. **`?role` is read nowhere in the file.**
- `src/app/auth/callback/route.ts:75-78` gates the profile role stamp on
  `role === "contractor" || role === "homeowner"`. No param, no stamp.
- Live `handle_new_user` trigger on `auth.users` (enabled):
  `CASE WHEN NEW.raw_user_meta_data->>'role' = 'homeowner' THEN 'homeowner' ELSE 'contractor' END`.
  A magic link sent from `/login` carries no metadata. `profiles.role` also defaults to
  `'contractor'`.
- `src/middleware.ts` then bounces them: contractor + `/homeowner` → `/dashboard`; contractor +
  not-onboarded → `/onboarding/license`.
- Live: `SELECT role, count(*) FROM profiles GROUP BY role` → **contractor: 4**. Zero homeowner
  profiles have ever existed. `homeowner_intakes` = **0**.

**Consequence:** a homeowner finishes the intake, is invited to "sign in to track your project,"
and lands on a contractor licence-number form followed by a $149–$2,555/mo plan picker. They can
never reach `/homeowner`, see their project, message the contractor, or withdraw. The same trap
catches the confirmation email's CTA.

**Caveat on ranking:** this does not block contractor billing. It is listed as a ship-blocker
because it costs roughly one line to fix and it is currently killing an entire side of the product
that the contractor value proposition depends on.

**Also worth knowing:** `src/app/api/webhooks/supabase/route.ts:61` defaults the *opposite* way
(homeowner) and upserts with `ignoreDuplicates:false`. It is not wired (no webhook trigger on
`auth.users`; the handler 401s with no secret set). Two contradictory default-role paths exist in
this repo. **If that webhook is ever provisioned it will silently flip the default for every future
signup and demote contractors.**

---

**B6. Licence verification: the cron erases genuine verifications within 24 hours, and nine states
including Florida are advertised as auto-verified while holding zero roster rows.** `[V]` · effort S

Two defects, same subsystem, both fire on customer #1 in the launch state.

*B6a — erasure.* `src/app/api/cron/license-check/route.ts:42-46` selects every non-terminal licence
(including `verified_state_roster`) and calls `recheckLicense`, which delegates to `verifyLicense`
— every branch of which returns `{status:"pending", verified:false}` because the module contacts no
board. Line 70's status comparison is therefore true, and lines 74-80 write `verified:false`,
`verification_status:"pending"`, `expiry_date: null`, `raw_response: null`. The live CHECK
constraint permits `pending`, so the demoting UPDATE succeeds; migration 00127's trust trigger
short-circuits for `service_role`, so it passes straight through. Four `license-check` runs are
recorded (last 2026-07-06), fired from `.github/workflows/cron-fleet.yml:144` and re-fired by
`cron/catchup/route.ts:110`. `expiry_date` is nulled in 100% of cases. Four independent read paths
gate the Licensed badge on `verified = true`; all four silently lose it. No notification fires.

*B6b — false capability claim.* `src/app/api/onboarding/verify-license/route.ts:239-244` checks
only `contractor_license_sources.enabled = true` — never that the state has roster rows. Nine
enabled states have **zero**: AK, AR, CO, DC, **FL**, ID, OH, UT, VA. `available_states` is built
from the same flag (`:254-261`) and rendered at `onboarding/license/page.tsx:492-497` as
"Currently auto-verifying: {list}" to every contractor. A Georgia contractor is told Henri
auto-verifies nine states for which we hold nothing.

**Consequence:** Henri's 10 active territories are nine Tampa FL ZIPs plus one Hartford CT ZIP. A
Florida contractor enters a valid CILB number, is told it was not found, is stamped
`missing_in_roster`, and — if they ever do verify successfully — has it erased within 24 hours.
Meanwhile the product tells everyone else that Florida is covered.

**Do:** for B6a, guard on the *result* — `if (result.status === "pending") continue;` before the
update (this also stops `missing_in_roster` and `manual_review` being flattened, which the
originally-proposed fix missed), and build the patch with conditional spreads so a null can never
clear a stored value. Better still: unschedule the cron until a real check exists. For B6b, gate on
a cheap `SELECT 1 FROM state_license_rosters WHERE state_code=$1 LIMIT 1` and build
`available_states` from the same evidence. **Do not** gate on `last_inserted > 0` (it is a per-run
counter and already diverges from actual row counts by thousands), and **do not** disable the nine
sources — `enabled` is what tells the roster loader to run, so disabling FL guarantees its roster
never fills.

---

### HIGH-VALUE — best return per unit of effort once the blockers are closed

| # | Finding | Evidence | Effort | Conf |
|---|---|---|---|---|
| H1 | **125,504 permits still hold the literal address `[object Object]`.** The repair function exists, its preconditions verify (125,504 of 125,504 carry `raw_json->'location_1'`), it is idempotent and it terminates. It has simply never been run to completion. Repairing also restores zip and coordinates and re-queues the rows for scoring. | `supabase/migrations/00120…sql`; open task #34 | S | `[1]` |
| H2 | **The scorer never sees `leads.phone`.** 666 leads have both a phone and an owner name, yet `score_contact >= 10` returns **0 rows** across all 273,951. Realized distribution is only {0,4,5,8,9}. Feeding existing phone data back in moves contact from 4 to 9–14 points and is the cheapest available lift on the score ceiling. | `score/route.ts:849,857-866`; `model.ts` contact branch | S–M | `[V]` |
| H3 | **Duplicate leads from inconsistent `source_city` casing.** The dedup key is `(source_city, source_id)`; Tampa permits arrive as `''`, `'Tampa'` and `'tampa'`. 1,612 addresses appear under 2 distinct `source_city` values vs 404 under 1 — **80% duplicated**. 126 permit_ids in those ZIPs carry 2 leads each. | `sources-db.ts:163` passes city through unnormalised | M | `[1]` |
| H4 | **191,270 leads (70%) store a freshness breakdown the permit date contradicts** — one sampled lead reads "Filed today / 20 of 20" on a permit issued 2011-06-10 (5,535 days). The code was fixed 2026-06-21; the rows were never re-scored. Of freshness-20 leads inside active territories, 3,566 of 3,566 sit on permits older than 60 days. | `model.ts:161-191`; `ScoreSignalBreakdown.tsx:84,94-97` renders stored jsonb verbatim | S | `[V]` |
| H5 | **The homepage publishes a lead count 7.8% above reality** — 295,327 vs 273,951 actual, from a `count: "planned"` planner estimate. Biased upward, which is the disallowed direction under the round-down rule. Every other figure in the same payload is exact. | `refresh-landing-stats/route.ts:139` | S | `[1]` |
| H6 | **Plan ZIP cap counts released territories**, so releasing a ZIP permanently burns a slot and triggers a false upgrade prompt. The RPC gets this right; the API layer does not. One line. | `api/territories/route.ts:108-111` missing `.eq("status","active")` | S | `[1]` |
| H7 | **10,336 permits stored `status='approved'` while the source says `INACTIVE`.** The unanchored substring matcher was fixed; the corrupted rows were not. Status feeds urgency, so dead permits rank as live opportunities. | `normalizer.ts:127-146`; query by `source_city='Elk Grove'` | S | `[1]` |
| H8 | **The "Elk Grove" feed is a business-licence roster, not permits** — 22,519 rows with null address, null zip, null description, bare integer permit numbers, and statuses like `SEMINAR`, `1ST RENEWAL`, `IN COMPLIANCE`. `dataset_kind` exists precisely to exclude this and has never been written on any of 361,906 rows. | `sources-db.ts:38,220` | S | `[1]` |
| H9 | **Score cron fails 37% of runs on statement timeouts in its own primary SELECT** (35 runs / 13 errors in 7 days; `enrich` is 4 of 7). The batch pulls a ~10KB `raw_json` for 1,000 rows and uses two keys from it. | `score/route.ts:224`; `cron_runs` 7-day group-by | M | `[Q]` |
| H10 | **Anonymous callers can map every ZIP to the contractor UUIDs holding it**, then resolve those to name, company and full territory list. Both endpoints are unauthenticated and middleware short-circuits `/api/`. Breaks the coarse-competitive-intel rule and exposes Henri's own customer list. | `api/territories/[zip]/route.ts:9`; `api/contractors/[id]/route.ts:20` | S | `[1]` |
| H11 | **Territory claim hands over at most 500 historical leads and never resumes.** ZIP 06106: 594 owned, **12,056 unowned**. Nothing else rebinds a NULL-contractor lead. No counter explains the gap — the rows are not filtered, they are simply unassigned, which is the silent-drop the project's own rule forbids. | live `claim_territory` body (`LIMIT 500`) | M | `[1]` |
| H12 | **`leads.owner_occupied` defaults to `true`** — all 273,951 rows stamped owner-occupied, 0 false, 0 null. A never-measured property fact rendered in the map popup to every contractor. Also makes the `absentee_owner` reason code unreachable. | `00009_schema_v2.sql:24`; `dashboard/map/page.tsx:720` | S | `[V]` |
| H13 | **The capacity chip advertises radius / start-window / active-jobs filters that `applyCapacityFilter` does not implement.** A contractor sets a 25-mile radius and sees "≤25mi · 0 hidden", which reads as "the filter ran and nothing was out of range." | `capacity/types.ts:102-119` vs `:69` | S | `[1]` |
| H14 | **Five of eleven Leads filters are permanently empty** (Homeowner requests: 1 lead; Maintenance opportunities: 0; Pre-intent: 0 — those `opportunity_stage` values do not exist in the table). The empty state cannot distinguish "nothing today" from "never had a member." The self-hiding pattern already exists in the same file. | `LeadsPanel.tsx:70-77`, cf. `:464-476` | S | `[1]` |

### WORTH DOING — real, lower leverage

- **Zip backfill scoped to owned territory only.** 1,426,423 permits (63%) have NULL zip and no code
  path anywhere writes it — verified: the only four `permits` UPDATE sites write lat/lng or
  `scored_at`. But zip is not the binding constraint, territory ownership is: repairing all 101,305
  Florida rows yields roughly **three** additional sellable permits, because Orlando and Tallahassee
  have no contractor. The one slice with revenue behind it is Hartford CT (9,176 NULL-zip permits,
  ~31% of Hartford's zipped permits are 06106). Hook the repair to territory-claim time, not to
  catalog size. `[V]`
- **`historical_conversion` is a flat +3 for 99.87% of leads** because zero leads have ever been won.
  It occupies one sixth of the score weight and has essentially zero variance. Render it 0/15 with
  the honest "Not enough history yet" text it already carries. `[1]`
- **Breakdown rows do not sum to the score on 2.6% of leads** (delta −4 to +12). Render the stored
  `lead.score` as the header total instead of re-deriving it, so stale jsonb can never contradict
  the badge on screen. `[1]`
- **98.6% of leads carry a permit class, not a trade** (`other` 156,223, `residential` 45,013,
  `commercial` 40,515 vs roofing 843, hvac 776, plumbing 233). Per-trade templates, `score_trade_weights`
  and trade gating all key off a field that almost never holds a trade. `[1]`
- **The new-lead notification asserts recency** — "A new permit was filed" — on permits ingested at a
  median age of ~1,359 days. Currently masked because nothing fires. Fix it in the same commit as
  anything that turns notifications back on. `[1]`
- **"We'll review your license manually" is promised on three surfaces; no queue, no reviewer, no
  operator notification exists.** `[1]`
- **Two middleware onboarding gates are inert or check the wrong fact** — `/onboarding/payment` gates
  on `!profile?.plan`, but `plan` is NOT NULL DEFAULT `'free'`; `/onboarding/territory` gates on
  `stripe_customer_id`, which is stamped before the user reaches Stripe. Not exploitable (three
  deeper layers hold) but produces confusing dead ends. `[1]`
- **Enterprise's "All trades visible" differentiator is not enforced on the Leads tab.**
  `resolveTradeGate` has two call sites, neither of them `/api/leads`. And `profiles.trade` is NOT
  NULL DEFAULT `'general'`, never written by any onboarding step, so the gate lifts itself for 100%
  of accounts. Decide whether it is the differentiator or delete the bullet. `[1]`
- **`joinWaitlist` can never succeed** — it names a nonexistent `created_at` column and omits
  `position` (NOT NULL, no default). Zero rows, ever. Latent: no ZIP is currently full
  (`slots_total` is 3, max claims per ZIP is 1), so the button never renders. Fix via an RPC with
  `pg_advisory_xact_lock(hashtext(zip))` — a bare `max(position)+1` is still racy against
  `uq_zip_waitlist_position` under MVCC. `[V]`
- **Delete the exclusivity lock module.** `acquireLock` has no caller; the table has 0 rows; the
  badge has never rendered. But **do not build the acquire path** — see "Deliberately not doing."
  Removing `useExclusivity` from `LeadsPanel.tsx:172` and `KanbanBoard.tsx:438` also drops two
  always-empty round-trips per dashboard mount. `[V]`
- **`cron_runs` contains two spellings for the same job** — `/api/cron/refresh-landing-stats`
  (4 runs, 3 errors) and `refresh-landing-stats` (2 runs, 1 error) `[Q]`. This is the same
  cron-path-mismatch class that previously caused three routes to be re-fired forever. Normalise the
  key and add a uniqueness assertion. `[Q]`
- **Five priority-90 sources have never been scraped once** (fort-worth, columbus, new-orleans,
  kansas-city, orlando) and one of them duplicates an already-working Orlando feed byte-for-byte.
  Targeted mode (`?source_key=…`, `scrape/route.ts:171`) exists specifically for this. `[1]`

### DELIBERATELY NOT DOING — and why

- **Do not backfill zip across all 1,426,423 rows.** PostGIS is not installed (verified: it was
  dropped in migration 00080 and `pg_extension` confirms it is gone), there is no ZCTA polygon table,
  and `zip_reference` has no geometry or centroid — so the "cheap point-in-polygon on the 359,466
  rows that already have lat/lng, no external API, no rate limit" plan is not achievable with
  current assets. It needs either re-installing PostGIS plus ~33k polygons or a rate-limited external
  geocoder. And the payoff is near-zero: most of those rows are in ZIPs nobody owns. `[V]`
- **Do not re-engineer the scrape rotation to drain the 211,881-source explorer tail.** The 441-day
  cycle is real arithmetic, and the true throughput is worse (the tail gets 0 slots per run, not 20 —
  both lanes sort `priority DESC` first, and the 230s budget is consumed by ~8 head-of-array
  producers pulling ~20k rows each). But more permit sources fix neither of the two binding
  constraints, which are contact fill and the score ceiling. `[V]`
- **Do not route source triage through `dataset_kind` as currently designed.** The column reads
  `'unknown'` on all 361,906 rows and its only `non_permit` writer sets `enabled=false` in the same
  patch — so filtering on it against an enabled-only lane is a provable no-op. Use a distinct
  probe-state column instead. `[V]`
- **Do not add `ORDER BY issued_date DESC` to the score cron's unscored-permit select.** The
  "1,362-day speed-to-lead" figure that motivated it conflates two stages: ingest lag (p50 1,359
  days — scraper backfill of decades-old archives) and scoring queue lag (**p50 4.4 days, p90 10.6
  days**). Ordering can only affect the 4.4-day stage. Worse, the freshest cohort scores *lowest*
  (0–90 days old: n=74, max score 46 — below the warm threshold of 50), so newest-first would
  prioritise the one cohort that structurally cannot fire a notification, and it would permanently
  starve the 16,611 unscored permits with a NULL `issued_date`. `[V]`
- **Do not build the exclusivity lock acquire path.** Exclusivity is already enforced, just not where
  the docs say: `score/route.ts:1039-1041` assigns exactly one contractor per permit (round-robin),
  and `useLeads.helpers.ts:126` scopes every non-god-mode read by `contractor_id`. Live check for
  double-assignment returns zero rows. Adding a claim step would layer a second, conflicting
  ownership model on leads that are already exclusively owned. **Do** fix the latent hole instead:
  `zipCounters` resets each cron run and the upsert conflict target is `(permit_id, contractor_id)`,
  so a re-scored permit in a 2+-contractor ZIP can create a second lead row. Make the mapping
  deterministic (stable hash of `permit_id`) and add a regression test. `[V]`
- **Do not gate territory sales on ">=200 leads with a contact method."** Zero of 11,003 ZIPs
  qualify. It is a kill switch, not a quality floor. `[V]`
- **Do not buy Apollo or any paid enrichment before first revenue.** It is the only thing that moves
  phone fill meaningfully, and it is correctly gated on MRR in the existing plan.
- **Do not chase the remaining uncovered states.** See the ceiling section.
- **Do not treat the missing `scrape` cron_runs rows as evidence the scraper is dead.** See
  "Corrections to the record."

---

## 4. The structural theme

### The pattern: the claim outlives the code

Every recurring defect in this codebase is one assertion that was true (or believed true) at the
moment it was written, and stayed on the page after the thing it described changed. It shows up in
three shapes.

**Shape 1 — Fixed forward, never backfilled.** The bug is found, the code is corrected, and the
rows that carry the old behaviour are left in place with no mechanism that will ever revisit them.
The freshness blend (191,270 rows), the unanchored status matcher (10,336 rows), the
`contact_completeness` bonus (115,459 rows), the `[object Object]` addresses (125,504 rows), the
breakdown-sum mismatch (2.6%). In each case the code is now right and the product is still wrong,
and the fix commit reads as complete.

**Shape 2 — A flag standing in for evidence.** A boolean acquires a second meaning nobody
declared. `contractor_license_sources.enabled` means "the loader should run this" and is read as
"we can verify this state." `status: verified` in a source YAML means "someone wrote this file" and
is read as "someone probed this endpoint" — which is how `detroit-mi.yml` came to serve Virginia
Beach. `owner_occupied DEFAULT true` means "the column has a value" and is read as "we measured
occupancy." `dataset_kind` was designed to carry evidence and was never written at all.

**Shape 3 — A comment asserting a quantity nobody re-measured.** `cron-fleet.yml:167-171` reasons
about "~12k enabled sources" and a "240-day rotation" against a live 239,883. `model.ts:251-255`
justifies the contact-score floor on the premise that "the mailing address IS on every permit" —
it is on 7.9% of leads and 0 of the 3,994 leads the one real contractor holds. `score/route.ts:1013`
says the loop creates a lead "for each scored lead × each contractor" while the code four lines
below picks one. `verify.ts:104` says the cron "can surface expiry from the `expiry_date` already
stored on the row" while line 78 unconditionally nulls it.

The common root is that **nothing in the pipeline ever compares a written claim against live
data.** Type-checking, tests and code review all validate code against code. Every defect above
survived all three.

### The process change

Four items, all cheap, ordered by how many of the findings above each would have caught.

**1. A nightly assertion job that queries live data and fails loudly.** Not metrics — assertions,
each one a claim the product makes, expressed as SQL that must return zero rows:

- no lead's stored freshness detail contradicts its permit's `issued_date`
- no urgency tier rendered in the UI has zero members
- every published landing number is less than or equal to its exact live count
- every cron in the schedule has a `cron_runs` row inside its own period, under exactly one
  `cron_path` spelling
- no column representing a measured fact has a non-null DEFAULT
- no enabled licence source has zero roster rows while being named in `available_states`

This would have caught B1, B6b, H4, H5, H12 and the double-spelled cron path, on the day each
landed. It is the single highest-return item in this document.

**2. One question on every PR: "how many existing rows carry the old behaviour, and what
re-processes them?"** The answer "none" is fine. Leaving it blank is not. This catches all of Shape
1 — roughly 440,000 corrupted rows across four separate incidents, every one of which shipped as
a completed fix.

**3. No boolean carries two meanings, and no measured fact carries a DEFAULT.** When a flag is
about to answer a second question, add a column. `enabled` vs "verifiable", `status: verified` vs
"probed", `owner_occupied` vs "occupancy measured." This is Shape 2 in its entirety.

**4. Any comment stating a quantity carries the query that produced it and the date.** This is
already done well in three places — `refresh-landing-stats`'s sanity gates, `ACTIVE_STATE_MIN_PERMITS`,
and the 42-template comment. Make it the rule rather than the exception. A stale number with a date
next to it is self-flagging; a stale number without one is indistinguishable from a fresh one, which
is exactly how "~12k enabled sources" survived a 20x drift.

**One structural note on this audit itself:** four of the fourteen most confident findings were
refuted or materially downgraded by a second pass that tried to break them. Two of the refutations
turned on the *reporter's own evidence contradicting their own conclusion two sentences later*. The
adversarial pass is not optional overhead — at a 29% refutation rate on high-confidence findings, it
is the difference between a work plan and a wild goose chase.

---

## 5. Corrections to the record

Things previously believed — some in CLAUDE.md, some in this audit's own first pass — that live
data does not support. Do not act on any of these.

| Claim | Reality |
|---|---|
| "Permit ingestion has been stopped for a month; the `scrape` cron has never logged a completed run" | The missing `cron_runs` rows are a logging artifact. `logCronRun(SCRAPE_CRON_PATH, …)` was introduced in commit `74c6e1f` at 02:18 UTC **today**; before that the route contained no `cron_runs` write on any path. Eight sources were stamped between 00:09 and 01:01 UTC today with `error_count = 0` and healthy counts (Cincinnati 18,676; DC 20,000; Miami-Dade 20,000; Sacramento 11,773) — a producer rotation completing normally with no log statement to execute. The proposed "300s ceiling kills it" mechanism is also empirically false: `catchup` logged a 361,020 ms run and `enrich` 414,881 ms on the same deployment. `[V]` |
| "The Hot tier ceiling sums to 74 — one point short" | Omits the five boosters entirely (`model.ts:585-591`); live data shows up to **18** booster points on 43,073 rows, and the reporter's own measured per-component maxima sum to 79. Hot is reachable in principle and has never been reached in practice. `[V]` |
| "Speed-to-lead is 1,362 days at the median" | 99.7% of that is scraper backfill of decades-old permit archives. The scoring queue itself adds p50 **4.4 days**, p90 **10.6 days**. Do not put 1,362 in any report or in CLAUDE.md as a latency figure. `[V]` |
| "The exclusivity wedge is completely inert; two contractors would work the same permit" | Exclusivity is enforced — by single-contractor round-robin assignment plus `contractor_id` row scoping. Live check for a permit assigned to 2+ contractors returns zero rows, and no ZIP currently has more than one contractor. The lock table is dead code; the outcome it promises is delivered elsewhere. CLAUDE.md wedge bullet #1 describes a mechanism that does not run. `[V]` |
| "191,270 leads say 'Filed today'" | Only 21,821 say "Filed today"; the other 169,449 say "Filed 2 days ago" / "Filed 3-6 days ago". Still false, but not that string. And 187,050 of the 191,270 are orphans with `contractor_id IS NULL` and are unreachable by any contractor — the 4,220 owned ones belong to `dev-contractor@henri.local` and the founder. **No third-party paying contractor holds a single poisoned lead.** `[V]` |
| "`owner_occupied` inflates contact_completeness by +4 on every lead" | The score cron's `buildSignals` call never passes `owner_occupied`, so the bonus cannot fire under current code — the +4 is frozen on 115,459 legacy rows, of which 207 are assigned to anyone. `[V]` |
| "The `owner_occupied` badge renders in the lead drawer" | The drawer reads live enrichment (`useEnrichment` → `/api/enrichment/property`), which starts null. The only surface that renders `leads.owner_occupied` is the map popup. `[V]` |
| CLAUDE.md / `cron-fleet.yml:167-171`: "~12k enabled sources, 240-day rotation, 1,200 source-scrapes/day" | Live: **239,883** enabled sources, of which 210,897 have never been contacted once, and **8** scraped in the last 30 days. `[Q]` |
| `sources-db.ts:126-133` citing "239,883 enabled sources" as a coverage signal | 88% of them have never been contacted. "Enabled" means "queued behind a year of backlog," not "live." `[V]` |
| `verify-license/route.ts:99-128`: "until migration 00123 lands, these writes raise" | 00123 is applied. The live CHECK constraint already permits `verified_state_roster`, `manual_review` and `missing_in_roster`. The caveat is stale and will mislead the next reader. `[V]` |
| `model.ts:251-255`: "the mailing address IS on every permit" | 7.9% of leads (21,514 of 273,951), and **0 of 3,994** for the one contractor with a realistic territory portfolio. `[1]` |
| `score/route.ts:1013-1014`: "for each scored lead × each contractor in that ZIP, create a lead" | The code four lines below picks exactly one contractor. `[V]` |

---

## 6. The honest ceiling

What is not solvable with the current data, compute tier or budget. Do not burn weeks here.

**Contact data.** National phone fill on free public sources caps at roughly 8–12%; Henri is at
**0.98%** (2,694 of 273,951) and has **two** email addresses in the entire table. The prior research
sweep closed this definitively across ten probe families — voter files (commercial-use prohibited in
every phone-bearing state except NC, OH and WI), county PSAPs, assessor CAMA, court e-filing, utility
rolls. West Virginia's NG911 `Res_Phone` is an outlier, not a pattern; Vermont's equivalent layer was
probed field-by-field and has no phone column. Only a paid waterfall (Apollo class, ~$49/mo floor)
moves this. **More free data sources will not fix lead quality.** That research budget is spent.

**The score ceiling follows from the contact ceiling.** `contact_completeness` maxes at 9 of 15
because phone is absent; `historical_conversion` is pinned at 3 of 15 because zero leads have ever
been won; `homeowner_engagement` cannot reach 15 because zero homeowner intakes exist. Those three
caps are data facts, not tuning parameters. Recalibrating thresholds is honest; pretending the
signals will fill in is not.

**Compute.** A bulk UPDATE exhausted this instance's Disk IO budget and made it unresponsive for
hours on 2026-08-04. The `authenticator` role carries an ~8s statement timeout. Every repair in this
document must be chunked, and the score cron is already failing 37% of runs on that timeout in its
own primary SELECT. Assume the instance is the constraint, not the code.

**PostGIS is gone.** Dropped in migration 00080 (it was dead code — the only dependent column was
empty). There is no point-in-polygon capability, no ZCTA polygon table, and `zip_reference` has no
geometry. Any coordinate-to-ZIP work needs a deliberate decision to re-install it (into the
`extensions` schema, per 00080's own guidance) or to pay for a rate-limited external geocoder. It is
not free and it is not a one-liner.

**Geographic coverage.** The US has roughly 19,500 incorporated municipalities; approximately
500–800 publish a public permit API. The reachable ceiling is the top ~800 cities and ~42–46 states,
not 50. Four states (RI, MS, ND, WV) have no viable free permit path at all — RI is entirely on
OpenGov ViewPoint, whose ToS prohibits automated bulk extraction, making it a partnership question
rather than an engineering one. Kansas and Rhode Island additionally have no free public parcel
REST. Long-tail rural jurisdictions issue permits on paper in courthouse filing cabinets and are
inaccessible to any automation at any budget.

**Scrape rotation.** 239,883 enabled sources against 8 scraped in 30 days. A full rotation of the
explorer tail is 441 days at the *designed* cadence and unbounded at the real one. This is not
fixable by tuning the 60/40 lane split, and it does not need to be — coverage is not what is
blocking revenue.

**Marketplace liquidity.** Zero homeowner intakes have ever been created; zero homeowner profiles
have ever existed. Any contractor value proposition that depends on homeowner-side supply cannot be
validated at all until B5 is fixed and the portal gets traffic. Until then, Henri is a permit-lead
tool, and should be priced and pitched as one.

---

## 7. What was and was not verified

**Verified live in this session (re-runnable):** all lead aggregates (count, phone, email, owner
name, hot, max/avg score, assigned); Tampa nine-ZIP lead and permit aggregates; `outreach_queue`
totals and recipient distribution; `contractor_licenses`, `homeowner_intakes`, `profiles` by role,
active `territories`, `zip_waitlist`, `billing_events` counts; `cron_runs` 7-day group-by and
all-time `scrape` / `follow-ups` counts; `permit_sources` enabled count and 30-day scrape recency;
`vercel.json` in full; `model.ts:522`, `LeadsPanel.tsx:216`, `checkout/route.ts:75`,
`stripe/client.ts:59`.

**Verified by the adversarial pass (marked `[V]`):** ten findings survived a deliberate attempt to
refute them, four did not, and several had their severity or their stated impact corrected. Where a
correction was made it is stated inline rather than quietly dropped.

**Single-pass only (marked `[1]`):** everything else. Each carries a `file:line` or a query, but
nobody tried to break it. Given that the second pass refuted or materially downgraded roughly 29%
of the findings it examined, **treat single-pass findings as hypotheses with evidence, not as
settled facts** — particularly B2 (the outreach worker), whose live numbers I re-ran but whose code
paths were not challenged.

**Not verified at all:** nothing in this document was confirmed by running the dev server and
clicking the UI. Every user-facing consequence is traced from component source plus a query for the
data it renders. The only locally authenticatable account is god-mode, which bypasses middleware
role gating, both territory prerequisite checks and the `claim_territory` god-mode branch — so a
god-mode walkthrough would have validated nothing about the real path, and there is no non-god-mode
contractor with a subscription to impersonate. Whether the four `STRIPE_*_PRICE_ID` variables are
actually set in Vercel was also not checked; if `STRIPE_FOUNDER_PRICE_ID` is missing,
`/api/checkout` returns 400 "Plan unavailable" and the $149 tier — the entire soft-launch plan — is
unbuyable with no diagnostic. Worth thirty seconds before launch.
