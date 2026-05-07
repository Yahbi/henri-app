# Uploading the loader bundle to the Hetzner sidecar

After `git pull` on the Henri repo, run these two commands from your
**Windows PowerShell** (no SSH session needed for SCP):

## 1. Upload the loaders + configs

```powershell
scp -i $HOME\.ssh\henri_sidecar -r "C:\Users\yabis\Desktop\Henri App\scripts\_sidecar_loaders\*" henri@5.78.152.250:~/scrapling_loaders/
```

If PowerShell rejects the `*`, fall back to:

```powershell
scp -i $HOME\.ssh\henri_sidecar -r "C:\Users\yabis\Desktop\Henri App\scripts\_sidecar_loaders" henri@5.78.152.250:~/scrapling_loaders_new
```

…then SSH in and merge:

```bash
cp -r ~/scrapling_loaders_new/* ~/scrapling_loaders/
rm -rf ~/scrapling_loaders_new
```

## 2. Install the YAML library inside the venv

```bash
ssh -i $HOME\.ssh\henri_sidecar henri@5.78.152.250
```

Then on the box:

```bash
source ~/scrapling-env/bin/activate
pip install pyyaml
```

## 3. Smoke-test the generic loader against Austin

The verified config:

```bash
set -a && source ~/.henri-sidecar.env && set +a
python ~/scrapling_loaders/load_socrata.py austin
```

Expected output: same as before, ~50 rows in <2s.

## 4. Probe one of the unverified cities

Pick any city YAML from `configs/` and run the probe to see the real
column names BEFORE running the loader (saves 400 errors):

```bash
python ~/scrapling_loaders/probe_socrata.py "https://data.cityofnewyork.us/resource/ipu4-2q9a.json"
```

The output is a sorted list of all keys + values. Compare against
`configs/nyc-dob.yml` and edit the field mappings to match.

Then test:

```bash
python ~/scrapling_loaders/load_socrata.py nyc-dob
```

If it errors, the error message tells you which column doesn't exist —
fix it in the YAML, re-run.

## 5. Once verified, run all configs sequentially

```bash
python ~/scrapling_loaders/load_socrata.py --all
```

This iterates every YAML in `configs/`, runs each, prints a per-city
summary. Bad configs are skipped (they print errors but don't kill
the run).

## 6. Update the cron to fire `--all` instead of just Austin

```bash
crontab -e
```

Change the line:

```cron
30 */4 * * * /home/henri/scrapling_loaders/run.sh load_austin.py >> /home/henri/scrapling-loaders.log 2>&1
```

to:

```cron
30 */4 * * * /home/henri/scrapling_loaders/run.sh load_socrata.py --all >> /home/henri/scrapling-loaders.log 2>&1
```

Save & exit. The next 4-hour mark will pull from every verified city.

## 7. Phase 2 — Tyler EnerGov loader (added 2026-05-05)

`load_energov.py` mirrors the Socrata loader's shape but speaks Tyler
EnerGov's `/api/v2/Records/Search` POST contract. ~80 cities (especially
TX, GA, NC, FL) run on Tyler, so this is the highest-leverage Phase 2
addition.

Smoke-test a single energov city after upload:

```bash
python ~/scrapling_loaders/load_energov.py atlanta-energov
```

