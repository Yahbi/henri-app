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

```
30 */4 * * * /home/henri/scrapling_loaders/run.sh load_austin.py >> /home/henri/scrapling-loaders.log 2>&1
```

to:

```
30 */4 * * * /home/henri/scrapling_loaders/run.sh load_socrata.py --all >> /home/henri/scrapling-loaders.log 2>&1
```

Save & exit. The next 4-hour mark will pull from every verified city.
