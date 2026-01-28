import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, UserCheck, UserX, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  parent_user_id: string | null;
  child_id: string | null;
}

interface MiniLeaguePlayerOverridesProps {
  eventId: string;
  miniLeagueId: string;
  isAdmin: boolean;
  onOverridesChange: (overrides: Record<string, boolean>) => void;
}

const getAbilityLabel = (rating: number): string => {
  switch (rating) {
    case 1: return "Beginner";
    case 2: return "Developing";
    case 3: return "Intermediate";
    case 4: return "Advanced";
    case 5: return "Expert";
    default: return "Unknown";
  }
};

export function MiniLeaguePlayerOverrides({
  eventId,
  miniLeagueId,
  isAdmin,
  onOverridesChange,
}: MiniLeaguePlayerOverridesProps) {
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, boolean>>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Fetch mini league players
  const { data: allPlayers } = useQuery({
    queryKey: ["mini-league-players-overrides", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, ability_rating, parent_user_id, child_id")
        .eq("mini_league_id", miniLeagueId)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as MiniLeaguePlayer[];
    },
    enabled: !!miniLeagueId,
  });

  // Fetch RSVPs for this event
  const { data: eventRsvps } = useQuery({
    queryKey: ["event-rsvps-for-overrides", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id, status")
        .eq("event_id", eventId);
      if (error) throw error;
      return data as { user_id: string; child_id: string | null; status: string }[];
    },
    enabled: !!eventId,
  });

  // Map RSVPs to mini league players
  const getRsvpStatus = (player: MiniLeaguePlayer): string | null => {
    if (!eventRsvps) return null;
    
    // Check if player's child_id matches an RSVP child_id
    if (player.child_id) {
      const childRsvp = eventRsvps.find(r => r.child_id === player.child_id);
      if (childRsvp) return childRsvp.status;
    }
    // Check if player's parent has RSVP'd (for players without child_id)
    if (player.parent_user_id) {
      const parentRsvp = eventRsvps.find(r => r.user_id === player.parent_user_id && !r.child_id);
      if (parentRsvp) return parentRsvp.status;
    }
    return null;
  };

  // Categorize players by their effective status (RSVP or override)
  const categorizedPlayers = {
    going: [] as MiniLeaguePlayer[],
    maybe: [] as MiniLeaguePlayer[],
    not_going: [] as MiniLeaguePlayer[],
    not_responded: [] as MiniLeaguePlayer[],
  };

  allPlayers?.forEach(player => {
    const rsvpStatus = getRsvpStatus(player);
    const hasOverride = playerOverrides[player.id] !== undefined;
    
    if (hasOverride) {
      // Override takes precedence
      if (playerOverrides[player.id]) {
        categorizedPlayers.going.push(player);
      } else {
        categorizedPlayers.not_going.push(player);
      }
    } else if (rsvpStatus === "going") {
      categorizedPlayers.going.push(player);
    } else if (rsvpStatus === "maybe") {
      categorizedPlayers.maybe.push(player);
    } else if (rsvpStatus === "not_going") {
      categorizedPlayers.not_going.push(player);
    } else {
      categorizedPlayers.not_responded.push(player);
    }
  });

  // Initialize overrides based on RSVP status
  useEffect(() => {
    if (allPlayers && eventRsvps && !initialized) {
      const initialOverrides: Record<string, boolean> = {};
      allPlayers.forEach(player => {
        const rsvpStatus = getRsvpStatus(player);
        // Only "going" players are available by default
        initialOverrides[player.id] = rsvpStatus === "going";
      });
      setPlayerOverrides(initialOverrides);
      onOverridesChange(initialOverrides);
      setInitialized(true);
    }
  }, [allPlayers, eventRsvps, initialized]);

  // Toggle a single player's override
  const togglePlayerOverride = (playerId: string) => {
    const newOverrides = {
      ...playerOverrides,
      [playerId]: !playerOverrides[playerId],
    };
    setPlayerOverrides(newOverrides);
    onOverridesChange(newOverrides);
  };

  // Quick actions
  const selectAll = () => {
    const newOverrides: Record<string, boolean> = {};
    allPlayers?.forEach(p => { newOverrides[p.id] = true; });
    setPlayerOverrides(newOverrides);
    onOverridesChange(newOverrides);
  };

  const resetToRsvp = () => {
    const newOverrides: Record<string, boolean> = {};
    allPlayers?.forEach(player => {
      const rsvpStatus = getRsvpStatus(player);
      newOverrides[player.id] = rsvpStatus === "going";
    });
    setPlayerOverrides(newOverrides);
    onOverridesChange(newOverrides);
    setInitialized(true);
  };

  const clearAll = () => {
    const newOverrides: Record<string, boolean> = {};
    allPlayers?.forEach(p => { newOverrides[p.id] = false; });
    setPlayerOverrides(newOverrides);
    onOverridesChange(newOverrides);
  };

  const availableCount = Object.values(playerOverrides).filter(v => v === true).length;

  if (!isAdmin || !allPlayers || allPlayers.length === 0) {
    return null;
  }

  const renderPlayerItem = (player: MiniLeaguePlayer) => {
    const isSelected = playerOverrides[player.id] === true;
    const rsvpStatus = getRsvpStatus(player);
    const hasOverride = playerOverrides[player.id] !== undefined && playerOverrides[player.id] !== (rsvpStatus === "going");
    
    return (
      <div
        key={player.id}
        className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
          isSelected 
            ? "bg-primary/10 hover:bg-primary/15" 
            : "bg-muted/30 hover:bg-muted/50"
        }`}
        onClick={() => togglePlayerOverride(player.id)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Checkbox 
            checked={isSelected} 
            onCheckedChange={() => togglePlayerOverride(player.id)}
          />
          <span className={`text-sm truncate ${!isSelected ? "opacity-60" : ""}`}>
            {player.name}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            ({getAbilityLabel(player.ability_rating)})
          </span>
        </div>
        {hasOverride && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 shrink-0">
            Override
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4 space-y-3">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">League Players</span>
              <Badge variant="secondary" className="text-xs">
                {availableCount} / {allPlayers?.length || 0} available
              </Badge>
            </div>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="space-y-3 pt-2">
          {/* Quick Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={(e) => { e.stopPropagation(); selectAll(); }}
            >
              <UserCheck className="h-3.5 w-3.5 mr-1" />
              All Available
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={(e) => { e.stopPropagation(); resetToRsvp(); }}
            >
              Reset to RSVP
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={(e) => { e.stopPropagation(); clearAll(); }}
            >
              <UserX className="h-3.5 w-3.5 mr-1" />
              None
            </Button>
          </div>

          {/* Categorized Player Lists */}
          <div className="space-y-3">
            {/* Going */}
            {categorizedPlayers.going.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                  <span>✅</span> Going ({categorizedPlayers.going.length})
                </p>
                <div className="space-y-1 pl-2">
                  {categorizedPlayers.going.map(renderPlayerItem)}
                </div>
              </div>
            )}

            {/* Maybe */}
            {categorizedPlayers.maybe.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <span>🤔</span> Maybe ({categorizedPlayers.maybe.length})
                </p>
                <div className="space-y-1 pl-2">
                  {categorizedPlayers.maybe.map(renderPlayerItem)}
                </div>
              </div>
            )}

            {/* Not Going */}
            {categorizedPlayers.not_going.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-destructive flex items-center gap-1">
                  <span>❌</span> Can't Go ({categorizedPlayers.not_going.length})
                </p>
                <div className="space-y-1 pl-2">
                  {categorizedPlayers.not_going.map(renderPlayerItem)}
                </div>
              </div>
            )}

            {/* Not Responded */}
            {categorizedPlayers.not_responded.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <span>⏳</span> Not Responded ({categorizedPlayers.not_responded.length})
                </p>
                <div className="space-y-1 pl-2">
                  {categorizedPlayers.not_responded.map(renderPlayerItem)}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
