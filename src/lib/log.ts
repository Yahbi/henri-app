/**
 * Tiny server-side error-logging helper that avoids dumping raw error objects
 * into server logs (which may contain user IDs, emails, Stripe payloads, or
 * Supabase query details).
 *
 * Use this in catch blocks of API routes instead of `console.error("…:", err)`.
 *
 * Example:
 *   } catch (err) {
 *     logApiError("estimates.create", err);
 *     return NextResponse.json({ error: "…" }, { status: 500 });
 *   }
 */
export function logApiError(
  operation: string,
  err: unknown,
  extra?: Record<string, string | number | boolean>
): void {
  const message = err instanceof Error ? err.message : "unknown";
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  console.error(`${operation} failed`, {
    message,
    ...(code ? { code } : {}),
    ...(extra ?? {}),
  });
}
