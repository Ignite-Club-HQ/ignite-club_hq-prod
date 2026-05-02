import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Clock, Users, Loader2, Check, CalendarCheck } from "lucide-react";
import { PitchPosition } from "./PositionBadge";
import { useGameStats } from "@/hooks/useGameStats";
import { useSaveGameResult } from "@/hooks/useSaveGameResult";

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
  skipped?: boolean;
}

interface Goal {
  id: string;
  scorerId?: string;
  scorerName?: string;
  time: number;
  half: 1 | 2;
  isOpponentGoal: boolean;
}

interface GameFinishedDialogProps {
  open: boolean;
  onClose: () => void;
  players: Player[];
  totalGameTime: number;
  teamName?: string;
  // Event linking
  linkedEventId?: string | null;
  teamId?: string;
  formationUsed?: string;
  teamSize?: number;
  executedSubs?: SubstitutionEvent[];
  halfDuration?: number;
  goals?: Goal[];
  // Event details for email notification
  eventTitle?: string;
  eventDate?: string;
  opponent?: string;
}

const PITCH_STATE_KEY = 'ignite-pitch-board-state';
const PITCH_STATE_KEY_BASE = 'ignite-pitch-board-state-team';
const getPitchStateKeyForTeam = (teamId: string) => `${PITCH_STATE_KEY_BASE}-${teamId}`;
const TIMER_STATE_KEY = 'pitch-board-timer-state';

export default function GameFinishedDialog({ 
  open, 
  onClose, 
  players, 
  totalGameTime,
  teamName,
  linkedEventId,
  teamId,
  formationUsed,
  teamSize = 7,
  executedSubs = [],
  halfDuration,
  goals = [],
  eventTitle,
  eventDate,
  opponent,
}: GameFinishedDialogProps) {
  const { saveGameStats, isSaving } = useGameStats();
  const { save: saveGameResult } = useSaveGameResult();
  const [statsSaved, setStatsSaved] = useState(false);
  
  // Sort players by minutes played (descending)
  const sortedPlayers = [...players].sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
  
  const totalMinutesPlayed = players.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);
  const avgMinutes = players.length > 0 ? Math.round(totalMinutesPlayed / players.length) : 0;
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFinish = async () => {
    // Auto-save stats if linked to an event and not already saved
    if (linkedEventId && teamId && !statsSaved) {
      try {
        await saveGameStats({
          eventId: linkedEventId,
          teamId,
          players,
          totalGameTime,
          halfDuration: halfDuration || Math.floor(totalGameTime / 2),
          formationUsed,
          teamSize,
          executedSubs,
          goals,
          eventTitle,
          eventDate,
          opponent,
        });
        setStatsSaved(true);
      } catch (error) {
        console.error("Failed to save game stats:", error);
        // Continue with cleanup even if save fails
      }
    }

    // Clear timer state — team-specific key first, then only clear active key if it matches
    if (teamId) {
      const teamTimerKey = `pitch-board-timer-state-team-${teamId}`;
      localStorage.removeItem(teamTimerKey);
      
      // Only clear the shared active key if it belongs to THIS team
      const activeTimerRaw = localStorage.getItem(TIMER_STATE_KEY);
      if (activeTimerRaw) {
        try {
          const activeTimer = JSON.parse(activeTimerRaw);
          if (activeTimer.teamId === teamId) {
            localStorage.removeItem(TIMER_STATE_KEY);
          }
        } catch { localStorage.removeItem(TIMER_STATE_KEY); }
      }
    } else {
      localStorage.removeItem(TIMER_STATE_KEY);
    }
    
    // Clear pitch state but also ensure auto-sub plan is cancelled
    const pitchStateKey = teamId ? getPitchStateKeyForTeam(teamId) : PITCH_STATE_KEY;
    const pitchStateRaw = localStorage.getItem(pitchStateKey) || localStorage.getItem(PITCH_STATE_KEY);
    if (pitchStateRaw) {
      try {
        const pitchState = JSON.parse(pitchStateRaw);
        // Clear the auto-sub plan
        pitchState.autoSubPlan = [];
        pitchState.autoSubActive = false;
        pitchState.autoSubPaused = false;
        // Clear linked event
        pitchState.linkedEventId = null;
        const json = JSON.stringify(pitchState);
        if (teamId) localStorage.setItem(getPitchStateKeyForTeam(teamId), json);
        // Only write to active key if it belongs to this team
        const activeRaw = localStorage.getItem(PITCH_STATE_KEY);
        if (activeRaw) {
          try {
            const activeState = JSON.parse(activeRaw);
            if (!activeState.teamId || activeState.teamId === teamId) {
              localStorage.setItem(PITCH_STATE_KEY, json);
            }
          } catch { localStorage.setItem(PITCH_STATE_KEY, json); }
        } else {
          localStorage.setItem(PITCH_STATE_KEY, json);
        }
      } catch (e) {
        console.error('Failed to clear auto-sub plan:', e);
      }
    }
    if (teamId) localStorage.removeItem(getPitchStateKeyForTeam(teamId));
    // Only remove active key if it belongs to this team (prevent wiping another team's state)
    const activeKeyRaw = localStorage.getItem(PITCH_STATE_KEY);
    if (activeKeyRaw) {
      try {
        const activeState = JSON.parse(activeKeyRaw);
        if (!activeState.teamId || activeState.teamId === teamId) {
          localStorage.removeItem(PITCH_STATE_KEY);
        }
      } catch { localStorage.removeItem(PITCH_STATE_KEY); }
    } else {
      localStorage.removeItem(PITCH_STATE_KEY);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md z-[99999]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Game Finished!
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {teamName && (
            <p className="text-center text-muted-foreground">{teamName}</p>
          )}
          
          {/* Event linked indicator */}
          {linkedEventId && (
            <div className="flex items-center justify-center gap-2 text-sm text-primary">
              <CalendarCheck className="h-4 w-4" />
              <span>Stats will be saved to linked game</span>
            </div>
          )}
          
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-primary/10 rounded-lg p-3 text-center">
              <Clock className="h-4 w-4 mx-auto mb-1 text-primary" />
              <p className="text-xl font-bold">{formatTime(totalGameTime)}</p>
              <p className="text-[10px] text-muted-foreground">Total Time</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{players.length}</p>
              <p className="text-[10px] text-muted-foreground">Players</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <Clock className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{formatTime(avgMinutes)}</p>
              <p className="text-[10px] text-muted-foreground">Avg/Player</p>
            </div>
          </div>
          
          {/* Player list */}
          {players.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Final Playing Time</p>
              <ScrollArea className="h-[200px]">
                <div className="space-y-1.5">
                  {sortedPlayers.map((player, index) => {
                    const minutes = player.minutesPlayed || 0;
                    const gamePercentage = totalGameTime > 0 ? Math.round((minutes / totalGameTime) * 100) : 0;
                    
                    return (
                      <div key={player.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                        <span className="text-xs text-muted-foreground w-4">{index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">
                              {player.number ? `#${player.number} ` : ''}{player.name}
                            </span>
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {gamePercentage}%
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${gamePercentage}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">
                              {formatTime(minutes)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button onClick={handleFinish} className="w-full" disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving Stats...
              </>
            ) : statsSaved ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Done
              </>
            ) : (
              <>
                <Trophy className="h-4 w-4 mr-2" />
                {linkedEventId ? "Save & Finish" : "Done"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
