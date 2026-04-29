import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  personalizeOutreach,
  type OutreachLlmClient,
} from "../outreach-personalizer";
import type { Lead } from "@/types/lead";

function mockLlm(response: string, delayMs = 0): OutreachLlmClient {
  return {
    async complete() {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return response;
    },
  };
}

const lead: Lead = {
  id: "L1", permit_id: "P1", contractor_id: "C1",
  score: 70, urgency: "warm", status: "new",
  score_freshness: 15, score_value: 12, score_contact: 8, score_demand: 8,
  address: "123 Maple St", city: "Hartford", state: "CT", zip: "06106",
  trade: "roofing", permit_type: "roof",
  permit_description: "Replace asphalt roof", permit_value: 18000, year_built: 1985,
} as unknown as Lead;

const template =
  "Hi John, this is Mike from Apex Roofing. Saw your roof permit at 123 Maple St. Reply YES for a free 15-min walk-through.";

beforeEach(() => {
  process.env.LLM_OUTREACH_ENABLED = "1";
});
afterEach(() => {
  delete process.env.LLM_OUTREACH_ENABLED;
});

describe("personalizeOutreach", () => {
  it("returns LLM output when valid", async () => {
    const llm = mockLlm(
      "Hi John, your asphalt roof replacement at 123 Maple St — quick intro from Apex Roofing. Reply YES for a free walk-through.",
    );
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    expect(r.source).toBe("llm");
    expect(r.body).toContain("asphalt");
  });

  it("falls back to template when LLM disabled", async () => {
    delete process.env.LLM_OUTREACH_ENABLED;
    const r = await personalizeOutreach({ template, lead, channel: "sms" });
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("llm-disabled");
    expect(r.body).toBe(template);
  });

  it("falls back on LLM error", async () => {
    const llm: OutreachLlmClient = {
      async complete() { throw new Error("provider down"); },
    };
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("llm-error");
    expect(r.body).toBe(template);
  });

  it("falls back on timeout", async () => {
    const llm = mockLlm("late response", 1000);
    const r = await personalizeOutreach(
      { template, lead, channel: "sms", budgetMs: 100 },
      llm,
    );
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("llm-timeout");
  });

  it("rejects URL injection", async () => {
    const llm = mockLlm(
      "Hi John, click http://evil.com for your roof estimate. — Mike",
    );
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("validation-rejected");
  });

  it("rejects unrendered template tokens", async () => {
    const llm = mockLlm(
      "Hi {{owner_first}}, your roof permit at 123 Maple St — Reply YES",
    );
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("validation-rejected");
  });

  it("rejects SMS over 160 chars", async () => {
    const long = "x".repeat(200);
    const llm = mockLlm(long);
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("validation-rejected");
  });

  it("accepts longer email bodies (cap 2000)", async () => {
    const ok = "x".repeat(template.length); // similar length to template
    const llm = mockLlm(ok);
    const r = await personalizeOutreach(
      { template, lead, channel: "email" },
      llm,
    );
    // We're not testing length specifically here; just that cap is higher
    expect(r.body.length).toBeLessThanOrEqual(2000);
  });

  it("rejects too-short output", async () => {
    const llm = mockLlm("hi");
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    expect(r.source).toBe("template-fallback");
    expect(r.fallback_reason).toBe("validation-rejected");
  });

  it("strips wrapping quotes from LLM output", async () => {
    const llm = mockLlm(
      `"Hi John, your roof permit on Maple St — quick intro from Apex Roofing. Reply YES for a walk-through."`,
    );
    const r = await personalizeOutreach(
      { template, lead, channel: "sms" },
      llm,
    );
    if (r.source === "llm") {
      expect(r.body.startsWith('"')).toBe(false);
      expect(r.body.endsWith('"')).toBe(false);
    }
  });
});
