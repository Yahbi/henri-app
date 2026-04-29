-- 00042_ppp_loans.sql
--
-- Paycheck Protection Program (PPP) loan enrichment table.
--
-- Why: every PPP record carries business name + address + ZIP, and the
-- pre-redaction slice (loans ≥ $150k from the first release) also carried
-- owner first/last + business phone. For the ~25% of permits where
-- `contractor_name` is an LLC, PPP maps the LLC back to a real owner +
-- their business phone. On the homeowner side, millions of self-employed
-- sole-proprietors listed their home address — so sometimes a PPP record
-- matches the permit address directly (no LLC involved).
--
-- Data source: https://data.sba.gov/dataset/ppp-foia
-- Disclosed under the Small Business Act's transparency requirements.
-- Free to download and redistribute.
--
-- Ingest script: scripts/ingest-ppp.ts
-- Lookup module: src/lib/enrichment/ppp-loan.ts
--
-- RLS: enabled but NO policies are created. Default-deny for anon +
-- authenticated; only the service-role key (see src/lib/supabase/admin.ts)
-- bypasses RLS. Matches the 00031 / 00039 / 00041 pattern — enrichment
-- is a server-side-only concern.
--
-- Additive-only, idempotent. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS ppp_loans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id                 text UNIQUE,             -- SBA's own identifier (LoanNumber)
  borrower_name           text NOT NULL,
  borrower_address        text,
  borrower_city           text,
  borrower_state          text,
  borrower_zip            text,                    -- 5-digit, +4 stripped
  naics_code              text,
  owner_first             text,                    -- only in pre-redaction ≥$150k slice
  owner_last              text,                    -- only in pre-redaction ≥$150k slice
  owner_address           text,                    -- sometimes = home address
  business_phone          text,                    -- only in pre-redaction ≥$150k slice
  email                   text,                    -- very rarely disclosed
  employee_count          integer,                 -- JobsReported
  loan_amount             numeric(12,2),           -- CurrentApprovalAmount
  forgiveness_status      text,                    -- LoanStatus ("Fully Forgiven", etc.)
  loan_date               date,                    -- DateApproved
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ppp_loans_borrower_name_idx
  ON ppp_loans (lower(borrower_name));
CREATE INDEX IF NOT EXISTS ppp_loans_zip_idx
  ON ppp_loans (borrower_zip);
CREATE INDEX IF NOT EXISTS ppp_loans_address_zip_idx
  ON ppp_loans (borrower_zip, lower(borrower_address));

ALTER TABLE ppp_loans ENABLE ROW LEVEL SECURITY;
-- No policy = default-deny; service-role bypass only.

COMMIT;
