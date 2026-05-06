/**
 * Quick null-rate snapshot for leads enrichment fields.
 * Used by the /enrich runbook to capture a before/after delta.
 *
 * Run: npx tsx scripts/_enrich-stats.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Node 24 + supabase-js aborts sometimes surface as UnhandledPromise-
// Rejection when a count query times out. Convert to a warning so the
// script can still print its partial report instead of dying mid-run.
process.on("unhandledRejection", (reason) => {
  console.warn(
    "(unhandled rejection suppressed — likely a supabase AbortController race)",
    reason instanceof Error ? reason.message : String(reason),
  );
});

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * Count a column's non-null rate. Tries `count=estimated` first (fast,
 * planner-based); falls back to null on any error. Also catches the
 * Node 24 + supabase-js AbortController race that sometimes leaks past
 * the await even inside a try/catch — we wrap in a Promise.race with
 * an explicit timeout so the script never hangs indefinitely.
 */
async function safeCount(
  col: string,
  filter: "non-null" | "all",
  timeoutMs = 15_000,
): Promise<number | null> {
  try {
    const queryPromise = (async () => {
      let q = s.from("leads").select(col, { count: "estimated", head: true });
      if (filter === "non-null") q = q.not(col, "is", null);
      const { count, error } = await q;
      if (error) return null;
      return count ?? 0;
    })();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs),
    );
    return await Promise.race([queryPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

async function totalCount(): Promise<number | null> {
  return safeCount("id", "all");
}

(async () => {
  const total = await totalCount();
  if (total == null) {
    console.log("total leads: ERROR (query timed out or failed)");
  }
  const fields = [
    "owner_name",
    "owner_first",
    "owner_last",
    "phone",
    "email",
    "year_built",
    "home_sqft",
    "lot_sqft",
    "assessed_value",
    "property_value",
    "mailing_address",
    "owner_occupied",
    "latitude",
    "contact_source",
  ];
  if (total != null) {
    console.log(`total leads: ${total.toLocaleString()}`);
  }
  console.log("");
  console.log("field                  | non-null | pct");
  console.log("-----------------------+----------+------");
  for (const col of fields) {
    const n = await safeCount(col, "non-null");
    if (n == null) {
      console.log(`${col.padEnd(22)} | TIMEOUT  |  ?   `);
    } else {
      const pct =
        total && total > 0 ? ((n / total) * 100).toFixed(1) : "0.0";
      console.log(
        `${col.padEnd(22)} | ${n.toLocaleString().padStart(8)} | ${pct.padStart(4)}%`,
      );
    }
  }
})();
