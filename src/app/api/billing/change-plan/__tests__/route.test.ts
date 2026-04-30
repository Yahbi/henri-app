import { describe, it, expect, vi, beforeEach } from "vitest";

/* PLAN_PRICES in `change-plan/route.ts` is computed at module-import time
 * from `process.env.STRIPE_*_PRICE_ID`. Because vitest hoists `import`
 * statements above any top-level code, we must seed env vars via
 * `vi.hoisted(...)` so they're set BEFORE the route module is imported.
 * Otherwise PLAN_PRICES freezes to empty strings and every test gets
 * "Plan price ID not configured". */
vi.hoisted(() => {
  process.env.STRIPE_FOUNDER_PRICE_ID = "price_founder";
  process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro";
  process.env.STRIPE_ENTERPRISE_PRICE_ID = "price_enterprise";
});

/* ── Supabase server-client mock (auth.getUser + profile lookup + profile update) ── */

const mockGetUser = vi.fn();
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn();
const mockUpdate = vi.fn().mockReturnThis();

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
  update: mockUpdate,
}));

mockSelect.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ single: mockSingle, eq: mockEq });
mockUpdate.mockReturnValue({ eq: mockEq });

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => mockGetUser() },
    from: mockFrom,
  }),
}));

vi.mock("@/lib/log", () => ({ logApiError: vi.fn() }));

/* ── Stripe mock ────────────────────────────────────────────────────────── */

const mockSubscriptionsList = vi.fn();
const mockSubscriptionsUpdate = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    subscriptions: {
      list: (...args: unknown[]) => mockSubscriptionsList(...args),
      update: (...args: unknown[]) => mockSubscriptionsUpdate(...args),
    },
  }),
}));

/* ── Import handler under test ──────────────────────────────────────────── */

import { POST } from "../route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/billing/change-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FUTURE_PERIOD_END = Math.floor(Date.now() / 1000) + 14 * 86400;

beforeEach(() => {
  vi.clearAllMocks();
  // env vars are set at top of file (before module import) so PLAN_PRICES
  // captures them. Don't re-set here — that would mask the test below
  // that asserts the missing-price-id 400.

  // Default: authenticated, has Stripe customer + active sub on Pro.
  //
  // Audit-04-29: the route now uses `requireContractor()` which does its
  // own `.from("profiles").select("role")` lookup BEFORE the route reads
  // stripe_customer_id. Both lookups land on this single mocked .single()
  // return — including `role: "contractor"` here lets the gate pass and
  // the handler still picks up stripe_customer_id from the same object.
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-123" } },
    error: null,
  });
  mockSingle.mockResolvedValue({
    data: {
      role: "contractor",
      stripe_customer_id: "cus_abc",
      plan: "pro",
    },
    error: null,
  });
  mockSubscriptionsList.mockResolvedValue({
    data: [
      {
        id: "sub_active",
        items: {
          data: [{ id: "si_1", price: { id: "price_pro" }, current_period_end: FUTURE_PERIOD_END }],
        },
        current_period_end: FUTURE_PERIOD_END,
      },
    ],
  });
  mockSubscriptionsUpdate.mockResolvedValue({});
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("Billing change-plan (P0-9)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ plan: "starter" }));
    expect(res.status).toBe(401);
  });

  it("rejects malformed plan payloads with 400", async () => {
    const res = await POST(makeRequest({ plan: "platinum-extra" }));
    expect(res.status).toBe(400);
  });

  it("rejects when contractor has no Stripe customer (must checkout first)", async () => {
    /* Both requireContractor + the handler read .single() — keep role:
     * "contractor" so the gate passes; null stripe_customer_id triggers
     * the route's own 400. */
    mockSingle.mockResolvedValue({
      data: { role: "contractor", stripe_customer_id: null, plan: "founder" },
      error: null,
    });
    const res = await POST(makeRequest({ plan: "starter" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/checkout/i);
  });

  it("DOWNGRADE pro→founder schedules at next billing cycle (no proration)", async () => {
    const res = await POST(makeRequest({ plan: "founder" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scheduled?: boolean;
      effective?: string;
      plan?: string;
    };
    expect(body.scheduled).toBe(true);
    expect(body.plan).toBe("founder");
    expect(body.effective).toBeTypeOf("string");

    // Stripe call uses proration_behavior:"none" + billing_cycle_anchor:"unchanged"
    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockSubscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(updateArgs.proration_behavior).toBe("none");
    expect(updateArgs.billing_cycle_anchor).toBe("unchanged");

    // Profile gets pending_plan set (not plan — that flips at next cycle via webhook)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_plan: "founder",
        pending_plan_effective_at: expect.any(String) as unknown,
      }),
    );
  });

  it("UPGRADE founder→pro applies immediately with prorations", async () => {
    mockSingle.mockResolvedValue({
      data: {
        role: "contractor",
        stripe_customer_id: "cus_abc",
        plan: "founder",
      },
      error: null,
    });
    const res = await POST(makeRequest({ plan: "pro" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upgraded?: boolean; plan?: string };
    expect(body.upgraded).toBe(true);
    expect(body.plan).toBe("pro");

    // Stripe call uses proration_behavior:"create_prorations"
    const updateArgs = mockSubscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(updateArgs.proration_behavior).toBe("create_prorations");

    // Profile.plan flips immediately
    expect(mockUpdate).toHaveBeenCalledWith({ plan: "pro" });
  });

  it("rejects when no active subscription exists on the customer", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    const res = await POST(makeRequest({ plan: "starter" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no active subscription/i);
  });
});
