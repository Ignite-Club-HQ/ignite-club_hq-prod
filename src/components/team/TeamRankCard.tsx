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

  // Soften the framing for teams in the bottom quartile so the card never
  // reads like a "last place" callout. Only suppress when there are enough
  // teams for a quartile to be meaningful.
  const isBottomQuartile = totalRanked >= 4 && me.rank > Math.ceil(totalRanked * 0.75);

  // Progress toward next rank: how close my points are to the team above
  const progressPct = above && above.points > 0
    ? Math.min(100, Math.round((me.points / above.points) * 100))
    : me.rank === 1 ? 100 : 0;

  const rankLabel = me.rank === 1 ? "🥇" : me.rank === 2 ? "🥈" : me.rank === 3 ? "🥉" : `#${me.rank}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md bg-muted/30">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Link
          to="/leaderboard"
          aria-label="View club leaderboard"
          className="flex items-center gap-2 flex-1 min-w-0 rounded-sm hover:bg-muted/50 transition-colors py-0.5"
        >
          <span className="flex items-center justify-center h-6 w-7 rounded text-[11px] font-semibold tabular-nums text-muted-foreground shrink-0">
            {rankLabel}
          </span>
          <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
            {isBottomQuartile ? (
              <>Climbing · <span className="tabular-nums">{me.points} pts</span></>
            ) : (
              <>
                <span className="text-foreground/80 font-medium">
                  Rank {me.rank <= 3 ? `#${me.rank}` : ordinal(me.rank)}
                </span>
                <span> of {totalRanked} · </span>
                <span className="tabular-nums">{me.points} pts</span>
                {above && pointsToNext > 0 ? <> · {pointsToNext} to #{above.rank}</> : null}
              </>
            )}
          </span>
        </Link>
        <CollapsibleTrigger
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Show ways to improve team ranking"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="px-3 pb-2.5 pt-0.5 space-y-1.5 border-t border-border/40 mt-0.5">
          {EARN_TIPS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1.5 first:pt-2">
              <Icon className="h-3 w-3 shrink-0 text-primary/70" aria-hidden="true" />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
