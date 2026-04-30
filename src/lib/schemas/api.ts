import { z } from "zod";

/**
 * Shared request-body schemas for API routes.
 *
 * Rule of thumb: if an API route accepts JSON, it should validate the body
 * through a schema here. Keep schemas narrow — validate exactly what the
 * handler actually reads — so future fields don't accidentally leak through.
 */

export const PlanKeySchema = z.enum([
  "founder",
  "starter",
  "pro",
  "enterprise",
]);

export const CheckoutBodySchema = z.object({
  plan: PlanKeySchema,
});
export type CheckoutBody = z.infer<typeof CheckoutBodySchema>;

export const TerritoryClaimBodySchema = z.object({
  zip: z
    .string()
    .regex(/^\d{5}$/u, "ZIP must be a 5-digit US ZIP code"),
});
export type TerritoryClaimBody = z.infer<typeof TerritoryClaimBodySchema>;

/**
 * S1 — /api/ai/draft-reply request body
 *
 * The review text is concatenated into an LLM prompt, so it's an
 * untrusted-input surface. Caps stop a 100KB jailbreak payload from
 * making it through; the route additionally wraps the text in
 * <<<REVIEW>>>...<<<END>>> delimiters and instructs Claude to treat
 * everything between the delimiters as data, never instructions.
 */
export const DraftReplyBodySchema = z.object({
  rating: z.number().min(0).max(5).optional().default(0),
  text: z.string().min(1, "Review text required").max(2000),
  platform: z.string().max(50).optional().default(""),
  reviewer_name: z.string().max(120).optional().default(""),
});
export type DraftReplyBody = z.infer<typeof DraftReplyBodySchema>;

/**
 * S2 — /api/chat/refine request body
 *
 * answers_so_far is concatenated into an OpenAI prompt — same threat
 * model as the draft-reply route. Cap each answer at 500 chars and the
 * array at MAX_QUESTIONS so a malicious homeowner can't pump 100 jailbreak
 * tokens into the system prompt. The route additionally wraps each answer
 * in <<<ANSWER N>>>...<<<END>>> delimiters before sending to OpenAI.
 */
export const ChatRefineBodySchema = z.object({
  trade: z.string().min(1).max(80),
  answers_so_far: z.array(z.string().max(500)).max(3).optional().default([]),
  question_index: z.number().int().min(0).max(10),
});
export type ChatRefineBody = z.infer<typeof ChatRefineBodySchema>;

/**
 * S3 + S9 — request bodies for the previously-unguarded contractor-facing
 * POSTs. Pattern: cap free-text fields at sane lengths, narrow enums, and
 * UUIDs/zips through regex so a malicious client can't pump 100KB of junk
 * (or worse, prompt-injection attempts) into downstream LLM/email/SMS
 * pipelines.
 *
 * Common atoms reused across schemas.
 */
const ZipSchema = z.string().regex(/^\d{5}$/u, "ZIP must be a 5-digit US ZIP");
const UuidSchema = z
  .string()
  .uuid("Must be a valid UUID")
  .or(z.string().regex(/^[0-9a-fA-F-]{36}$/u, "Must be a valid UUID"));
const EmailSchema = z.string().email("Invalid email address").max(254);
const PhoneSchema = z
  .string()
  .max(40)
  .regex(/^[+\d\s().-]{7,40}$/u, "Phone must be a recognizable phone number")
  .optional();
const ContactNameSchema = z.string().max(120).optional();
// Free-text body — cap large enough for real estimate scope notes, small
// enough that a malicious payload can't blow up Resend / Twilio.
const NotesSchema = z.string().max(4000).optional();
const TradeSchema = z.string().min(1).max(80);

/**
 * US state codes. Used by license verification and any other surface
 * that takes a US-state identifier. Must be 2-letter uppercase per USPS.
 */
const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU", "AS", "MP",
] as const;
const StateCodeSchema = z.enum(US_STATE_CODES);

