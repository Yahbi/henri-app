/**
 * Homeowner-flow smoke test — critical public path.
 *
 *   /  →  "Talk to Henri" CTA  →  /portal  →  intake form renders
 *
 * Fails if:
 *   - Landing page 500s
 *   - CTA link to /portal is missing (homeowners have no other way in)
 *   - Intake modal trigger is missing from /portal
 *
 * Intentionally does NOT submit the form — that would hit OpenAI and
 * bill real tokens. Smoke tests should be free to run.
 */

import { test, expect } from "@playwright/test";

test.describe("homeowner flow", () => {
  test("landing → portal → intake visible", async ({ page }) => {
    // 1. Landing page renders.
    await page.goto("/");
    await expect(page).toHaveTitle(/Henri/);

    // 2. There's a path to the homeowner portal. The CTA copy has drifted
    //    historically ("Talk to Henri" → "Find a contractor" → "Get matched")
    //    so we check the destination rather than the text.
    const portalLink = page.locator('a[href="/portal"]').first();
    await expect(portalLink).toBeVisible({ timeout: 5_000 });

    // 3. Navigate to portal. Let redirects settle.
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal/);

    // 4. The intake modal trigger or form must be present. The CTA text
    //    on /portal is "Start my project" at time of writing — fallback
    //    to any button that looks like an intake entry.
    const intakeTrigger = page.getByRole("button", { name: /start|intake|tell.*henri|get matched/i }).first();
    await expect(intakeTrigger).toBeVisible({ timeout: 5_000 });
  });

  test("pricing page renders (Founder $149 is load-bearing)", async ({ page }) => {
    await page.goto("/pricing");
    // Founder plan price is the wedge's lowest rung and the page MUST show it.
    // If this assertion breaks, the pricing table has regressed.
    await expect(page.getByText("$149")).toBeVisible();
    await expect(page.getByText("$749")).toBeVisible();
    await expect(page.getByText("$1,499")).toBeVisible();
    await expect(page.getByText("$2,555")).toBeVisible();
  });
});
