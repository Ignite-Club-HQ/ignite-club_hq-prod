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
import { Settings, Volume2, VolumeX, Settings2, Users, Trash2, BarChart3, ArrowLeftRight, Save, X, Clock, ChevronDown, Timer, LayoutGrid, RotateCcw, CalendarCheck, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type TeamSize = "4" | "7" | "9" | "11";

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

// Section component for organization
function SettingsSection({ 
  title, 
  icon: Icon, 
  children,
  defaultOpen = true 
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border border-border rounded-lg">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 transition-colors rounded-lg">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform",
          isOpen && "rotate-180"
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
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
  
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
  };
  
  return (
    <>
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
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
              Pitch Settings
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          
          <div className="space-y-3 py-2 overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
          {/* Quick Toggles - Always visible */}
          <div className="flex flex-wrap gap-2 pb-2 border-b border-border">
            <Button
              variant={soundEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => onSoundToggle(!soundEnabled)}
              className="flex items-center gap-1.5"
            >
              {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              <span className="text-xs">Sound</span>
            </Button>
            
            {!readOnly && (
              <Button
                variant={mockMode ? "default" : "outline"}
                size="sm"
                onClick={() => onMockModeChange(!mockMode)}
                className="flex items-center gap-1.5"
              >
                <Users className="h-3.5 w-3.5" />
                <span className="text-xs">Mock Data</span>
              </Button>
            )}
          </div>
          
          {/* Game Timing Section */}
          <SettingsSection title="Game Timing" icon={Clock} defaultOpen={true}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Time per Half</Label>
                <Select 
                  value={minutesPerHalf.toString()} 
                  onValueChange={(v) => onMinutesPerHalfChange(parseInt(v))}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-9">
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
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[99999] bg-popover">
                    <SelectItem value="1">Slow</SelectItem>
                    <SelectItem value="2">Medium</SelectItem>
                    <SelectItem value="3">Fast</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Slow: ~{Math.round(minutesPerHalf / 2)} min • Medium: ~{Math.round(minutesPerHalf / 3)} min • Fast: ~{Math.round(minutesPerHalf / 4)} min
            </p>
          </SettingsSection>
          
          {/* Formation Section */}
          <SettingsSection title="Team Formation" icon={LayoutGrid} defaultOpen={true}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Players per Side</Label>
                <Select 
                  value={teamSize} 
                  onValueChange={(v) => onTeamSizeChange(v as TeamSize)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[99999] bg-popover">
                    <SelectItem value="4">4-a-side</SelectItem>
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
                  <SelectTrigger className="h-9">
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
          </SettingsSection>
          
          {/* Substitution Options Section */}
          {!readOnly && (onDisablePositionSwapsChange || onDisableBatchSubsChange) && (
            <SettingsSection title="Substitution Options" icon={Timer} defaultOpen={false}>
              {onDisableBatchSubsChange && (
                <div className="flex items-center justify-between py-1">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="disable-batch-toggle" className="text-sm">
                      Single Subs Only
                    </Label>
                    <span className="text-[10px] text-muted-foreground">Disable multiple subs at once</span>
                  </div>
                  <Switch
                    id="disable-batch-toggle"
                    checked={disableBatchSubs}
                    onCheckedChange={onDisableBatchSubsChange}
                  />
                </div>
              )}
              {onDisablePositionSwapsChange && (
                <div className="flex items-center justify-between py-1">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="disable-swaps-toggle" className="text-sm">
                      Disable Position Swaps
                    </Label>
                    <span className="text-[10px] text-muted-foreground">In auto sub generation</span>
                  </div>
                  <Switch
                    id="disable-swaps-toggle"
                    checked={disablePositionSwaps}
                    onCheckedChange={onDisablePositionSwapsChange}
                  />
                </div>
              )}
            </SettingsSection>
          )}
          
        </div>
        
        {/* Sticky Action Buttons Footer */}
        <div className="pt-3 border-t border-border shrink-0 space-y-2">
          {/* Match Header Toggle */}
          {!readOnly && onShowMatchHeaderChange && (
            <div className="flex items-center justify-between py-2 px-1 border-b border-border">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="show-match-header-toggle" className="text-sm font-medium">
                    Show Match Header
                  </Label>
                  <span className="text-[10px] text-muted-foreground">Link games and track stats</span>
                </div>
              </div>
              <Switch
                id="show-match-header-toggle"
                checked={showMatchHeader}
                onCheckedChange={onShowMatchHeaderChange}
              />
            </div>
          )}
          
          {/* Hide Scores Toggle */}
          {!readOnly && onHideScoresChange && (
            <div className="flex items-center justify-between py-2 px-1 border-b border-border">
              <div className="flex items-center gap-2">
                <EyeOff className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="hide-scores-toggle" className="text-sm font-medium">
                    Hide Scores
                  </Label>
                  <span className="text-[10px] text-muted-foreground">Disable scoring and hide scoreboard</span>
                </div>
              </div>
              <Switch
                id="hide-scores-toggle"
                checked={hideScores}
                onCheckedChange={onHideScoresChange}
              />
            </div>
          )}
          
          {/* Save Settings Button */}
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
              {isSaving ? "Saving..." : "Save as Team Defaults"}
            </Button>
          )}
          
          {/* Match Stats */}
          {onOpenStats && (
            <Button 
              variant="outline" 
              className="w-full h-10"
              onClick={onOpenStats}
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Match Stats
            </Button>
          )}
          
          {/* Player Position Preference */}
          {!readOnly && (
            <Button 
              variant="outline" 
              className="w-full h-10"
              onClick={onOpenPositionEditor}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Player Preferences
            </Button>
          )}
          
          {/* Reset Formation */}
          {!readOnly && onResetFormation && (
            <Button 
              variant="outline" 
              className="w-full h-10"
              onClick={() => setResetFormationConfirmOpen(true)}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset Formation
            </Button>
          )}
          
          {/* Reset Game */}
          {!readOnly && onResetGame && (
            <Button 
              variant="outline" 
              className="w-full h-10 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setResetConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Reset Game
            </Button>
          )}
          
          <Button 
            variant="secondary" 
            className="w-full h-10"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
    
    {/* Reset Confirmation Dialog */}
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
    
    {/* Reset Formation Confirmation Dialog */}
    <AlertDialog open={resetFormationConfirmOpen} onOpenChange={setResetFormationConfirmOpen}>
      <AlertDialogContent className="z-[999999]">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Formation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move all players back to their formation positions and reset the ball to center. Timer and match stats will not be affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={() => {
              onResetFormation?.();
              setResetFormationConfirmOpen(false);
              setOpen(false);
            }}
          >
            Reset Formation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