/* ── POST /api/estimates ── */
export const EstimateCreateBodySchema = z.object({
  trade: TradeSchema,
  zip: ZipSchema,
  amount: z.number().nonnegative().max(10_000_000),
  tiers: z.record(z.string().max(40), z.unknown()),
  description: z.string().max(2000).optional(),
  scope_notes: z.string().max(4000).optional(),
  contact_name: ContactNameSchema,
  contact_email: EmailSchema.optional(),
  contact_phone: PhoneSchema,
  status: z.enum(["draft", "sent"]).optional(),
});
export type EstimateCreateBody = z.infer<typeof EstimateCreateBodySchema>;

/* ── POST /api/quotes ── (homeowner-initiated) */
export const QuoteRequestBodySchema = z.object({
  contractor_id: UuidSchema,
  trade: TradeSchema,
  zip: ZipSchema,
  description: z.string().min(1).max(2000),
  scope_notes: z.string().max(4000).optional(),
  contact_name: ContactNameSchema,
  contact_email: EmailSchema.optional(),
  contact_phone: PhoneSchema,
});
export type QuoteRequestBody = z.infer<typeof QuoteRequestBodySchema>;

/* ── POST /api/messages/send ── */
// Twilio SMS has a hard 1600-char ceiling (multipart); we cap at 1600.
// Email body cap at 4000 — anything longer is template, not handcrafted.
export const MessageSendBodySchema = z.object({
  lead_id: UuidSchema,
  channel: z.enum(["sms", "email"]).default("sms"),
  body: z.string().min(1).max(4000),
  subject: z.string().max(150).optional(),
});
export type MessageSendBody = z.infer<typeof MessageSendBodySchema>;

/* ── POST /api/reviews/respond ── */
export const ReviewRespondBodySchema = z.object({
  // review_id can be a Google review ID (alphanumeric/_-) or our UUID,
  // so accept any non-empty short string.
  review_id: z.string().min(1).max(120),
  reply: z.string().min(1).max(4000),
});
export type ReviewRespondBody = z.infer<typeof ReviewRespondBodySchema>;

/* ── POST /api/financing/request ── */
export const FinancingRequestBodySchema = z.object({
  lead_id: UuidSchema,
  partner: z.string().min(1).max(80),
  // partner_url is rendered into an outbound HTML email — must be http(s)
  // only to prevent javascript: / data: URI injection.
  partner_url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//iu.test(u), {
      message: "partner_url must be http or https",
    })
    .optional(),
});
export type FinancingRequestBody = z.infer<typeof FinancingRequestBodySchema>;

/* ── POST /api/estimates/send ── */
export const EstimateSendBodySchema = z.object({
  estimate_id: UuidSchema,
  to_email: EmailSchema.optional(),
  message: NotesSchema,
});
export type EstimateSendBody = z.infer<typeof EstimateSendBodySchema>;

