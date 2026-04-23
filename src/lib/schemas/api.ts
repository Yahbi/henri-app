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
