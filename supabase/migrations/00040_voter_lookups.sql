-- 00040_voter_lookups.sql
--
-- Cache table for voter-registration lookups. See
-- src/lib/enrichment/voter-registration.ts for the consumer.
--
-- STATUS: SCAFFOLD — do NOT apply live yet.
--
-- The consuming module currently returns null on every call (zero network
-- activity) unless the operator explicitly sets VOTER_REG_ENABLED=1 AND a
-- live vendor integration replaces the stub. Since nothing writes to this
-- table today, applying this migration would create an unused table and
-- RLS surface. Keep it checked in as part of Step 4 of the enrichment plan
-- so the final vendor integration can land in one shot (ALTER TABLE if the
-- shape needs tweaking, INSERT once the real lookup code ships).
--
-- Additive-only, idempotent. Safe to re-run once the scaffold is promoted.

BEGIN;

CREATE TABLE IF NOT EXISTS voter_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state varchar(2) NOT NULL,
  address text NOT NULL,
  zip varchar(5),
  last_name text,
  phone text,
  owner_name text,
  source text NOT NULL,
  confidence numeric(3,2),
  looked_up_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state, address, zip, last_name)
);

CREATE INDEX IF NOT EXISTS voter_lookups_state_zip_idx
  ON voter_lookups (state, zip);

-- RLS: read-only for authenticated users, writes only via service role.
ALTER TABLE voter_lookups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voter_lookups select" ON voter_lookups;
CREATE POLICY "voter_lookups select" ON voter_lookups
  FOR SELECT TO authenticated USING (true);

COMMIT;
