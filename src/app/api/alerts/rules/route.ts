import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logger } from "@/lib/logger";
import { isUuid } from "@/lib/validation/params";

export const runtime = "nodejs";

/**
 * Module 14 — alert_rules CRUD.
 *
 *   GET    /api/alerts/rules         — list mine
 *   POST   /api/alerts/rules         — create
 *   PATCH  /api/alerts/rules?id=...  — toggle / edit
 *   DELETE /api/alerts/rules?id=...  — remove
 *
 * RLS self-policy from migration 00090 (lines 165-183) enforces that
 * contractors only see + mutate their own rows. This route layer
 * adds Zod input validation + JSON contracts for the settings UI.
 */

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

const KindEnum = z.enum([
  "high_score",
  "permit_no_contractor",
  "homeowner_match",
  "stage_change",
]);

const ChannelEnum = z.enum(["email", "sms", "none"]);

const HighScoreSchema = z.object({
  min_score: z.number().int().min(0).max(100).optional(),
  trades: z.array(z.string().max(40)).max(10).nullable().optional(),
});
const PermitNoContractorSchema = z.object({
  zip: z.string().max(10).nullable().optional(),
});
const HomeownerMatchSchema = z.object({
  trades: z.array(z.string().max(40)).max(10).nullable().optional(),
});
const StageChangeSchema = z.object({
  from: z.string().max(40).nullable().optional(),
  to: z.string().max(40).nullable().optional(),
});

function validateCriteriaForKind(
  kind: z.infer<typeof KindEnum>,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema =
    kind === "high_score"
      ? HighScoreSchema
      : kind === "permit_no_contractor"
        ? PermitNoContractorSchema
        : kind === "homeowner_match"
          ? HomeownerMatchSchema
          : StageChangeSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, value: parsed.data };
}

const CreateSchema = z.object({
  kind: KindEnum,
  criteria: z.unknown(), // validated against kind below
  enabled: z.boolean().optional(),
  channel: ChannelEnum.optional(),
});

const PatchSchema = z.object({
  kind: KindEnum.optional(),
  criteria: z.unknown().optional(),
  enabled: z.boolean().optional(),
  channel: ChannelEnum.optional(),
});

/* -------------------------------------------------------------------------- */
/*  Handlers                                                                  */
/* -------------------------------------------------------------------------- */

export async function GET() {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const { data, error } = await supabase
    .from("alert_rules")
    .select(
      "id, kind, criteria, enabled, channel, last_fired_at, fire_count, created_at, updated_at",
    )
    .eq("contractor_id", guard.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("alerts.rules.list failed", { message: error.message });
    return NextResponse.json({ error: "Failed to load alert rules" }, { status: 500 });
  }
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const criteriaCheck = validateCriteriaForKind(parsed.data.kind, parsed.data.criteria);
  if (!criteriaCheck.ok) {
    return NextResponse.json(
      { error: `Invalid criteria for kind '${parsed.data.kind}': ${criteriaCheck.error}` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("alert_rules")
    .insert({
      contractor_id: guard.user.id,
      kind: parsed.data.kind,
      criteria: criteriaCheck.value,
      enabled: parsed.data.enabled ?? true,
      channel: parsed.data.channel ?? "email",
    })
    .select(
      "id, kind, criteria, enabled, channel, last_fired_at, fire_count, created_at, updated_at",
    )
    .single();

  if (error) {
    logger.error("alerts.rules.create failed", { message: error.message });
    return NextResponse.json({ error: "Failed to create alert rule" }, { status: 500 });
  }
  return NextResponse.json({ rule: data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Missing or malformed ?id=" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Build the update payload, validating criteria against kind
  // when both are present in the patch (or kind is omitted but
  // criteria is updated — fall back to current row's kind).
  const update: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
  if (parsed.data.channel !== undefined) update.channel = parsed.data.channel;

  if (parsed.data.kind !== undefined) update.kind = parsed.data.kind;

  if (parsed.data.criteria !== undefined) {
    let kindToValidate = parsed.data.kind;
    if (!kindToValidate) {
      const { data: cur } = await supabase
        .from("alert_rules")
        .select("kind")
        .eq("id", id)
        .eq("contractor_id", guard.user.id)
        .maybeSingle();
      if (!cur) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
      kindToValidate = cur.kind as z.infer<typeof KindEnum>;
    }
    const check = validateCriteriaForKind(kindToValidate, parsed.data.criteria);
    if (!check.ok) {
      return NextResponse.json(
        { error: `Invalid criteria for kind '${kindToValidate}': ${check.error}` },
        { status: 400 },
      );
    }
    update.criteria = check.value;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const { data, error } = await supabase
    .from("alert_rules")
    .update(update)
    .eq("id", id)
    .eq("contractor_id", guard.user.id)
    .select(
      "id, kind, criteria, enabled, channel, last_fired_at, fire_count, created_at, updated_at",
    )
    .single();

  if (error) {
    logger.error("alerts.rules.update failed", { message: error.message });
    return NextResponse.json({ error: "Failed to update alert rule" }, { status: 500 });
  }
  return NextResponse.json({ rule: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const guard = await requireContractor(supabase);
  if (guard.response) return guard.response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Missing or malformed ?id=" }, { status: 400 });
  }

  const { error } = await supabase
    .from("alert_rules")
    .delete()
    .eq("id", id)
    .eq("contractor_id", guard.user.id);
  if (error) {
    logger.error("alerts.rules.delete failed", { message: error.message });
    return NextResponse.json({ error: "Failed to delete alert rule" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