/* ── PATCH /api/estimates/[id] — contractor edits a saved estimate ── */
// `tiers` is a free-form Record<string, unknown> in the schema (e.g. tier
// labels → { total, line_items[] }) — just gate the keys to <=40 chars and
// trust the caller, same as EstimateCreateBodySchema. Whitelist the
// other allowed fields explicitly so unknown columns can't slip in.
export const EstimatePatchBodySchema = z
  .object({
    tiers: z.record(z.string().max(40), z.unknown()).optional(),
    amount: z.number().nonnegative().max(10_000_000).optional(),
    status: z.enum(["draft", "sent"]).optional(),
    contact_name: ContactNameSchema,
    contact_email: EmailSchema.optional(),
    contact_phone: PhoneSchema,
    scope_notes: z.string().max(4000).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();
export type EstimatePatchBody = z.infer<typeof EstimatePatchBodySchema>;

/* ── PATCH /api/leads/[id] — pipeline updates from the lead drawer ── */
export const LeadPatchBodySchema = z
  .object({
    status: z
      .enum([
        "new",
        "contacted",
        "quoted",
        "proposal",
        "won",
        "lost",
        "pending",
      ])
      .optional(),
    urgency: z.enum(["hot", "warm", "cold"]).optional(),
    // Notes here are the freeform `leads.notes` column — cap at 5000.
    notes: z.string().max(5000).optional(),
    contacted_at: z.string().datetime().optional(),
    won_at: z.string().datetime().optional(),
    phone: PhoneSchema,
    phone2: PhoneSchema,
    email: EmailSchema.optional(),
    email2: EmailSchema.optional(),
    trade: TradeSchema.optional(),
    pipeline_value: z.number().nonnegative().max(10_000_000).optional(),
  })
  .strict();
export type LeadPatchBody = z.infer<typeof LeadPatchBodySchema>;

/* ── POST /api/leads/[id]/notes — append a timestamped activity note ── */
export const LeadNoteBodySchema = z.object({
  content: z.string().min(1, "Note content required").max(5000),
});
export type LeadNoteBody = z.infer<typeof LeadNoteBodySchema>;

/* ── POST /api/financing — attach financing details to a quote ── */
export const FinancingAttachBodySchema = z.object({
  quote_id: UuidSchema,
  financing_partner: z.enum(["greensky", "mosaic", "service_finance"]),
  monthly_payment: z.number().positive().max(1_000_000).optional(),
  // 1-360 months covers everything from a 1-month bridge to 30-year terms.
  term_months: z.number().int().min(1).max(360).optional(),
  // APR cap of 30% — anything higher is predatory. Anything <0 is invalid.
  apr: z.number().min(0).max(30).optional(),
});
export type FinancingAttachBody = z.infer<typeof FinancingAttachBodySchema>;

/* ── POST /api/license/verify — contractor license verification ── */
export const LicenseVerifyBodySchema = z.object({
  license_number: z.string().min(1).max(80),
  state: StateCodeSchema,
  license_type: z.string().max(60).optional(),
  // Holder name appears on a pre-signed license display surface — cap to
  // 100 chars to fit the badge UI without ellipsis surprises.
  holder_name: z.string().max(100).optional(),
});
export type LicenseVerifyBody = z.infer<typeof LicenseVerifyBodySchema>;

/* ── POST /api/admin/sources/probe — operator-only source qualifier ── */
export const SourceProbeBodySchema = z.object({
  source_key: z.string().min(1).max(120),
  // Default true on the server side (matching the previous behaviour);
  // accept absent or boolean false to skip auto-enable.
  enable_on_success: z.boolean().optional(),
});
export type SourceProbeBody = z.infer<typeof SourceProbeBodySchema>;

/* ── POST /api/agents/lead-scorer — cron-only batch re-scorer ── */
export const LeadScorerBodySchema = z.object({
  // Up to 1000 lead IDs in one batch — anything bigger should page.
  lead_ids: z.array(UuidSchema).max(1000).optional(),
});
export type LeadScorerBody = z.infer<typeof LeadScorerBodySchema>;

/* ── POST /api/agents/permit-scraper — cron-only Socrata fan-out ── */
export const PermitScraperBodySchema = z.object({
  source_ids: z.array(z.string().min(1).max(120)).max(1000).optional(),
  // Reasonable knobs to prevent a malicious caller from triggering
  // a multi-year backfill across every source on the planet.
  days_back: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});
export type PermitScraperBody = z.infer<typeof PermitScraperBodySchema>;

/* ── POST /api/agents/ziplock — territory exclusivity manager ── */
// The route accepts three actions; we narrow each branch with a discriminated
// union so impossible combinations (e.g. "release" without contractor_id)
// are rejected at the schema layer instead of the handler.
export const ZipLockBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("check"),
    zip: ZipSchema,
    contractor_id: UuidSchema.optional(),
  }),
  z.object({
    action: z.literal("claim"),
    zip: ZipSchema,
    contractor_id: UuidSchema,
  }),
  z.object({
    action: z.literal("release"),
    zip: ZipSchema,
    contractor_id: UuidSchema,
  }),
]);
export type ZipLockBody = z.infer<typeof ZipLockBodySchema>;

