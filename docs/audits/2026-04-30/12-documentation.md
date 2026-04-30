# 12 — Documentation (2026-04-30)

## TL;DR

CLAUDE.md remains the canonical reference. AGENTS.md (Next.js 16 / breaking-changes warning) intact. 9 audit folders accumulated under `docs/audits/`. Comment density in shipping code is healthy — every non-trivial change in commit `1437f86` includes inline rationale tied to either the audit-04-30 priority # or a CLAUDE.md rule.

## Score

**HEALTHY** — UNCHANGED vs 2026-04-29.

## Findings

**D1** | **HEALTHY** | CLAUDE.md
- ~600 lines. Covers brand non-negotiables, pricing source-of-truth, policies, truthfulness contract, architecture, wedge contract (6 bullets), delivery patterns, code patterns, migrations, verification gate, files-not-to-touch, plan files, MCP servers, and a long install log of plugins/skills/hooks added across audits.
- The install-log section is starting to dominate the file; suggest splitting `MCP install log` and `Knowledge Work Plugins install log` to a separate `docs/setup/install-log.md` and linking from CLAUDE.md. Future audits will have less to scan.

**D2** | **HEALTHY** | AGENTS.md
- Single-line warning: "This is NOT the Next.js you know" + pointer to `node_modules/next/dist/docs/`. Read by all sub-agents per CLAUDE.md `@AGENTS.md` import. Effective.

**D3** | **HEALTHY** | Inline code comments in commit `1437f86`
- Every change explains itself. Examples:
  - `src/components/portal/ChatIntakeModal.tsx:96-109` — Skip-ahead policy commentary
  - `src/components/pipeline/KanbanBoard.tsx:362-410` — Drag race documented + dataTransfer fallback rationale
  - `src/app/api/cron/enrich/route.ts:33-58` — Phase 3.1 throughput tune note + math
  - `src/app/api/cron/review-requests/route.ts:153` — 2026-04-30 canonical email policy comment
- All include the date `2026-04-30` so future audits can chronologize.

**D4** | **WATCH** | `docs/audits/` accumulation
- 9 dated folders + 4 rolled-up files (4 audits in 5 days). Storage cost: trivial. Cognitive cost: diff-vs-prior is now linking 3 hops back to find a baseline.
- **Recommended fix**: Move audits older than 14 days to `docs/audits/_archive/`. Keep the 4 most recent rolled-up files at `docs/audits/henri-audit-YYYY-MM-DD.md`. ~10 min.

**D5** | **Nitpick** | Audit numbering
- Today's audit is at `docs/audits/2026-04-30/`. Prior pattern: `docs/audits/YYYY-MM-DD/` + `docs/audits/henri-audit-YYYY-MM-DD.md` rolled-up. Today's rolled-up file is being assembled now.

**D6** | **Nitpick** | Plan files in `~/.claude/plans/`
- Active plan: `composed-questing-lighthouse.md` (Tier 1-4 plan from 2026-04-30 session — the 8-item user-reported fixes plan).
- Prior active: `distributed-growing-quiche.md` (Phase 0a wedge work).
- Unclear which is current; suggest adding a one-line "Active plan: <filename>" entry at the top of CLAUDE.md so a session entrypoint always knows.

## Audit corpus inventory

```
docs/audits/
├── 2026-04-26/             (full audit folder)
├── 2026-04-26-delta.md
├── 2026-04-26-product-roadmap.md
├── 2026-04-27/             (full audit folder)
├── 2026-04-28/             (full audit folder)
├── 2026-04-29/             (full audit folder)
├── 2026-04-30/             ← TODAY
├── henri-audit-2026-04-26.md
├── henri-audit-2026-04-28.md
├── henri-audit-2026-04-29.md
└── henri-audit-2026-04-30.md  ← TODAY (rolled-up, being assembled)
```

## Closing

Documentation is healthy and growing through accretion. The audit corpus benefits from a 14-day archival policy (D4); CLAUDE.md benefits from extracting the install-log section (D1). Both are 10-minute hygiene wins.
