import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, ChevronRight, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface Props {
  competitionId: string;
  competitionName: string;
}

/**
 * Lets a participant (entered-team member or competition official) message the
 * competition's Owner/Admin role holders. Club admins are never recipients —
 * the server-side RLS only grants access via competition_roles owner/admin.
 */
export function ContactCompetitionAdminsButton({ competitionId, competitionName }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const { data: eligible = false } = useQuery({
    queryKey: ["competition-contact-eligible", competitionId, user?.id],
    enabled: !!user && !!competitionId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const db = supabase as any;
      const { data: roles } = await db
        .from("competition_roles")
        .select("role")
        .eq("competition_id", competitionId)
        .eq("user_id", user!.id);
      const roleSet = new Set((roles ?? []).map((r: any) => r.role));
      if (roleSet.has("owner") || roleSet.has("admin")) return false;
      if (roleSet.size > 0) return true;

      const { data: myRoles } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);
      const teamIds = [...new Set((myRoles ?? []).map((r) => r.team_id).filter(Boolean))] as string[];
      if (!teamIds.length) return false;
      const { data: entries } = await db
        .from("competition_entries")
        .select("id")
        .eq("competition_id", competitionId)
        .in("status", ["invited", "accepted"])
        .in("team_id", teamIds)
        .limit(1);
      return (entries ?? []).length > 0;
    },
  });

  if (!eligible) return null;

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc(
        "get_or_create_competition_admin_conversation",
        { p_competition_id: competitionId },
      );
      if (error) throw error;
      navigate(`/messages/competition-admin/${data}`);
    } catch (err: any) {
      toast({ title: "Unable to contact competition admins", description: err.message || "Please try again later", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={open} disabled={busy} className="w-full text-left">
      <Card className="hover:border-primary/50 transition-colors border-primary/20 bg-primary/5">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="relative h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Trophy className="h-4 w-4" />
            <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center border-2 border-background">
              <MessageSquare className="h-2 w-2 text-primary-foreground" />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="truncate font-semibold text-sm">Contact competition admins</h3>
            <p className="text-xs text-muted-foreground truncate">
              {busy ? "Opening conversation..." : `Message the ${competitionName} organisers`}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </button>
  );
}
