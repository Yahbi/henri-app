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
|---|---|---|---|
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
