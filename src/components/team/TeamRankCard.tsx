import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, ChevronRight, ChevronDown, CalendarCheck, MessageCircle, Camera } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface TeamRankCardProps {
  teamId: string;
  clubId: string;
}

interface LeaderboardRow {
  rank: number;
  team_id: string;
  team_name: string;
  points: number;
}

const EARN_TIPS = [
  { icon: CalendarCheck, label: "Complete RSVPs on time" },
  { icon: MessageCircle, label: "Stay active in team chat" },
  { icon: Camera, label: "Share team photos & moments" },
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function TeamRankCard({ teamId, clubId }: TeamRankCardProps) {
  const [open, setOpen] = useState(false);

  const { data: leaderboard } = useQuery({
    queryKey: ["team-leaderboard-rank", clubId, teamId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_teams_leaderboard", {
        _club_id: clubId,
        _window: "all",
        _limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
    enabled: !!clubId && !!teamId,
    staleTime: 5 * 60 * 1000,
  });

  if (!leaderboard) return null;
  const me = leaderboard.find((r) => r.team_id === teamId);
  if (!me) return null;

  const above = leaderboard.find((r) => r.rank === me.rank - 1);
  const pointsToNext = above ? Math.max(0, above.points - me.points) : 0;
  const totalRanked = leaderboard.length;

  // Progress toward next rank: how close my points are to the team above
  const progressPct = above && above.points > 0
    ? Math.min(100, Math.round((me.points / above.points) * 100))
    : me.rank === 1 ? 100 : 0;

  const rankLabel = me.rank === 1 ? "🥇" : me.rank === 2 ? "🥈" : me.rank === 3 ? "🥉" : `#${me.rank}`;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        <Link
          to="/leaderboard"
          aria-label="View club leaderboard"
          className="flex items-center gap-3 flex-1 min-w-0 -m-1 p-1 rounded-md hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center justify-center h-9 w-9 rounded-md bg-muted text-sm font-bold tabular-nums shrink-0">
            {rankLabel}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight">
              Club Rank {me.rank <= 3 ? `#${me.rank}` : ordinal(me.rank)}
              <span className="text-muted-foreground font-normal"> of {totalRanked}</span>
            </p>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              <span className="tabular-nums font-medium text-foreground/80">{me.points} pts</span>
              {above ? (
                <> · {pointsToNext} to #{above.rank}</>
              ) : me.rank === 1 ? (
                <> · Top of the club 🎉</>
              ) : null}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        </Link>
      </div>

      {above && (
        <div className="px-3 -mt-1 pb-2">
          <Progress value={progressPct} className="h-1" aria-label={`${progressPct}% toward rank ${above.rank}`} />
        </div>
      )}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="w-full flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Show ways to improve team ranking"
        >
          <span className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            Ways to climb the leaderboard
          </span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="px-3 pb-3 pt-1 space-y-1.5">
            {EARN_TIPS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
            <li className="text-[11px] text-muted-foreground/80 pt-1">
              Team scores are based on chat activity and RSVP response rates.
            </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
