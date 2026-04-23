---
description: Phase 0a wedge readiness report — what's live, what's waiting on migrations, what's next.
---

Print a concise status of the Phase 0 wedge (the 10 contractor pain points from the plan). Use the Supabase admin client to check actual DB state.

## Data to gather

### 1. Migration state
Check if each wedge table exists:
```
npx tsx -e "
import {createClient} from '@supabase/supabase-js';
import * as dotenv from 'dotenv'; dotenv.config({path:'.env.local'});
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
for (const t of ['lead_exclusivity_locks','permit_events','missed_call_events','pre_permit_signals','market_intel_zip','contractor_interviews']) {
  const {error}=await s.from(t).select('id',{count:'estimated',head:true});
  console.log(t.padEnd(28), error ? 'missing' : 'ok');
}
"
```

### 2. Feature-flag readiness (columns on existing tables)
```
npx tsx -e "
import {createClient} from '@supabase/supabase-js';
import * as dotenv from 'dotenv'; dotenv.config({path:'.env.local'});
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const {error:scoreErr}=await s.from('leads').select('score_signals',{head:true}).limit(1);
const {error:capErr}=await s.from('profiles').select('capacity_prefs',{head:true}).limit(1);
console.log('leads.score_signals    ', scoreErr ? 'missing' : 'ok');
console.log('profiles.capacity_prefs', capErr ? 'missing' : 'ok');
"
```

### 3. UI surface liveness
For each wedge feature, report whether the UI is wired, whether the DB backs it, and the gap:
- Pain #1 exclusivity lock — check `src/components/dashboard/LeadCard.tsx` imports `ExclusivityBadge`
- Pain #2 score transparency — check `src/components/dashboard/LeadDetailDrawer.tsx` imports `ScoreSignalBreakdown`
- Pain #4 pre-permit map overlay — check `src/components/map/PrePermitSignalLayer.tsx` exists
- Pain #5 permit-events timeline — check drawer for `permit_events` fetch
- Pain #6 missed-call text-back — check `src/app/api/webhooks/twilio-missed-call/route.ts`
- Pain #7 capacity filter — check `src/components/dashboard/CapacityFilterBar.tsx` referenced in LeadsPanel
- Pain #9 market intel panel — check `src/components/dashboard/MarketIntelPanel.tsx` rendered in Intel tab
- Pain #10 permit-specific templates — check `outreach_templates` seed rows for trade=roofing/hvac/plumbing/electrical

### 4. Env readiness
Echo which secrets are set (redact values):
```
cd "C:/Users/yabis/Desktop/Henri App" && awk -F'=' '/^(RESEND_API_KEY|TWILIO_AUTH_TOKEN|SUPABASE_ACCESS_TOKEN|DATABASE_URL)/ { print $1, (length($2)>0 ? "set" : "EMPTY") }' .env.local
```

## Report format

```
=== Phase 0a wedge status ===

Migrations
  00031_wedge_trust         [✓ applied | ✗ pending — paste sql]
  00032_pre_permit_intel    [...]

Columns
  leads.score_signals       [...]
  profiles.capacity_prefs   [...]

UI surfaces
  #1 Exclusivity lock       [wired in UI, DB pending | fully live | not yet]
  #2 Score transparency     [wired in UI, fallback rendering | fully live]
  #4 Pre-permit overlay     [not built]
  #5 Permit-events timeline [not built]
  #6 Missed-call text-back  [not built]
  #7 Capacity filter        [wired in UI + Settings]
  #9 Market intel           [not built]
  #10 Permit-specific       [seeds pending]

Env secrets
  RESEND_API_KEY            [EMPTY — outreach/PDF delivery blocked]
  TWILIO_AUTH_TOKEN         [EMPTY — missed-call text-back blocked]
  SUPABASE_ACCESS_TOKEN     [EMPTY — /migrate blocked]

Next unlock (biggest value per hour):
  1. Fill SUPABASE_ACCESS_TOKEN → run /migrate → activates 7 UI surfaces
  2. Fill RESEND_API_KEY → feedback + outreach deliver
  3. ...
```

End with one clear recommendation: which env/migration unlock moves the most features from "wired" to "live".
