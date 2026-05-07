---
name: godmode-preview
description: Start the Next.js dev server, log in via god-mode dev login, and screenshot a tour of the dashboard.
---

# Henri god-mode preview tour

Starts the dev server, authenticates as the founder via god-mode (bypassing onboarding), and takes screenshots of every major dashboard surface so the user can see app state at a glance.

## Preconditions

1. `NEXT_PUBLIC_ENABLE_DEV_LOGIN=1` in `.env.local`
2. Claude Preview MCP connected (`mcp__Claude_Preview__preview_*`)
3. `.claude/launch.json` contains a `next-dev` configuration

## Steps

### 1. Start (or reuse) the dev server

```
mcp__Claude_Preview__preview_start({ name: "next-dev" })
```

Capture the returned `serverId`.

### 2. Navigate to /login + click Dev Login (owner)

```
mcp__Claude_Preview__preview_eval({
  serverId,
  expression: 'window.location.href = "http://localhost:3000/login"; "navigating"'
})
```

Wait 2-3s for hydration, then:

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

The button POSTs to `/api/dev/auto-login` which mints a founder session via Supabase admin. Middleware's god-mode bypass kicks in.

### 3. Tour the surfaces

For each URL: navigate, wait 2-3s, screenshot.

| URL | What to verify |
|---|---|
| `/dashboard` | Leads + Map. Cluster pins, total lead count, capacity-filter bar |
| Click first lead | LeadDetailDrawer with score breakdown, scope, ApplicantBadge, CrossTradeOpportunities |
| `/dashboard/pipeline` | Kanban with weighted-value header, drag-and-drop |
| `/dashboard/analytics` | Conversion funnel + revenue forecast |
| `/dashboard/intel` | Market intel cards |
| `/dashboard/storm` | Live NWS alerts + active events + outreach templates |
| `/dashboard/outreach` | Auto-fire toggle + template editor (token picker + live preview) |
| `/dashboard/estimate` | ZIP-prefilled tax + tier multipliers |
| `/dashboard/roi` | Monthly intelligence report |
| `/dashboard/jobs` | Post-won job stages |

### 4. Verify the god-mode chip

The bottom-right should show `DEV: y.abismuth@gmail.com` with **Contractor / Homeowner** role-switcher. If missing, check server logs for `POST /api/dev/auto-login [200]`.

## Final deliverable

Summary table mapping each surface visited → what was visible (lead counts, value totals, alerts). Plus the running serverId for follow-on `preview_*` interactions.

## When this is useful

- Before recording a demo video
- After a refactor (visual regression check)
- During incident triage
- For new contributors

## Caveats

- Real DB data is shown — verify no PII before sharing screenshots externally
- `/dashboard/storm` may show real active NWS alerts
- MapLibre canvas takes 2-3s to render tiles on first load
