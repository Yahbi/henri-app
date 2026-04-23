# Row-Level Security (RLS) Invariants

Every API route in `src/app/api/**` that queries a user-owned table relies on
Supabase RLS for the final layer of isolation. Middleware and route-level role
gates are defense-in-depth — they make the obvious bypasses 401/403 — but RLS
is what guarantees a contractor cannot read another contractor's rows even
with a leaked cookie.

This document lists each protected table, the policy that enforces isolation,
and the migration file where the policy is defined. If you add a new table
with user data, **copy the matching pattern** and update this file.

## Invariants the app depends on

| Table | Isolation key | Policy name(s) | Migration |
|-------|---------------|----------------|-----------|
| `profiles` | `id = auth.uid()` | `profiles_select_own`, `profiles_update_own`, `profiles_insert_own` | `00002_profiles.sql`, `00012_prod_hardening.sql` |
| `territories` | `user_id = auth.uid()` (write); public select for availability | `territories_select_all`, `territories_update_own`, `territories_insert_own` | `00003_territories.sql` |
| `zip_waitlist` | `user_id = auth.uid()` (write/delete); public select | `zip_waitlist_*` | `00003_territories.sql` |
| `permits` | public read (building permits are non-sensitive); writes via service role only | `permits_select_all` | `00004_permits.sql` |
| `leads` | `contractor_id = auth.uid()`; inserts via service role | `leads_insert_service` and select policy | `00005_leads.sql`, `00019_audit_fixes.sql` |
| `notifications` | `user_id = auth.uid()` | `notifications_select_own`, `notifications_update_own`, `notifications_insert_service` | `00006_notifications.sql`, `00019_audit_fixes.sql` |
| `homeowner_intakes` | matched-contractor-only select; anon insert | `intakes_select_matched`, `intakes_insert_anon` | `00009_schema_v2.sql` |
| `outreach_logs` | `contractor_id = auth.uid()` | `outreach_select_own`, `outreach_insert_own` | `00009_schema_v2.sql` |
| `estimates` | `contractor_id = auth.uid()` | `estimates_select_own`, `estimates_insert_own`, `estimates_update_own` | `00009_schema_v2.sql`, `00011_estimates_and_blasts.sql` |
| `blast_campaigns` | `contractor_id = auth.uid()` | `contractor sees own blasts` | `00011_estimates_and_blasts.sql` |
| `outreach_templates` | `contractor_id = auth.uid()` | `contractor sees own templates` | `00011_estimates_and_blasts.sql` |
| `contractor_licenses` | `contractor_id = auth.uid()` | `licenses_select_own`, `licenses_insert_own`, `licenses_update_own` | `00010_roles_and_licenses.sql` |
| `permit_sources` | public read; writes via service role only | `permit_sources_select` | `00013_permit_sources.sql` |
| `referral_codes` | owner select/insert | `referral_codes_*` | `00015_referrals.sql` |
| `referrals` | owner select/insert/update | `referrals_*` | `00015_referrals.sql` |
| `reviews` | public select; owner insert/update | `reviews_*` | `00016_marketplace_engine.sql` |
| `review_requests` | owner-only | `review_requests_own` | `00016_marketplace_engine.sql` |
| `quotes` | contractor owns row OR homeowner on the intake | `quotes_contractor`, `quotes_homeowner` | `00016_marketplace_engine.sql` |
| `intake_matches` | contractor sees own; homeowner sees own intake's matches | `Contractors see own matches`, `Homeowners see own intake matches` | `00018_intake_matches_and_indexes.sql` |

## Service-role writes

The following tables are `INSERT`-only via the service-role key (never from a
client session):

- `leads`
- `notifications`
- `permits`
- `permit_sources`

These inserts happen inside cron routes (`src/app/api/cron/*`) and the Stripe
webhook. The service-role key must never be shipped to the browser — see
`src/lib/supabase/admin.ts`.

## When to update this document

- Adding a new table with user data → add a row here and link the migration.
- Changing an isolation key (e.g. `user_id` → `org_id`) → update this file in
  the same PR as the migration.
- Disabling RLS on a table (rare, usually only for lookup tables) → document
  why here with a justification.

## Verification

A contractor session querying any other user's rows must return 0 results,
even when the query does not include an explicit `eq("user_id", …)` filter.
Test periodically with two seed accounts in a staging database — do not rely
on code review alone.
