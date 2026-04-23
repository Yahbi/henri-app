---
description: Authenticate the local dev server as the founder (god-mode) via the /api/dev/auto-login endpoint. Stores the cookie at /tmp/c.txt for subsequent curl calls.
argument-hint: [--role=contractor|homeowner]
---

Authentication for smoke-testing. The app has `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` in `.env.local`, which enables a stubbed auth endpoint that issues a session for the founder account without Google OAuth.

## Steps
1. Ensure dev server is running on `localhost:3000`.
2. Hit the auto-login endpoint + capture cookies:
   ```
   curl -s -X POST -c /tmp/c.txt http://localhost:3000/api/dev/auto-login
   ```
3. Verify the session:
   ```
   curl -s -b /tmp/c.txt http://localhost:3000/api/leads/count
   ```
   Expected: `{"total":N,"geocoded":M}` with N > 0.
4. Report back:
   - Session user id (from the response)
   - Lead count (proves contractor gate passed)
   - Path to cookies for reuse (`/tmp/c.txt`)

## Usage with other curls
```
curl -s -b /tmp/c.txt http://localhost:3000/api/leads?limit=10
curl -s -b /tmp/c.txt http://localhost:3000/api/permits/history?address=642+PARK+ST&zip=06106
curl -s -b /tmp/c.txt http://localhost:3000/api/exclusivity?lead_ids=uuid1,uuid2
```

## Flags
- `--role=homeowner` (future): create a homeowner-scoped session for testing the `/homeowner/*` flow. Requires the /api/dev/auto-login endpoint to accept a role query param — check if it does before passing.

## Not in scope
- Never use this endpoint against a deployed environment. It's dev-only (proxy.ts blocks it in prod).
- Do NOT commit `/tmp/c.txt` or paste its contents to the user.
