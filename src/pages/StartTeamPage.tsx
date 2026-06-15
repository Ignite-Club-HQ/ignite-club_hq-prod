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
    <div className="container max-w-md mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
        <Users className="h-6 w-6 text-primary" /> Start a team
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Attach this team to a club, or run it on its own. You can always link it
        to a club later.
      </p>

      <div className="space-y-4">
        <div>
          <Label htmlFor="club">Club (optional)</Label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger id="club"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PERSONAL}>No club — just me (personal)</SelectItem>
              {!isLoading && clubs.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Only clubs where you're an admin appear here.
          </p>
        </div>

        <Button onClick={handleContinue} disabled={working} className="w-full">
          {working ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Continue
        </Button>
      </div>
    </div>
  );
}
