import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { 
  Pencil, Eraser, Trash2, MoveRight, Save, FolderOpen, Loader2, 
  ZoomIn, ZoomOut, RotateCcw, RefreshCw, Users, Settings2, List, 
  Clock, Calendar, BarChart3, Pause, Play, X, ChevronDown, ChevronUp,
  Palette, Timer, PenTool, Eye, Database, GripHorizontal, Volume2, VolumeX, Undo2, ArrowLeftRight,
  Target, Link2, Link2Off
} from "lucide-react";
import { cn } from "@/lib/utils";
import GameTimer, { GameTimerRef } from "./GameTimer";

import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { PitchSettingsDialog } from "./PitchSettingsDialog";

type TeamSize = "4" | "7" | "9" | "11";
type DrawingTool = "none" | "pen" | "arrow";

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: any;
  playerIn: any;
  positionSwap?: any;
  executed?: boolean;
}

interface Formation {
  id: string;
  name: string;
  team_size: number;
  profiles: any;
}

interface PitchToolbarProps {
  // Team info
  teamId: string;
  teamName: string;
  
  // Formation
  teamSize: TeamSize;
  onTeamSizeChange: (size: TeamSize) => void;
  selectedFormation: number;
  onFormationChange: (value: string) => void;
  formations: { name: string; positions: { x: number; y: number }[] }[];
  
  // Timer & Subs
  gameTimerRef: React.RefObject<GameTimerRef>;
  onTimerUpdate: (elapsed: number, half: 1 | 2) => void;
  onHalfChange: (half: 1 | 2) => void;
  disableAutoSubs: boolean;
  autoSubActive: boolean;
  autoSubPaused: boolean;
  autoSubPlan: SubstitutionEvent[];
  onOpenNewPlan: () => void;
  onTogglePause: () => void;
  onCancelPlan: () => void;
  onOpenEditPlan: () => void;
  
  // Substitution Mode
  subMode: boolean;
  onToggleSubMode: () => void;
  selectedOnPitch: string | null;
  onOpenSubPreview: () => void;
  
  // Swap Mode
  swapMode?: boolean;
  onToggleSwapMode?: () => void;
  canSwap?: boolean; // true if at least 2 players on pitch
  
  // Drawing
  drawingTool: DrawingTool;
  onDrawingToolChange: (tool: DrawingTool) => void;
  drawingColor: string;
  onDrawingColorChange: (color: string) => void;
  onClearDrawings: () => void;
  
  // View
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onOpenStats: () => void;
  
  // Data
  mockMode: boolean;
  onMockModeChange: (checked: boolean) => void;
  onOpenPositionEditor: () => void;
  
  // Save/Load
  saveDialogOpen: boolean;
  onSaveDialogOpenChange: (open: boolean) => void;
  loadDialogOpen: boolean;
  onLoadDialogOpenChange: (open: boolean) => void;
  formationName: string;
  onFormationNameChange: (name: string) => void;
  onSaveFormation: () => void;
  savePending: boolean;
  loadingFormations: boolean;
  savedFormations: Formation[] | undefined;
  onLoadFormation: (formation: Formation) => void;
  onDeleteFormation: (id: string) => void;
  
  // Time display
  players: { position: { x: number; y: number } | null; minutesPlayed?: number }[];
  
  // Layout
  variant?: "portrait" | "landscape";
  
  // Collapse state
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  
  // Read-only mode - disables all editing controls
  readOnly?: boolean;
  
  // Reset game
  onResetGame?: () => void;
  
  // Reset formation (players + ball positions only)
  onResetFormation?: () => void;

  // Undo
  onUndo?: () => void;
  canUndo?: boolean;
  undoDescription?: string;
  
  // Game state
  gameInProgress?: boolean;
  
  // Minutes per half (for settings dialog)
  minutesPerHalf?: number;
  onMinutesPerHalfChange?: (minutes: number) => void;
  
  // Rotation speed (subs speed)
  rotationSpeed?: number;
  onRotationSpeedChange?: (speed: number) => void;
  
  // Disable position swaps in auto sub generation
  disablePositionSwaps?: boolean;
  onDisablePositionSwapsChange?: (disabled: boolean) => void;
  
  // Disable batch subs (multiple at once)
  disableBatchSubs?: boolean;
  onDisableBatchSubsChange?: (disabled: boolean) => void;
  
