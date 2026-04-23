---
description: Print the local `.henri-feedback.jsonl` inbox that collects dev-mode user submissions.
---

`/api/feedback` writes submissions to three delivery paths (DB insert → email via Resend → local JSONL fallback). In dev, the JSONL file is often the only one active.

## Steps
1. Check if the file exists:
   ```
   test -f "C:/Users/yabis/Desktop/Henri App/.henri-feedback.jsonl" && wc -l "C:/Users/yabis/Desktop/Henri App/.henri-feedback.jsonl" || echo "no feedback yet"
   ```
2. If it exists, pretty-print every entry newest-first:
   ```
   node -e "const fs=require('fs'); const lines=fs.readFileSync('.henri-feedback.jsonl','utf8').split('\\n').filter(Boolean).reverse(); for (const line of lines) { const r=JSON.parse(line); console.log('---', r.received_at, r.role, r.category, (r.rating?'★'.repeat(r.rating):''), '\\n ', r.message, '\\n ', r.page_path||''); }"
   ```
3. Report a summary: total entries, breakdown by role (contractor / homeowner / anonymous), breakdown by category, average rating if any ratings exist.

## Don't
- Commit or push `.henri-feedback.jsonl` — it's gitignored for a reason (contains user emails and browser UAs).
- Echo raw contents to the user without redacting emails if we're in a shared-screen context.
