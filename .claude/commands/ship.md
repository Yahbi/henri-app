---
description: Commit + push the current branch after the `/verify` gate passes.
argument-hint: <commit-message-subject>
---

This command commits the current staged+unstaged work and pushes to the current branch's remote. **It never pushes to `main` directly** — if the current branch is main/master, it refuses and asks the user to create a feature branch first.

## Preconditions
1. `/verify` must have printed `VERIFY_OK` in the last 20 minutes. If not, refuse and tell the user to run `/verify` first.
2. No files under `supabase/migrations/` that have NOT been applied — a commit that adds an unapplied migration is fine, but the CI must be able to re-apply it.
3. The user must have explicitly asked to ship (e.g. "ship it", "/ship", "commit + push"). Never run this proactively.

## Steps
1. Determine branch: `git rev-parse --abbrev-ref HEAD`
   - If `main` or `master`: refuse. Tell the user to branch off first.
2. `git status --short` + `git diff --stat` — show the user what will be committed.
3. `git add -A` (but only after verifying no `.env.local`, no `.henri-feedback.jsonl`, no `/tmp/*` made it into the diff).
4. Compose a commit message following the conventional style:
   ```
   <scope>: <imperative subject under 72 chars>

   <optional body — why, not what; reference the wedge pain # if applicable>

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```
5. `git commit -m "$(cat <<'EOF' ... EOF)"` — use heredoc for multi-line bodies.
6. `git push` — do NOT use `--force` or `--force-with-lease` unless the user explicitly asked.
7. `git log --oneline -5` — confirm the commit landed.
8. Print the PR-creation link if the branch has an upstream:
   ```
   gh pr create --draft --fill --web   # preferred — opens browser
   # or
   gh pr view --web 2>/dev/null || echo "No PR yet; use: gh pr create --draft --fill"
   ```

## What not to do
- Never run `git rebase -i` or any interactive git operation.
- Never bypass hooks (`--no-verify`, `--no-gpg-sign`).
- Never amend an existing commit unless the user explicitly says "amend".
- Never skip the Co-Authored-By trailer.
