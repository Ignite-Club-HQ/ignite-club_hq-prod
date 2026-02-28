import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  ResponsiveDialog, 
  ResponsiveDialogContent, 
  ResponsiveDialogHeader, 
  ResponsiveDialogTitle 
} from "@/components/ui/responsive-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Settings, Volume2, VolumeX, Users, Trash2, BarChart3, Settings2, Save, X, ChevronDown, RotateCcw, CalendarCheck, EyeOff, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamSize } from "./types";

interface Formation {
  name: string;
  positions: { x: number; y: number }[];
}

interface PitchSettingsDialogProps {
  // Sound
  soundEnabled: boolean;
  onSoundToggle: (enabled: boolean) => void;
  
  // Formation
  selectedFormation: number;
  onFormationChange: (value: string) => void;
  formations: Formation[];
  
  // Team size
  teamSize: TeamSize;
  onTeamSizeChange: (size: TeamSize) => void;
  
  // Time per half
  minutesPerHalf: number;
  onMinutesPerHalfChange: (minutes: number) => void;
  
  // Rotation speed (subs speed)
  rotationSpeed: number;
  onRotationSpeedChange: (speed: number) => void;
  
  // Disable position swaps in auto sub generation
  disablePositionSwaps?: boolean;
  onDisablePositionSwapsChange?: (disabled: boolean) => void;
  
  // Disable batch subs (multiple at once)
  disableBatchSubs?: boolean;
  onDisableBatchSubsChange?: (disabled: boolean) => void;
  
  // Player position preference
  onOpenPositionEditor: () => void;
  
  // Mock data
  mockMode: boolean;
  onMockModeChange: (enabled: boolean) => void;
  
  // Read-only mode
  readOnly?: boolean;
  
  // Optional trigger button customization
  triggerClassName?: string;
  
  // Reset game
  onResetGame?: () => void;
  
  // Reset formation (players + ball to default positions)
  onResetFormation?: () => void;
  
  // Match stats
  onOpenStats?: () => void;
  
  // Save settings
  onSaveSettings?: () => void;
  isSaving?: boolean;
  
  // Match header toggle
  showMatchHeader?: boolean;
  onShowMatchHeaderChange?: (show: boolean) => void;
  
  // Hide scores toggle
  hideScores?: boolean;
  onHideScoresChange?: (hide: boolean) => void;
}

