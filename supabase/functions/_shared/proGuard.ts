/**
 * Pro access guard for edge functions.
 *
 * Phase 2 of the Pro gating rollout. Provides `requireClubPro` and
 * `requireTeamPro` helpers that wrap the SQL functions
 * `public.has_active_pro_for_club` and `public.has_active_pro_for_team`.
 *
 * Both helpers return `null` if the caller's club/team has active Pro
 * (or the caller is an app_admin), or a 403 `Response` with
 * `{ error: "pro_required", club_id? | team_id? }` otherwise.
 *
 * NOTE: This helper is currently unused. It will be wired into write-gateway
 * edge functions in a later phase, behind explicit approval per feature.
 *
 * Usage:
 *   import { requireClubPro } from "../_shared/proGuard.ts";
 *
 *   const denied = await requireClubPro(supabase, clubId, corsHeaders);
 *   if (denied) return denied;
 */

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export async function requireClubPro(
  supabase: SupabaseLike,
  clubId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!clubId) {
    return new Response(
      JSON.stringify({ error: "missing_club_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data, error } = await supabase.rpc("has_active_pro_for_club", { _club_id: clubId });
  if (error) {
    console.error("[proGuard] has_active_pro_for_club error:", error);
    return new Response(
      JSON.stringify({ error: "pro_check_failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (data === true) return null;

  return new Response(
    JSON.stringify({ error: "pro_required", club_id: clubId }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export async function requireTeamPro(
  supabase: SupabaseLike,
  teamId: string,
  corsHeaders: Record<string, string> = {},
): Promise<Response | null> {
  if (!teamId) {
    return new Response(
      JSON.stringify({ error: "missing_team_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data, error } = await supabase.rpc("has_active_pro_for_team", { _team_id: teamId });
  if (error) {
    console.error("[proGuard] has_active_pro_for_team error:", error);
    return new Response(
      JSON.stringify({ error: "pro_check_failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (data === true) return null;

  return new Response(
    JSON.stringify({ error: "pro_required", team_id: teamId }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