  // Save settings
  onSaveSettings?: () => void;
  isSavingSettings?: boolean;
  
  // Match header toggle
  showMatchHeader?: boolean;
  onShowMatchHeaderChange?: (show: boolean) => void;
  
  // Hide scores toggle
  hideScores?: boolean;
  onHideScoresChange?: (hide: boolean) => void;
  
  // Match info for landscape toolbar integration
  opponentName?: string;
  linkedEventId?: string | null;
  onLinkEvent?: (eventId: string | null) => void;
  onOpenEventSelector?: () => void;
  currentScore?: { team: number; opponent: number };
  onToggleScorePanel?: () => void;
  scorePanelExpanded?: boolean;
}

interface ToolbarGroupProps {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ToolbarGroup({ label, icon, children, defaultOpen = true, className, open, onOpenChange }: ToolbarGroupProps) {
  return (
    <Collapsible 
      defaultOpen={defaultOpen} 
      open={open} 
      onOpenChange={onOpenChange}
      className={cn("border-b border-border", className)}
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/50 transition-colors group">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function PitchToolbar({
  teamId,
  teamName,
  teamSize,
  onTeamSizeChange,
  selectedFormation,
  onFormationChange,
  formations,
  gameTimerRef,
  onTimerUpdate,
  onHalfChange,
  disableAutoSubs,
  autoSubActive,
  autoSubPaused,
  autoSubPlan,
  onOpenNewPlan,
  onTogglePause,
  onCancelPlan,
  onOpenEditPlan,
  subMode,
  onToggleSubMode,
  selectedOnPitch,
  onOpenSubPreview,
  swapMode = false,
  onToggleSwapMode,
  canSwap = false,
  drawingTool,
  onDrawingToolChange,
  drawingColor,
  onDrawingColorChange,
  onClearDrawings,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onOpenStats,
  mockMode,
  onMockModeChange,
  onOpenPositionEditor,
  saveDialogOpen,
  onSaveDialogOpenChange,
  loadDialogOpen,
  onLoadDialogOpenChange,
  formationName,
  onFormationNameChange,
  onSaveFormation,
  savePending,
  loadingFormations,
  savedFormations,
  onLoadFormation,
  onDeleteFormation,
  players,
  variant = "portrait",
  collapsed = false,
  onToggleCollapse,
  readOnly = false,
  onResetGame,
  onResetFormation,
  onUndo,
  canUndo = false,
  undoDescription,
  gameInProgress = false,
  minutesPerHalf = 45,
  onMinutesPerHalfChange,
  rotationSpeed = 2,
  onRotationSpeedChange,
  disablePositionSwaps = false,
  onDisablePositionSwapsChange,
  disableBatchSubs = false,
  onDisableBatchSubsChange,
  onSaveSettings,
  isSavingSettings = false,
  showMatchHeader,
  onShowMatchHeaderChange,
  hideScores = false,
  onHideScoresChange,
  opponentName,
  linkedEventId,
  onLinkEvent,
  onOpenEventSelector,
  currentScore,
  onToggleScorePanel,
  scorePanelExpanded,
}: PitchToolbarProps) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [timerRunning, setTimerRunning] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);
  
  // Persist expanded section states across collapse/expand cycles
  // In landscape mode, only Subs should be expanded by default (bench is handled separately in PitchBoard)
  const [matchOpen, setMatchOpen] = useState(true); // Match info section for landscape
  const [subsOpen, setSubsOpen] = useState(true);
  const [timerOpen, setTimerOpen] = useState(variant !== "landscape");
  const [drawOpen, setDrawOpen] = useState(false);
  const [formationOpen, setFormationOpen] = useState(false);
  

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const onPitchPlayers = players.filter(p => p.position !== null);
  const benchPlayers = players.filter(p => p.position === null);
  const onPitchMinutes = onPitchPlayers.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);
  const benchMinutes = benchPlayers.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);

  if (variant === "landscape") {
    // Collapsed state for landscape - just show swipe indicator
    if (collapsed) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-2">
          <div className="text-muted-foreground/50">
            <ChevronDown className="h-4 w-4 rotate-[-90deg] animate-pulse" />
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        {/* Content - no separate scroll, parent container handles scrolling */}
        <div>
          {/* Match Info Group - at top for quick access to opponent/score */}
          <ToolbarGroup label="Match" icon={<Target className="h-3.5 w-3.5" />} open={matchOpen} onOpenChange={setMatchOpen}>
            <div className="space-y-3">
              {/* Opponent display */}
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">
                  {linkedEventId ? "Playing against" : "No game linked"}
                </p>
                {opponentName ? (
                  <p className="font-semibold text-sm">{opponentName}</p>
                ) : linkedEventId ? (
                  <p className="text-sm text-muted-foreground italic">Unknown opponent</p>
                ) : null}
              </div>

              {/* Score button */}
              {!hideScores && currentScore && onToggleScorePanel && (
                <Button
                  variant={scorePanelExpanded ? "secondary" : "outline"}
                  className="w-full h-10"
                  onClick={onToggleScorePanel}
                >
                  <Target className="h-4 w-4 mr-2" />
                  <span className="font-bold text-lg">{currentScore.team} - {currentScore.opponent}</span>
                </Button>
              )}

              {/* Link/Unlink buttons */}
              {!readOnly && onLinkEvent && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9"
                    onClick={onOpenEventSelector}
                  >
                    <Link2 className="h-4 w-4 mr-1.5" />
                    {linkedEventId ? "Change" : "Link Game"}
                  </Button>
                  {linkedEventId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onLinkEvent(null)}
                    >
                      <Link2Off className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </ToolbarGroup>

          {/* Substitutions Group */}
          {!readOnly && (
            <ToolbarGroup label="Subs" icon={<RefreshCw className="h-3.5 w-3.5" />} open={subsOpen} onOpenChange={setSubsOpen}>
              <div className="space-y-2">
                <Button
                  variant={subMode ? "default" : "outline"}
                  className="w-full h-9 text-sm"
                  onClick={onToggleSubMode}
                >
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  {subMode ? "Cancel" : "Make Sub"}
                </Button>
                
                {subMode && selectedOnPitch && (
                  <Button variant="outline" className="w-full h-8 text-xs" onClick={onOpenSubPreview}>
                    <List className="h-3.5 w-3.5 mr-1.5" />
                    Options
                  </Button>
                )}
                
                {subMode && (
                  <p className="text-xs text-muted-foreground text-center">
                    {selectedOnPitch ? "Select bench player" : "Select on pitch"}
                  </p>
                )}

                {!disableAutoSubs && (
                  <div className="pt-2 border-t border-border">
                    {!autoSubActive ? (
                      <Button 
                        variant="outline" 
                        className="w-full h-9 text-sm" 
                        onClick={onOpenNewPlan}
                        disabled={gameInProgress}
                        title={gameInProgress ? "Can only create plan before game starts" : undefined}
                      >
                        <Calendar className="h-4 w-4 mr-1.5" />
                        Auto-Subs
                      </Button>
                    ) : (
                      <Button variant="destructive" size="sm" className="w-full h-8 text-xs" onClick={onCancelPlan}>
                        <X className="h-3.5 w-3.5 mr-1" />
                        Cancel Plan
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </ToolbarGroup>
          )}

          {/* Timer & Game Group */}
          <ToolbarGroup label="Timer" icon={<Timer className="h-3.5 w-3.5" />} open={timerOpen} onOpenChange={setTimerOpen}>
            <div className="space-y-3">
              <GameTimer 
                ref={gameTimerRef} 
                teamId={teamId} 
                teamName={teamName} 
                onTimeUpdate={onTimerUpdate} 
                onHalfChange={onHalfChange} 
                readOnly={readOnly}
                hideSoundToggle
                soundEnabled={soundEnabled}
                onSoundToggle={setSoundEnabled}
                minutesPerHalf={minutesPerHalf}
                onMinutesPerHalfChange={onMinutesPerHalfChange}
              />
              {/* Sync status indicator */}
              <div className="flex justify-center">
                <SyncStatusIndicator />
              </div>
              {/* Quick access icons row - Stats, Positions, Mock, Sound, Reset */}
              <div className="flex items-center justify-center gap-4 flex-wrap">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" className="h-12 w-12" onClick={onOpenStats}>
                        <BarChart3 className="h-6 w-6" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Match Stats</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {!readOnly && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-12 w-12" onClick={onOpenPositionEditor}>
                          <Settings2 className="h-6 w-6" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Player Positions</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {!readOnly && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant={mockMode ? "default" : "outline"} 
                          size="icon" 
                          className="h-12 w-12"
                          onClick={() => onMockModeChange(!mockMode)}
                        >
                          <Users className="h-6 w-6" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Mock Data {mockMode ? "(On)" : "(Off)"}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant={soundEnabled ? "outline" : "secondary"} 
                        size="icon" 
                        className="h-12 w-12"
                        onClick={() => setSoundEnabled(!soundEnabled)}
                      >
                        {soundEnabled ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Sound {soundEnabled ? "(On)" : "(Off)"}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {!readOnly && onUndo && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-12 w-12"
                          disabled={!canUndo}
                          onClick={() => setUndoConfirmOpen(true)}
                        >
                          <Undo2 className="h-6 w-6" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Undo Last Sub/Swap</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {!readOnly && onResetGame && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-12 w-12 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setResetConfirmOpen(true)}
                        >
                          <Trash2 className="h-6 w-6" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Reset Game</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            </div>
          </ToolbarGroup>

          {/* Drawing Group - under Timer */}
          {!readOnly && (
            <ToolbarGroup label="Draw" icon={<PenTool className="h-3.5 w-3.5" />} open={drawOpen} onOpenChange={setDrawOpen}>
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant={drawingTool === "pen" ? "default" : "outline"} 
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => onDrawingToolChange(drawingTool === "pen" ? "none" : "pen")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Draw</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant={drawingTool === "arrow" ? "default" : "outline"} 
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => onDrawingToolChange(drawingTool === "arrow" ? "none" : "arrow")}
                        >
                          <MoveRight className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Arrow</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9" onClick={onClearDrawings}>
                          <Eraser className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Clear</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {(drawingTool === "pen" || drawingTool === "arrow") && (
                  <div className="flex gap-1.5">
                    {["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308"].map(color => (
                      <button
                        key={color}
                        className={cn(
                          "w-7 h-7 rounded-full border-2",
                          drawingColor === color ? "border-primary" : "border-transparent"
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => onDrawingColorChange(color)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ToolbarGroup>
          )}

          {/* Formation Group */}
          <ToolbarGroup label="Formation" icon={<Palette className="h-3.5 w-3.5" />} open={formationOpen} onOpenChange={setFormationOpen}>
            <div className="space-y-2">
              <Select value={teamSize} onValueChange={(v) => onTeamSizeChange(v as TeamSize)} disabled={readOnly}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[99999] bg-popover">
                  <SelectItem value="4">4-a-side</SelectItem>
                  <SelectItem value="7">7-a-side</SelectItem>
                  <SelectItem value="9">9-a-side</SelectItem>
                  <SelectItem value="11">11-a-side</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedFormation.toString()} onValueChange={onFormationChange} disabled={readOnly}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[99999] bg-popover">
                  {formations.map((f, i) => (
                    <SelectItem key={i} value={i.toString()}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </ToolbarGroup>
        </div>

        {/* Undo Confirmation AlertDialog for landscape */}
        {!readOnly && onUndo && (
          <AlertDialog open={undoConfirmOpen} onOpenChange={setUndoConfirmOpen}>
            <AlertDialogContent className="z-[99999]">
              <AlertDialogHeader>
                <AlertDialogTitle>Undo Last Action?</AlertDialogTitle>
                <AlertDialogDescription>
                  {undoDescription ? (
                    <>Are you sure you want to undo: <strong>{undoDescription}</strong>?</>
                  ) : (
                    "Are you sure you want to undo the last substitution or swap?"
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    onUndo();
                    setUndoConfirmOpen(false);
                  }}
                >
                  Undo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    );
  }

  // Calculate number of items in row 1 for dynamic sizing (used for both collapsed and expanded)
  const collapsedRow1ItemCount = [
    true, // Timer (always)
    true, // Sync indicator (always)
    !readOnly, // Sub button
    !readOnly && !disableAutoSubs, // Plan button
    !readOnly && onUndo && canUndo, // Undo button (only when active)
    true, // Collapse (always)
  ].filter(Boolean).length;
  
  // Dynamic button size for collapsed mode - fewer items = larger buttons
  const collapsedButtonHeight = collapsedRow1ItemCount <= 4 ? "h-9" : collapsedRow1ItemCount <= 5 ? "h-8" : collapsedRow1ItemCount <= 6 ? "h-7" : "h-7";
  const collapsedIconSizeNum = collapsedRow1ItemCount <= 4 ? 16 : collapsedRow1ItemCount <= 5 ? 14 : 12;
  const collapsedTimerClass = collapsedRow1ItemCount <= 4 ? `${collapsedButtonHeight} px-2.5 gap-1.5 font-mono text-sm` : collapsedRow1ItemCount <= 5 ? `${collapsedButtonHeight} px-2 gap-1 font-mono text-xs` : `${collapsedButtonHeight} px-1.5 gap-1 font-mono text-xs`;
  const collapsedSubButtonClass = collapsedRow1ItemCount <= 4 ? `${collapsedButtonHeight} px-2.5 text-sm` : collapsedRow1ItemCount <= 5 ? `${collapsedButtonHeight} px-2 text-xs` : `${collapsedButtonHeight} px-1.5 text-xs`;

  // Portrait layout - compact horizontal toolbar with collapse
  // Collapsed state - show minimal bar with toggle
  if (collapsed) {
    return (
      <>
        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Button
              variant="outline"
              className={collapsedTimerClass}
              onClick={() => {
                if (!readOnly) {
                  gameTimerRef.current?.toggleTimer();
                  setTimerRunning(!timerRunning);
                }
              }}
              disabled={readOnly}
            >
              {timerRunning ? <Pause size={collapsedIconSizeNum} /> : <Play size={collapsedIconSizeNum} />}
              <GameTimer ref={gameTimerRef} teamId={teamId} teamName={teamName} onTimeUpdate={(elapsed, half) => { onTimerUpdate?.(elapsed, half); if (gameTimerRef.current) setTimerRunning(gameTimerRef.current.isRunning()); }} onHalfChange={onHalfChange} readOnly={readOnly} compact hideSoundToggle hidePlayPause hideExtras soundEnabled={soundEnabled} onSoundToggle={setSoundEnabled} minutesPerHalf={minutesPerHalf} onMinutesPerHalfChange={onMinutesPerHalfChange} />
            </Button>
            <SyncStatusIndicator />
            {!readOnly && (
              <Button
                variant={subMode ? "default" : "secondary"}
                size="sm"
                className={collapsedSubButtonClass}
                onClick={onToggleSubMode}
              >
                <RefreshCw size={collapsedIconSizeNum} className="mr-1" />
                {subMode ? "Cancel" : "Sub"}
              </Button>
            )}
            {!readOnly && !disableAutoSubs && (
              !autoSubActive ? (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={collapsedSubButtonClass}
                  onClick={onOpenNewPlan}
                  disabled={gameInProgress}
                  title={gameInProgress ? "Can only create plan before game starts" : undefined}
                >
                  <Calendar size={collapsedIconSizeNum} className="mr-1" />
                  AutoSub
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className={`${collapsedButtonHeight} px-2 text-xs gap-1`}>
                      <Settings2 size={collapsedIconSizeNum} />
                      <ChevronDown size={collapsedIconSizeNum} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="z-[99999]">
                    <DropdownMenuItem onClick={onOpenEditPlan}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit Plan
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onTogglePause}>
                      {autoSubPaused ? (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Resume Plan
                        </>
                      ) : (
                        <>
                          <Pause className="h-4 w-4 mr-2" />
                          Pause Plan
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onCancelPlan} className="text-destructive focus:text-destructive">
                      <X className="h-4 w-4 mr-2" />
                      Cancel Plan
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            )}
            {!readOnly && onUndo && canUndo && (
              <Button 
                variant="outline" 
                size="sm" 
                className={collapsedSubButtonClass}
                onClick={() => setUndoConfirmOpen(true)}
              >
                <Undo2 size={collapsedIconSizeNum} className="mr-1" />
                Undo
              </Button>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onToggleCollapse} className={`${collapsedButtonHeight} w-7 shrink-0`}>
            <ChevronDown size={collapsedIconSizeNum} />
          </Button>
        </div>
        
        {/* Undo Confirmation AlertDialog - must be rendered even when collapsed */}
        {!readOnly && onUndo && (
          <AlertDialog open={undoConfirmOpen} onOpenChange={setUndoConfirmOpen}>
            <AlertDialogContent className="z-[99999]">
              <AlertDialogHeader>
                <AlertDialogTitle>Undo Last Action?</AlertDialogTitle>
                <AlertDialogDescription>
                  {undoDescription ? (
                    <>Are you sure you want to undo: <strong>{undoDescription}</strong>?</>
                  ) : (
                    "Are you sure you want to undo the last substitution or swap?"
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={(e) => { 
                    e.preventDefault();
                    onUndo(); 
                    setUndoConfirmOpen(false); 
                  }} 
                >
                  Undo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  }

  // Calculate number of items in row 1 for dynamic sizing
  const row1ItemCount = [
    true, // Timer (always)
    !readOnly, // Sub button
    !readOnly && canSwap, // Swap button
    !readOnly && !disableAutoSubs, // Plan button
    !readOnly && onUndo && canUndo, // Undo button (only when visible)
    true, // Sync indicator (always)
    true, // Settings (always)
    true, // Collapse (always)
  ].filter(Boolean).length;
  
  // Dynamic button size based on item count - fewer items = larger buttons
  const buttonHeight = row1ItemCount <= 5 ? "h-11" : row1ItemCount <= 6 ? "h-10" : row1ItemCount <= 7 ? "h-9" : "h-8";
  const buttonSize = row1ItemCount <= 5 ? "h-11 w-11" : row1ItemCount <= 6 ? "h-10 w-10" : row1ItemCount <= 7 ? "h-9 w-9" : "h-8 w-8";
  const iconSizeNum = row1ItemCount <= 5 ? 20 : row1ItemCount <= 6 ? 18 : row1ItemCount <= 7 ? 16 : 14;
  const timerButtonClass = row1ItemCount <= 5 ? `${buttonHeight} px-3 gap-2 font-mono text-base` : row1ItemCount <= 6 ? `${buttonHeight} px-2.5 gap-1.5 font-mono text-sm` : row1ItemCount <= 7 ? `${buttonHeight} px-2 gap-1.5 font-mono text-sm` : `${buttonHeight} px-1.5 gap-1 font-mono text-xs`;
  const subButtonClass = row1ItemCount <= 5 ? `${buttonHeight} px-3 text-sm` : row1ItemCount <= 6 ? `${buttonHeight} px-2.5 text-xs` : row1ItemCount <= 7 ? `${buttonHeight} px-2 text-xs` : `${buttonHeight} px-1.5 text-xs`;

  return (
    <div className="space-y-2 px-2 py-2">
      {/* Row 1: Timer + Play/Pause + Sub + Plan + Undo + Sync + Settings + Collapse */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            className={timerButtonClass}
            onClick={() => {
              if (!readOnly) {
                gameTimerRef.current?.toggleTimer();
                setTimerRunning(!timerRunning);
              }
            }}
            disabled={readOnly}
          >
            {timerRunning ? <Pause size={iconSizeNum} /> : <Play size={iconSizeNum} />}
            <GameTimer ref={gameTimerRef} teamId={teamId} teamName={teamName} onTimeUpdate={(elapsed, half) => { onTimerUpdate?.(elapsed, half); if (gameTimerRef.current) setTimerRunning(gameTimerRef.current.isRunning()); }} onHalfChange={onHalfChange} readOnly={readOnly} compact hideSoundToggle hidePlayPause hideExtras soundEnabled={soundEnabled} onSoundToggle={setSoundEnabled} minutesPerHalf={minutesPerHalf} onMinutesPerHalfChange={onMinutesPerHalfChange} />
          </Button>
          {!readOnly && (
            <Button
              variant={subMode ? "default" : "secondary"}
              size="sm"
              className={subButtonClass}
              onClick={onToggleSubMode}
            >
              <RefreshCw size={iconSizeNum} className="mr-1" />
              {subMode ? "Cancel" : "Sub"}
            </Button>
          )}
          {!readOnly && !disableAutoSubs && (
            !autoSubActive ? (
              <Button 
                variant="outline" 
                size="sm" 
                className={subButtonClass}
                onClick={onOpenNewPlan}
                disabled={gameInProgress}
                title={gameInProgress ? "Can only create plan before game starts" : undefined}
              >
                <Calendar size={iconSizeNum} className="mr-1" />
                AutoSub
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className={subButtonClass + " gap-1"}>
                    <Settings2 size={iconSizeNum} />
                    <ChevronDown size={12} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="z-[99999]">
                  <DropdownMenuItem onClick={onOpenEditPlan}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Plan
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onTogglePause}>
                    {autoSubPaused ? (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Resume Plan
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4 mr-2" />
                        Pause Plan
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onCancelPlan} className="text-destructive focus:text-destructive">
                    <X className="h-4 w-4 mr-2" />
                    Cancel Plan
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          )}
          {!readOnly && onUndo && canUndo && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className={buttonSize}
                    onClick={() => setUndoConfirmOpen(true)}
                  >
                    <Undo2 size={iconSizeNum} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo Last Sub/Swap</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <SyncStatusIndicator />
          <PitchSettingsDialog
            soundEnabled={soundEnabled}
            onSoundToggle={setSoundEnabled}
            selectedFormation={selectedFormation}
            onFormationChange={onFormationChange}
            formations={formations}
            teamSize={teamSize}
            onTeamSizeChange={onTeamSizeChange}
            minutesPerHalf={minutesPerHalf}
            onMinutesPerHalfChange={onMinutesPerHalfChange || (() => {})}
            rotationSpeed={rotationSpeed}
            onRotationSpeedChange={onRotationSpeedChange || (() => {})}
            disablePositionSwaps={disablePositionSwaps}
            onDisablePositionSwapsChange={onDisablePositionSwapsChange}
            disableBatchSubs={disableBatchSubs}
            onDisableBatchSubsChange={onDisableBatchSubsChange}
            onOpenPositionEditor={onOpenPositionEditor}
            mockMode={mockMode}
            onMockModeChange={onMockModeChange}
            readOnly={readOnly}
            triggerClassName={buttonSize}
            onResetGame={onResetGame}
            onResetFormation={onResetFormation}
            onOpenStats={onOpenStats}
            onSaveSettings={onSaveSettings}
            isSaving={isSavingSettings}
            showMatchHeader={showMatchHeader}
            onShowMatchHeaderChange={onShowMatchHeaderChange}
            hideScores={hideScores}
            onHideScoresChange={onHideScoresChange}
          />
          <Button variant="outline" size="icon" onClick={onToggleCollapse} className={buttonSize + " shrink-0"}>
            <ChevronUp size={iconSizeNum} />
          </Button>
        </div>
      </div>

      {/* Row 2: Drawing tools */}
      {!readOnly && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button 
              variant={drawingTool === "pen" ? "default" : "outline"} 
              size="icon"
              className="h-9 w-9"
              onClick={() => onDrawingToolChange(drawingTool === "pen" ? "none" : "pen")}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button 
              variant={drawingTool === "arrow" ? "default" : "outline"} 
              size="icon"
              className="h-9 w-9"
              onClick={() => onDrawingToolChange(drawingTool === "arrow" ? "none" : "arrow")}
            >
              <MoveRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={onClearDrawings}>
              <Eraser className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308"].map(color => (
              <button
                key={color}
                className={cn(
                  "w-7 h-7 rounded-full border-2",
                  drawingColor === color ? "border-primary ring-2 ring-primary/50" : "border-muted"
                )}
                style={{ backgroundColor: color }}
                onClick={() => onDrawingColorChange(color)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Single Reset Game AlertDialog shared by both landscape and portrait */}
      {!readOnly && onResetGame && (
        <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
          <AlertDialogContent className="z-[99999]">
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Game?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reset all player minutes to 0, clear the timer, and return players to their starting positions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={(e) => { 
                  e.preventDefault();
                  console.log("Reset Game clicked, calling onResetGame");
                  onResetGame(); 
                  setResetConfirmOpen(false); 
                }} 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Reset Game
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Undo Confirmation AlertDialog */}
      {!readOnly && onUndo && (
        <AlertDialog open={undoConfirmOpen} onOpenChange={setUndoConfirmOpen}>
          <AlertDialogContent className="z-[99999]">
            <AlertDialogHeader>
              <AlertDialogTitle>Undo Last Action?</AlertDialogTitle>
              <AlertDialogDescription>
                {undoDescription ? (
                  <>Are you sure you want to undo: <strong>{undoDescription}</strong>?</>
                ) : (
                  "Are you sure you want to undo the last substitution or swap?"
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={(e) => { 
                  e.preventDefault();
                  onUndo(); 
                  setUndoConfirmOpen(false); 
                }} 
              >
                Undo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

    </div>
  );
}

export default memo(PitchToolbar);
