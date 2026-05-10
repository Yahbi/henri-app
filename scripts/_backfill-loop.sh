#!/bin/bash
# Wrap _backfill-intent.mjs in a retry loop. The script's "empty page" check
# fires on transient API errors (Management API returns [] silently when
# saturated). We restart from the last cursor each loop until either:
#   - 8 successive attempts return cursor at/near ffff (real end of table)
#   - 30 total iterations (safety cap)
#
# Usage: bash scripts/_backfill-loop.sh [start-after-id]

cd "$(dirname "$0")/.."
START_AFTER="${1:-59000000-0000-0000-0000-000000000000}"
MAX_ITER=30
END_THRESHOLD="fff00000-0000-0000-0000-000000000000"
LOG=/tmp/backfill-loop.log
> "$LOG"

iter=0
while [ "$iter" -lt "$MAX_ITER" ]; do
  iter=$((iter + 1))
  echo "=== iter $iter, start-after-id=$START_AFTER ===" | tee -a "$LOG"
  npx tsx scripts/_backfill-intent.mjs --start-after-id="$START_AFTER" 2>&1 | tee -a "$LOG"

  # Extract last "empty page after id > X" cursor
  LAST_CURSOR=$(grep -oE "empty page after id > [a-f0-9-]+" "$LOG" | tail -1 | awk '{print $NF}')
  if [ -z "$LAST_CURSOR" ]; then
    echo "no empty-page cursor found — stopping" | tee -a "$LOG"
    break
  fi

  # Stop if cursor is at the very end of the table (ffff prefix)
  if [[ "$LAST_CURSOR" > "$END_THRESHOLD" ]]; then
    echo "cursor $LAST_CURSOR past end-threshold $END_THRESHOLD — done" | tee -a "$LOG"
    break
  fi

  # If the cursor didn't advance, sleep + retry from same point (transient)
  if [ "$LAST_CURSOR" = "$START_AFTER" ]; then
    echo "cursor stuck at $START_AFTER — sleeping 8s before retry" | tee -a "$LOG"
    sleep 8
  fi
  START_AFTER="$LAST_CURSOR"
done
echo "=== done after $iter iterations, last cursor=$START_AFTER ===" | tee -a "$LOG"
