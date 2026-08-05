import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGodModeSession } from "@/lib/auth/god-mode";
import { probeSource } from "@/lib/sources/probe";
import { logApiError } from "@/lib/log";
import { SourceProbeBodySchema, parseBody } from "@/lib/schemas/api";

/**
 * POST /api/admin/sources/probe
 * Body: { source_key: string, enable_on_success?: boolean }
 *
 * Verifies a permit-source endpoint is reachable, infers its field
 * mapping, and optionally flips `enabled=true` when the probe succeeds.
 * Gated to god-mode emails only — this is an operator tool, not a
 * contractor-facing surface.
 *
 * Returns the probe result plus the updated row so the admin UI can
 * render green/red per source without re-fetching.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = parseBody(SourceProbeBodySchema, raw);
    if (parsed.response) return parsed.response;
    const body = parsed.data;
    const sourceKey = body.source_key.trim();
    if (!sourceKey) {
      return NextResponse.json({ error: "source_key required" }, { status: 400 });
    }

    // God-mode gate. Admin action, not a subscriber flow.
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    const { data: { session } } = await userClient.auth.getSession();
    if (!user || !isGodModeSession(user.email, session?.access_token)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: row, error } = await supabase
      .from("permit_sources")
      .select("source_key, name, source_type, endpoint, enabled")
      .eq("source_key", sourceKey)
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "source not found" }, { status: 404 });
    }

    const result = await probeSource(row.source_type, row.endpoint);

    // Persist the inferred field mappings + stamp last_scraped_at so the
    // source moves up / down the round-robin queue. Always write the
    // error_count update: increment on failure, reset on success.
    const patch: Record<string, unknown> = {
      last_scraped_at: new Date().toISOString(),
      last_count: result.row_count,
    };
    if (result.ok) {
      patch.error_count = 0;
      Object.assign(patch, result.fields);
      if (body.enable_on_success !== false) patch.enabled = true;
    } else {
      // Don't auto-disable; just count errors so a separate cleanup
      // pass can retire sources that have failed ≥N probes.
      patch.error_count = await incrErr(supabase, sourceKey);
    }

    await supabase.from("permit_sources").update(patch).eq("source_key", sourceKey);

    return NextResponse.json({
      source_key: sourceKey,
      name: row.name,
      source_type: row.source_type,
      probe: result,
      patched: patch,
    });
  } catch (error) {
    logApiError("admin.sources.probe", error);
    return NextResponse.json(
      { error: "probe failed" },
      { status: 500 },
    );
  }
}

async function incrErr(
  supabase: ReturnType<typeof createAdminClient>,
  sourceKey: string,
): Promise<number> {
  const { data } = await supabase
    .from("permit_sources")
    .select("error_count")
    .eq("source_key", sourceKey)
    .single();
  return (data?.error_count ?? 0) + 1;
}