/* ── POST /api/billing/extra-zip — Stripe checkout for extra-ZIP add-on ── */
export const ExtraZipBodySchema = z.object({
  // Same 1..100 clamp the route already had — keep the floor/ceiling so
  // a 100KB body of zeros gets rejected before the Stripe call.
  quantity: z.number().int().min(1).max(100).optional(),
});
export type ExtraZipBody = z.infer<typeof ExtraZipBodySchema>;

/* ── POST /api/billing/change-plan — schedule plan change at next cycle ── */
export const ChangePlanBodySchema = z.object({
  plan: PlanKeySchema,
});
export type ChangePlanBody = z.infer<typeof ChangePlanBodySchema>;

/* ── PATCH /api/quotes/[id] — contractor + homeowner-side quote edits ── */
// Both sides PATCH the same row but with different field allowlists; the
// route already enforces who-can-set-what, so we only validate shape here.
export const QuotePatchBodySchema = z
  .object({
    // Contractor fields
    tier_good: z.record(z.string().max(40), z.unknown()).optional(),
    tier_better: z.record(z.string().max(40), z.unknown()).optional(),
    tier_best: z.record(z.string().max(40), z.unknown()).optional(),
    message: z.string().max(4000).optional(),
    financing_available: z.boolean().optional(),
    // Homeowner fields
    selected_tier: z.enum(["good", "better", "best"]).optional(),
    decline_reason: z.string().max(2000).optional(),
    // Shared (the route enforces which values are allowed per role)
    status: z.enum(["sent", "accepted", "declined"]).optional(),
  })
  .strict();
export type QuotePatchBody = z.infer<typeof QuotePatchBodySchema>;

/* ── Audit-04-29 fixes — Zod schemas for the 9 unvalidated body POSTs ── */
//
// All 9 POST handlers below previously read `body as { … }` with no schema,
// so a malformed payload fell through to ad-hoc null/length checks at best.
// Each schema below caps free-text / arrays / number ranges so a malicious
// caller can't pump 100KB junk into a downstream Resend / Twilio / RPC call,
// and rejects unknown keys via .strict() where the route reads a fixed set.

/* ── POST /api/homeowner/maintenance — toggle a maintenance task ── */
// task_id is a slug from a static homeowner-portal task list, not a UUID,
// so accept any short non-empty string.
export const HomeownerMaintenanceBodySchema = z.object({
  task_id: z.string().min(1, "task_id required").max(120),
  completed: z.boolean().optional(),
});
export type HomeownerMaintenanceBody = z.infer<
  typeof HomeownerMaintenanceBodySchema
>;

/* ── POST /api/homeowner/messages — append homeowner-side message ── */
// `message` is concatenated into a leads.notes line — cap to keep the
// notes column from ballooning past Postgres TOAST limits and to discourage
// injection of large prompt-style payloads.
export const HomeownerMessageBodySchema = z.object({
  lead_id: UuidSchema,
  message: z.string().min(1, "message required").max(4000),
});
export type HomeownerMessageBody = z.infer<typeof HomeownerMessageBodySchema>;

/* ── POST /api/outreach/library — clone a library template ── */
export const OutreachLibraryCopyBodySchema = z.object({
  template_id: UuidSchema,
  // The clone-rename optionally lets the contractor name the local copy.
  rename: z.string().max(120).optional(),
});
export type OutreachLibraryCopyBody = z.infer<
  typeof OutreachLibraryCopyBodySchema
>;

/* ── POST /api/outreach — queue a new outreach message ── */
// Body cap: 4000 chars matches MessageSendBodySchema (Twilio multipart
// SMS ceiling is 1600; email body cap mirrors leads.notes max).
export const OutreachQueueBodySchema = z.object({
  lead_id: UuidSchema,
  channel: z.enum(["sms", "email"]),
  message: z.string().min(1, "message required").max(4000),
  template_name: z.string().max(120).optional(),
});
export type OutreachQueueBody = z.infer<typeof OutreachQueueBodySchema>;