export function PitchSettingsDialog({
  soundEnabled,
  onSoundToggle,
  selectedFormation,
  onFormationChange,
  formations,
  teamSize,
  onTeamSizeChange,
  minutesPerHalf,
  onMinutesPerHalfChange,
  rotationSpeed,
  onRotationSpeedChange,
  disablePositionSwaps = false,
  onDisablePositionSwapsChange,
  disableBatchSubs = false,
  onDisableBatchSubsChange,
  onOpenPositionEditor,
  mockMode,
  onMockModeChange,
  readOnly = false,
  triggerClassName,
  onResetGame,
  onResetFormation,
  onOpenStats,
  onSaveSettings,
  isSaving = false,
  showMatchHeader,
  onShowMatchHeaderChange,
  hideScores = false,
  onHideScoresChange,
}: PitchSettingsDialogProps) {
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetFormationConfirmOpen, setResetFormationConfirmOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  
  return (
    <>
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <Button 
        variant="outline" 
        size="icon" 
        className={cn("h-10 w-10", triggerClassName)}
        onClick={() => setOpen(true)}
      >
        <Settings className="h-5 w-5" />
      </Button>
        <ResponsiveDialogContent 
          className="z-[99999] max-h-[85vh] sm:max-h-[80vh] flex flex-col"
        >
          <ResponsiveDialogHeader className="shrink-0 pb-2">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Game Setup
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
            {/* Primary: Team Size + Formation - the only thing new users need */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Players per Side</Label>
                  <Select 
                    value={teamSize} 
                    onValueChange={(v) => onTeamSizeChange(v as TeamSize)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[99999] bg-popover">
                      <SelectItem value="3">3-a-side</SelectItem>
                      <SelectItem value="4">4-a-side</SelectItem>
                      <SelectItem value="5">5-a-side</SelectItem>
                      <SelectItem value="7">7-a-side</SelectItem>
                      <SelectItem value="9">9-a-side</SelectItem>
                      <SelectItem value="11">11-a-side</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Formation</Label>
                  <Select 
                    value={selectedFormation.toString()} 
                    onValueChange={onFormationChange}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[99999] bg-popover">
                      {formations.map((f, i) => (
                        <SelectItem key={i} value={i.toString()}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Time per Half</Label>
                  <Select 
                    value={minutesPerHalf.toString()} 
                    onValueChange={(v) => onMinutesPerHalfChange(parseInt(v))}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[99999] bg-popover">
                      <SelectItem value="5">5 min</SelectItem>
                      <SelectItem value="10">10 min</SelectItem>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="20">20 min</SelectItem>
                      <SelectItem value="25">25 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="35">35 min</SelectItem>
                      <SelectItem value="40">40 min</SelectItem>
                      <SelectItem value="45">45 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Subs Speed</Label>
                  <Select 
                    value={rotationSpeed.toString()} 
                    onValueChange={(v) => onRotationSpeedChange(parseInt(v))}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[99999] bg-popover">
                      <SelectItem value="1">Slow</SelectItem>
                      <SelectItem value="2">Normal</SelectItem>
                      <SelectItem value="3">Fast</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Subs every ~{rotationSpeed === 1 ? Math.round(minutesPerHalf / 2) : rotationSpeed === 2 ? Math.round(minutesPerHalf / 3) : Math.round(minutesPerHalf / 4)} min
              </p>
            </div>

            {/* Advanced Options - collapsed by default */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>More Options</span>
                </div>
                <ChevronDown className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  advancedOpen && "rotate-180"
                )} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {/* Match display toggles */}
                {!readOnly && onShowMatchHeaderChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="show-match-header-toggle" className="text-sm">
                        Show Match Header
                      </Label>
                    </div>
                    <Switch
                      id="show-match-header-toggle"
                      checked={showMatchHeader}
                      onCheckedChange={onShowMatchHeaderChange}
                    />
                  </div>
                )}
                
                {!readOnly && onHideScoresChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="hide-scores-toggle" className="text-sm">
                        Hide Scores
                      </Label>
                    </div>
                    <Switch
                      id="hide-scores-toggle"
                      checked={hideScores}
                      onCheckedChange={onHideScoresChange}
                    />
                  </div>
                )}

                {/* Substitution toggles */}
                {!readOnly && onDisableBatchSubsChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="disable-batch-toggle" className="text-sm">
                        Single Subs Only
                      </Label>
                      <span className="text-[10px] text-muted-foreground">One sub at a time</span>
                    </div>
                    <Switch
                      id="disable-batch-toggle"
                      checked={disableBatchSubs}
                      onCheckedChange={onDisableBatchSubsChange}
                    />
                  </div>
                )}
                {!readOnly && onDisablePositionSwapsChange && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="disable-swaps-toggle" className="text-sm">
                        Lock Positions
                      </Label>
                      <span className="text-[10px] text-muted-foreground">Keep players in assigned positions</span>
                    </div>
                    <Switch
                      id="disable-swaps-toggle"
                      checked={disablePositionSwaps}
                      onCheckedChange={onDisablePositionSwapsChange}
                    />
                  </div>
                )}

                {/* Sound toggle */}
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    {soundEnabled ? <Volume2 className="h-4 w-4 text-muted-foreground" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                    <Label htmlFor="sound-toggle" className="text-sm">Sound</Label>
                  </div>
                  <Switch
                    id="sound-toggle"
                    checked={soundEnabled}
                    onCheckedChange={onSoundToggle}
                  />
                </div>

                {/* Mock data toggle */}
                {!readOnly && (
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="mock-toggle" className="text-sm">Mock Data</Label>
                    </div>
                    <Switch
                      id="mock-toggle"
                      checked={mockMode}
                      onCheckedChange={onMockModeChange}
                    />
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
          
          {/* Footer - minimal actions */}
          <div className="pt-3 border-t border-border shrink-0 space-y-2">
            {/* Save Settings */}
            {!readOnly && onSaveSettings && (
              <Button 
                variant="default" 
                className="w-full h-10"
                onClick={() => {
                  onSaveSettings();
                  setOpen(false);
                }}
                disabled={isSaving}
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving..." : "Remember for This Team"}
              </Button>
            )}
            
            {/* Quick action row */}
            <div className="flex gap-2">
              {onOpenStats && (
                <Button 
                  variant="outline" 
                  size="sm"
                  className="flex-1 h-9"
                  onClick={onOpenStats}
                >
                  <BarChart3 className="h-4 w-4 mr-1.5" />
                  Stats
                </Button>
              )}
              {!readOnly && (
                <Button 
                  variant="outline" 
                  size="sm"
                  className="flex-1 h-9"
                  onClick={onOpenPositionEditor}
                >
                  <Settings2 className="h-4 w-4 mr-1.5" />
                  Positions
                </Button>
              )}
            </div>

            {/* Danger zone - collapsed */}
            {!readOnly && (onResetFormation || onResetGame) && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center justify-center w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors gap-1">
                  <span>Reset Options</span>
                  <ChevronDown className="h-3 w-3" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-1">
                  {onResetFormation && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="w-full h-9"
                      onClick={() => setResetFormationConfirmOpen(true)}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-2" />
                      Reset Formation
                    </Button>
                  )}
                  {onResetGame && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="w-full h-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setResetConfirmOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Reset Game
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </ResponsiveDialogContent>
    </ResponsiveDialog>
    
    {/* Reset Game Confirmation */}
    <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
      <AlertDialogContent className="z-[999999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Game?</AlertDialogTitle>
          <AlertDialogDescription>
            This will reset the timer, all player positions, and clear all substitution history. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              onResetGame?.();
              setResetConfirmOpen(false);
            }}
          >
            Reset Game
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    
    {/* Reset Formation Confirmation */}
    <AlertDialog open={resetFormationConfirmOpen} onOpenChange={setResetFormationConfirmOpen}>
      <AlertDialogContent className="z-[999999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Formation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move all players back to their default formation positions. Timer and stats will not be affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            onResetFormation?.();
            setResetFormationConfirmOpen(false);
          }}>
            Reset Formation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
