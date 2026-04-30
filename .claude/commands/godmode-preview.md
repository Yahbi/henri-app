---
description: Start the Next.js dev server, log in via god-mode dev login, and screenshot a tour of the dashboard.
---

You are about to start the dev server, authenticate as the founder via god-mode (bypassing onboarding), and take screenshots of every major dashboard surface so the user can see app state at a glance.

## Preconditions

1. `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1` must be set in `.env.local` (the Dev Login button is hidden otherwise).
2. The Claude Preview MCP must be connected (tools `mcp__Claude_Preview__preview_*`).
3. `.claude/launch.json` must contain a `next-dev` configuration. Verify with:
   ```bash
   cat .claude/launch.json
   ```

## Steps

### 1. Start (or reuse) the dev server

```
mcp__Claude_Preview__preview_start({ name: "next-dev" })
```

Capture the returned `serverId`. If the server is already running (`reused: true`), proceed.

### 2. Navigate to /login + click Dev Login (owner)

```
mcp__Claude_Preview__preview_eval({
  serverId,
  expression: 'window.location.href = "http://localhost:3000/login"; "navigating"'
})
```

Wait 2–3 seconds for the page to load, then:

```
mcp__Claude_Preview__preview_eval({
  serverId,
  expression: `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const devBtn = buttons.find(b => b.textContent?.toLowerCase().includes('dev login'));
    if (!devBtn) return { error: 'Dev Login button not found' };
    devBtn.click();
    return { ok: true };
  })()`
})
```

The button POSTs to `/api/dev/auto-login`, which calls Supabase admin to mint a founder session. The middleware's god-mode bypass kicks in — onboarding gates are skipped, the dashboard renders with full data.

### 3. Tour the surfaces

Take screenshots after each navigation, waiting 2–3 seconds between for hydration:

| URL | What to verify |
|---|---|
| `/dashboard` | Leads + Map. Cluster pins, total lead count chip, capacity-filter bar |
| Click first lead | LeadDetailDrawer renders with score breakdown, scope, urgency window |
| `/dashboard/pipeline` | Kanban with weighted-value header, 6 columns, drag-and-drop cards |
| `/dashboard/analytics` | Conversion funnel + revenue forecast |
| `/dashboard/intel` | Market intel skeleton or populated cards |
| `/dashboard/storm` | Live NWS alerts + active events + outreach templates |
| `/dashboard/outreach` | Auto-fire toggle + template library by trade |
| `/dashboard/roi` | Monthly intelligence report + demand heatmap |
| `/dashboard/jobs` | Post-won job stages (Scheduled / In Progress / Punch List / Complete / Invoiced) |

For each, use:
```
mcp__Claude_Preview__preview_eval({ serverId, expression: 'window.location.href = "http://localhost:3000/dashboard/<surface>"; "nav"' })
mcp__Claude_Preview__preview_eval({ serverId, expression: 'new Promise(r => setTimeout(() => r("waited"), 2500))' })
mcp__Claude_Preview__preview_screenshot({ serverId })
```

### 4. Verify the god-mode chip

The bottom-right should show `DEV: y.abismuth@gmail.com` with **Contractor / Homeowner** buttons. If it doesn't, the dev login failed — check the server logs:

```
mcp__Claude_Preview__preview_logs({ serverId, search: "dev/auto-login", lines: 20 })
```

Expect a `POST /api/dev/auto-login [200]` line.

## Final deliverable

A summary table mapping each surface visited → what was visible (lead counts, value totals, cluster sizes, alerts, score-pill colors). Plus the running `serverId` so the user can do follow-on `preview_*` interactions.

## When this is useful

- Before recording a demo video (verify nothing's broken)
- After a refactor (visually confirm no regressions across all dashboard tabs)
- During incident triage (see app state without manually clicking through)
- For new contributors (one command surfaces the entire feature set)

## Caveats

- Real DB data shows up — the lead count, total value, and cluster sizes are live. Don't share screenshots externally unless you've verified no PII is visible.
- The `/dashboard/storm` page can show real active NWS alerts. Severe events render with full alert text.
- The map's MapLibre canvas takes 2–3s to render tiles on first load. Wait between nav + screenshot.
