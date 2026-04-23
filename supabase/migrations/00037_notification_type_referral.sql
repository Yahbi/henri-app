-- Add missing 'referral' value to notification_type enum.
-- process_referral_signup() inserts this value but the enum never included it,
-- causing runtime failures on referral sign-ups.
DO $$
BEGIN
  ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'referral';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
