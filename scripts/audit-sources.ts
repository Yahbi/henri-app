#!/usr/bin/env npx tsx
/* Inspect every row in permit_sources, probe live, and report health.
 * Shows which sources are live, which are broken, and why.
 *
 * Usage:
 *   npx tsx scripts/audit-sources.ts            # probe all sources
 *   npx tsx scripts/audit-sources.ts errors     # only sources with errors_count>0
 *   npx tsx scripts/audit-sources.ts <prefix>   # filter by source_key prefix
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const filter = process.argv[2];

type Src = {
  source_key: string;
  city: string;
  state: string;
  endpoint: string;
  source_type: string;
  error_count: number | null;
  last_scraped_at: string | null;
  id_field: string | null;
  type_field: string | null;
  status_field: string | null;
  address_field: string | null;
  date_field: string | null;
  value_field: string | null;
  lat_field: string | null;
  lng_field: string | null;
};

async function probe(src: Src): Promise<{ ok: boolean; status: string; note: string; sample?: unknown }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000);
  try {
    const url =
      src.source_type === "arcgis"
        ? `${src.endpoint}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=1&returnGeometry=true`
        : `${src.endpoint}?$limit=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Henri/1.0 audit",
        ...(src.source_type === "socrata" && process.env.SOCRATA_APP_TOKEN
          ? { "X-App-Token": process.env.SOCRATA_APP_TOKEN }
          : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: String(res.status), note: `HTTP ${res.status}` };
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { ok: false, status: "parse", note: "non-JSON" }; }
    if (typeof json === "object" && json !== null && "error" in json) {
      const e = (json as { error: { message?: string } }).error;
      return { ok: false, status: "arcgis-err", note: e?.message ?? "arcgis error" };
    }
    if (src.source_type === "arcgis") {
      const features = (json as { features?: unknown[] }).features ?? [];
      const attrs = (features[0] as { attributes?: Record<string, unknown> } | undefined)?.attributes ?? {};
      const keys = Object.keys(attrs);
      const needed = [src.id_field, src.type_field, src.status_field, src.address_field, src.date_field, src.value_field].filter(Boolean) as string[];
      const missing = needed.filter((k) => !keys.includes(k));
      return {
        ok: true,
        status: "200",
        note: missing.length ? `MISSING: ${missing.join(",")}` : "all required fields present",
        sample: features[0],
      };
    } else {
      const arr = json as Record<string, unknown>[];
      const keys = arr[0] ? Object.keys(arr[0]) : [];
      const needed = [src.id_field, src.type_field, src.status_field, src.address_field, src.date_field, src.value_field, src.lat_field, src.lng_field].filter(Boolean) as string[];
      const missing = needed.filter((k) => !keys.includes(k));
      return {
        ok: true,
        status: "200",
        note: missing.length ? `MISSING: ${missing.join(",")}` : `${arr.length} rows, all fields present`,
        sample: arr[0],
      };
    }
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "fetch", note: msg };
  }
}

async function main() {
  let query = supabase
    .from("permit_sources")
    .select("source_key, city, state, endpoint, source_type, error_count, last_scraped_at, id_field, type_field, status_field, address_field, date_field, value_field, lat_field, lng_field")
    .eq("enabled", true)
    .order("source_type")
    .order("source_key");
  if (filter === "errors") {
    query = query.gt("error_count", 0);
  } else if (filter) {
    query = query.like("source_key", `${filter}%`);
  }
  const { data: sources, error } = await query;
  if (error || !sources) { console.error(error); process.exit(1); }

  console.log("=".repeat(96));
  console.log(`  Source Audit — ${sources.length} sources`);
  console.log("=".repeat(96));

  const failing: { src: Src; reason: string }[] = [];
  const healthy: { src: Src; note: string }[] = [];

  for (const src of sources as Src[]) {
    const r = await probe(src);
    const mark = r.ok ? "OK" : "FAIL";
    const missingMarker = r.note.startsWith("MISSING:") ? "FIELDS" : mark;
    process.stdout.write(
      `  ${missingMarker.padEnd(6)} ${src.source_type.padEnd(8)} ${src.source_key.padEnd(32)} err=${(src.error_count ?? 0).toString().padStart(3)}  ${r.note}\n`
    );
    if (!r.ok || r.note.startsWith("MISSING:")) {
      failing.push({ src, reason: r.note });
    } else {
      healthy.push({ src, note: r.note });
    }
  }

  console.log("\n" + "-".repeat(96));
  console.log(`  Summary: ${healthy.length} healthy, ${failing.length} need attention`);
  console.log("-".repeat(96));
  if (failing.length) {
    console.log("\n  Need attention:");
    for (const f of failing) {
      console.log(`    ${f.src.source_key.padEnd(32)} ${f.reason}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
