import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Target } from "lucide-react";
import { PitchPosition } from "./PositionBadge";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
}

interface Goal {
  id: string;
  scorerId?: string;
  scorerName?: string;
  time: number;
  half: 1 | 2;
  isOpponentGoal?: boolean;
}

interface MatchStatsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  elapsedGameTime?: number;
  goals?: Goal[];
  teamName?: string;
  opponentName?: string;
  hideScores?: boolean;
}

export default function MatchStatsPanel({ open, onOpenChange, players, elapsedGameTime = 0, goals = [], teamName = "Team", opponentName = "Opponent", hideScores = false }: MatchStatsPanelProps) {
  // Sort players by minutes played (descending)
  const sortedPlayers = [...players].sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
  
  const avgMinutes = players.length > 0 ? Math.round(players.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0) / players.length) : 0;
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = (player: Player) => {
    if (player.position !== null) {
      return <Badge variant="default" className="text-[10px] px-1.5">On Pitch</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px] px-1.5">Bench</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md z-[99999] sm:max-w-md landscape:max-w-2xl max-h-[100dvh] sm:max-h-[85vh] landscape:max-h-[90vh] h-[100dvh] sm:h-auto landscape:h-auto w-full sm:w-auto landscape:w-[90vw] rounded-none sm:rounded-lg landscape:rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Match Statistics
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Score display - only when scoring is enabled */}
          {!hideScores && goals.length > 0 && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center justify-center gap-6">
                <div className="text-center">
                  <p className="text-3xl font-bold">{goals.filter(g => !g.isOpponentGoal).length}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[80px]">{teamName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  <span className="text-lg font-medium text-muted-foreground">-</span>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold">{goals.filter(g => g.isOpponentGoal).length}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-[80px]">{opponentName}</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Summary stats */}
          <div className={`grid ${!hideScores ? 'grid-cols-2' : 'grid-cols-2'} gap-3`}>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{formatTime(elapsedGameTime)}</p>
              <p className="text-xs text-muted-foreground">Game Time</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{formatTime(avgMinutes)}</p>
              <p className="text-xs text-muted-foreground">Avg per Player</p>
            </div>
          </div>
          
          {/* Player list */}
          <div>
            <p className="text-sm font-medium mb-2">Minutes by Player</p>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {sortedPlayers.map((player, index) => {
                  const minutes = player.minutesPlayed || 0;
                  const maxMinutes = sortedPlayers.length > 0 ? (sortedPlayers[0].minutesPlayed || 0) : 0;
                  const percentage = maxMinutes > 0 ? (minutes / maxMinutes) * 100 : 0;
                  
                  return (
                    <div key={player.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground w-5">{index + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {player.number ? `#${player.number} ` : ''}{player.name}
                          </span>
                          {getStatusBadge(player)}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right">
                            {formatTime(minutes)}
                          </span>
                        </div>
                        {player.assignedPositions && player.assignedPositions.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {player.assignedPositions.map(pos => (
                              <span key={pos} className="text-[10px] text-muted-foreground">
                                {pos}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
