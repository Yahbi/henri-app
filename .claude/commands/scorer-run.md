---
description: Trigger the lead-scoring cron manually, for smoke-testing score_signals + new scoring logic.
argument-hint: [--dry-run] [--limit=N]
---

The scoring cron normally runs every 2 hours (`vercel.json` → `/api/cron/score` at `0 */2 * * *`). Use this command to trigger it on demand, e.g. after changing the scoring model or verifying Phase 0a's `score_signals` jsonb writes correctly.

## Steps
1. Ensure the dev server is running (`mcp__Claude_Preview__preview_start` server `next-dev`).
2. Pull the CRON_SECRET from `.env.local`:
   ```
   export CRON_SECRET=$(grep '^CRON_SECRET=' "C:/Users/yabis/Desktop/Henri App/.env.local" | cut -d= -f2)
   ```
3. Hit the endpoint:
   ```
   curl -s -o /tmp/score.json -w "HTTP %{http_code}\\n" \
     -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/score
   cat /tmp/score.json | node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({permits_scored:j.permits_scored, leads_assigned:j.leads_assigned, notifications_sent:j.notifications_sent, sample_signal:j.sample?.score_signals?.slice?.(0,1)},null,2));})"
   ```
4. Confirm the run completed by checking `mcp__Claude_Preview__preview_logs --search "cron/score"` — look for `score_signals column missing` warnings (migration 00031 not applied) vs clean runs (migration applied and signals written).
5. Open any lead in the dashboard drawer — verify the "Why this score" breakdown now shows real detail text (e.g. "Filed 3 days ago", "Permit value $175,000") instead of the legacy fallback.

## Flags
- `--dry-run`: do NOT write to `leads`; return the scored payload for inspection only.
- `--limit=N`: only score the first N permits. Useful for tight iteration.

If either flag is requested, add it to the endpoint's query string and adjust the route handler if not yet supported (the current route doesn't take flags — add them as search params if the user asks).
