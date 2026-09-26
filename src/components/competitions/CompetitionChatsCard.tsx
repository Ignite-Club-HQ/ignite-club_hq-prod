import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

const SCOPE_LABEL: Record<string, string> = {
  all_members: "Competition chat (all members)",
  coordinators: "Coordinators chat",
  referees: "Referees chat",
  committee: "Committee chat",
};
const ORDER = ["all_members", "coordinators", "referees", "committee"];

/** Quick links for competition admins to every chat of this competition. */
export function CompetitionChatsCard({ competitionId }: { competitionId: string }) {
  const navigate = useNavigate();
  const { data: chats = [] } = useQuery({
    queryKey: ["competition-chats-links", competitionId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("chat_groups") as any)
        .select("id, name, competition_scope")
        .eq("competition_id", competitionId);
      if (error) throw error;
      return ((data ?? []) as { id: string; name: string; competition_scope: string | null }[])
        .filter((c) => c.competition_scope && SCOPE_LABEL[c.competition_scope])
        .sort((a, b) => ORDER.indexOf(a.competition_scope!) - ORDER.indexOf(b.competition_scope!));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Competition chats</CardTitle>
        <CardDescription>
          Competition admins are automatically in every chat for this competition.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {chats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chats yet.</p>
        ) : (
          chats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/groups/${c.id}`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 text-left"
            >
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="flex-1 text-sm font-medium">{SCOPE_LABEL[c.competition_scope!]}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}
