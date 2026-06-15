import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, Info, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";

const PERSONAL = "__personal__";

/**
 * Step before CreateTeamPage when the user enters via the Start chooser.
 * Lets them attach the team to an existing club they admin, or run it
 * under a personal (shell) organiser. Either way we forward to
 * /clubs/:clubId/teams/new which is the real team creation form.
 */
export default function StartTeamPage() {
  usePageTitle("Start a team");
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<string>(PERSONAL);
  const [working, setWorking] = useState(false);

  const { data: clubs = [], isLoading } = useQuery({
    queryKey: ["my-admin-clubs-for-team", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin"]);
      const seen = new Set<string>();
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell" && !seen.has(c.id) && (seen.add(c.id), true));
    },
  });

  const handleContinue = async () => {
    if (!user) return;
    setWorking(true);
    try {
      if (choice !== PERSONAL) {
        navigate(`/clubs/${choice}/teams/new`);
        return;
      }

      // Reuse an existing personal shell club if we already created one.
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, kind)")
        .eq("user_id", user.id)
        .eq("role", "club_admin");
      const existing = (roles ?? [])
        .map((r: any) => r.clubs)
        .find((c: any) => c && c.kind === "shell");
      if (existing?.id) {
        navigate(`/clubs/${existing.id}/teams/new`);
        return;
      }

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

      navigate(`/clubs/${shell.id}/teams/new`);
    } catch (err: any) {
      toast({
        title: "Couldn't start a team",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="container max-w-md mx-auto px-4 pt-4 pb-8">
      {/* Inline header */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 active:scale-95 transition-transform"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight">Start a Team</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-[280px] mb-5 leading-relaxed">
        Choose a club or create a standalone team. You can link it later.
      </p>

      <div className="space-y-5">
        <div>
          <Label htmlFor="club" className="text-sm font-medium text-foreground mb-2 block">
            Club
          </Label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger
              id="club"
              className="h-12 w-full rounded-2xl border-0 bg-[#FAFAFA] dark:bg-card px-4 shadow-sm text-sm focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value={PERSONAL}>No club — just me (personal)</SelectItem>
              {!isLoading && clubs.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-start gap-1.5 mt-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[13px] text-muted-foreground leading-snug">
              Only clubs you manage are shown
            </p>
          </div>
        </div>

        <Button
          onClick={handleContinue}
          disabled={working}
          className="w-full h-12 rounded-2xl text-base font-semibold shadow-sm active:scale-[0.97] transition-transform"
        >
          {working ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <>
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
