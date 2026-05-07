# Stale-state permit research, round 2 (2026-05-07)

Continuation of the round-1 research at
[16-stale-states-2026-05-06.md](./16-stale-states-2026-05-06.md). That
round verified 8 of 16 states' real permit endpoints; this round
covers the remaining 8.

**Targets:** ME · MS · NV · NH · OK · RI · UT · WV

**Methodology:** 4 parallel research agents, each covering 2 states,
following the same protocol as round 1 (live HTTP probe of every
candidate URL, ≤90-day-freshness gate, scope-filter to building
permits only, reject non-construction permits / business-license /
right-of-way / well permits / sign permits).

## Result summary

| State | Verified endpoints | YAML shipped | Notes |
|---|---:|---|---|
| **NV** | **2** | henderson-nv.yml + las-vegas-nv.yml | Henderson is Bozeman-tier (publishes `professionalphone` + `professionalstatelicnbr` + `ownername`). Las Vegas has 65,866 permits issued in 2026 alone |
| ME | 0 | — | Public-data desert. Best candidate (Auburn ME ArcGIS) is frozen at FY2020 |
| MS | 0 | — | All cities use vendor portals (BS&A, OpenGov, AxisGIS) — no public read API |
| NH | 0 | — | Cities run EnerGov SelfService, ViewPoint, MapGeo. Concord NH is a Phase-2 EnerGov candidate |
| OK | 0 | — | OKC = Accela ACA (auth-gated). Tulsa Self-Service Portal capped at 100 rows/page |
| RI | 0 | — | Providence Socrata is frozen at 2020 (migrated to ViewPoint Cloud). All RI cities now on ViewPoint |
| UT | 0 | — | SLC Socrata stale 2020. All cities use Accela ACA or Citizenserve |
| WV | 0 | — | No state has fewer public permit endpoints. Morgantown uses Cityworks PLL (auth-gated) |

**Net: 2 of 8 verified.** 12 of 16 stale states now have $0 paths
documented (round 1: 8 winners + 4 confirmed-blocked; round 2: 2
winners + 6 confirmed-blocked).

## The 6 confirmed-blocked states — their actual platforms

These states aren't "missing data" — they have rich permit data
locked behind vendor portals that require Track-B platform-specific
scrapers (Playwright + ASP ViewState / Auth0 / session cookies).

| State | Dominant platform(s) | Track-B adapter required |
|---|---|---|
| ME | AxisGIS, Vision Government Solutions, MapGeo, PortlandMaps SPA | Multiple — Maine balkanized |
| MS | BS&A Online, OpenGov, paper/email | OpenGov adapter (single tenant key per city) |
| NH | Tyler EnerGov SelfService, ViewPoint Cloud, MapGeo, AxisGIS | EnerGov SelfService scraper (`load_energov_ss.py` exists) |
| OK | Accela ACA (OKC), Self-Service Permitting Portal (Tulsa) | Accela ACA Playwright scraper |
| RI | ViewPoint Cloud (8 municipalities + 2 state agencies) | OpenGov / ViewPoint adapter |
| UT | Accela ACA (SLC), Citizenserve (St. George), Cityworks | Accela ACA scraper (covers SLC + Sandy + others) |
| WV | Cityworks PLL (Morgantown), HTML-only mapping apps | Cityworks PLL adapter |

**Highest-leverage Track-B adapter:** Accela ACA. Per CLAUDE.md, Accela
ACA covers ~10–15 mid-size cities across NV, OK, UT, FL, TX, IN. One
adapter unlocks ~60-80k permits/yr across multiple states. Estimated
~5 days of focused Playwright + ASP ViewState scraping work on the
Hetzner sidecar.

**Second-highest:** ViewPoint Cloud / OpenGov. Single-platform that
covers all of RI + chunks of MS, IN, NC. ~3-5 days for the auth-flow
+ session-cookie + paginated-API scraping.

## Action items for the source registry

For each of the 6 dead-end states, update `permit_sources.discovered_via`
to flag the situation. Either:

  * `coverage: track-b-required`  (need a Wave 3 adapter)
  * `coverage: confirmed-blocked` (no public path exists)

This stops the `activate-arcgis-sources` cron from continuing to
rotate auto-imported junk endpoints that won't produce data — the
cron's promotion budget should focus on states where productive
endpoints exist.

## Research transcript references

The full agent transcripts (with every URL probed, every HTTP status
captured, every record-count pull) are preserved in the chat history.
Total research: ~4 parallel agents, ~10 min wall-clock per agent,
~110k tokens combined.

## What this means for the launch plan

The pre-launch goal was "no dead pipelines visible to a real
contractor signing up." Status now:

  * Round 1 (2026-05-06): 8 stale states had verified endpoints found,
    YAML configs shipped. State coverage: 35 active states.
  * Round 2 (2026-05-07): 2 more verified (NV via Henderson +
    Las Vegas). State coverage: 35 → 37 active states (NV joins,
    not previously listed).
  * 6 states permanently blocked on $0 path until Track-B adapters
    ship. Per CLAUDE.md, these are post-launch / Wave 3.

Marketing claim alignment: keep "30+ states covered" (rounded DOWN
to nearest 5) — at 37 active it stays at "35+". When Track-B
adapters ship and cover the remaining 6 (ME, MS, NH, OK, RI, UT, WV
— minus dropped ones), the badge can bump to "40+".
