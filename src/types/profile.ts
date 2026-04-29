/* ── Contractor profile & notification preference types ── */

export interface ContractorProfile {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  bio: string | null;
  trade: string | null;
  service_area: string | null;
  specialties: string[];
  years_experience: number | null;
  portfolio_photos: string[];
  profile_public: boolean;
  phone: string | null;
  plan: string | null;
  onboarding_completed: boolean;
  /** Twilio number assigned to this contractor for missed-call SMS
   *  text-back (wedge bullet #5). Populated from migration 00035.
   *  When null, the missed-call webhook short-circuits silently. */
  twilio_tracked_number: string | null;
  created_at: string;

  /* Computed fields */
  avg_rating: number;
  review_count: number;
  response_time_h: number | null;
  jobs_completed: number;
}

export interface ContractorProfileUpdate {
  company_name?: string;
  full_name?: string;
  bio?: string;
  trade?: string;
  specialties?: string[];
  years_experience?: number;
  phone?: string;
  profile_public?: boolean;
  service_area?: string;
  /** E.164 phone number routed to Twilio for missed-call SMS text-back. */
  twilio_tracked_number?: string | null;
}

export interface NotificationPrefs {
  email_new_lead: boolean;
  sms_new_lead: boolean;
  email_lead_update: boolean;
  sms_lead_update: boolean;
  email_weekly_digest: boolean;
  email_daily_digest: boolean;
  sms_storm_alerts: boolean;
  email_review_received: boolean;
  email_quote_request: boolean;
  sms_quote_request: boolean;
  email_payment_alerts: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  email_new_lead: true,
  sms_new_lead: true,
  email_lead_update: true,
  sms_lead_update: false,
  email_weekly_digest: true,
  email_daily_digest: true,
  sms_storm_alerts: false,
  email_review_received: true,
  email_quote_request: true,
  sms_quote_request: false,
  email_payment_alerts: true,
};

/** All valid keys for notification preferences */
export const NOTIFICATION_PREF_KEYS: (keyof NotificationPrefs)[] = [
  "email_new_lead",
  "sms_new_lead",
  "email_lead_update",
  "sms_lead_update",
  "email_weekly_digest",
  "email_daily_digest",
  "sms_storm_alerts",
  "email_review_received",
  "email_quote_request",
  "sms_quote_request",
  "email_payment_alerts",
];