/* ── POST /api/referrals/invite — send a referral invite email ── */
const ReferralTypeSchema = z.enum(["contractor", "homeowner"]);
export const ReferralInviteBodySchema = z.object({
  email: EmailSchema,
  type: ReferralTypeSchema.optional(),
});
export type ReferralInviteBody = z.infer<typeof ReferralInviteBodySchema>;

/* ── POST /api/referrals — record an invite (email + name) ── */
export const ReferralCreateBodySchema = z.object({
  email: EmailSchema,
  name: z.string().max(120).optional(),
  type: ReferralTypeSchema.optional(),
});
export type ReferralCreateBody = z.infer<typeof ReferralCreateBodySchema>;

/* ── POST /api/referrals/validate — process referral signup ── */
// `code` matches the HENRI-XXXXXX format created by the get_or_create_
// referral_code RPC; we accept any reasonable length range to be lenient
// to format changes. role narrows to the two real values.
export const ReferralValidateBodySchema = z.object({
  code: z.string().min(3).max(60),
  userId: UuidSchema,
  email: EmailSchema,
  role: z.enum(["contractor", "homeowner"]).optional(),
});
export type ReferralValidateBody = z.infer<typeof ReferralValidateBodySchema>;

/* ── POST /api/reviews/request — contractor sends a review request ── */
// Either email OR phone is needed depending on channel; route enforces
// that constraint after parsing. Caps mirror MessageSendBodySchema.
export const ReviewRequestBodySchema = z.object({
  lead_id: UuidSchema.optional(),
  customer_name: z.string().min(1, "customer_name required").max(120),
  customer_email: EmailSchema.optional(),
  customer_phone: PhoneSchema,
  channel: z.enum(["email", "sms"]),
});
export type ReviewRequestBody = z.infer<typeof ReviewRequestBodySchema>;

/* ── POST /api/reviews — submit a review ── */
// Public-facing endpoint (token-or-auth) — caps prevent prompt-injection
// vectors flowing into the AI response generator and keep emailed bodies
// within Resend limits.
export const ReviewSubmitBodySchema = z.object({
  // Token is any opaque short string when present; `contractor_id` is
  // ALWAYS required (the route uses it to look up the right contractor
  // even on the unauthenticated token path).
  contractor_id: UuidSchema,
  rating: z.number().int().min(1).max(5),
  reviewer_name: z.string().min(1, "reviewer_name required").max(120),
  reviewer_email: EmailSchema.optional(),
  title: z.string().max(160).optional(),
  body: z.string().max(4000).optional(),
  token: z.string().max(120).optional(),
});
export type ReviewSubmitBody = z.infer<typeof ReviewSubmitBodySchema>;

/* ── PATCH /api/profile/notifications — boolean prefs only ── */
export const NotificationPrefsPatchBodySchema = z
  .object({
    email_new_lead: z.boolean().optional(),
    sms_new_lead: z.boolean().optional(),
    email_lead_update: z.boolean().optional(),
    sms_lead_update: z.boolean().optional(),
    email_weekly_digest: z.boolean().optional(),
    email_daily_digest: z.boolean().optional(),
    sms_storm_alerts: z.boolean().optional(),
    email_review_received: z.boolean().optional(),
    email_quote_request: z.boolean().optional(),
    sms_quote_request: z.boolean().optional(),
    email_payment_alerts: z.boolean().optional(),
  })
  .strict();
export type NotificationPrefsPatchBody = z.infer<
  typeof NotificationPrefsPatchBodySchema
>;

/**
 * Small helper for API routes that validates a body or returns a
 * 400 with the first issue. Keeps handlers terse and consistent.
 */
import { NextResponse } from "next/server";

export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { data: T; response?: never } | { data?: never; response: NextResponse } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      response: NextResponse.json(
        { error: issue?.message ?? "Invalid request" },
        { status: 400 },
      ),
    };
  }
  return { data: parsed.data };
}
