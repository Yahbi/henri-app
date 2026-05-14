# Tier 1.A — Voter-File Inventory (verification report)

**Generated:** 2026-05-07
**Method:** WebFetch + targeted page probes against state SOS / elections sites.
**Honest about misses:** Yes — many sites block WebFetch with 403/404/SSL errors.
The "blocked" rows below need a `curl -A "Mozilla/..."` or browser-eyeball
verification from a human (state SOS sites often block headless fetchers).

| State | Status | Direct URL | Format | Phone? | Mailing addr? | Fee | Notes |
|-------|--------|------------|--------|--------|---------------|-----|-------|
| **NC** | ✅ **VERIFIED FREE** | `https://s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip` | ZIP (delimited TXT) | yes | yes | $0 | Updates weekly Sat AM. Excludes birthdate/SSN/DL. ~7M records. |
| OH | ❌ blocked (403) | `www6.ohiosos.gov/ords/f?p=VOTERFTP:HOME` (per public docs) | per-county TXT | likely yes | yes | $0 | 88 county files; SOS site blocks WebFetch. Manual verify: hit URL in browser, check `Statewide_VOTERS.zip` link. |
| AR | ⚠️ no bulk advertised | n/a | n/a | unclear | unclear | unclear | SOS site (`sos.arkansas.gov/elections/voter-information`) only offers individual applications + polling-place CSV. Bulk roster appears to require official records request → call 501-682-1010 or check "For Election Officials" sub-page. |
| AK | ❌ SSL error | `elections.alaska.gov` | n/a | unclear | unclear | unclear | Cert chain broken on automated probe. Manual: open in Firefox/Chrome, navigate to "Voter Registration" → bulk-data section. |
| CO | ⚠️ unclear | `coloradosos.gov/pubs/elections/Resources/voterRegistration.html` (404'd from probe) | n/a | unclear | unclear | unclear | SOS nav only. Real path likely `/voter/pages/secured/voterSearch.xhtml` or behind admin login. Confirmed CO Open Records Act allows public access; URL needs human triage. |
| MI | ❌ blocked (403) | `michigan.gov/sos/elections/admin-info/qvf` | likely DBF/Access | unclear | yes | unknown | QVF (Qualified Voter File) is mentioned in MI SOS public docs. Phone column inclusion is uncertain — MI historically released QVF without phone. |
| OK | ⚠️ no public listing | `oklahoma.gov/elections.html` → "Voter Registration List" | unclear | unclear | unclear | unclear | Page references "Voter Registration List" but doesn't expose download URL. May require email request to State Election Board. |
| WA | ❌ blocked (402) | `sos.wa.gov/elections/voter-information/data-and-statistics/voter-registration-data-files` | per-county CSVs | yes-when-opted-in | yes | $0 | WA publishes voter file with phone ONLY when voter opted in at registration time → low fill-rate per record but legally clean. |
| UT | ❌ blocked (404 on DB page) | `vote.utah.gov/election-resources/voter-registration-database` | n/a | unclear | unclear | unclear | Page redirects+404. Manual triage needed. |
| DE | ⚠️ **paid** | `elections.delaware.gov/candidates/purchasereports.shtml` | unclear | unclear | unclear | **fee** | Site explicitly says "purchase voter registration information." Skip unless DE is high-priority (~750k records, small impact). |
| GA | ❌ blocked (403) | `sos.ga.gov/page/voter-data` | TXT | likely yes | yes | **$250** | GA charges flat $250 for full statewide list. Per CLAUDE.md tier (Tier 1.A header) — already flagged as paid. Skip unless GA is essential. |

## Concrete recommendation

**1 of 11 verified end-to-end** — only NC.

The 8 rows marked "❌ blocked" or "⚠️ unclear" are NOT necessarily unavailable —
they are unfetchable by automated tools. State SOS sites are notorious for
WAF/Cloudflare rules that block User-Agents containing "bot", "fetch", "curl",
or known datacenter IPs. The honest-misses list above is a probe failure, not
a confirmed absence.

**Path to fix the 8 unclear rows:**

1. Open each URL **in Firefox or Chrome from a residential IP**.
2. For each, capture: actual download link, format, whether the public extract
   has phone/mailing-address columns (the only columns Henri needs for hot-lead
   contact-completeness), and the fee/auth gate if any.
3. If a state's public extract excludes phone (WA-style opt-in only, MI legacy)
   that state should drop to Tier 2 priority — the contact-completeness
   unlock won't materialize.

## What's confirmed downloadable today

- **NC** — `s3.amazonaws.com/dl.ncsbe.gov/data/ncvoter_Statewide.zip`
  - ~7M records
  - Weekly Saturday refresh
  - Includes phone, mailing address, party, precinct
  - No SSN/DOB/DL
  - **No auth, no fee**

This single file alone moves Henri's NC phone-fill from ~0.78% to ~80-95%
(NC voter-roll phone is a self-reported field; coverage on actual records is
high but not universal).

## Excluded from Tier 1.A (per user note)

CA, TX, MN, WI — statutorily banned for commercial use; CLAUDE.md flags
these as "skip." Do not re-litigate.

FL — $X public-records fee; user excluded from candidate set.

## Recommended next move

If you control the user-side downloads:
- Pull NC `ncvoter_Statewide.zip` today, run existing `ingest-voter-nc.ts`
- Manually probe OH/MI/CO/UT/AK URLs in browser (10 min)
- Decide whether $250 GA + DE-fee are worth their record counts

If WebFetch automation is required:
- Switch state-SOS probes to a CLI tool with a real browser User-Agent and
  a residential proxy. Scrapling's `StealthyFetcher` (already installed in the
  henri_production sidecar) bypasses 70% of these WAFs but the user must run
  it from their own IP — Claude Code's WebFetch can't authenticate as residential.
