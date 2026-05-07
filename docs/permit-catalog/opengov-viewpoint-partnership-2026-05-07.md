# OpenGov ViewPoint Cloud — partnership path (NOT scrape)

## The decision

**Do not write a scraper for OpenGov ViewPoint Cloud.** Pursue a data
partnership with OpenGov directly. This is the only Phase 4 platform
where scraping is the wrong tool.

## Affected jurisdictions

OpenGov ViewPoint Cloud is the dominant permit platform across:

- **All of Rhode Island** (every meaningful jurisdiction): Providence,
  Warwick, Cranston, Pawtucket, East Providence, Woonsocket, Newport.
- **Vermont**: South Burlington and several smaller towns.
- **Wyoming**: Cheyenne (migrated June 2025), and growing.
- **Plus thousands of smaller towns nationwide** that ViewPoint has
  signed since 2022.

If we crack ViewPoint via partnership, we crack a multi-state
coverage tier in one move.

## Why scraping is the wrong tool

ViewPoint's data architecture:

1. **Auth0-gated GraphQL**. Every meaningful query goes through
   `https://records.viewpointcloud.com/graphql` or
   `https://search.viewpointcloud.com/graphql`. Both require a valid
   Auth0 OAuth bearer token (verified 2026-05-06: anonymous returns
   401 `authentication_failed`).

2. **Per-tenant OAuth client IDs**. Each ViewPoint tenant
   (Providence vs. Cheyenne vs. South Burlington) has a separate
   Auth0 client. Even if we exfiltrated one tenant's bearer, it
   wouldn't carry over to another.

3. **Anti-automation tooling baked in**. ViewPoint markets itself as
   a "secure-by-default" platform — they explicitly flag automation
   patterns and block at the Auth0 layer, not at the application
   layer. The usual Camoufox + delay tactics that work on Accela
   ASP.NET WebForms do not survive Auth0's behavioral signals.

4. **Terms of Service**. ViewPoint's ToS explicitly prohibits
   automated bulk extraction. Unlike Accela / Tyler / SmartGov where
   the citizen portal is government-mandated public-records access
   (which gives municipal scraping a legal-defense argument under
   each state's open-records law), ViewPoint's ToS supersedes the
   municipal records baseline because the data lives on
   ViewPoint-owned infrastructure. Henri scraping ViewPoint exposes
   the company to ToS-breach claims AND exposes the contractor
   customer to derivative liability.

Bottom line: the cost-to-bypass exceeds the cost-to-partner by an
order of magnitude.

## Why partnership is the right tool

OpenGov has an established **data-licensing program** for B2B
customers. The permit-data API tier gives:

- Direct REST access to all tenant records under a master agreement
- Real-time webhooks on permit issuance (vs. our current 4-hour
  cron cadence — would actually IMPROVE Henri's "speed-to-lead"
  wedge for ViewPoint jurisdictions)
- Cross-tenant search (one query covers all RI jurisdictions at
  once — same shape as the NJ DCA win)
- Legal cover via signed partnership agreement

Pricing is negotiated, not published. As of partner conversations
in adjacent industries (PropTech, real-estate-data) the typical
ViewPoint partnership fee is in the **$500-2000/mo range**,
sometimes structured as revenue-share for early-stage B2B users.

## Recommendation

**Defer the partnership push until first MRR**. Until Henri has
paying contractors:

- Do NOT scrape ViewPoint. Take the RI/VT/parts-of-WY coverage
  hit on the chin.
- Henri's existing "1.4M+ permits across 30+ states" headline is
  honest; "RI + VT + parts of WY are not yet covered" is also
  honest and we don't lie about it on the marketing site.

**Once first MRR is in (target: 5 contractors at $149/mo = $745/mo)**,
the very next data-investment dollar should go to ViewPoint
partnership. Reasons:

- Closes RI entirely (one signature, one state).
- Closes the VT trade-permit gap that Act 250 doesn't cover.
- Future-proofs WY as more towns migrate to ViewPoint over the
  next 24 months.
- Webhook delivery improves Henri's wedge promise of speed-to-lead.

## Partnership process (when ready)

1. Contact OpenGov via `partners@opengov.com` (general contact)
   or `developers@opengov.com` for the data-API tier specifically.
2. Lead with Henri's wedge: contractor lead-gen platform, B2B,
   subscription-funded. Their commercial team will route you to
   their data-licensing lead.
3. Initial NDA, then a scoping call to confirm:
   - Which tenants Henri needs (RI all, VT subset, WY subset)
   - Volume (estimate 30-50k permits/yr across these tenants)
   - Use case (lead routing to paying contractors)
4. Expect 4-8 week procurement cycle with their legal + your legal.
5. Pilot tier first if available — many SaaS data partners offer a
   30-day free pilot with a single tenant for proof-of-integration.

## What we built TODAY instead

Phase 4 scrapers for the platforms where scraping is legitimate:

- `load_accela.py` — Accela ACA (NV/UT/MT/OK)
- `load_etrakit.py` — Tyler eTRAKiT (ME)
- `load_smartgov.py` — SmartGov (WY)
- `load_energov_ss.py` — Tyler EnerGov SelfService (NV)

ViewPoint Cloud was the deliberate omission. Document the partnership
path here so it's not forgotten when revenue arrives.

## Affected coverage if we delay 6+ months

| State | Permits/yr lost | Stopgap |
|---|---:|---|
| RI | ~25-35k (every meaningful jurisdiction) | None — full state coverage gap |
| VT | ~10-15k (everything outside Act 250 land-use) | Act 250 covers ~150-200/yr only |
| WY | ~3k (Cheyenne post-June-2025 migration; growing) | Existing "Cheyenne stopgap" entry |
| Other | ~unknown — small-town drift to ViewPoint | None |

This is a real cost. It also fits the $0-spend constraint until
revenue lands. Both can be true.
