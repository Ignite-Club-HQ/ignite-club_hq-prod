import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * Entry point for "Start a Team" from the Start chooser.
 *
 * Teams must live under a club in our schema, but users who just want to run
 * a single social/twilight team shouldn't have to set up a club first. This
 * page finds (or creates) a personal "shell" club for the user and forwards
 * them straight into the normal team-creation flow.
 */
export default function StartTeamPage() {
  usePageTitle("Start a team");
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const ranRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        // 1. Look for an existing shell club this user already admins.
        const { data: roles } = await supabase
          .from("user_roles")
          .select("club_id, clubs:club_id(id, kind)")
          .eq("user_id", user.id)
          .eq("role", "club_admin");

        const existingShell = (roles ?? [])
          .map((r: any) => r.clubs)
          .find((c: any) => c && c.kind === "shell");

        if (existingShell?.id) {
          navigate(`/clubs/${existingShell.id}/teams/new`, { replace: true });
          return;
        }

        // 2. Otherwise create a personal shell club + admin role.
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();
        const who = profile?.display_name?.trim() || "My";

        const { data: shell, error: shellErr } = await supabase
          .from("clubs")
          .insert({ name: `${who}'s teams`, kind: "shell", created_by: user.id })
          .select("id")
          .single();
        if (shellErr || !shell) throw shellErr ?? new Error("Could not create personal organiser");

        const { error: roleErr } = await supabase
          .from("user_roles")
          .insert({ user_id: user.id, club_id: shell.id, role: "club_admin" });
        if (roleErr) throw roleErr;

        navigate(`/clubs/${shell.id}/teams/new`, { replace: true });
      } catch (err: any) {
        ranRef.current = false;
        toast({
          title: "Couldn't start a team",
          description: err?.message ?? "Please try again",
          variant: "destructive",
        });
        navigate("/start", { replace: true });
      }
    })();
  }, [user, loading, navigate, toast]);

  return (
    <div className="container max-w-md mx-auto px-4 py-12 flex flex-col items-center text-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Setting up your team…</p>
    </div>
  );
}
