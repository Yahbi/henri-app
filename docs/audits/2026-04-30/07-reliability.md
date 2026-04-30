# 07 — Reliability (2026-04-30)

## TL;DR

Graceful-degrade patterns intact across `/api/feedback`, `/api/exclusivity`, `useLeads`. Webhook idempotency module wired into Stripe + Twilio (status) + Resend. **Twilio missed-call still missing the `wasProcessed()` wrap** — same as 04-29 (priority #8). Today's commit added a defensive try/catch around `dataTransfer.setData()` in `KanbanBoard.tsx:374-381` for older Safari MIME-rejection edge case.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-29.

## Findings

**R1** | **HEALTHY** | `/api/feedback/route.ts` — 3-path graceful degrade
- **Path 1**: DB insert via `createAdminClient().from("feedback")...` (silently fails if table missing — migration 00030).
- **Path 2**: Resend email to `FEEDBACK_INBOX` (skipped if `RESEND_API_KEY` unset).
- **Path 3**: Append to `.henri-feedback.jsonl` (skipped on Vercel read-only filesystem; works locally).
- **Returns 200 if ANY path succeeds**; 502 only if all three fail.
- **Rate limit**: 4KB body size (Zod rejection).
- This is the canonical pattern documented in CLAUDE.md "Delivery patterns" section.

**R2** | **HEALTHY** | `/api/exclusivity/route.ts:31-69` — table-missing → empty summary
- GET endpoint returns empty lock summary when migration 00031 hasn't been applied. Each lead gets `{ held_by_caller: false, ms_remaining: 0, window_end: null, watchers_bucket: "0" }` (line 56-62).
- Caller's UI never hard-fails; leads render with "no lock held" state.
- Try/catch wraps both summarizer calls; logApiError + return `{ locks: {} }` on exception (line 66-67).

**R3** | **Medium (carry-forward from 04-29)** | `/api/webhooks/twilio-missed-call/route.ts` missing `wasProcessed()` guard
- See [04-api-surface.md F3](./04-api-surface.md) and [05-security.md F7](./05-security.md).
- **Why it matters**: Twilio retries on receiver timeout. Each retry inserts duplicate `missed_call_events` row + sends another auto-reply SMS. Wedge bullet #5 (speed-to-lead) auto-reply is the brand-defining moment; sending it twice looks broken.
- **Recommended fix**: Pattern from `/api/webhooks/twilio/route.ts:44-62`:
  ```ts
  const idempotencyKey = callSid;
  const seen = await wasProcessed(supabase, "twilio-missed-call", idempotencyKey);
  if (seen) return NextResponse.json({ ok: true, idempotent: true });
  // ... existing logic ...
  await markProcessed(supabase, "twilio-missed-call", idempotencyKey);
  ```
  ~30 min copy-paste from the existing twilio route.

**R4** | **HEALTHY** | `useLeads` extended-columns fallback (`src/hooks/useLeads.ts`)
- Module-scoped `extendedColumnsMissing` flag (line 37-39). First fetch tries `SELECT_WIDE`; on "column does not exist" error, flag is set and subsequent fetches use `SELECT_NARROW`.
- Single probe per page load; full reload resets flag.
- Helper `resolveSelect(extendedColumnsMissing, ...)` on line 93 picks the right select list.
- Result: migration 00039/00044 backfill is transparent; leads keep rendering during the rolling deploy window.

**R5** | **HEALTHY** | KanbanBoard drag-drop dataTransfer fallback (`src/components/pipeline/KanbanBoard.tsx:362-410`) — NEW today
- `handleDragStart` writes `{leadId, fromCol}` to `dataTransfer.setData("application/x-henri-lead", ...)` inside try/catch (line 372-381) — older Safari rejects custom MIME types.
- `handleDrop` reads from dataTransfer first, falls back to React state.
- Eliminates the dragend-vs-drop race that silently no-op'd fast releases.
- The `text/plain` fallback set in `KanbanCard.onDragStart:208` provides leadId even if the custom MIME type is rejected.

**R6** | **HEALTHY** | Error boundary coverage (26+ `error.tsx` files)
- Root `src/app/error.tsx` + `src/app/global-error.tsx` (Sentry capture wired via global listener).
- 22 segment-level boundaries across dashboard, auth, marketing, homeowner, and onboarding groups.

## Idempotency posture

| Webhook | Idempotency key | Source of truth |
|---|---|---|
| `/api/webhooks/stripe` | `event.id` | `billing_events.stripe_event_id UNIQUE` |
| `/api/webhooks/twilio` (status) | `messageSid:status` | `webhook_idempotency` table |
| `/api/webhooks/twilio-missed-call` | **MISSING** | (none) |
| `/api/webhooks/resend` | `svix-id` | `webhook_idempotency` table |
| `/api/webhooks/supabase` | (Webhook secret check, not retry-aware) | (n/a) |

## Closing

Reliability remains the strongest non-data-layer surface. The single open issue is the twilio-missed-call wrap; everything else is hardened. The new dataTransfer pattern in KanbanBoard adds another defensive layer at the UX boundary.
