/**
 * Dashboard + lead-drawer smoke test (post-refactor 2026-04-28).
 *
 *   /login  →  Dev Login (god-mode)  →  /dashboard  →  click first lead row
 *
 * Fails if:
 *   - Dev login button missing (`/api/dev/auto-login` returns non-200)
 *   - Dashboard route doesn't render the leads panel (skeletons stuck > 30s)
 *   - LeadDetailDrawer fails to render the extracted `generateProposal()`
 *     output — the audit-priority-#9 refactor moved the per-trade copy
 *     table out of the drawer; if the import or the lib is broken the
 *     drawer is empty under the score circle. Smoke test for that
 *     wiring.
 *
 * Skipped in CI by default — requires `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1`
 * which only ships in `.env.local`. Local devs can run it via:
 *
 *   pnpm exec playwright test dashboard-flow
 *
 * In CI we'd need a fixture user + a way to seed leads; both are out
 * of scope for this initial smoke pass. See e2e/README.md (TODO) for
 * the long-term plan.
 */
import { test, expect } from "@playwright/test";

test.describe("dashboard + lead drawer", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN,
    "requires NEXT_PUBLIC_ENABLE_DEV_LOGIN=1 in .env.local",
  );

  test("dev-login → dashboard → click lead → drawer renders proposal", async ({
    page,
  }) => {
    // 1. Login page is the root for unauthenticated dashboard requests.
    await page.goto("/login");
    await expect(page).toHaveTitle(/Henri/);

    // 2. Click the dev-login button. Returns 200 with `redirect: /dashboard`
    //    when the env flag is set; the button's onClick navigates.
    const devButton = page.getByRole("button", { name: /Dev Login/i });
    await expect(devButton).toBeVisible({ timeout: 5_000 });
    await devButton.click();

    // 3. Wait for navigation to /dashboard. The button opens a new tab
    //    via the auto-login flow; switch to the dashboard tab.
    const dashTabPromise = page.context().waitForEvent("page", {
      timeout: 10_000,
    });
    const dashboardPage = await dashTabPromise.catch(() => page);
    await dashboardPage.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // 4. Leads panel renders within 60s (Supabase can be slow on
    //    saturated days). The top header reads "Leads N of M".
    const panelHeader = dashboardPage.getByText(/Leads\s+\d+/i).first();
    await expect(panelHeader).toBeVisible({ timeout: 60_000 });

    // 5. Click the first lead row. We don't pin to text content (the
    //    addresses change as scoring runs); we click the first lead-card
    //    selector by class hint.
    const firstLead = dashboardPage
      .locator("[role=button], button")
      .filter({ hasText: /\d{2,4}\s+\w+/ })
      .first();
    await firstLead.click({ timeout: 30_000 });

    // 6. Drawer renders. The LeadDetailDrawer always emits the score
    //    circle (huge font, lead.score). After the audit-priority-#9
    //    refactor, the proposal copy comes from `lib/proposals` — verify
    //    the headline pattern lands ("X opportunity" or default-trade
    //    "permit was filed"). If the import or extracted lib is broken,
    //    none of these regexes match.
    const proposalHeadline = dashboardPage
      .getByText(
        /opportunity|seasonal urgency|likely urgent|modernization|major project|multi-trade|active project|first-mover/i,
      )
      .first();
    await expect(proposalHeadline).toBeVisible({ timeout: 15_000 });
  });
});
