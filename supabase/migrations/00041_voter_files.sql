-- 00041_voter_files.sql
--
-- State voter-file enrichment tables (free bulk-file path).
--
-- Three states publish their full voter roll for free and at least one
-- of them (FL) publishes a daytime phone number right in the file. The
-- enrichment pipeline keeps a local copy of each state's file in its
-- own table, then cross-references `leads.address + leads.zip` to
-- recover `owner_name` / `phone` / mailing info that the permit itself
-- didn't carry.
--
-- Each state gets its own table so state-specific columns can evolve
-- independently (FL has phone, NC mostly doesn't, OH publishes a
-- separate mailing block, etc.). The shape below is the intersection
-- we actually use downstream; extra per-state fields can be added
-- with additive ALTER TABLEs as we discover we want them.
--
-- RLS: enabled but NO policies are created. Without a matching policy
-- an RLS-enabled table returns zero rows to the anon + authenticated
-- roles (default-deny). Only the service-role key (see
-- `src/lib/supabase/admin.ts`) bypasses RLS — and the live lookup
-- module always uses that client. Matches the 00031 / 00039 pattern.
--
-- Additive-only, idempotent. Safe to re-run.
--
-- Data sources (all free, request-or-download):
--   FL  https://dos.myflorida.com/elections/data-statistics/voter-registration-statistics/voter-extract-disk-request/
--   NC  https://www.ncsbe.gov/results-data/voter-registration-data
--   OH  https://www6.ohiosos.gov/ords/f?p=111:1
--
-- Ingest scripts:
--   scripts/ingest-voter-fl.ts
--   scripts/ingest-voter-nc.ts
--   scripts/ingest-voter-oh.ts

BEGIN;

/* ────────────────────────────────────────────────────────────────────
   FL — voter_fl
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS voter_fl (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id           text UNIQUE,            -- state's own Voter ID
  first_name         text,
  middle_name        text,
  last_name          text,
  name_suffix        text,
  residence_address  text,                   -- normalized UPPER, single-space
  residence_city     text,
  residence_zip      text,                   -- 5-digit, +4 stripped
  county             text,
  phone              text,                   -- FL publishes daytime phone
  email              text,                   -- rare
  registration_date  date,
  party              text,                   -- D / R / NPA / etc.
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voter_fl_address_zip_idx
  ON voter_fl (residence_zip, lower(residence_address));
CREATE INDEX IF NOT EXISTS voter_fl_name_zip_idx
  ON voter_fl (lower(last_name), residence_zip);

ALTER TABLE voter_fl ENABLE ROW LEVEL SECURITY;
-- No policy: default-deny for anon + authenticated. Service-role bypass
-- is the only read path (enrichment is a server-only concern).

/* ────────────────────────────────────────────────────────────────────
   NC — voter_nc
   Phone column stays for shape uniformity even though the state file
   almost never carries one; future states can piggyback on the same
   lookup logic.
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS voter_nc (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id           text UNIQUE,            -- NC's `ncid`
  first_name         text,
  middle_name        text,
  last_name          text,
  name_suffix        text,
  residence_address  text,
  residence_city     text,
  residence_zip      text,
  county             text,
  phone              text,
  email              text,
  registration_date  date,
  party              text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voter_nc_address_zip_idx
  ON voter_nc (residence_zip, lower(residence_address));
CREATE INDEX IF NOT EXISTS voter_nc_name_zip_idx
  ON voter_nc (lower(last_name), residence_zip);

ALTER TABLE voter_nc ENABLE ROW LEVEL SECURITY;

/* ────────────────────────────────────────────────────────────────────
   OH — voter_oh
   ──────────────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS voter_oh (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id           text UNIQUE,            -- OH's SOS_VOTERID
  first_name         text,
  middle_name        text,
  last_name          text,
  name_suffix        text,
  residence_address  text,
  residence_city     text,
  residence_zip      text,
  county             text,
  phone              text,
  email              text,
  registration_date  date,
  party              text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voter_oh_address_zip_idx
  ON voter_oh (residence_zip, lower(residence_address));
CREATE INDEX IF NOT EXISTS voter_oh_name_zip_idx
  ON voter_oh (lower(last_name), residence_zip);

ALTER TABLE voter_oh ENABLE ROW LEVEL SECURITY;

COMMIT;
