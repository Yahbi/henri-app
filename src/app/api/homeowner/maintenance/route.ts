import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import {
  HomeownerMaintenanceBodySchema,
  parseBody,
} from "@/lib/schemas/api";

/**
 * Homeowner maintenance-task completion tracking.
 *
 * GET    → list of task ids the signed-in homeowner has checked off
 * POST   → toggle a task (idempotent — safe to send the same body repeatedly)
 *
 * Table `homeowner_maintenance_completed` — migration in the Phase 1.6
 * manual-apply SQL file.
 */

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("homeowner_maintenance_completed")
      .select("task_id, completed_at")
      .eq("owner_id", user.id);

    if (error) {
      logApiError("homeowner.maintenance.get", error);
      return NextResponse.json({ error: "Load failed" }, { status: 500 });
    }

    return NextResponse.json({ completed: data ?? [] });
  } catch (err) {
    logApiError("homeowner.maintenance.get.catch", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(HomeownerMaintenanceBodySchema, raw);
    if (parsed.response) return parsed.response;
    const body = parsed.data;

    if (body.completed === false) {
      const { error } = await supabase
        .from("homeowner_maintenance_completed")
        .delete()
        .eq("owner_id", user.id)
        .eq("task_id", body.task_id);
      if (error) {
        logApiError("homeowner.maintenance.delete", error);
        return NextResponse.json({ error: "Uncheck failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, completed: false });
    }

    const { error } = await supabase
      .from("homeowner_maintenance_completed")
      .upsert(
        {
          owner_id: user.id,
          task_id: body.task_id,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,task_id" },
      );

    if (error) {
      logApiError("homeowner.maintenance.upsert", error);
      return NextResponse.json({ error: "Check failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, completed: true });
  } catch (err) {
    logApiError("homeowner.maintenance.post.catch", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
