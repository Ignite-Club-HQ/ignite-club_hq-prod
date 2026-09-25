import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Trophy, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { fetchProfilesWithCache } from "@/lib/profileCache";

interface Row {
  id: string;
  competition_id: string;
  competition_name: string;
  member_user_id: string;
  member_name: string;
  last_message_at: string | null;
  is_mine: boolean;
}

/**
 * Competition-admin threads. Rows come back only where the user started the
 * thread, or holds the competition's Owner/Admin role (enforced by RLS).
 * Club filtering: shown only when the active club organises the competition
 * or has a team entered; fails closed when that can't be determined.
 */
export function CompetitionAdminInboxList({ clubFilter }: { clubFilter?: string | null }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: rows = [] } = useQuery({
    queryKey: ["competition-admin-inbox", user?.id, clubFilter ?? null],
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Row[]> => {
      const db = supabase as any;
      const { data: convs } = await db
        .from("competition_admin_conversations")
        .select("id, competition_id, member_user_id, last_message_at")
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false });
      if (!convs?.length) return [];
      const compIds = [...new Set(convs.map((c: any) => c.competition_id))] as string[];

      const { data: comps } = await db
        .from("competitions")
        .select("id, name, organizer_club_id")
        .in("id", compIds);
      const compMap = new Map<string, any>((comps ?? []).map((c: any) => [c.id, c]));

      let allowed = new Set<string>(compIds);
      if (clubFilter) {
        allowed = new Set();
        const { data: entries } = await db
          .from("competition_entries")
          .select("competition_id, teams:team_id(club_id)")
          .in("competition_id", compIds)
          .in("status", ["invited", "accepted"]);
        for (const id of compIds) {
          const comp = compMap.get(id);
          if (!comp) continue; // fail closed
          if (comp.organizer_club_id === clubFilter) allowed.add(id);
        }
        for (const e of entries ?? []) {
          if (e?.teams?.club_id === clubFilter) allowed.add(e.competition_id);
        }
      }

      const visible = convs.filter((c: any) => allowed.has(c.competition_id) && compMap.has(c.competition_id));
      const memberIds = [...new Set(visible.map((c: any) => c.member_user_id))] as string[];
      const profiles = memberIds.length ? await fetchProfilesWithCache(memberIds) : [];
      const pMap = new Map<string, any>((profiles as any[]).map((p) => [p.id, p]));

      return visible.map((c: any) => ({
        id: c.id,
        competition_id: c.competition_id,
        competition_name: compMap.get(c.competition_id)?.name ?? "Competition",
        member_user_id: c.member_user_id,
        member_name: pMap.get(c.member_user_id)?.display_name ?? "Member",
        last_message_at: c.last_message_at,
        is_mine: c.member_user_id === user!.id,
      }));
    },
  });

  if (!rows.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">Competition inbox</p>
      {rows.map((r) => (
        <button key={r.id} type="button" className="w-full text-left" onClick={() => navigate(`/messages/competition-admin/${r.id}`)}>
          <Card className="hover:border-primary/50 transition-colors">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Trophy className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="truncate font-semibold text-sm">
                  {r.is_mine ? `${r.competition_name} admins` : r.member_name}
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {r.is_mine ? "Your conversation with the organisers" : `${r.competition_name} · competition admins`}
                </p>
              </div>
              {r.last_message_at && (
                <span className="text-[11px] text-muted-foreground shrink-0">{formatTimeShort(r.last_message_at)}</span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}
