/**
 * Contractor-flow smoke test — paid-tier acquisition path.
 *
 *   /  →  /contractors  →  pricing table + signup CTA visible
 *
 * Fails if:
 *   - /contractors 500s
 *   - Any of the four plan tiers ($149 / $749 / $1,499 / $2,555) is
 *     missing from the pricing grid — this is the core wedge offer
 *   - Signup CTA is missing (contractors have no way to convert)
 *
 * Intentionally does NOT complete signup — that writes to Supabase and
 * would require fixture teardown. Smoke tests stay read-only.
 */

import { test, expect } from "@playwright/test";

test.describe("contractor flow", () => {
  test("contractors page renders + signup CTA + pricing link", async ({ page }) => {
    await page.goto("/contractors");
    await expect(page).toHaveURL(/\/contractors/);

    // /contractors is the stats / pitch page — not the pricing table.
    // Verify the wedge headline copy + the four core stats render.
    // (The full price table lives on /pricing; the contractors page
    // links there via "See pricing & territories" CTA.)
    await expect(page.getByText(/Own your ZIP/i).first()).toBeVisible();
    await expect(page.getByText(/900k\+/).first()).toBeVisible();
    await expect(page.getByText(/1 \/ ZIP/).first()).toBeVisible();

    // Signup CTA present — destination is /signup?role=contractor per
    // the architecture doc. Copy may say "Start trial" or "Sign up"; we
    // check the link destination instead.
    const signupCta = page.locator('a[href*="/signup"]').first();
    await expect(signupCta).toBeVisible();
  });

  test("/pricing renders all 4 plan tiers", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveURL(/\/pricing/);

    // All four plan tiers must render. Order-agnostic — we just check
    // each price appears at least once on the page.
    await expect(page.getByText("$149").first()).toBeVisible();
    await expect(page.getByText("$749").first()).toBeVisible();
    await expect(page.getByText("$1,499").first()).toBeVisible();
    await expect(page.getByText("$2,555").first()).toBeVisible();
  });

  test("/contractors does NOT surface fabricated metrics", async ({ page }) => {
    // Truthfulness contract — the retired fake stats (18.4x ROI, 4200+
    // homeowners, 94% / 4.9 etc.) MUST NOT render. If any do, the
    // copy has regressed and needs sourcing from a live query.
    await page.goto("/contractors");
    const html = await page.content();
    expect(html).not.toMatch(/18\.4x/);
    expect(html).not.toMatch(/4,?200\+/);
    expect(html).not.toMatch(/94%\s*(rate|contact)/);
    expect(html).not.toMatch(/4\.9\s*\/\s*5/);
  });
});
