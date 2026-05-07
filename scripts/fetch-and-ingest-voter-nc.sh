#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# fetch-and-ingest-voter-nc.sh — one-shot NC voter-file refresh
#
# Per research/SUMMARY-2026-05-07.md item #2: pulls the verified-free
# NC SBE statewide voter extract (~7M records, weekly Sat refresh,
# includes phone + mailing address) and runs the existing
# `scripts/ingest-voter-nc.ts` ingester against it.
#
# Verified-free direct URL — no auth, no fee, no signup:
#   https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip
#
# Usage:
#   bash scripts/fetch-and-ingest-voter-nc.sh
#
# What it does:
#   1. Downloads the zip to /tmp (or $TMPDIR) — atomic via .partial suffix
#   2. Verifies the file is a real ZIP (not an HTML error page)
#   3. Unzips to ncvoter_Statewide.txt
#   4. Calls scripts/ingest-voter-nc.ts with the file path
#   5. Cleans up /tmp on success
#
# Safe to run weekly via cron after the Saturday morning NC refresh:
#   30 8 * * SUN  bash /home/henri/Henri\ App/scripts/fetch-and-ingest-voter-nc.sh
#
# Env tuning (passed through to ingest-voter-nc.ts):
#   BATCH   — upsert batch size (default 5000)
#   MAX     — cap row count (default unlimited; useful for first-run smoke)
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

TMPDIR="${TMPDIR:-/tmp}"
ZIP_URL="https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip"
ZIP_PATH="$TMPDIR/ncvoter_Statewide.zip"
TXT_PATH="$TMPDIR/ncvoter_Statewide.txt"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INGESTER="$REPO_ROOT/scripts/ingest-voter-nc.ts"

if [[ ! -f "$INGESTER" ]]; then
  echo "ingester not found at $INGESTER" >&2
  exit 1
fi

echo "[1/4] downloading $ZIP_URL"
# --fail   — exit 22 on HTTP error instead of saving the error page as the file
# --silent — quiet; rely on stderr for failures
# --show-error — print errors even when --silent
# --location — follow redirects
curl --fail --silent --show-error --location -o "$ZIP_PATH.partial" "$ZIP_URL"
mv "$ZIP_PATH.partial" "$ZIP_PATH"

echo "[2/4] verifying ZIP integrity"
unzip -tq "$ZIP_PATH"

echo "[3/4] extracting"
# -o overwrite without prompting; -d sets output dir
unzip -oq "$ZIP_PATH" ncvoter_Statewide.txt -d "$TMPDIR"

if [[ ! -f "$TXT_PATH" ]]; then
  echo "expected $TXT_PATH after unzip; did the file rename upstream?" >&2
  exit 1
fi

echo "[4/4] ingesting via npx tsx $INGESTER"
cd "$REPO_ROOT"
npx tsx "$INGESTER" "$TXT_PATH"

echo "[done] cleaning up"
rm -f "$ZIP_PATH" "$TXT_PATH"
echo "NC voter ingest complete. Resume state: scripts/.ingest-voter-nc.state.json"
