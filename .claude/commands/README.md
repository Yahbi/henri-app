# Henri. — Slash Commands

Project-scoped commands that automate the full shipping lifecycle. Each `.md` file is a runbook Claude executes on invocation.

## Lifecycle map

| When | Command | What it does |
|---|---|---|
| Before every commit | `/typecheck` | `pnpm tsc --noEmit`, grouped error report |
| Before every commit | `/truthfulness-scan` | Blocks fake stats from shipping |
| Before every commit | `/verify` | Typecheck + build + smoke-test changed surfaces |
| On demand | `/migrate` | Apply pending `supabase/migrations/*.sql` |
| On demand | `/wedge-status` | Phase 0a readiness snapshot (migrations + columns + UI + env) |
| On demand | `/roadmap` | Phase 0a → E plan progress |
| On demand | `/sources-probe` | Re-qualify / probe permit_sources catalog |
| On demand | `/scorer-run` | Trigger scoring cron manually |
| On demand | `/permit-history <addr>` | Print all permits at an address |
| On demand | `/feedback-read` | Print local `.henri-feedback.jsonl` inbox |
| On demand | `/dev-login` | Auth the dev server as founder (god-mode) |
| When HMR confused | `/restart-dev` | Clean stop + start of the preview server |
| Pre-launch | `/launch-checklist` | Full pre-launch audit (code + truth + security + perf + legal) |
| After `/verify` | `/ship <subject>` | Commit + push (never to main, never force-push) |

## Design rules
1. **Every command is idempotent or explicitly asks before doing something irreversible.**
2. **Every command reports back a crisp result** — a magic string like `VERIFY_OK` / `TRUTHFULNESS_OK` so upstream commands can chain.
3. **No command commits, pushes, or migrates without user confirmation** — the guardrails live here, not in the settings file.
4. **Arguments follow the Claude slash-command convention** — `argument-hint` field in the frontmatter, `$1` / `$ARGUMENTS` inside the runbook.

## Adding a new command
1. Create `.claude/commands/<name>.md` with frontmatter:
   ```yaml
   ---
   description: <short sentence shown in the picker>
   argument-hint: <optional usage hint>
   ---
   ```
2. Write the runbook as a set of numbered steps.
3. Reference existing patterns — `/verify` for gates, `/ship` for mutations, `/wedge-status` for read-only reports.
4. Add a row to the lifecycle map above.

## What deliberately doesn't exist (yet)
- `/rollback` — schema rollback is dangerous; do it manually with an explicit "yes, rollback 00031" from the user
- `/refund` — financial ops go through the Stripe dashboard, not a slash command
- `/impersonate <user>` — security boundary; not worth the foot-gun risk in dev
- `/bulk-email` — goes through Outreach tab with proper audit trail, not a command
