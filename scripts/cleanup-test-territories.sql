-- ─────────────────────────────────────────────────────────────────────────
-- Pre-launch cleanup: drop test territories owned by founder/god-mode accounts
-- ─────────────────────────────────────────────────────────────────────────
-- Why: ~11,444 territories were claimed during god-mode exploration over the
--      last weeks. A real contractor signing up for ZIP 10001 (or any other
--      explored ZIP) would see "claimed by someone else" and bounce. Need a
--      clean slate before opening signup to outside contractors.
--
-- Source of truth for "founder" identities: src/lib/auth/god-mode.ts
--   DEFAULT_ALLOWLIST = "y.abismuth@gmail.com,waspinc20@gmail.com"
--
-- The CLAUDE.md mentioned 4 founder accounts but the code only ships 2.
-- The `IN (SELECT id FROM profiles WHERE email = ANY(...))` form below is
-- safe regardless of count — extend the array if you have more.
--
-- Apply path:
--   1. Open https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new
--   2. Paste this whole file
--   3. RUN STEP 0 FIRST (preview). Confirm the count looks right (~11,444).
--   4. Then run STEP 1 (the actual delete). Wrapped in a transaction so you
--      can ROLLBACK if numbers look wrong inside the txn.
--
-- Idempotent: safe to re-run. After the first run, STEP 0's count = 0.
-- ─────────────────────────────────────────────────────────────────────────


-- ── STEP 0: PREVIEW (read-only, run first) ──────────────────────────────
-- Confirms which contractors and how many rows would be affected.
-- Expect: 2-4 rows, sum(territory_count) ~= 11,444.

SELECT
  p.email,
  p.id AS contractor_id,
  COUNT(t.id) AS territory_count
FROM profiles p
LEFT JOIN territories t ON t.contractor_id = p.id
WHERE p.email = ANY (ARRAY[
  'y.abismuth@gmail.com',
  'waspinc20@gmail.com'
  -- add the other 2 founder emails here if they exist:
  -- ,'<email3>@gmail.com'
  -- ,'<email4>@gmail.com'
])
GROUP BY p.email, p.id
ORDER BY territory_count DESC;


-- ── STEP 1: DELETE (transactional — uncomment to execute) ───────────────
-- BEGIN;
--
-- WITH founders AS (
--   SELECT id FROM profiles
--   WHERE email = ANY (ARRAY[
--     'y.abismuth@gmail.com',
--     'waspinc20@gmail.com'
--     -- ,'<email3>@gmail.com'
--     -- ,'<email4>@gmail.com'
--   ])
-- ),
-- deleted AS (
--   DELETE FROM territories
--   WHERE contractor_id IN (SELECT id FROM founders)
--   RETURNING contractor_id, zip
-- )
-- SELECT
--   contractor_id,
--   COUNT(*) AS deleted_count
-- FROM deleted
-- GROUP BY contractor_id;
--
-- -- Sanity check: no test territories left for founders
-- SELECT COUNT(*) AS remaining_for_founders
-- FROM territories t
-- WHERE t.contractor_id IN (
--   SELECT id FROM profiles WHERE email = ANY (ARRAY[
--     'y.abismuth@gmail.com',
--     'waspinc20@gmail.com'
--   ])
-- );
--
-- -- Sanity check: total territory count after cleanup
-- SELECT COUNT(*) AS total_territories_remaining FROM territories;
--
-- -- If the numbers above look right, COMMIT. Otherwise ROLLBACK.
-- COMMIT;
-- -- ROLLBACK;


-- ── STEP 2: OPTIONAL — also drop dependent rows that reference these ZIPs
-- If your `leads` / `lead_locks` / `exclusivity_locks` join through
-- territory.contractor_id, those rows for the founders should also clear.
-- Run this AFTER step 1 commits, ONLY if you see leftovers in the
-- founder accounts' dashboards.
--
-- BEGIN;
-- DELETE FROM exclusivity_locks WHERE contractor_id IN (
--   SELECT id FROM profiles WHERE email = ANY (ARRAY[
--     'y.abismuth@gmail.com', 'waspinc20@gmail.com'
--   ])
-- );
-- COMMIT;
