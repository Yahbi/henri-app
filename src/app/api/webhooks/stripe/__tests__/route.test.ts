import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Mock Supabase admin client ─────────────────────────────────────────── */

const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();
const mockSingle = vi.fn().mockResolvedValue({ data: { id: "user-123" } });
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnThis();

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
  insert: mockInsert,
  update: mockUpdate,
}));

// Chain: from().select().eq().single()
mockSelect.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ single: mockSingle, eq: mockEq });
mockUpdate.mockReturnValue({ eq: mockEq });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/* ── Mock Stripe ────────────────────────────────────────────────────────── */

const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

vi.mock("stripe", () => {
  // Must be a real class/function that supports `new`
  function StripeMock() {
    return {
      webhooks: { constructEvent: mockConstructEvent },
      subscriptions: { retrieve: mockSubscriptionsRetrieve },
    };
  }
  StripeMock.default = StripeMock;
  return { default: StripeMock };
});

/* ── Import the handler ─────────────────────────────────────────────────── */

import { POST } from "../route";
import { NextRequest } from "next/server";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function makeRequest(body: string, signature = "sig_test_valid"): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
    body,
  });
}

function makeEvent(type: string, object: Record<string, unknown>) {
  return { id: "evt_test_123", type, data: { object } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_xxx";

  // Default: constructEvent succeeds
  mockConstructEvent.mockImplementation((_body: string, _sig: string, _secret: string) =>
    makeEvent("checkout.session.completed", {
      id: "cs_test",
      customer: "cus_abc",
      subscription: "sub_abc",
      metadata: { user_id: "user-123", plan: "pro" },
    })
  );

  // Default: subscription retrieval
  mockSubscriptionsRetrieve.mockResolvedValue({
    items: { data: [{ price: { id: "price_pro" } }] },
  });

  // Default: profile found
  mockSingle.mockResolvedValue({ data: { id: "user-123" } });
  mockInsert.mockResolvedValue({ error: null });
});

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe("POST /api/webhooks/stripe", () => {
  it("rejects requests without stripe-signature header", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/Missing stripe-signature/);
  });

  it("rejects requests with invalid signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const req = makeRequest("{}", "sig_bad");
    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toMatch(/Webhook Error/);
  });

  it("handles checkout.session.completed", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("checkout.session.completed", {
        id: "cs_test",
        customer: "cus_abc",
        subscription: "sub_abc",
        metadata: { user_id: "user-123", plan: "pro" },
      })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.received).toBe(true);

    // Should update profile
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    // Should log billing event
    expect(mockFrom).toHaveBeenCalledWith("billing_events");
  });

  it("handles customer.subscription.updated with active status", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", {
        customer: "cus_abc",
        status: "active",
        items: { data: [{ price: { id: "price_pro" } }] },
      })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should look up profile by customer
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("handles customer.subscription.updated with past_due status", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", {
        customer: "cus_abc",
        status: "past_due",
        items: { data: [{ price: { id: "price_pro" } }] },
      })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should insert notification
    expect(mockFrom).toHaveBeenCalledWith("notifications");
  });

  it("handles customer.subscription.deleted", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("customer.subscription.deleted", {
        customer: "cus_abc",
        status: "canceled",
        items: { data: [] },
      })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should revert plan to free
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    // Should notify user
    expect(mockFrom).toHaveBeenCalledWith("notifications");
  });

  it("handles invoice.payment_failed", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("invoice.payment_failed", {
        customer: "cus_abc",
        amount_due: 14900,
        currency: "usd",
        id: "in_test",
      })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Should log billing event and notify
    expect(mockFrom).toHaveBeenCalledWith("billing_events");
    expect(mockFrom).toHaveBeenCalledWith("notifications");
  });

  it("handles invoice.payment_succeeded", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("invoice.payment_succeeded", {
        customer: "cus_abc",
        amount_paid: 14900,
        currency: "usd",
        id: "in_test",
      })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockFrom).toHaveBeenCalledWith("billing_events");
  });

  it("returns 200 for unhandled event types", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("customer.created", { id: "cus_new" })
    );

    const req = makeRequest("{}");
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it("returns 200 even when handler throws (prevents Stripe retries)", async () => {
    mockConstructEvent.mockReturnValue(
      makeEvent("checkout.session.completed", {
        id: "cs_test",
        customer: "cus_abc",
        subscription: "sub_abc",
        metadata: { user_id: "user-123", plan: "pro" },
      })
    );

    // Force a DB error
    mockFrom.mockImplementationOnce(() => {
      throw new Error("DB connection failed");
    });

    const req = makeRequest("{}");
    const res = await POST(req);
    // Should still return 200 to prevent Stripe retries
    expect(res.status).toBe(200);
  });
});
