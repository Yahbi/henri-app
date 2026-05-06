# Sprint plans — 2026-04-26 post-audit

Each file in this directory is a self-contained sprint plan for a Phase-1 or Phase-2 item from `docs/audits/2026-04-26-product-roadmap.md` that did NOT ship in the 2026-04-26 execution session.

Sprint plans are designed so a separate engineer (or a future Claude session in a fresh context) can execute end-to-end without re-discovering the surface area. Each contains:

1. **Context** — why this work, where it lives in the larger roadmap
2. **Foundation already shipping** — what migrations / code paths can be reused
3. **Scope** — the actual code changes
4. **Critical files**
5. **Verification gate**
6. **Out of scope** — what NOT to expand into

| Phase | File | Effort | Status |
|---|---|---|---|
| 1.1 | [phase-1.1-lead-drawer-4col.md](./phase-1.1-lead-drawer-4col.md) | 1.5d | Pending |
| 1.5 | [phase-1.5-outreach-templates.md](./phase-1.5-outreach-templates.md) | 3d | Pending |
| 1.6 | [phase-1.6-estimate-builder-v2.md](./phase-1.6-estimate-builder-v2.md) | 5–7d | Pending |
| 2.1 | [phase-2.1-llm-description-mining.md](./phase-2.1-llm-description-mining.md) | 1 wk | Pending |
| 2.2 | [phase-2.2-outreach-agent.md](./phase-2.2-outreach-agent.md) | 1 wk | Pending |
| 2.3 | [phase-2.3-enrichment-derivations.md](./phase-2.3-enrichment-derivations.md) | 2 wks | Pending |
| 2.4 | [phase-2.4-stripe-tax-v2.md](./phase-2.4-stripe-tax-v2.md) | 3d | Pending |
| Cron | [phase-1.2-wire-cron.md](./phase-1.2-wire-cron.md) | 0.5d | Pending |

**Already shipped this session** (so not in this directory):
- Phase 1.2 predictive rules engine + tests (`src/lib/predictive/rules.ts` + 26 unit tests)
- Phase 1.3 DIY-vs-pro classifier + drawer surfacing (`src/lib/permits/applicant-classifier.ts` + `ApplicantBadge`)
- Phase 1.4 referral 13th-month-free Stripe webhook (`src/app/api/webhooks/stripe/route.ts` `applyReferralCreditIfEligible`)
- Phase 2.5 Sentry instrumentation scaffold (`instrumentation.ts`)
- Migrations 00045 (`cross_trade_suggestions`) + 00046 (`referral_credits`)

The "Cron" entry above is a small follow-up: wire `evaluateRules()` into `/api/cron/score/route.ts` so the predictive engine runs on every scoring pass. The engine + drawer are ready; the cron writer is the missing edge.

Phase 3.* (full agent loop, ML scoring, mobile) is scoped at `docs/audits/2026-04-26-product-roadmap.md#phase-3` — quarter-scale work, no sprint plan yet.
