# Hetzner sidecar deploy — 2026-05-07 batch

The Hetzner CCX13 sidecar at `henri@5.78.152.250` runs Scrapling-driven
loaders for sources that Vercel cron can't reach (Cloudflare/Auth0 walls,
JS SPAs, scrape-only state portals). This document lists the files this
session added and the exact commands to push them.

## 1. Files to deploy

### Three new platform loaders (Tier 5/6 of research/SUMMARY-2026-05-07.md)

| File | Tier | What it unlocks |
|---|---|---|
| `scripts/_sidecar_loaders/load_citizenserve.py` | Tier 5 | ~400 long-tail Citizenserve tenant portals via the deterministic `installationID=N` URL template |
| `scripts/_sidecar_loaders/load_mygovonline.py` | Tier 5 | MyGovernmentOnline (MGO) — dominant MS Gulf-Coast + parts of LA/TX/AL |
| `scripts/_sidecar_loaders/load_lien_recorder.py` | Tier 6 | Mechanic's lien RECORDING layer (vs CourtListener's APPEAL layer). First aggregator: GA gsccca.org. |

### Nine new YAML configs (all `status: unverified` until smoke-tested per UPLOAD.md §11)

| Config | Loader |
|---|---|
| `configs/allegheny-county-pa.yml` | arcgis (Pittsburgh metro Permit_Points service) |
| `configs/ga-gsccca.yml` | lien_recorder (GA statewide lien index) |
| `configs/gulfport-ms.yml` | mygovonline (MS Gulf-Coast unlock) |
| `configs/mecklenburg-county-nc.yml` | arcgis (Charlotte metro) |
| `configs/miami-dade-fl.yml` | arcgis (Miami-Dade ~100k rows / 2yr window) |
| `configs/miami-fl.yml` | socrata (City of Miami, data.miamigov.com) |
| `configs/orlando-fl.yml` | socrata (Orlando, data.cityoforlando.net) |
| `configs/philadelphia-pa.yml` | arcgis (Philadelphia ~5M historical) |
| `configs/wake-county-nc.yml` | arcgis (Raleigh metro maps.wake.gov MapServer) |

## 2. Deploy command (run from your Windows / WSL machine)

```bash
# From the repo root on your Windows box
cd "C:\Users\yabis\Desktop\Henri App"

# Tarball just this batch and ship it
tar czf hetzner-2026-05-07.tar.gz \
  scripts/_sidecar_loaders/load_citizenserve.py \
  scripts/_sidecar_loaders/load_mygovonline.py \
  scripts/_sidecar_loaders/load_lien_recorder.py \
  scripts/_sidecar_loaders/configs/allegheny-county-pa.yml \
  scripts/_sidecar_loaders/configs/ga-gsccca.yml \
  scripts/_sidecar_loaders/configs/gulfport-ms.yml \
  scripts/_sidecar_loaders/configs/mecklenburg-county-nc.yml \
  scripts/_sidecar_loaders/configs/miami-dade-fl.yml \
  scripts/_sidecar_loaders/configs/miami-fl.yml \
  scripts/_sidecar_loaders/configs/orlando-fl.yml \
  scripts/_sidecar_loaders/configs/philadelphia-pa.yml \
  scripts/_sidecar_loaders/configs/wake-county-nc.yml

# Push to the box (uses your existing SSH key)
scp -i $HOME/.ssh/henri_sidecar hetzner-2026-05-07.tar.gz henri@5.78.152.250:~/

# Unpack on the box
ssh -i $HOME/.ssh/henri_sidecar henri@5.78.152.250 \
  "tar xzf hetzner-2026-05-07.tar.gz --strip-components=1 -C ~/scrapling_loaders/ \
   && rm hetzner-2026-05-07.tar.gz \
   && ls -la ~/scrapling_loaders/load_*.py ~/scrapling_loaders/configs/*.yml | tail -25"
```

## 3. Per-loader smoke-tests (run on the box)

The cron will not fire any of these until you flip each YAML's
`status: unverified` → `status: verified` after a successful one-off run.

```bash
# SSH in
ssh -i $HOME/.ssh/henri_sidecar henri@5.78.152.250

# (on the box)
source ~/scrapling-env/bin/activate

# Sample probe — each command should print "wrote N rows" with N > 0.
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_arcgis.py allegheny-county-pa
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_arcgis.py wake-county-nc
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_arcgis.py mecklenburg-county-nc
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_arcgis.py miami-dade-fl
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_arcgis.py philadelphia-pa
python ~/scrapling_loaders/load_socrata.py miami-fl
python ~/scrapling_loaders/load_socrata.py orlando-fl
python ~/scrapling_loaders/load_mygovonline.py gulfport-ms
python ~/scrapling_loaders/load_lien_recorder.py ga-gsccca
```

For each loader that returns rows: edit its YAML config and change
`status: unverified` to `status: verified`. After that the existing
`--all-arcgis` / `--all-socrata` / `--all-mygovonline` / `--all-lien_recorder`
cron lines will pick it up.

## 4. New cron lines to add (after smoke-tests pass)

```cron
# Add these to crontab on the Hetzner box, alongside the existing
# Socrata/EnerGov/ArcGIS/Phase-4 cron lines. Stagger past :30 so they
# don't collide with the existing Socrata pull at :30.

# Every 4h at :45 — citizenserve (long-tail, larger fleet so spread)
45 */4 * * * /home/henri/scrapling_loaders/run.sh load_citizenserve.py --all-citizenserve >> /home/henri/scrapling-loaders.log 2>&1

# Daily 05:00 UTC — MGO (slower to scrape, smaller fleet)
0 5 * * * /home/henri/scrapling_loaders/run.sh load_mygovonline.py --all-mygovonline >> /home/henri/scrapling-loaders.log 2>&1

# Daily 05:30 UTC — county recorder lien feeds (gsccca first, more states later)
30 5 * * * /home/henri/scrapling_loaders/run.sh load_lien_recorder.py --all-lien_recorder >> /home/henri/scrapling-loaders.log 2>&1
```

## 5. Verify ingest landed

After the first successful smoke-test run, hop into Supabase and check
row counts:

```sql
-- ArcGIS-loader configs (Allegheny, Wake, Mecklenburg, Miami-Dade, Philly)
SELECT source_city, COUNT(*) AS permits_today
FROM permits
WHERE source_city IN ('Pittsburgh','Raleigh','Charlotte','Miami','Philadelphia')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_city;

-- Socrata-loader configs (Miami city + Orlando)
SELECT source_city, COUNT(*) AS permits_today
FROM permits
WHERE source_city IN ('Miami','Orlando')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY source_city;

-- New lien recorder table (after gsccca smoke-test)
SELECT recording_state, COUNT(*) AS rows
FROM liens_county_recorder
GROUP BY recording_state;
```
