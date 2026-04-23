/**
 * Phase 3b — Build address_permit_history from Supabase permits.
 *
 * Reads the permits table (just-loaded in Phase 3a), groups by normalized
 * address, and upserts per-address rollups into address_permit_history.
 *
 * Consumed by the scorer to populate leads.permit_history, cascade_flag,
 * cascade_count, pipeline_value.
 *
 * Run:  npx tsx scripts/build-address-history.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const PAGE = 500;
const UPSERT_BATCH = 500;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type PermitRow = {
  id: string;
  source_city: string;
  source_id: string;
  permit_number: string | null;
  permit_type: string;
  status: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  estimated_value: number | null;
  applied_date: string | null;
  issued_date: string | null;
  raw_json: Record<string, unknown> | null;
};

type HistoryRow = {
  address_norm: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  permit_count: number;
  total_value: number | null;
  first_permit_date: string | null;
  last_permit_date: string | null;
  trades: string[];
  permits: Array<Record<string, unknown>>;
};

function normAddress(address: string | null | undefined, zip: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return null;
  return `${trimmed}|${zip ?? ""}`;
}

async function main() {
  console.log("Aggregating permits → address_permit_history…");

  const agg = new Map<string, HistoryRow>();
  let lastId: string | null = null;
  let totalRead = 0;

  while (true) {
    // Keyset pagination on id (uuid) — avoids OFFSET scan timeouts.
    let query = supabase
      .from("permits")
      .select(
        "id, source_city, source_id, permit_number, permit_type, status, address, city, state, zip, estimated_value, applied_date, issued_date, raw_json",
      )
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    lastId = data[data.length - 1].id as string;

    for (const raw of data as PermitRow[]) {
      const key = normAddress(raw.address, raw.zip);
      if (!key) continue;
      const trade = (raw.raw_json?.normalized_trade as string | undefined) ?? "general";
      const date = raw.issued_date || raw.applied_date || null;

      const permitEntry = {
        permit_number: raw.permit_number ?? raw.source_id,
        permit_type: raw.permit_type,
        status: raw.status,
        applied_date: raw.applied_date,
        issued_date: raw.issued_date,
        value: raw.estimated_value,
        trade,
      };

      let row = agg.get(key);
      if (!row) {
        row = {
          address_norm: key,
          address: raw.address,
          city: raw.city,
          state: raw.state,
          zip: raw.zip,
          permit_count: 0,
          total_value: null,
          first_permit_date: null,
          last_permit_date: null,
          trades: [],
          permits: [],
        };
        agg.set(key, row);
      }
      row.permit_count += 1;
      if (raw.estimated_value != null) {
        row.total_value = (row.total_value ?? 0) + raw.estimated_value;
      }
      if (date) {
        if (!row.first_permit_date || date < row.first_permit_date) row.first_permit_date = date;
        if (!row.last_permit_date || date > row.last_permit_date) row.last_permit_date = date;
      }
      if (!row.trades.includes(trade)) row.trades.push(trade);
      // Cap permits array at 10 to keep jsonb small (pick most recent later)
      row.permits.push(permitEntry);
    }

    totalRead += data.length;
    if (totalRead % 10000 < PAGE) {
      console.log(`  read ${totalRead.toLocaleString()} permits, ${agg.size.toLocaleString()} unique addresses`);
    }
    if (data.length < PAGE) break;
  }

  console.log(
    `Read ${totalRead.toLocaleString()} permits → ${agg.size.toLocaleString()} unique addresses`,
  );

  // For each address, keep only the 10 most-recent permits in the jsonb array
  // (sorted by issued_date || applied_date desc). Total_value is still sum of all.
  for (const row of agg.values()) {
    row.permits.sort((a, b) => {
      const ad = (a.issued_date as string) || (a.applied_date as string) || "";
      const bd = (b.issued_date as string) || (b.applied_date as string) || "";
      return bd.localeCompare(ad);
    });
    if (row.permits.length > 10) row.permits = row.permits.slice(0, 10);
  }

  // Upsert in batches
  const all = [...agg.values()];
  let done = 0;
  for (let i = 0; i < all.length; i += UPSERT_BATCH) {
    const chunk = all.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase
      .from("address_permit_history")
      .upsert(chunk, { onConflict: "address_norm" });
    if (error) {
      console.error(`Batch ${i} failed:`, error.message);
      // Fall back to one-by-one
      for (const row of chunk) {
        const { error: e2 } = await supabase
          .from("address_permit_history")
          .upsert(row, { onConflict: "address_norm" });
        if (e2) console.warn(`  skip ${row.address_norm}:`, e2.message);
      }
    }
    done += chunk.length;
    if (done % 5000 < UPSERT_BATCH) console.log(`  upsert ${done}/${all.length}`);
  }

  const { count } = await supabase
    .from("address_permit_history")
    .select("*", { count: "exact", head: true });
  const { count: cascadeCount } = await supabase
    .from("address_permit_history")
    .select("*", { count: "exact", head: true })
    .gte("permit_count", 2);
  console.log(
    `Done. address_permit_history rows: ${count} (cascade candidates with ≥2 permits: ${cascadeCount})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
