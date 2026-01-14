import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Minus, Target, X, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Goal, Player } from "./types";

interface ScoreTrackerProps {
  goals: Goal[];
  onAddGoal: (goal: Goal) => void;
  onRemoveGoal: (goalId: string) => void;
  players: Player[];
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  teamName: string;
  opponentName?: string;
  readOnly?: boolean;
  compact?: boolean;
  mini?: boolean;
  isGameFinished?: boolean;
}

export default function ScoreTracker({
  goals,
  onAddGoal,
  onRemoveGoal,
  players,
  currentHalf,
  elapsedSeconds,
  teamName,
  opponentName = "Opponent",
  readOnly = false,
  compact = false,
  mini = false,
  isGameFinished = false,
}: ScoreTrackerProps) {
  const [showGoalSheet, setShowGoalSheet] = useState(false);
  const [selectedGoalType, setSelectedGoalType] = useState<"team" | "opponent" | null>(null);

  const teamGoals = goals.filter((g) => !g.isOpponentGoal);
  const opponentGoals = goals.filter((g) => g.isOpponentGoal);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins}'`;
  };

  const handleAddTeamGoal = () => {
    setSelectedGoalType("team");
    setShowGoalSheet(true);
  };

  const handleAddOpponentGoal = () => {
    const newGoal: Goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      time: elapsedSeconds,
      half: currentHalf,
      isOpponentGoal: true,
    };
    onAddGoal(newGoal);
  };

  const handleSelectScorer = (player: Player | null) => {
    const newGoal: Goal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scorerId: player?.id,
      scorerName: player?.name,
      time: elapsedSeconds,
      half: currentHalf,
      isOpponentGoal: false,
    };
    onAddGoal(newGoal);
    setShowGoalSheet(false);
    setSelectedGoalType(null);
  };

  const handleRemoveLastTeamGoal = () => {
    if (teamGoals.length > 0) {
      onRemoveGoal(teamGoals[teamGoals.length - 1].id);
    }
  };

  const handleRemoveLastOpponentGoal = () => {
    if (opponentGoals.length > 0) {
      onRemoveGoal(opponentGoals[opponentGoals.length - 1].id);
    }
  };

  // Get players on pitch for scorer selection
  const playersOnPitch = players.filter((p) => p.position !== null);

  // Combine readOnly and isGameFinished for score locking
  const isLocked = readOnly || isGameFinished;

  // Mini mode - just score display, click to add goals
  if (mini) {
    return (
      <>
        <button
          onClick={() => {
            if (!isLocked) {
              setSelectedGoalType("team");
              setShowGoalSheet(true);
            }
          }}
          className={cn(
            "flex items-center gap-1.5 bg-background/90 backdrop-blur-sm rounded-md px-2 py-1 shadow-sm border border-border",
            !isLocked && "hover:bg-background cursor-pointer active:scale-95 transition-transform",
            isGameFinished && "ring-2 ring-primary/30"
          )}
        >
          <Badge variant="default" className="text-sm font-bold px-1.5 min-w-[20px] justify-center h-5">
            {teamGoals.length}
          </Badge>
          <span className="text-muted-foreground text-xs">-</span>
          <Badge variant="secondary" className="text-sm font-bold px-1.5 min-w-[20px] justify-center h-5">
            {opponentGoals.length}
          </Badge>
        </button>

        {/* Goal scorer selection sheet */}
        <Sheet open={showGoalSheet} onOpenChange={setShowGoalSheet}>
          <SheetContent
            side="bottom"
            className="rounded-t-xl h-[85vh]"
            style={{ zIndex: 100001 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Add Goal
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-4rem)]">
              <div className="space-y-3 pr-4">
                {/* Team goal section */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{teamName} Goal</p>
                  <button
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => handleSelectScorer(null)}
                  >
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Unknown / Own Goal</span>
                    </div>
                  </button>
                  {playersOnPitch.map((player) => (
                    <button
                      key={player.id}
                      className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                      onClick={() => handleSelectScorer(player)}
                    >
                      <div className="flex items-center gap-2">
                        {player.number && (
                          <Badge variant="outline" className="text-xs">
                            #{player.number}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{player.name}</span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Opponent goal section */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-sm font-medium text-muted-foreground">{opponentName} Goal</p>
                  <button
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                    onClick={handleAddOpponentGoal}
                  >
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">Add {opponentName} Goal</span>
                    </div>
                  </button>
                </div>
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm rounded-lg px-3 py-2 shadow-md border border-border">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium truncate max-w-[60px]">{teamName}</span>
          <Badge variant="default" className="text-lg font-bold px-2 min-w-[28px] justify-center">
            {teamGoals.length}
          </Badge>
        </div>
        <span className="text-muted-foreground text-sm">-</span>
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="text-lg font-bold px-2 min-w-[28px] justify-center">
            {opponentGoals.length}
          </Badge>
          <span className="text-xs font-medium truncate max-w-[60px]">{opponentName}</span>
        </div>
        {!isLocked && (
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-primary/20"
              onClick={handleAddTeamGoal}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-secondary/50"
              onClick={handleAddOpponentGoal}
            >
              <Target className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Goal scorer selection sheet */}
        <Sheet open={showGoalSheet} onOpenChange={setShowGoalSheet}>
          <SheetContent
            side="bottom"
            className="rounded-t-xl h-[85vh]"
            style={{ zIndex: 100001 }}
          >
            <SheetHeader className="pb-2">
              <SheetTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Who Scored?
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(85vh-4rem)]">
              <div className="space-y-2 pr-4">
                {/* Unknown scorer option */}
                <button
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  onClick={() => handleSelectScorer(null)}
                >
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">Unknown / Own Goal</span>
                  </div>
                </button>

                {/* Players on pitch */}
                {playersOnPitch.map((player) => (
                  <button
                    key={player.id}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => handleSelectScorer(player)}
                  >
                    <div className="flex items-center gap-2">
                      {player.number && (
                        <Badge variant="outline" className="text-xs">
                          #{player.number}
                        </Badge>
                      )}
                      <span className="font-medium text-sm">{player.name}</span>
                      {player.currentPitchPosition && (
                        <span className="text-xs text-muted-foreground">
                          ({player.currentPitchPosition})
                        </span>
                      )}
                    </div>
                  </button>
                ))}

                {/* Players on bench (less prominent) */}
                {players
                  .filter((p) => p.position === null)
                  .map((player) => (
                    <button
                      key={player.id}
                      className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors opacity-60"
                      onClick={() => handleSelectScorer(player)}
                    >
                      <div className="flex items-center gap-2">
                        {player.number && (
                          <Badge variant="outline" className="text-xs">
                            #{player.number}
                          </Badge>
                        )}
                        <span className="font-medium text-sm">{player.name}</span>
                        <span className="text-xs text-muted-foreground">(Bench)</span>
                      </div>
                    </button>
                  ))}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className={cn(
      "bg-background/95 backdrop-blur-sm rounded-xl p-3 shadow-md border border-border",
      isGameFinished && "ring-2 ring-primary/30"
    )}>
      {/* Score display */}
      <div className="flex items-center justify-center gap-4 mb-3">
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-xs font-medium text-muted-foreground truncate max-w-full">
            {teamName}
          </span>
          <div className="flex items-center gap-2">
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRemoveLastTeamGoal}
                disabled={teamGoals.length === 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
            <Badge
              variant="default"
              className="text-2xl font-bold px-4 py-1 min-w-[48px] justify-center"
            >
              {teamGoals.length}
            </Badge>
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleAddTeamGoal}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <span className="text-2xl font-bold text-muted-foreground">-</span>

        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-xs font-medium text-muted-foreground truncate max-w-full">
            {opponentName}
          </span>
          <div className="flex items-center gap-2">
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRemoveLastOpponentGoal}
                disabled={opponentGoals.length === 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
            <Badge
              variant="secondary"
              className="text-2xl font-bold px-4 py-1 min-w-[48px] justify-center"
            >
              {opponentGoals.length}
            </Badge>
            {!isLocked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleAddOpponentGoal}
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Goal timeline */}
      {goals.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="text-[10px] text-muted-foreground mb-1">
            {isGameFinished ? "Final Score" : "Goals"}
          </p>
          <div className="flex flex-wrap gap-1">
            {goals
              .sort((a, b) => a.time - b.time)
              .map((goal) => (
                <div
                  key={goal.id}
                  className={cn(
                    "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full",
                    goal.isOpponentGoal
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-primary/20 text-primary"
                  )}
                >
                  <span>{formatTime(goal.time)}</span>
                  {goal.scorerName && (
                    <span className="font-medium truncate max-w-[80px]">
                      {goal.scorerName}
                    </span>
                  )}
                  {goal.isOpponentGoal && <span>Opp</span>}
                  {!isLocked && (
                    <button
                      onClick={() => onRemoveGoal(goal.id)}
                      className="hover:bg-background/50 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Goal scorer selection sheet */}
      <Sheet open={showGoalSheet} onOpenChange={setShowGoalSheet}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl h-[85vh]"
          style={{ zIndex: 100001 }}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Who Scored?
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(85vh-4rem)]">
            <div className="space-y-2 pr-4">
              {/* Unknown scorer option */}
              <button
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                onClick={() => handleSelectScorer(null)}
              >
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">Unknown / Own Goal</span>
                </div>
              </button>

              {/* Players on pitch */}
              {playersOnPitch.map((player) => (
                <button
                  key={player.id}
                  className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  onClick={() => handleSelectScorer(player)}
                >
                  <div className="flex items-center gap-2">
                    {player.number && (
                      <Badge variant="outline" className="text-xs">
                        #{player.number}
                      </Badge>
                    )}
                    <span className="font-medium text-sm">{player.name}</span>
                    {player.currentPitchPosition && (
                      <span className="text-xs text-muted-foreground">
                        ({player.currentPitchPosition})
                      </span>
                    )}
                  </div>
                </button>
              ))}

              {/* Players on bench (less prominent) */}
              {players
                .filter((p) => p.position === null)
                .map((player) => (
                  <button
                    key={player.id}
                    className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors opacity-60"
                    onClick={() => handleSelectScorer(player)}
                  >
                    <div className="flex items-center gap-2">
                      {player.number && (
                        <Badge variant="outline" className="text-xs">
                          #{player.number}
                        </Badge>
                      )}
                      <span className="font-medium text-sm">{player.name}</span>
                      <span className="text-xs text-muted-foreground">(Bench)</span>
                    </div>
                  </button>
                ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
