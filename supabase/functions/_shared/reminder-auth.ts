/** Internal jobs never accept an ordinary user/anon JWT or an absent secret. */
export function requireReminderAuth(req: Request, cors: Record<string, string>, schedulerSecret?: string): Response | null {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1].trim();
  const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  const equal = (a: string | null | undefined, b: string | undefined) => {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };
  if (equal(token, serviceKey) || equal(provided, schedulerSecret)) return null;
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403, headers: { ...cors, "Content-Type": "application/json" },
  });
}