---
description: Cleanly stop + start the Next.js dev server via the Claude Preview MCP. Useful when HMR gets confused or env changes.
---

When Fast Refresh starts choking on stale chunks, env vars change, or a dev-only service worker is misbehaving, a clean restart is usually faster than debugging.

## Steps
1. List current preview servers:
   ```
   mcp__Claude_Preview__preview_list
   ```
2. For each server with `name: "next-dev"`:
   ```
   mcp__Claude_Preview__preview_stop(serverId)
   ```
3. Start a fresh server:
   ```
   mcp__Claude_Preview__preview_start(name: "next-dev")
   ```
   (The server config lives at `.claude/launch.json`.)
4. Wait for the home page to respond 200:
   ```
   until curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | grep -q '^200$'; do sleep 2; done
   ```
5. Re-authenticate (`/dev-login`) since the cookie file may not survive if env changed.
6. Navigate to the surface you were working on and confirm it renders.

## When to use
- After `.env.local` edits (Next.js dev server does NOT hot-reload env)
- After installing a new npm package (HMR occasionally misses the new module tree)
- After a big refactor that touches server components + middleware
- When `preview_screenshot` times out for >30s (likely stuck renderer)
- When console shows repeated `ReferenceError`s that match the latest edit (HMR stale)

## What NOT to do
- Don't spin up a second `next-dev` server on a different port — the preview MCP expects one canonical server.
- Don't kill node globally (`taskkill //F //IM node.exe`) unless the preview MCP has lost track of its server (last resort).
