import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "authentication_required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "local_runtime_not_configured" }, 500);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser(authorization.slice(7));
  if (userError || !userData.user) return json({ error: "invalid_session" }, 401);

  let body: { clubId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof body.clubId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.clubId)) {
    return json({ error: "invalid_club_id" }, 400);
  }

  const { data: roles, error: roleError } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userData.user.id)
    .eq("club_id", body.clubId)
    .limit(1);
  if (roleError) return json({ error: "authorization_check_failed" }, 500);
  if (!roles?.length) return json({ error: "club_access_denied" }, 403);

  return json({ ok: true, userId: userData.user.id, clubId: body.clubId }, 200);
});
