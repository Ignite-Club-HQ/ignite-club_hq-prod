import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { PitchPosition } from "@/components/pitch/PositionBadge";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isFillIn?: boolean;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
}

interface Goal {
  id: string;
  scorerId?: string;
  scorerName?: string;
  time: number;
  half: 1 | 2;
  isOpponentGoal: boolean;
}

interface SaveGameStatsParams {
  eventId: string;
  teamId: string;
  players: Player[];
  totalGameTime: number; // in seconds
  halfDuration: number; // in seconds
  formationUsed?: string;
  teamSize: number;
  executedSubs: SubstitutionEvent[];
  goals?: Goal[];
}

export function useGameStats() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveGameStatsMutation = useMutation({
    mutationFn: async ({
      eventId,
      teamId,
      players,
      totalGameTime,
      halfDuration,
      formationUsed,
      teamSize,
      executedSubs,
      goals = [],
    }: SaveGameStatsParams) => {
      // Calculate positions played per player based on their current position and subs
      const playerPositionsMap = new Map<string, Set<string>>();
      const playerSubsCount = new Map<string, number>();
      const playerStartedOnPitch = new Map<string, boolean>();
      const playerGoalsCount = new Map<string, number>();

      // Initialize with starting positions
      players.forEach((player) => {
        playerPositionsMap.set(player.id, new Set());
        playerSubsCount.set(player.id, 0);
        playerGoalsCount.set(player.id, 0);
        // Player started on pitch if they have a position
        playerStartedOnPitch.set(player.id, player.position !== null);
        
        // Add current position if on pitch
        if (player.currentPitchPosition) {
          playerPositionsMap.get(player.id)?.add(player.currentPitchPosition);
        }
      });

      // Count goals per player (only team goals, not opponent goals)
      goals.filter(g => !g.isOpponentGoal && g.scorerId).forEach((goal) => {
        if (goal.scorerId) {
          playerGoalsCount.set(
            goal.scorerId,
            (playerGoalsCount.get(goal.scorerId) || 0) + 1
          );
        }
      });

      // Track positions from executed substitutions
      executedSubs.forEach((sub) => {
        if (sub.executed) {
          // Player coming out - add their position at time of sub
          const playerOutPositions = playerPositionsMap.get(sub.playerOut.id);
          if (sub.playerOut.currentPitchPosition) {
            playerOutPositions?.add(sub.playerOut.currentPitchPosition);
          }
          playerSubsCount.set(
            sub.playerOut.id,
            (playerSubsCount.get(sub.playerOut.id) || 0) + 1
          );

          // Player coming in - add the position they're taking
          const playerInPositions = playerPositionsMap.get(sub.playerIn.id);
          if (sub.positionSwap) {
            playerInPositions?.add(sub.positionSwap.fromPosition);
          } else if (sub.playerOut.currentPitchPosition) {
            playerInPositions?.add(sub.playerOut.currentPitchPosition);
          }
          playerSubsCount.set(
            sub.playerIn.id,
            (playerSubsCount.get(sub.playerIn.id) || 0) + 1
          );

          // Position swap player
          if (sub.positionSwap) {
            const swapPlayerPositions = playerPositionsMap.get(
              sub.positionSwap.player.id
            );
            swapPlayerPositions?.add(sub.positionSwap.fromPosition);
            swapPlayerPositions?.add(sub.positionSwap.toPosition);
          }
        }
      });

      // Calculate total substitutions
      const totalSubstitutions = executedSubs.filter((s) => s.executed).length;

      // Save game summary
      const { error: summaryError } = await supabase
        .from("game_summaries")
        .upsert(
          {
            event_id: eventId,
            team_id: teamId,
            total_game_time: totalGameTime,
            half_duration: halfDuration,
            formation_used: formationUsed || null,
            team_size: teamSize,
            total_substitutions: totalSubstitutions,
          },
          { onConflict: "event_id" }
        );

      if (summaryError) {
        throw new Error(`Failed to save game summary: ${summaryError.message}`);
      }

      // Delete existing player stats for this event (to allow re-saving)
      await supabase
        .from("game_player_stats")
        .delete()
        .eq("event_id", eventId);

      // Save individual player stats
      const playerStats = players.map((player) => {
        const positionsPlayed = Array.from(
          playerPositionsMap.get(player.id) || []
        );
        const subsCount = playerSubsCount.get(player.id) || 0;
        const startedOnPitch = playerStartedOnPitch.get(player.id) || false;
        const goalsScored = playerGoalsCount.get(player.id) || 0;

        return {
          event_id: eventId,
          team_id: teamId,
          user_id: player.isFillIn ? null : player.id,
          fill_in_player_name: player.isFillIn ? player.name : null,
          jersey_number: player.number || null,
          minutes_played: Math.floor((player.minutesPlayed || 0)), // already in seconds
          positions_played: positionsPlayed,
          substitutions_count: subsCount,
          started_on_pitch: startedOnPitch,
          goals_scored: goalsScored,
        };
      });

      const { error: statsError } = await supabase
        .from("game_player_stats")
        .insert(playerStats);

      if (statsError) {
        throw new Error(`Failed to save player stats: ${statsError.message}`);
      }

      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: "Game stats saved",
        description: "Player statistics have been recorded for this game.",
      });
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["game-summary"] });
    },
    onError: (error: Error) => {
      console.error("Failed to save game stats:", error);
      toast({
        title: "Failed to save stats",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveGameStats = useCallback(
    (params: SaveGameStatsParams) => {
      return saveGameStatsMutation.mutateAsync(params);
    },
    [saveGameStatsMutation]
  );

  return {
    saveGameStats,
    isSaving: saveGameStatsMutation.isPending,
  };
}
