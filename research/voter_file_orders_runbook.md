# Voter-file orders — manual mail-in runbook

Per research/tier1a_voter_files_v2.md, two states require a paper data-request
form mailed/emailed to the SOS office. Neither can be ordered programmatically
(no online checkout). This runbook walks the human steps to get the discs in
hand so the existing ingester pattern (`ingest-voter-nc.ts` shape) can run
against them.

Reminder of the current voter-file inventory after Tier 1.A:

| State | Status | Cost | Action |
|-------|--------|-----:|--------|
| **NC** | ✅ live (already wired) | $0 | run `bash scripts/fetch-and-ingest-voter-nc.sh` weekly |
| **OH** | ✅ live (already wired) | $0 | existing `ingest-voter-oh.ts` |
| **AR** | 📮 mail-in pending | $2.50 | follow §AR below |
| **CO** | 📮 mail-in pending | $50.00 | follow §CO below |
| **WA** | optional (10-20% phone-fill) | $0 | hold; ingest only if AR+CO under-deliver |
| AK · MI · OK · UT · DE · GA | ❌ confirmed dead | — | do not order |

---

## §AR — Arkansas SOS data-request form

**Cost:** $2.50 per file (covers media + handling; checks payable to "Arkansas
Secretary of State"). **Format:** CSV. **Refresh cadence:** monthly snapshot.
**Schema:** confirmed by Tier 1.A research to include `phone` and full
mailing address columns. **Approx record count:** 1.8M registered voters.

**Steps:**

1. Download the Arkansas Voter Registration Data Request Form (PDF) from
   https://www.sos.arkansas.gov/elections/voter-information/. The link is
   in the footer under "Voter Lists & Data."
2. Fill out the form. For the "intended use" field, write:
   *"Internal commercial-use lead-generation database. Will not be resold,
   redistributed, or used for political solicitation."*
   (Henri's use case is commercial; AR allows commercial use unlike CA/TX/MN/WI.)
3. Mail the completed form + a $2.50 check to:

       Arkansas Secretary of State
       Elections Division — Voter Registration Data
       500 Woodlane Avenue, Suite 256
       Little Rock, AR 72201

4. Estimated turnaround: 5-10 business days for a CD-ROM in the mail.
5. When the CD arrives:
   - Mount it; copy the `.csv` to `/tmp/arkansas_voter.csv`
   - Run a copy-of `ingest-voter-nc.ts` named `ingest-voter-ar.ts` —
     the schemas differ slightly (AR uses `phone_number` as the column
     name vs NC's `full_phone_number`), so the field-map needs one tweak
     before ingest. **Sketch:** after the CSV header is parsed in the
     ingester, log the actual column names; then update
     `phone: row.phone_number?.trim() || null` (NC uses `full_phone_number`).

**On the AR ingester (not yet built):** mirror `ingest-voter-nc.ts` line-for-
line; only the column-name map and the table name (`voter_ar`) differ.
Add a corresponding migration for `voter_ar` (matching `voter_nc` shape).

---

## §CO — Colorado SOS voter-file data set

**Cost:** $50.00 for one disc (one-time snapshot) **OR** $1,000.00 for a
2-year subscription with weekly updates. Recommended: start with the
$50 disc. **Format:** CSV. **Schema:** Tier 1.A confirms includes "phone
number (if provided by the voter)" + mailing address. Phone-fill rate
expected ~30-50% (CO doesn't require phone at registration). **Approx
record count:** 4.0M voters.

**Steps:**

1. Download the Voter Registration Data Request Form (PDF) from
   https://www.coloradosos.gov/pubs/elections/main.html (under "Election
   Data" — the form name is *"Application for Voter Registration Data."*)
2. Fill in:
   - **Use:** check "Commercial" (CO permits commercial use; the
     prohibition list does NOT include CO — confirm vs CLAUDE.md "skip
     CA/TX/MN/WI" rule)
   - **Format:** CSV preferred (some discs ship as TXT pipe-delimited;
     either works)
   - **Frequency:** Single Snapshot (start there; subscribe later if
     ingest cadence proves valuable)
3. Mail or hand-deliver:

       Colorado Secretary of State
       Elections Division — Voter Data
       1700 Broadway, Suite 550
       Denver, CO 80290

   Include a check for $50 payable to "Colorado Department of State."
4. Estimated turnaround: 3-5 business days for an in-state mail-back.
5. Run a copy-of `ingest-voter-nc.ts` named `ingest-voter-co.ts`. CO's
   column names use lowercase + underscores already (close to NC's
   layout); main differences: CO has a `precinct_number` int field and
   the phone column is named `phone_num`.

---

## Quick-reference: when the discs arrive

After both AR + CO ingests run successfully, expected combined fill-rate
lift on Henri's `phone` column:

- AR: ~1.8M records × ~70% phone fill = ~1.26M new phones
- CO: ~4.0M records × ~30-50% phone fill = ~1.2-2M new phones
- **Combined with existing NC (~5M phones already ingested):** Henri
  reaches roughly **8-9M total voter-file phone records** across NC + AR + CO.

This is the practical ceiling for the voter-file phone lever. Per the
SUMMARY-2026-05-07.md caveat: after these three ship, **don't chase more
voter files** — the next phone-source dollar should fund Numverify
($0/100/mo free tier already wired) or Apollo ($49/mo entry).

## Honest caveats

- **Do NOT order DE, GA, UT, AK, MI, OK voter files.** Tier 1.A confirmed
  these either redact phone in the public extract (DE, GA, MI, OK), or
  charge fees that exceed the marginal record-count value (UT $1,050,
  GA $250 + commercial-use ban that legally blocks Henri).
- **CA/TX/MN/WI are statutorily off-limits** per CLAUDE.md. Do not
  re-litigate.
- **WA is opt-in-phone-only** (10-20% fill). Hold off until AR+CO are
  live and we know whether a marginal 10% fill is worth $0 + ingester
  cost.
- The AR + CO discs include **historical inactive voters** (deceased,
  relocated). The ingester should set `is_active = (voter_status_desc
  IN ('ACTIVE', 'A'))` to avoid stale phone numbers polluting the
  high-confidence pool.
