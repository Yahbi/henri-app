# Sidecar loader configs

Each `*.yml` here is one Socrata city. The generic `load_socrata.py`
runs them via:

    python load_socrata.py austin       # one city
    python load_socrata.py --all        # all configs in this dir

## Adding a new city

1. **Probe the endpoint first** — column names vary per city:

       python probe_socrata.py "https://data.<city>.gov/resource/<id>.json"

   This prints all column names + values from one row. Map them to
   Henri's canonical fields and write a YAML.

2. **Use the Austin config as a template** — it's the verified-working
   reference. Copy and edit the `name` / `city` / `state` / `url` /
   `fields` keys.

3. **Smoke-test from the box**:

       python load_socrata.py <slug>

   Watch for `inserted N rows` and a non-empty `permit_type breakdown`.
   If you see `inserted 0 rows`, check the HTTPError 400 message — it
   names the column it didn't recognize.

4. **Add to cron**: the `--all` mode picks up every config in this dir,
   so once smoke-tested it just rides the existing cron schedule.

## Status of pre-built configs (2026-05-04)

| Config              | Status              | Notes |
|---------------------|---------------------|-------|
| `austin.yml`        | ✅ verified working | Inserted 50 rows in <2s |
| `nyc-dob.yml`       | ⚠️ unverified       | Field guesses based on NYC dataset; probe before relying |
| `chicago.yml`       | ⚠️ unverified       | Same — likely needs field tweaks |
| `sf.yml`            | ⚠️ unverified       | Same |
| `seattle.yml`       | ⚠️ unverified       | Same |
| `boston.yml`        | ⚠️ datastore API    | Boston uses CKAN datastore_search, not pure Socrata. May need a tweak to load_socrata.py |
| `los-angeles.yml`   | ⚠️ unverified       | Same |
| `denver.yml`        | ❌ ArcGIS, not Socrata | Needs a separate `load_arcgis.py` (Phase 3) |
| `portland-or.yml`   | ❌ Custom API        | Portland's portland maps API isn't standard Socrata; defer |
| `sacramento.yml`    | ⚠️ unverified       | Probe first |

**Onboarding flow per new config:**
1. `python probe_socrata.py "<URL>"` — shows real column names
2. Edit the YAML to match
3. `python load_socrata.py <slug>` — verify insert
4. Move from `⚠️ unverified` to `✅ verified` in this README

## Why YAML, not Python

The whole point of Phase 1 is **write the loader code once, configure
many times**. Adding a city should be 10 lines of YAML, never code.
When YAML stops being expressive enough (different platform like
Tyler EnerGov or ArcGIS), spawn a sibling loader (`load_tyler.py`,
`load_arcgis.py`) — but keep them config-driven the same way.