Expected: real cities first need a probe pass (the YAML's `status:
unverified` is the marker). Open the city's citizen-portal Search page
in a browser, watch the Network tab while submitting an empty search,
copy the actual POST URL + body keys into the YAML, then re-run.

Once verified, add to a separate cron line so Tyler failures don't
block the Socrata schedule:

```cron
0  */4 * * * /home/henri/scrapling_loaders/run.sh load_energov.py --all-energov >> /home/henri/scrapling-loaders.log 2>&1
```

(Note: `:00` past the hour for energov, `:30` past for Socrata — staggers
the load on Supabase.)

## 8. ZERO-COST API-key checklist (for Vercel env)

After upload + smoke-test, these env-var keys close the contact-fill
gap without spending a dollar. All have free tiers wired into
`src/lib/enrichment/orchestrator.ts` already — only provisioning is
needed.

| Vercel env var | Provider signup | Free quota | What it fills |
| --- | --- | --- | --- |
| `HUNTER_API_KEY` | hunter.io/sign-up | 25 searches/mo | Email guess from contractor name |
| `GOOGLE_PLACES_API_KEY` | console.cloud.google.com → Places API | $200/mo credit (~10k req) | Phone + business hours + website |
| `OPENCORPORATES_API_KEY` | opencorporates.com/users/sign_up | 500/day | LLC principal lookup |
| `FEC_API_KEY` | api.fec.gov/developers | 1,000/hour | Owner name + employer + occupation (donor records) |
| `NUMVERIFY_API_KEY` | numverify.com (already documented in CLAUDE.md) | 100/mo | Phone format + line type |
| `CLOUDMERSIVE_API_KEY` | cloudmersive.com | 800/mo | Phone + address validation |
| `CL_TOKEN` | courtlistener.com → Profile → API | unlimited | Mechanic-lien dockets (already-empty `liens_courtlistener` table) |

Apollo (`APOLLO_API_KEY`) is intentionally **excluded** — paid floor.
Defer until first MRR funds it.

After provisioning, redeploy Vercel to pick up the new env. The next
`enrich-sweep` cron will pick up where it left off — `applyField()` is
idempotent.

## 9. Phase 1.5 — voter-file ingest (NC + OH only, FREE)

These run *locally* on your dev machine, not on Hetzner. The TS scripts
already exist (`scripts/ingest-voter-{nc,oh}.ts`) and do streamed
upserts (resumable, batch=5000).

```bash
# NC — free direct download
curl -O https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip
unzip ncvoter_Statewide.zip          # → ncvoter_Statewide.txt
npx tsx scripts/ingest-voter-nc.ts ./ncvoter_Statewide.txt

# OH — free direct download
# Visit https://www6.ohiosos.gov/ords/f?p=111:1 and grab SWVF_*.csv
npx tsx scripts/ingest-voter-oh.ts ./SWVF_1_22.csv
```

**Skip FL voter** until you decide whether to pay the public-records fee.

After ingest completes, kick the enrichment cron once to fan out the
new voter rows over existing leads:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://meethenri.com/api/cron/enrich-sweep
```

The `voter_file_local` enricher in orchestrator.ts will start hitting
the new tables immediately — no code change required.

## 10. Phase 3 — ArcGIS REST loader (added 2026-05-06)

`load_arcgis.py` mirrors the Socrata loader's shape but speaks the
ArcGIS FeatureServer/MapServer query contract. Verified configs
shipped: `detroit-mi`, `minneapolis-mn`, `st-paul-mn`, `nashua-nh`,
`vt-act250-statewide`, `nashville-tn`, `knoxville-tn`, `bozeman-mt`.

Smoke-test a single ArcGIS city:

```bash
python ~/scrapling_loaders/load_arcgis.py detroit-mi
```

Add to crontab (stagger from Socrata + EnerGov):

```cron
15 */4 * * * /home/henri/scrapling_loaders/run.sh load_arcgis.py --all-arcgis >> /home/henri/scrapling-loaders.log 2>&1
```

NJ DCA statewide is via the Socrata loader (one endpoint, 2.7M rows).
For the initial backfill, run a date-filtered version manually so
the default 1000-row pull doesn't truncate history.

## 11. Phase 4 — stealth scrapers (added 2026-05-07)

Phase 4 covers the platforms with no public REST: Accela ACA,
Tyler eTRAKiT, SmartGov, Tyler EnerGov SelfService. These run via
Camoufox + Scrapling DynamicFetcher and need an extra Hetzner step
to install the browser:

```bash
source ~/scrapling-env/bin/activate
python -m playwright install chromium firefox
# Camoufox uses Firefox under the hood; Chromium is the fallback.
```

Each Phase 4 scraper has its own `--all-<platform>` mode:

```bash
python ~/scrapling_loaders/load_accela.py --all-accela
python ~/scrapling_loaders/load_etrakit.py --all-etrakit
python ~/scrapling_loaders/load_smartgov.py --all-smartgov
python ~/scrapling_loaders/load_energov_ss.py --all-energov-ss
```

**ALL Phase 4 configs ship with `status: unverified`.** They will NOT
fire under `--all-<platform>` until you explicitly mark them
`status: verified` after a successful per-tenant smoke test.

### Per-tenant smoke-test workflow

For each new Phase 4 config:

```bash
# 1. Dry-run with HTML debug enabled
DEBUG_HTML_DUMP=1 python ~/scrapling_loaders/load_accela.py clark-county-nv

# 2. Inspect output:
#    - Did the scraper return rows? (non-zero count)
#    - Are columns aligned correctly? (check raw_json in DB)
#    - If form-fill failed, ~/accela-debug-CLARK-COUNTY-NV.html
#      shows the post-search HTML — fix the YAML's `field_*`
#      selectors to match.

# 3. Once verified, edit the YAML: status: unverified -> status: verified
# 4. Re-run without DEBUG_HTML_DUMP — it should now run silently.
# 5. Add to the --all-<platform> rotation by virtue of status:verified.
```

### Cron schedule for Phase 4 (after verification)

Phase 4 scrapers are SLOW (2-5 min per tenant via headless browser).
DON'T fire them all at the same `:15` minute mark — stagger:

```cron
# Phase 4: stealth scrapers (run in dedicated daily windows)
0  3  * * * /home/henri/scrapling_loaders/run.sh load_accela.py     --all-accela     >> /home/henri/scrapling-loaders.log 2>&1
30 3  * * * /home/henri/scrapling_loaders/run.sh load_etrakit.py    --all-etrakit    >> /home/henri/scrapling-loaders.log 2>&1
0  4  * * * /home/henri/scrapling_loaders/run.sh load_smartgov.py   --all-smartgov   >> /home/henri/scrapling-loaders.log 2>&1
30 4  * * * /home/henri/scrapling_loaders/run.sh load_energov_ss.py --all-energov-ss >> /home/henri/scrapling-loaders.log 2>&1
```

Each window is 30 minutes apart so even if a scraper hangs on
Camoufox startup, it won't block the next one.

### Phase 4 inventory

| Loader | Tenants | Configs |
|---|---|---|
| `load_accela.py` | NV (Clark, LV, Reno, Washoe, NLV, Sparks), UT (SLC), MT (Missoula), OK (OKC) | 9 |
| `load_etrakit.py` | ME (Portland) | 1 |
| `load_smartgov.py` | WY (Teton/Jackson) | 1 |
| `load_energov_ss.py` | NV (Henderson) | 1 |

OpenGov ViewPoint is intentionally NOT scraped. See
`docs/permit-catalog/opengov-viewpoint-partnership-2026-05-07.md` —
that's a partnership path, not a scraping path.
