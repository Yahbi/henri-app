# Phase 1.5 — Outreach template editor + per-trade copy

**Effort**: 3d
**Status**: Pending

## Context

User audit: "Major enhancement of the templates. Enhance design and capacity of user to write and design their own template, modifying the template offered. Re-write and enhance the quality and professionalism of template for both emails and text."

Current state (`src/app/(dashboard)/dashboard/outreach/page.tsx`): 3 hardcoded roofing templates only. `TemplateModal` allows save-to-mine but is a single textarea with no live preview.

## Foundation already shipping

- `src/lib/sequences/templates.ts` — auto-fire templates (separate from user-editable)
- `src/lib/sequences/engine.ts` — token interpolation engine
- Migration `00032_outreach_template_library.sql` — already shipped, table exists for the per-trade library
- `outreach_templates` table — user copies-to-mine here

## Scope

### A. Per-trade default template library (1 day)

Seed `outreach_templates` (system rows, contractor_id NULL) with **42 templates** = 7 trades × 3 stages × 2 channels (SMS + email). Trades: roofing, hvac, plumbing, electrical, solar, adu, general. Stages: initial (day 0), day-3 follow-up, day-7 last-touch.

Every template MUST include at least one of `{{permit_number}}`, `{{address}}`, `{{permit_type}}`, `{{permit_value}}` per wedge contract bullet #4. Add a CI check: `pnpm test:templates` greps for these tokens.

Sample roofing initial SMS:

```
Hi {{owner_first}}, this is {{contractor_name}} from {{contractor_company}}.
Saw your roof permit at {{address_short}} (#{{permit_number}}) — wanted to
introduce ourselves before the materials window tightens. Free 15-min
walk-through if you're open this week. Reply YES for times.
```

### B. Template editor UX (1.5 days)

Replace the single-textarea `TemplateModal` with a 2-pane editor:

- **Left**: Editable source with token chips. Click a token chip in a sidebar (Available tokens: `{{owner_first}}`, `{{address}}`, `{{permit_number}}`, ...) to insert at cursor.
- **Right**: Live preview rendered with sample lead data. Shows what the contractor's first homeowner will actually see.
- SMS-channel: character counter (160 / 320 / SMS-segments calculator).
- Email-channel: separate Subject + Body fields.

### C. Polish (0.5 day)

- Trade filter on the library list (dropdown: All / Roofing / HVAC / ...)
- "Default" badge on system templates, "Custom" on contractor's edits
- Restore-to-default button when a template is customized
- CI gate: `pnpm test:templates` validates every shipped template has wedge tokens

## Files

**Modified**:
- `src/app/(dashboard)/dashboard/outreach/page.tsx`
- `src/components/dashboard/TemplateModal.tsx` (or split into `TemplateEditor.tsx`)
- `src/lib/sequences/templates.ts` (expand defaults)

**New**:
- `src/lib/sequences/__tests__/wedge-token-presence.test.ts` — CI gate

**Migration**:
- New `00047_seed_template_library.sql` — INSERT the 42 system templates

## Verification

- 144 + N new tests pass
- Manual: open Outreach page, switch trade filter — see per-trade defaults
- Manual: open template editor, type `{{owner_first}}` in source — preview shows sample value
- CI gate: `pnpm test:templates` red on a template missing all wedge tokens

## Out of scope

- AI-generated templates (Phase 2.2)
- A/B variant testing (data-driven, post-Beta)
- Template versioning (just diff the rows; no formal version history)
