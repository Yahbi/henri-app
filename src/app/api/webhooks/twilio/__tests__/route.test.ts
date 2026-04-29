import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Mock Supabase admin client ─────────────────────────────────────────── */

const mockUpdate = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn(() => ({ update: mockUpdate, eq: mockEq }));

mockUpdate.mockReturnValue({ eq: mockEq });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/* ── Mock the idempotency helper ────────────────────────────────────────── */

const mockWasProcessed = vi.fn();
const mockMarkProcessed = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/webhooks/idempotency", () => ({
  wasProcessed: (...args: unknown[]) => mockWasProcessed(...args),
  markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
}));

/* ── Mock Twilio signature validation ───────────────────────────────────── */

const mockValidateRequest = vi.fn();
vi.mock("twilio", () => ({
  default: { validateRequest: (...args: unknown[]) => mockValidateRequest(...args) },
  validateRequest: (...args: unknown[]) => mockValidateRequest(...args),
}));

/* ── Import the handler ─────────────────────────────────────────────────── */

import { POST } from "../route";
import { NextRequest } from "next/server";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function makeRequest(form: Record<string, string>, signature = "sig_valid"): NextRequest {
  const body = new URLSearchParams(form).toString();
  return new NextRequest("http://localhost/api/webhooks/twilio", {
    method: "POST",
    headers: {
      "x-twilio-signature": signature,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  // Default: signature valid, not yet processed
  mockValidateRequest.mockReturnValue(true);
  mockWasProcessed.mockResolvedValue(false);
});

/* ── Tests ─────────────────────────────────────────────────────────────── */

describe("Twilio status webhook (P0-10)", () => {
  it("rejects requests with missing required fields", async () => {
    const res = await POST(makeRequest({ MessageStatus: "delivered" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/missing/i);
  });

  it("rejects requests with invalid Twilio signature", async () => {
    mockValidateRequest.mockReturnValue(false);
    const res = await POST(
      makeRequest({ MessageSid: "SM_test", MessageStatus: "delivered" }),
    );
    expect(res.status).toBe(403);
  });

  it("skips replay of already-processed (MessageSid:MessageStatus) pair", async () => {
    mockWasProcessed.mockResolvedValue(true);
    const res = await POST(
      makeRequest({ MessageSid: "SM_dup", MessageStatus: "delivered" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped?: string };
    expect(body.skipped).toBe("duplicate");
    // Critical: no DB update, no markProcessed (no double-write)
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockMarkProcessed).not.toHaveBeenCalled();
  });

  it("maps `delivered` to delivered_at + status='delivered'", async () => {
    const res = await POST(
      makeRequest({ MessageSid: "SM_d1", MessageStatus: "delivered" }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const update = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(update.status).toBe("delivered");
    expect(update.delivered_at).toBeTypeOf("string");
    // Marks processed AFTER update so failed updates can replay
    expect(mockMarkProcessed).toHaveBeenCalledTimes(1);
  });

  it("maps `read` to opened_at + delivered_at + status='opened'", async () => {
    const res = await POST(
      makeRequest({ MessageSid: "SM_r1", MessageStatus: "read" }),
    );
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(update.status).toBe("opened");
    expect(update.opened_at).toBeTypeOf("string");
    expect(update.delivered_at).toBeTypeOf("string");
  });

  it("maps `failed` to bounce_reason + bounced_at + status='failed'", async () => {
    const res = await POST(
      makeRequest({
        MessageSid: "SM_f1",
        MessageStatus: "failed",
        ErrorCode: "30005",
      }),
    );
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(update.status).toBe("failed");
    expect(update.bounce_reason).toContain("30005");
    expect(update.bounced_at).toBeTypeOf("string");
  });

  it("ignores intermediate statuses (queued/sent) without DB write", async () => {
    const res = await POST(
      makeRequest({ MessageSid: "SM_q1", MessageStatus: "queued" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action?: string };
    expect(body.action).toBe("ignored");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
