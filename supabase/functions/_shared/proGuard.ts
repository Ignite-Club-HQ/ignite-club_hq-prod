/**
 * Pro access guard for edge functions.
 *
 * Provides `requireClubPro`, `requireTeamPro`, and `requireAnyClubPro`
 * helpers wrapping the SQL functions `public.has_active_pro_for_club`,
 * `public.has_active_pro_for_team`, and `public.user_has_any_club_pro`.
 *
 * All helpers return:
 *   - `null` when access is granted (RPC returned exactly `data === true`
 *     with no error).
 *   - A 400 Response when the required scope identifier is missing.
 *   - A 403 `{ error: "pro_required", ... }` Response when the RPC returns
 *     any other value.
 *   - A 500 `{ error: "pro_check_failed" }` Response when the RPC returns
 *     an error OR the underlying promise rejects (network / runtime /
 *     transport failure). Fail-closed: entitlement is never granted when
 *     verification is unavailable.
 *
 * Internal error details (messages, stacks, URLs, tokens, DB internals) are
 * never surfaced to the client. Server-side logs record only a short
 * diagnostic tag; the caught exception object itself is not logged.
 */

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

function proCheckFailedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: "pro_check_failed" }),
    {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function proRequiredResponse(
  corsHeaders: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error: "pro_required", ...extra }),
    {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function missingScopeResponse(
  corsHeaders: Record<string, string>,
  errorCode: string,
): Response {
  return new Response(
    JSON.stringify({ error: errorCode }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

export async function requireClubPro(
  supabase: SupabaseLike,
  clubId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!clubId) return missingScopeResponse(corsHeaders, "missing_club_id");

  try {
    const { data, error } = await supabase.rpc("has_active_pro_for_club", { _club_id: clubId });
    if (error) {
      console.error("[proGuard] has_active_pro_for_club returned error");
      return proCheckFailedResponse(corsHeaders);
    }
    if (data === true) return null;
    return proRequiredResponse(corsHeaders, { club_id: clubId });
  } catch {
    // Rejected promise: network/runtime/transport failure. Fail closed.
    console.error("[proGuard] has_active_pro_for_club threw");
    return proCheckFailedResponse(corsHeaders);
  }
}

export async function requireTeamPro(
  supabase: SupabaseLike,
  teamId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!teamId) return missingScopeResponse(corsHeaders, "missing_team_id");

  try {
    const { data, error } = await supabase.rpc("has_active_pro_for_team", { _team_id: teamId });
    if (error) {
      console.error("[proGuard] has_active_pro_for_team returned error");
      return proCheckFailedResponse(corsHeaders);
    }
    if (data === true) return null;
    return proRequiredResponse(corsHeaders, { team_id: teamId });
  } catch {
    console.error("[proGuard] has_active_pro_for_team threw");
    return proCheckFailedResponse(corsHeaders);
  }
}

export async function requireAnyClubPro(
  supabase: SupabaseLike,
  userId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!userId) return missingScopeResponse(corsHeaders, "missing_user_id");

  try {
    const { data, error } = await supabase.rpc("user_has_any_club_pro", { _user_id: userId });
    if (error) {
      console.error("[proGuard] user_has_any_club_pro returned error");
      return proCheckFailedResponse(corsHeaders);
    }
    if (data === true) return null;
    return proRequiredResponse(corsHeaders);
  } catch {
    console.error("[proGuard] user_has_any_club_pro threw");
    return proCheckFailedResponse(corsHeaders);
  }
}
