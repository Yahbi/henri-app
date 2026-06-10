import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/* Zod schema — PATCH body. Caps ids at 500 so a single request can't
 * carry an unbounded IN-list into the update query. */
const NotificationsPatchSchema = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  markAllRead: z.boolean().optional(),
});

/* ─── GET /api/notifications — fetch user's notifications ─── */
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit")) || 20;
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";

  let query = supabase
    .from("notifications")
    .select("id, user_id, type, title, body, read, metadata, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("read", false);
  }

  const { data: notifications, error } = await query;

  if (error) {
    logger.error("Notifications fetch error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }

  /* Unread count */
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);

  return NextResponse.json({
    notifications: notifications ?? [],
    unreadCount: unreadCount ?? 0,
  });
}

/* ─── PATCH /api/notifications — mark notifications as read ─── */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = NotificationsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ids, markAllRead } = parsed.data;

  if (markAllRead) {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      return NextResponse.json({ error: "Failed to mark all as read" }, { status: 500 });
    }

    return NextResponse.json({ success: true, marked: "all" });
  }

  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "ids or markAllRead is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: "Failed to mark notifications as read" }, { status: 500 });
  }

  return NextResponse.json({ success: true, marked: ids.length });
}
