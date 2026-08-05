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

/* ── Service-role client mock ────────────────────────────────────────────
 * The route writes `plan` / `pending_plan` with the admin client: migration
 * 00117 installed a BEFORE UPDATE guard that raises 42501 when the user's
 * own session rewrites `plan` while a subscription is active, and
 * service_role is exempt. Mocked separately from the server client so the
 * assertions can tell the two writers apart — and so the real
 * createAdminClient (which throws without SUPABASE_SERVICE_ROLE_KEY) never
 * runs here. */
const mockAdminUpdate = vi.fn();
const mockAdminEq = vi.fn();
const mockAdminFrom = vi.fn(() => ({ update: mockAdminUpdate }));

mockAdminUpdate.mockReturnValue({ eq: mockAdminEq });
mockAdminEq.mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/log", () => ({ logApiError: vi.fn() }));

/* ── Stripe mock ────────────────────────────────────────────────────────── */

const mockSubscriptionsList = vi.fn();
const mockSubscriptionsUpdate = vi.fn();
/* Downgrades go through Subscription Schedules, not a direct
 * subscriptions.update. `create` returns phases[0].start_date because the
 * route reuses it as the first phase's start when rewriting the schedule. */
const mockSchedulesCreate = vi.fn();
const mockSchedulesUpdate = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    subscriptions: {
      list: (...args: unknown[]) => mockSubscriptionsList(...args),
      update: (...args: unknown[]) => mockSubscriptionsUpdate(...args),
    },
    subscriptionSchedules: {
      create: (...args: unknown[]) => mockSchedulesCreate(...args),
      update: (...args: unknown[]) => mockSchedulesUpdate(...args),
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
  // Stripe returns the schedule with its first phase already anchored to
  // the subscription's current period start.
  mockSchedulesCreate.mockResolvedValue({
    id: "sub_sched_1",
    phases: [{ start_date: FUTURE_PERIOD_END - 30 * 24 * 3600 }],
  });
  mockSchedulesUpdate.mockResolvedValue({});

  // Re-seeded because individual tests use mockResolvedValueOnce to force a
  // failed profile write; clearAllMocks doesn't unwind a spent "once".
  mockAdminUpdate.mockReturnValue({ eq: mockAdminEq });
  mockAdminEq.mockResolvedValue({ error: null });
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
      synced?: boolean;
    };
    expect(body.scheduled).toBe(true);
    expect(body.plan).toBe("founder");
    expect(body.effective).toBeTypeOf("string");
    expect(body.synced).toBe(true);

    /* A downgrade must NOT touch the live subscription. The previous
     * implementation called subscriptions.update() with
     * proration_behavior:"none", which swapped the price immediately —
     * so a Pro contractor who had already paid $1,499 dropped from 12
     * ZIPs to 3 the instant they clicked Continue, with no credit, while
     * the dialog promised access through the cycle end. The fix is a
     * two-phase Subscription Schedule; these assertions pin that. */
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();

    expect(mockSchedulesCreate).toHaveBeenCalledWith({
      from_subscription: "sub_active",
    });

    expect(mockSchedulesUpdate).toHaveBeenCalledTimes(1);
    const [scheduleId, scheduleArgs] = mockSchedulesUpdate.mock.calls[0] as [
      string,
      { end_behavior: string; phases: Array<Record<string, unknown>> },
    ];
    expect(scheduleId).toBe("sub_sched_1");
    expect(scheduleArgs.end_behavior).toBe("release");
    expect(scheduleArgs.phases).toHaveLength(2);

    // Phase 1 keeps the CURRENT price until the period boundary.
    expect(scheduleArgs.phases[0]).toMatchObject({
      items: [{ price: "price_pro", quantity: 1 }],
      end_date: FUTURE_PERIOD_END,
      proration_behavior: "none",
    });
    // Phase 2 starts exactly at the boundary on the NEW price.
    expect(scheduleArgs.phases[1]).toMatchObject({
      items: [{ price: "price_founder", quantity: 1 }],
      start_date: FUTURE_PERIOD_END,
      proration_behavior: "none",
    });

    // Profile gets pending_plan set (not plan — that flips at next cycle via
    // webhook), and the write goes through the service-role client.
    expect(mockAdminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_plan: "founder",
        pending_plan_effective_at: expect.any(String) as unknown,
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
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
    const body = (await res.json()) as {
      upgraded?: boolean;
      plan?: string;
      synced?: boolean;
    };
    expect(body.upgraded).toBe(true);
    expect(body.plan).toBe("pro");
    expect(body.synced).toBe(true);

    // Stripe call uses proration_behavior:"create_prorations"
    const updateArgs = mockSubscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(updateArgs.proration_behavior).toBe("create_prorations");

    /* Profile.plan flips immediately, via the SERVICE-ROLE client. Doing it
     * on the user's session hits the 00117 BEFORE UPDATE guard (42501) — the
     * write silently failed and the ZIP cap stayed on the old tier until the
     * Stripe webhook caught up. */
    expect(mockAdminUpdate).toHaveBeenCalledWith({ plan: "pro" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("still 200s with synced:false when the profile write fails", async () => {
    mockSingle.mockResolvedValue({
      data: {
        role: "contractor",
        stripe_customer_id: "cus_abc",
        plan: "founder",
      },
      error: null,
    });
    // e.g. a future column guard, or a service-role outage.
    mockAdminEq.mockResolvedValueOnce({
      error: { message: "permission denied", code: "42501" },
    });

    const res = await POST(makeRequest({ plan: "pro" }));

    /* Stripe has already moved the subscription, so reporting failure would
     * be false and would invite a retry loop. The caller learns the profile
     * row is briefly stale from `synced`, and the webhook reconciles it. */
    expect(mockSubscriptionsUpdate).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upgraded?: boolean; synced?: boolean };
    expect(body.upgraded).toBe(true);
    expect(body.synced).toBe(false);
  });

  it("rejects when no active subscription exists on the customer", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    const res = await POST(makeRequest({ plan: "starter" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no active subscription/i);
  });
});
