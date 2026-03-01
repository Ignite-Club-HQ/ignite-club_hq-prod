import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useLazyFabric, prefetchFabric } from "@/hooks/useLazyFabric";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Pencil, Eraser, Trash2, ArrowLeft, RotateCcw, MoveRight, Save, FolderOpen, Loader2, ZoomIn, ZoomOut, X, RefreshCw, Users, Settings2, List, Clock, Calendar, BarChart3, Pause, Play, ChevronUp, ChevronLeft, ChevronRight, ChevronDown, Eye, ArrowLeftRight, Undo2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import PlayerToken from "./PlayerToken";
import SoccerBall from "./SoccerBall";
import GameTimer, { GameTimerRef, playSubAlertBeep } from "./GameTimer";
import PitchToolbar from "./PitchToolbar";
import { EventLinkSelector } from "./EventLinkSelector";
import { LinkedEventHeader } from "./LinkedEventHeader";
import { LandscapeEventSelector } from "./LandscapeEventSelector";
import { PitchPosition } from "./PositionBadge";

// Lazy load heavy dialog components for better initial load performance
const AutoSubPlanDialog = lazy(() => import("./AutoSubPlanDialog"));
const SubstitutionPreviewDialog = lazy(() => import("./SubstitutionPreviewDialog"));
const BenchToSubDialog = lazy(() => import("./BenchToSubDialog"));
const MatchStatsPanel = lazy(() => import("./MatchStatsPanel"));
const PlayerPositionEditor = lazy(() => import("./PlayerPositionEditor"));
const PositionSwapDialog = lazy(() => import("./PositionSwapDialog"));
const PitchSwapConfirmDialog = lazy(() => import("./PitchSwapConfirmDialog"));
const ManualSubConfirmDialog = lazy(() => import("./ManualSubConfirmDialog"));
const FormationChangeDialog = lazy(() => import("./FormationChangeDialog"));
const PitchPlayerActionMenu = lazy(() => import("./PitchPlayerActionMenu"));
const SubConfirmDialog = lazy(() => import("./SubConfirmDialog"));
const AddFillInPlayerDialog = lazy(() => import("./AddFillInPlayerDialog"));
const AutoSubManager = lazy(() => import("./AutoSubManager"));
const PreGameLineupScreen = lazy(() => import("./PreGameLineupScreen"));
import TacticalModeSelector from "./TacticalModeSelector";

import { useToast } from "@/hooks/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import { useIsLandscape } from "@/hooks/useIsLandscape";
import { useEventGroupSync } from "@/hooks/useEventGroupSync";

// Import types and utils from extracted files
import { 
  Player, 
  SubstitutionEvent, 
  TeamSize, 
  DrawingTool,
  Goal,
  FORMATIONS,
  getPositionFromCoords,
  PITCH_STATE_KEY,
  PITCH_BOARD_OPEN_KEY,
  TIMER_STORAGE_KEY,
  PitchBoardState,
  TimerState,
  MiniLeagueTeams
} from "./types";
import ScoreTracker from "./ScoreTracker";
import {
  savePitchState,
  loadPitchState,
  clearPitchState,
  loadTimerStateForMinutes,
  recalculateRemainingPlan,
  isSoundEnabled
} from "./pitchStateUtils";
import { TacticalMode, computeTacticalOffsets, computeBallOffset, TACTICAL_MODE_LABELS, RECOMMENDED_FORMATIONS } from "./tacticalMode";

interface PitchBoardProps {
  teamId: string;
  teamName: string;
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }>;
  onClose: () => void;
  disableAutoSubs?: boolean;
  initialRotationSpeed?: number;
  initialDisablePositionSwaps?: boolean;
  initialDisableBatchSubs?: boolean;
  initialRotateGkAtHalftime?: boolean;
  initialMinutesPerHalf?: number;
  initialTeamSize?: number;
  initialFormation?: string;
  readOnly?: boolean;
  initialLinkedEventId?: string | null;
  initialShowMatchHeader?: boolean;
  initialShowLineupPicker?: boolean;
  // Mini-league two-team mode configuration
  miniLeagueTeams?: MiniLeagueTeams;
}

// Loading fallback for lazy-loaded dialogs
const DialogLoader = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

// Pitch board loading component with soccer ball and Ignite logo
const PitchBoardLoading = ({ message = "Loading..." }: { message?: string }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12 bg-pitch-green min-h-[300px]">
    <div className="flex items-center gap-3">
      <div className="p-3 rounded-xl bg-primary">
        <Flame className="h-8 w-8 text-primary-foreground" />
      </div>
      <span className="text-4xl" role="img" aria-label="soccer ball">⚽</span>
    </div>
    <Loader2 className="h-6 w-6 animate-spin text-white" />
    <p className="text-sm text-white/80">{message}</p>
  </div>
);

export default function PitchBoard({ teamId, teamName, members, onClose, disableAutoSubs = false, initialRotationSpeed = 2, initialDisablePositionSwaps = false, initialDisableBatchSubs = false, initialRotateGkAtHalftime = true, initialMinutesPerHalf = 10, initialTeamSize, initialFormation, readOnly = false, initialLinkedEventId, initialShowMatchHeader = true, initialShowLineupPicker = true, miniLeagueTeams }: PitchBoardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { pitchBoardNotificationsEnabled } = usePitchBoardNotifications();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLandscape, isMobileLandscape, isTabletLandscape, isDesktopLandscape } = useIsLandscape();

  // Hide status bar in landscape on native to fill the whole screen
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const hideOrShow = async () => {
      try {
        if (isLandscape) {
          await StatusBar.hide();
        } else {
          await StatusBar.show();
          await StatusBar.setOverlaysWebView({ overlay: false });
          // Re-apply correct icon style based on current theme
          const isDark = document.documentElement.classList.contains('dark');
          await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
          if (Capacitor.getPlatform() === 'android') {
            await StatusBar.setBackgroundColor({ color: isDark ? '#0f1512' : '#f5f7f6' });
          }
        }
      } catch (e) {
        console.warn('[PitchBoard] StatusBar toggle error:', e);
      }
    };
    hideOrShow();
    return () => {
      // Restore status bar when PitchBoard unmounts
      if (Capacitor.isNativePlatform()) {
        StatusBar.show().catch(() => {});
        StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
        const isDark = document.documentElement.classList.contains('dark');
        StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
        if (Capacitor.getPlatform() === 'android') {
          StatusBar.setBackgroundColor({ color: isDark ? '#0f1512' : '#f5f7f6' }).catch(() => {});
        }
      }
    };
  }, [isLandscape]);

  // Event group sync - syncs pitch board state to database for mini-league matches
  const { forceSync: forceEventGroupSync, isEventGroup } = useEventGroupSync(teamId, null);
  
  // State initialization flag
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Load saved state once for initialization
  const savedStateRef = useRef<PitchBoardState | null>(null);
  if (savedStateRef.current === null) {
    const loaded = loadPitchState(teamId);
    savedStateRef.current = loaded;
    console.log("[PitchState] Initial load result:", loaded ? "found" : "not found");
  }
  const savedState = savedStateRef.current;
  
  // Determine initial team size - prefer saved state, then DB value, then default
  const getInitialTeamSize = (): TeamSize => {
    if (savedState?.teamSize) return savedState.teamSize;
    if (initialTeamSize && ["4", "7", "9", "11"].includes(String(initialTeamSize))) {
      return String(initialTeamSize) as TeamSize;
    }
    return "7";
  };
  
  // Determine initial formation index from formation name
  const getInitialFormationIndex = (size: TeamSize): number => {
    if (savedState?.selectedFormation !== undefined) return savedState.selectedFormation;
    if (initialFormation) {
      const formations = FORMATIONS[size];
      const index = formations.findIndex(f => f.name === initialFormation);
      if (index >= 0) return index;
    }
    return 0;
  };
  
  const [teamSize, setTeamSize] = useState<TeamSize>(getInitialTeamSize);
  const [selectedFormation, setSelectedFormation] = useState(() => getInitialFormationIndex(getInitialTeamSize()));
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("none");
  const [drawingColor, setDrawingColor] = useState("#ffffff");
  
  // Lazy load Fabric.js - only initialize when drawing mode is enabled
  const drawingEnabled = drawingTool !== "none";
  const { 
    canvas: fabricCanvas, 
    isLoading: isFabricLoading, 
    isReady: isFabricReady,
    fabricModule,
    clearCanvas: clearFabricCanvas 
  } = useLazyFabric({
    canvasRef,
    containerRef,
    enabled: drawingEnabled,
    initialColor: drawingColor,
    dependencies: [isLandscape],
  });
  
  // Prefetch Fabric.js in background after initial render
  useEffect(() => {
    prefetchFabric();
  }, []);
  
  // Save/Load state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [formationName, setFormationName] = useState("");
  
  // Position assignment editor state
  const [positionEditorOpen, setPositionEditorOpen] = useState(false);
  const [positionSwapDialogOpen, setPositionSwapDialogOpen] = useState(false);
  const [pendingSubBenchPlayer, setPendingSubBenchPlayer] = useState<string | null>(null);
  const [requiredPosition, setRequiredPosition] = useState<PitchPosition | null>(null);
  
  // Bench position filter
  const [benchPositionFilter, setBenchPositionFilter] = useState<PitchPosition | null>(null);
  
  // Substitution preview dialog
  const [subPreviewOpen, setSubPreviewOpen] = useState(false);
  const [previewSwapPlayers, setPreviewSwapPlayers] = useState<{ sourceId: string | null; targetId: string | null }>({ sourceId: null, targetId: null });

  // Formation/team-size change dialog state
  const [formationChangeDialogOpen, setFormationChangeDialogOpen] = useState(false);
  const [pendingFormationChange, setPendingFormationChange] = useState<{
    index: number;
    newTeamSize?: TeamSize; // Set when this is a team size change
    positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition }[];
    benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[];
  } | null>(null);

  // Auto-sub plan state
  const gameTimerRef = useRef<GameTimerRef>(null);
  const [autoSubPlanDialogOpen, setAutoSubPlanDialogOpen] = useState(false);
  const [autoSubPlanEditMode, setAutoSubPlanEditMode] = useState(false);
  const [autoSubFromPreGame, setAutoSubFromPreGame] = useState(false);
  const [autoSubPlan, setAutoSubPlan] = useState<SubstitutionEvent[]>(() => savedState?.autoSubPlan || []);
  const [autoSubActive, setAutoSubActive] = useState(() => savedState?.autoSubActive || false);
  const [autoSubPaused, setAutoSubPaused] = useState(() => savedState?.autoSubPaused || false);
  const [lockedPlayerIds, setLockedPlayerIds] = useState<Set<string>>(new Set());
  const [preferredSecondHalfGkId, setPreferredSecondHalfGkId] = useState<string | undefined>(undefined);
  const [linkedEventId, setLinkedEventId] = useState<string | null>(() => savedState?.linkedEventId || initialLinkedEventId || null);
  const [showMatchHeader, setShowMatchHeader] = useState(() => initialShowMatchHeader);
  const [goals, setGoals] = useState<Goal[]>(() => savedState?.goals || []);
  const [pendingAutoSub, setPendingAutoSub] = useState<SubstitutionEvent | null>(null);
  const [pendingBatchSubs, setPendingBatchSubs] = useState<SubstitutionEvent[]>([]);
  const [subConfirmDialogOpen, setSubConfirmDialogOpen] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(true); // Start collapsed by default
  const [bottomSheetTab, setBottomSheetTab] = useState<"bench" | "subs" | "setup">("bench");
  const [showFloatingDrawToolbar, setShowFloatingDrawToolbar] = useState(false);
  const [sheetHeightPct, setSheetHeightPct] = useState(50);
  const sheetDragRef = useRef<{ startY: number; startPct: number } | null>(null);
  const [portraitSheetOpen, setPortraitSheetOpen] = useState(false);
  const [portraitSheetHeightPct, setPortraitSheetHeightPct] = useState(45);
  const portraitSheetDragRef = useRef<{ startY: number; startPct: number } | null>(null);
  const [gameInProgress, setGameInProgress] = useState(false); // Track if game has started
  const [timerResetKey, setTimerResetKey] = useState(0); // Key to force remount GameTimer instances on reset
  const [showScoreInPortrait, setShowScoreInPortrait] = useState(false); // Toggle score visibility in portrait
  const [hideScores, setHideScores] = useState(false); // Hide scores and disable scoring
  const [landscapeEventSelectorOpen, setLandscapeEventSelectorOpen] = useState(false); // Event selector for landscape toolbar
  const [minutesPerHalf, setMinutesPerHalf] = useState(() => initialMinutesPerHalf); // Time per half for settings
  const [rotationSpeed, setRotationSpeed] = useState(() => initialRotationSpeed); // Subs speed
  const [disablePositionSwaps, setDisablePositionSwaps] = useState(() => initialDisablePositionSwaps); // Disable position swaps in auto sub generation
  const [disableBatchSubs, setDisableBatchSubs] = useState(() => initialDisableBatchSubs); // Disable batch subs (multiple at once)
  const [rotateGkAtHalftime, setRotateGkAtHalftime] = useState(() => initialRotateGkAtHalftime); // Rotate GK at halftime
  const [showLineupPicker, setShowLineupPicker] = useState(() => {
    // Show lineup picker on mount if setting enabled AND linked to a game event AND no saved state (fresh game)
    return initialShowLineupPicker && !!initialLinkedEventId && !savedState && !readOnly && !miniLeagueTeams;
  });
  const [showLineupPickerSetting, setShowLineupPickerSetting] = useState(() => initialShowLineupPicker); // Persist setting
  
  // Tactical mode state
  type TacticalFormationSuggestion = {
    mode: Exclude<TacticalMode, "neutral">;
    formationIndex: number;
    formationName: string;
  };
  const [tacticalMode, setTacticalMode] = useState<TacticalMode>("neutral");
  const [tacticalFormationSuggestion, setTacticalFormationSuggestion] = useState<TacticalFormationSuggestion | null>(null);

  // Sync settings from props when they change (e.g., when edited on team page)
  // Also sync on initial mount if no saved state exists for the setting
  useEffect(() => {
    setRotationSpeed(initialRotationSpeed);
  }, [initialRotationSpeed]);
  
  useEffect(() => {
    setDisablePositionSwaps(initialDisablePositionSwaps);
  }, [initialDisablePositionSwaps]);
  
  useEffect(() => {
    setDisableBatchSubs(initialDisableBatchSubs);
  }, [initialDisableBatchSubs]);
  
  useEffect(() => {
    setRotateGkAtHalftime(initialRotateGkAtHalftime);
  }, [initialRotateGkAtHalftime]);

  useEffect(() => {
    setMinutesPerHalf(initialMinutesPerHalf);
  }, [initialMinutesPerHalf]);
  
  // Sync team size and formation from props if no saved state - runs on mount and when props change
  useEffect(() => {
    // Only sync if there's no saved state for this team (fresh session)
    if (!savedState && initialTeamSize) {
      const validSize = String(initialTeamSize) as TeamSize;
      if (["4", "7", "9", "11"].includes(validSize)) {
        setTeamSize(validSize);
        // Also update formation if provided
        if (initialFormation) {
          const formations = FORMATIONS[validSize];
          const index = formations.findIndex(f => f.name === initialFormation);
          if (index >= 0) {
            setSelectedFormation(index);
          }
        } else {
          setSelectedFormation(0); // Reset to first formation for new size
        }
      }
    }
  }, [initialTeamSize, initialFormation, savedState]);

  // Save settings to database when they change
  const handleRotationSpeedChange = useCallback(async (speed: number) => {
    setRotationSpeed(speed);
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: speed,
          disable_position_swaps: disablePositionSwaps,
          disable_batch_subs: disableBatchSubs,
          minutes_per_half: minutesPerHalf,
          team_size: parseInt(teamSize),
          formation: FORMATIONS[teamSize][selectedFormation]?.name || null
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly, disablePositionSwaps, disableBatchSubs, minutesPerHalf, teamSize, selectedFormation]);

  const handleDisablePositionSwapsChange = useCallback(async (disabled: boolean) => {
    setDisablePositionSwaps(disabled);
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: rotationSpeed,
          disable_position_swaps: disabled,
          disable_batch_subs: disableBatchSubs,
          minutes_per_half: minutesPerHalf,
          team_size: parseInt(teamSize),
          formation: FORMATIONS[teamSize][selectedFormation]?.name || null
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly, rotationSpeed, disableBatchSubs, minutesPerHalf, teamSize, selectedFormation]);

  const handleDisableBatchSubsChange = useCallback(async (disabled: boolean) => {
    setDisableBatchSubs(disabled);
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: rotationSpeed,
          disable_position_swaps: disablePositionSwaps,
          disable_batch_subs: disabled,
          minutes_per_half: minutesPerHalf,
          team_size: parseInt(teamSize),
          formation: FORMATIONS[teamSize][selectedFormation]?.name || null
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly, rotationSpeed, disablePositionSwaps, minutesPerHalf, teamSize, selectedFormation]);

  const handleRotateGkAtHalftimeChange = useCallback(async (enabled: boolean) => {
    setRotateGkAtHalftime(enabled);
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotate_gk_at_halftime: enabled,
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly]);

  const handleMinutesPerHalfChange = useCallback(async (minutes: number) => {
    setMinutesPerHalf(minutes);
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: rotationSpeed,
          disable_position_swaps: disablePositionSwaps,
          disable_batch_subs: disableBatchSubs,
          minutes_per_half: minutes,
          team_size: parseInt(teamSize),
          formation: FORMATIONS[teamSize][selectedFormation]?.name || null
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly, rotationSpeed, disablePositionSwaps, disableBatchSubs, teamSize, selectedFormation]);

  const persistTeamSizeToDb = useCallback(async (newSize: TeamSize, formationName?: string) => {
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: rotationSpeed,
          disable_position_swaps: disablePositionSwaps,
          disable_batch_subs: disableBatchSubs,
          minutes_per_half: minutesPerHalf,
          team_size: parseInt(newSize),
          formation: formationName || FORMATIONS[newSize][0]?.name || null
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly, rotationSpeed, disablePositionSwaps, disableBatchSubs, minutesPerHalf]);

  const persistFormationToDb = useCallback(async (formationName: string) => {
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: rotationSpeed,
          disable_position_swaps: disablePositionSwaps,
          disable_batch_subs: disableBatchSubs,
          minutes_per_half: minutesPerHalf,
          team_size: parseInt(teamSize),
          formation: formationName
        }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly, rotationSpeed, disablePositionSwaps, disableBatchSubs, minutesPerHalf, teamSize]);

  // Save all settings at once with loading state
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  
  const handleSaveSettings = useCallback(async () => {
    if (readOnly) return;
    
    setIsSavingSettings(true);
    try {
      const { error } = await supabase
        .from('team_subscriptions')
        .upsert({ 
          team_id: teamId, 
          rotation_speed: rotationSpeed,
          disable_position_swaps: disablePositionSwaps,
          disable_batch_subs: disableBatchSubs,
          minutes_per_half: minutesPerHalf,
          team_size: parseInt(teamSize),
          formation: FORMATIONS[teamSize][selectedFormation]?.name || null,
          show_match_header: showMatchHeader,
          rotate_gk_at_halftime: rotateGkAtHalftime,
          show_lineup_picker: showLineupPickerSetting
        }, { onConflict: 'team_id' });
      
      if (error) throw error;
      
      toast({
        title: "Settings saved",
        description: "Your pitch settings have been saved successfully.",
      });
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast({
        title: "Failed to save",
        description: "Could not save your settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSettings(false);
    }
  }, [teamId, readOnly, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, minutesPerHalf, teamSize, selectedFormation, showMatchHeader, showLineupPickerSetting, toast]);

  // handleTacticalModeChange is defined after handleFormationChange (see below)

  const handleLineupConfirm = useCallback((updatedPlayers: Player[], firstHalfGkId?: string, secondHalfGkId?: string) => {
    setPlayers(updatedPlayers);
    setShowLineupPicker(false);
    if (secondHalfGkId) {
      setPreferredSecondHalfGkId(secondHalfGkId);
    }
    if (firstHalfGkId || secondHalfGkId) {
      console.log("[PitchBoard] Lineup confirmed with GK rotation:", { firstHalfGkId, secondHalfGkId });
    }
    // After confirming lineup, prompt auto-sub generation
    setTimeout(() => {
      setAutoSubPlanEditMode(false);
      setAutoSubFromPreGame(true);
      setAutoSubPlanDialogOpen(true);
    }, 300);
  }, []);

  const handleShowLineupPickerSettingChange = useCallback(async (enabled: boolean) => {
    setShowLineupPickerSetting(enabled);
    if (!readOnly) {
      await supabase
        .from('team_subscriptions')
        .upsert({ team_id: teamId, show_lineup_picker: enabled }, { onConflict: 'team_id' });
    }
  }, [teamId, readOnly]);


  // Handle linking event with email notifications
  const handleLinkEvent = useCallback(async (eventId: string | null) => {
    const previousLinkedEventId = linkedEventId;
    setLinkedEventId(eventId);
    
    // Only send email notifications when linking (not unlinking) and event is different
    if (eventId && eventId !== previousLinkedEventId && user?.id) {
      try {
        // Get team admins and coaches who should receive notifications
        const { data: teamAdmins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('team_id', teamId)
          .in('role', ['team_admin', 'coach']);
        
        if (teamAdmins && teamAdmins.length > 0) {
          // Get event details for the notification message
          const { data: eventData } = await supabase
            .from('events')
            .select('title')
            .eq('id', eventId)
            .single();
          
          const eventTitle = eventData?.title || 'a game';
          
          // Send email notifications to all team admins/coaches (except the current user)
          const recipientUserIds = teamAdmins
            .map(r => r.user_id)
            .filter(uid => uid !== user.id);
          
          for (const recipientUserId of recipientUserIds) {
            supabase.functions.invoke('send-pitch-board-notification-email', {
              body: {
                recipientUserId,
                teamId,
                teamName,
                notificationType: 'game_linked',
                notificationMessage: `The pitch board has been linked to "${eventTitle}"`,
                eventId,
              },
            }).catch(err => {
              console.error('[PitchBoard] Failed to send game linked email:', err);
            });
          }
        }
      } catch (error) {
        console.error('[PitchBoard] Error sending game linked notifications:', error);
      }
    }
  }, [linkedEventId, teamId, teamName, user?.id]);
  
  // Undo history for subs and swaps (stores player states)
  const [undoHistory, setUndoHistory] = useState<{ players: Player[]; description: string }[]>([]);
  const MAX_UNDO_HISTORY = 10;
  
  // Floating undo button visibility (30 second timer after sub/swap)
  const [showFloatingUndo, setShowFloatingUndo] = useState(false);
  const floatingUndoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isUndoingRef = useRef(false);
  const playersRef = useRef<Player[]>([]);
  const [benchCollapsed, setBenchCollapsed] = useState(true);
  
  // Swipe hint indicator state
  const [showSwipeHints, setShowSwipeHints] = useState(false);
  
  // Draggable floating subs button state
  const [floatingSubsPosition, setFloatingSubsPosition] = useState({ x: 16, y: 16 }); // bottom-left offset
  const floatingSubsDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  
  // Draggable floating timer state (for landscape mode) - positioned further right to avoid "View Only" badge
  const [floatingTimerPosition, setFloatingTimerPosition] = useState({ x: 8, y: 8 });
  const floatingTimerDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  
  // Floating timer drag handlers
  const handleTimerDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    floatingTimerDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: floatingTimerPosition.x,
      startPosY: floatingTimerPosition.y,
    };
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!floatingTimerDragRef.current) return;
      const deltaX = moveEvent.clientX - floatingTimerDragRef.current.startX;
      const deltaY = moveEvent.clientY - floatingTimerDragRef.current.startY;
      setFloatingTimerPosition({
        x: Math.max(0, floatingTimerDragRef.current.startPosX + deltaX),
        y: Math.max(0, floatingTimerDragRef.current.startPosY + deltaY),
      });
    };
    
    const handleMouseUp = () => {
      floatingTimerDragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [floatingTimerPosition]);
  
  const handleTimerTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    floatingTimerDragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startPosX: floatingTimerPosition.x,
      startPosY: floatingTimerPosition.y,
    };
    
    const handleTouchMove = (moveEvent: TouchEvent) => {
      if (!floatingTimerDragRef.current || moveEvent.touches.length !== 1) return;
      moveEvent.preventDefault();
      const touch = moveEvent.touches[0];
      const deltaX = touch.clientX - floatingTimerDragRef.current.startX;
      const deltaY = touch.clientY - floatingTimerDragRef.current.startY;
      setFloatingTimerPosition({
        x: Math.max(0, floatingTimerDragRef.current.startPosX + deltaX),
        y: Math.max(0, floatingTimerDragRef.current.startPosY + deltaY),
      });
    };
    
    const handleTouchEnd = () => {
      floatingTimerDragRef.current = null;
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [floatingTimerPosition]);


  // Swipe gestures for bench in landscape mode
  const benchSwipeHandlers = useSwipeGesture({
    onSwipeLeft: () => setBenchCollapsed(true),
    onSwipeRight: () => setBenchCollapsed(false),
    threshold: 40,
  });
  
  // Auto-collapse toolbar and bench when switching to mobile landscape, show swipe hints
  useEffect(() => {
    if (isMobileLandscape) {
      setToolbarCollapsed(true);
      setBenchCollapsed(true);
      // Show swipe hints briefly when entering landscape
      setShowSwipeHints(true);
      const timer = setTimeout(() => setShowSwipeHints(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [isMobileLandscape]);
  // Create database notification which triggers server-side push via database trigger
  const createSubNotification = useCallback(async (message: string) => {
    if (!user?.id) return;
    if (!pitchBoardNotificationsEnabled) return; // Check preference
    try {
      const { error } = await supabase
        .from('notifications')
        .insert({
          user_id: user.id,
          type: 'substitution',
          message,
          related_id: null,
        });
      if (error) {
        console.log('Failed to create notification:', error);
      }
    } catch (error) {
      console.log('Notification creation failed:', error);
    }
  }, [user?.id, pitchBoardNotificationsEnabled]);

  // Open auto-sub plan dialog with minutes from pitch settings
  const openAutoSubPlanDialog = useCallback((editMode?: boolean) => {
    setAutoSubPlanEditMode(editMode === true);
    setAutoSubFromPreGame(false);
    setAutoSubPlanDialogOpen(true);
  }, []);

  const handleOpenNewPlan = useCallback(() => openAutoSubPlanDialog(false), [openAutoSubPlanDialog]);
  const handleOpenEditPlan = useCallback(() => openAutoSubPlanDialog(true), [openAutoSubPlanDialog]);

  // Fetch team player positions from database with caching
  const { data: teamPlayerPositions } = useQuery({
    queryKey: ["team-player-positions", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_player_positions")
        .select("*")
        .eq("team_id", teamId);
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Fetch linked event details (for opponent name)
  const { data: linkedEventDetails } = useQuery({
    queryKey: ["pitch-linked-event", linkedEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, opponent, title")
        .eq("id", linkedEventId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!linkedEventId,
    staleTime: 5 * 60 * 1000,
  });

  // Extract opponent name from linked event
  const opponentName = useMemo(() => {
    if (linkedEventDetails?.opponent) return linkedEventDetails.opponent;
    if (linkedEventDetails?.title) {
      const vsMatch = linkedEventDetails.title.match(/\bvs?\b\s*(.+)/i);
      if (vsMatch) return vsMatch[1].trim();
    }
    return "Opponent";
  }, [linkedEventDetails]);

  // Goal handlers
  const handleAddGoal = useCallback((goal: Goal) => {
    setGoals(prev => [...prev, goal]);
    // Auto-collapse score in portrait mode after adding a goal
    if (!isLandscape) {
      setShowScoreInPortrait(false);
    }
  }, [isLandscape]);

  const handleRemoveGoal = useCallback((goalId: string) => {
    setGoals(prev => prev.filter(g => g.id !== goalId));
  }, []);

  // Generate mock players with positions
  const generateMockPlayers = useCallback((count: number): Player[] => {
    const mockNames = [
      "Alex Smith", "Jordan Lee", "Casey Brown", "Taylor Wilson", "Morgan Davis",
      "Riley Johnson", "Quinn Anderson", "Avery Thomas", "Cameron White", "Drew Martinez",
      "Jamie Garcia", "Peyton Robinson", "Skyler Clark", "Dakota Lewis", "Reese Walker"
    ];
    return Array.from({ length: count }, (_, i) => ({
      id: `mock-${i + 1}`,
      name: mockNames[i] || `Player ${i + 1}`,
      number: i + 1,
      position: null,
      assignedPositions: [], // Empty = eligible for all positions
      minutesPlayed: 0,
    }));
  }, []);

  // Get real players from team members with preferred positions from database
  // For mini-league mode, also assign team sides based on miniLeagueTeams config
  const realPlayers = useMemo(() => members
    .filter(m => m.role === "player")
    .map((m, index) => {
      const savedPos = teamPlayerPositions?.find(p => p.user_id === m.user_id);
      // Determine team side for mini-league mode
      let teamSide: "a" | "b" | undefined;
      if (miniLeagueTeams) {
        if (miniLeagueTeams.teamAPlayerIds.includes(m.user_id)) {
          teamSide = "a";
        } else if (miniLeagueTeams.teamBPlayerIds.includes(m.user_id)) {
          teamSide = "b";
        }
      }
      return {
        id: m.user_id,
        name: m.profiles?.display_name || `Player ${index + 1}`,
        number: savedPos?.jersey_number || index + 1,
        position: null as { x: number; y: number } | null,
        assignedPositions: (savedPos?.preferred_positions || []) as PitchPosition[],
        currentPitchPosition: undefined as PitchPosition | undefined,
        minutesPlayed: 0,
        teamSide,
      };
    }), [members, teamPlayerPositions, miniLeagueTeams]);

  // Helper to auto-place players on pitch using formation
  // Only places players in positions they're eligible for based on assignedPositions
  // Uses smart matching to ensure all position types get filled by eligible players
  const autoPlacePlayersOnPitch = useCallback((
    playersToPlace: Player[],
    size: TeamSize,
    formationIndex: number
  ): Player[] => {
    const formation = FORMATIONS[size][formationIndex];
    if (!formation) return playersToPlace;
    
    // Helper to check if player can play a position
    const canPlayPosition = (player: Player, pitchPos: PitchPosition): boolean => {
      // Players with no assigned positions can play anywhere
      if (!player.assignedPositions?.length) return true;
      return player.assignedPositions.includes(pitchPos);
    };
    
    // Build a list of formation slots with their required position types
    const slots = formation.positions.map((pos, index) => ({
      index,
      pos,
      pitchPos: getPositionFromCoords(pos.y, size),
      assignedPlayer: null as Player | null,
    }));
    
    // Track which players have been assigned
    const assignedPlayerIds = new Set<string>();
    
    // First pass: assign specialists (players with only one assigned position) to their positions
    // This ensures forwards fill forward slots, etc.
    const specialists = playersToPlace.filter(p => p.assignedPositions?.length === 1);
    for (const player of specialists) {
      if (assignedPlayerIds.has(player.id)) continue;
      
      const targetPos = player.assignedPositions![0];
      const slot = slots.find(s => s.pitchPos === targetPos && !s.assignedPlayer);
      if (slot) {
        slot.assignedPlayer = player;
        assignedPlayerIds.add(player.id);
      }
    }
    
    // Second pass: assign multi-position players to remaining slots they can fill
    const multiPos = playersToPlace.filter(p => (p.assignedPositions?.length || 0) > 1);
    for (const player of multiPos) {
      if (assignedPlayerIds.has(player.id)) continue;
      
      const slot = slots.find(s => !s.assignedPlayer && canPlayPosition(player, s.pitchPos));
      if (slot) {
        slot.assignedPlayer = player;
        assignedPlayerIds.add(player.id);
      }
    }
    
    // Third pass: assign flex players (no assigned positions) to remaining slots
    const flexPlayers = playersToPlace.filter(p => !p.assignedPositions?.length);
    for (const player of flexPlayers) {
      if (assignedPlayerIds.has(player.id)) continue;
      
      const slot = slots.find(s => !s.assignedPlayer);
      if (slot) {
        slot.assignedPlayer = player;
        assignedPlayerIds.add(player.id);
      }
    }
    
    // Build result: assigned players on pitch, unassigned on bench
    const result: Player[] = [];
    
    // Add players assigned to slots
    for (const slot of slots) {
      if (slot.assignedPlayer) {
        result.push({
          ...slot.assignedPlayer,
          position: slot.pos,
          currentPitchPosition: slot.pitchPos,
        });
      }
    }
    
    // Add unassigned players to bench
    for (const player of playersToPlace) {
      if (!assignedPlayerIds.has(player.id)) {
        result.push({
          ...player,
          position: null,
          currentPitchPosition: undefined,
        });
      }
    }
    
    return result;
  }, []);

  // Auto-place players for mini-league two-team mode
  // Places Team A on the bottom half (defending goal) and Team B on the top half (attacking goal)
  // When preserveOnPitchStatus=true, only repositions players already on pitch (for team size/formation changes)
  // When preserveOnPitchStatus=false (default for initial placement), places all players on pitch
  const autoPlaceMiniLeaguePlayers = useCallback((
    playersToPlace: Player[],
    size: TeamSize,
    preserveOnPitchStatus: boolean = false,
    formationIndex: number = 0,
    applyFormationPositions: boolean = false
  ): Player[] => {
    const formation = FORMATIONS[size][formationIndex] || FORMATIONS[size][0];
    if (!formation) return playersToPlace;
    
    const teamAPlayers = playersToPlace.filter(p => p.teamSide === "a");
    const teamBPlayers = playersToPlace.filter(p => p.teamSide === "b");
    const unassignedPlayers = playersToPlace.filter(p => !p.teamSide);
    
    const result: Player[] = [];
    
    // Helper to scale formation position to bottom half (for Team A: y 50-95)
    const scaleToBottomHalf = (pos: { x: number; y: number }) => {
      // Formation y typically ranges from ~15 (forwards) to ~90 (GK)
      // Scale to bottom half: y 50 (center) to 95 (near goal)
      const scaledY = 50 + (pos.y / 100) * 45; // Map 0-100 -> 50-95
      return { x: pos.x, y: scaledY };
    };
    
    // Helper to scale formation position to top half (for Team B: y 5-50)
    const scaleToTopHalf = (pos: { x: number; y: number }) => {
      // Mirror and scale to top half: y 5 (near goal) to 50 (center)
      const scaledY = 50 - (pos.y / 100) * 45; // Map 0-100 -> 50-5 (inverted)
      const mirroredX = 100 - pos.x; // Mirror X for Team B
      return { x: mirroredX, y: scaledY };
    };
    
    if (preserveOnPitchStatus && applyFormationPositions) {
      // Formation change: reposition on-pitch players to new formation, keep bench players on bench
      const teamAOnPitch = teamAPlayers.filter(p => p.position !== null);
      const teamBOnPitch = teamBPlayers.filter(p => p.position !== null);
      const teamAOnBench = teamAPlayers.filter(p => p.position === null);
      const teamBOnBench = teamBPlayers.filter(p => p.position === null);
      
      // Place Team A on-pitch players to new formation positions (bottom half)
      teamAOnPitch.forEach((player, index) => {
        if (index < formation.positions.length) {
          const pos = scaleToBottomHalf(formation.positions[index]);
          result.push({
            ...player,
            position: pos,
            currentPitchPosition: getPositionFromCoords(formation.positions[index].y, size),
          });
        } else {
          // More players than positions - keep on pitch at current spot
          result.push({
            ...player,
            currentPitchPosition: getPositionFromCoords(player.position!.y, size),
          });
        }
      });
      
      // Team A bench stays on bench
      teamAOnBench.forEach(player => {
        result.push({ ...player });
      });
      
      // Place Team B on-pitch players to new formation positions (top half)
      teamBOnPitch.forEach((player, index) => {
        if (index < formation.positions.length) {
          const pos = scaleToTopHalf(formation.positions[index]);
          result.push({
            ...player,
            position: pos,
            currentPitchPosition: getPositionFromCoords(formation.positions[index].y, size),
          });
        } else {
          // More players than positions - keep on pitch at current spot
          result.push({
            ...player,
            currentPitchPosition: getPositionFromCoords(100 - player.position!.y, size),
          });
        }
      });
      
      // Team B bench stays on bench
      teamBOnBench.forEach(player => {
        result.push({ ...player });
      });
    } else if (preserveOnPitchStatus && !applyFormationPositions) {
      // Team size change: adjust player count per team to match new size
      const teamAOnPitch = teamAPlayers.filter(p => p.position !== null);
      const teamBOnPitch = teamBPlayers.filter(p => p.position !== null);
      const teamAOnBench = teamAPlayers.filter(p => p.position === null);
      const teamBOnBench = teamBPlayers.filter(p => p.position === null);
      
      const targetSize = parseInt(size);
      
      // Team A: adjust to target size (bottom half)
      const teamAToPlace = [...teamAOnPitch, ...teamAOnBench].slice(0, targetSize);
      const teamATooBench = [...teamAOnPitch, ...teamAOnBench].slice(targetSize);
      
      teamAToPlace.forEach((player, index) => {
        if (index < formation.positions.length) {
          const pos = scaleToBottomHalf(formation.positions[index]);
          result.push({
            ...player,
            position: pos,
            currentPitchPosition: getPositionFromCoords(formation.positions[index].y, size),
          });
        } else {
          result.push({ ...player, position: null, currentPitchPosition: undefined });
        }
      });
      teamATooBench.forEach(player => {
        result.push({ ...player, position: null, currentPitchPosition: undefined });
      });
      
      // Team B: adjust to target size (top half)
      const teamBToPlace = [...teamBOnPitch, ...teamBOnBench].slice(0, targetSize);
      const teamBTooBench = [...teamBOnPitch, ...teamBOnBench].slice(targetSize);
      
      teamBToPlace.forEach((player, index) => {
        if (index < formation.positions.length) {
          const pos = scaleToTopHalf(formation.positions[index]);
          result.push({
            ...player,
            position: pos,
            currentPitchPosition: getPositionFromCoords(formation.positions[index].y, size),
          });
        } else {
          result.push({ ...player, position: null, currentPitchPosition: undefined });
        }
      });
      teamBTooBench.forEach(player => {
        result.push({ ...player, position: null, currentPitchPosition: undefined });
      });
    } else {
      // Initial placement - place all players on pitch (up to formation size)
      teamAPlayers.forEach((player, index) => {
        if (index < formation.positions.length) {
          const pos = scaleToBottomHalf(formation.positions[index]);
          result.push({
            ...player,
            position: pos,
            currentPitchPosition: getPositionFromCoords(formation.positions[index].y, size),
          });
        } else {
          result.push({ ...player, position: null, currentPitchPosition: undefined });
        }
      });
      
      teamBPlayers.forEach((player, index) => {
        if (index < formation.positions.length) {
          const pos = scaleToTopHalf(formation.positions[index]);
          result.push({
            ...player,
            position: pos,
            currentPitchPosition: getPositionFromCoords(formation.positions[index].y, size),
          });
        } else {
          result.push({ ...player, position: null, currentPitchPosition: undefined });
        }
      });
    }
    
    // Any unassigned players go to bench
    unassignedPlayers.forEach(player => {
      result.push({ ...player, position: null, currentPitchPosition: undefined });
    });
    
    return result;
  }, []);

  // Initialize players - check localStorage first to preserve positions across navigation
  // IMPORTANT: Always prefer saved state when it exists, regardless of whether players have positions
  // This ensures players stay where they were placed even if game is not running
  // For mini-league mode, auto-place both teams on the pitch
  const [players, setPlayers] = useState<Player[]>(() => {
    console.log("[PitchState] useState init - savedState:", savedState ? "exists" : "null", "realPlayers count:", realPlayers.length);
    if (savedState?.players && savedState.players.length > 0) {
      console.log("[PitchState] useState init - using saved players");
      // For mini-league mode, we need to check if saved state has proper two-team layout
      // If Team B players are not on the top half (y < 50), re-place all players
      if (miniLeagueTeams) {
        // Apply teamSide to saved players first
        const playersWithTeamSide = savedState.players.map(p => {
          let teamSide: "a" | "b" | undefined;
          if (miniLeagueTeams.teamAPlayerIds.includes(p.id)) {
            teamSide = "a";
          } else if (miniLeagueTeams.teamBPlayerIds.includes(p.id)) {
            teamSide = "b";
          }
          return { ...p, teamSide };
        });
        
        // Check if teams are correctly positioned (Team A bottom half, Team B top half)
        const teamAOnPitch = playersWithTeamSide.filter(p => p.teamSide === "a" && p.position);
        const teamBOnPitch = playersWithTeamSide.filter(p => p.teamSide === "b" && p.position);
        const teamACorrectlyPositioned = teamAOnPitch.length === 0 || teamAOnPitch.every(p => p.position!.y >= 50);
        const teamBCorrectlyPositioned = teamBOnPitch.length === 0 || teamBOnPitch.every(p => p.position!.y < 50);
        
        if ((!teamACorrectlyPositioned || !teamBCorrectlyPositioned) && (teamAOnPitch.length > 0 || teamBOnPitch.length > 0)) {
          console.log("[PitchState] Re-placing players for proper two-team half-pitch layout");
          // Saved state doesn't have correct two-team layout - re-place all players
          return autoPlaceMiniLeaguePlayers(playersWithTeamSide, getInitialTeamSize());
        }
        
        return playersWithTeamSide;
      }
      return savedState.players;
    }
    // For mini-league mode, auto-place players on both halves
    if (miniLeagueTeams) {
      console.log("[PitchState] useState init - using miniLeagueTeams mode");
      return autoPlaceMiniLeaguePlayers(realPlayers, getInitialTeamSize());
    }
    console.log("[PitchState] useState init - using realPlayers as fallback");
    return realPlayers;
  });
  
  // Keep playersRef in sync with players state (for use in effects with stale closures)
  playersRef.current = players;
  
  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null);
  const [touchDragPlayer, setTouchDragPlayer] = useState<string | null>(null);
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);

  // Ball position state
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number }>(() => savedState?.ballPosition || { x: 50, y: 50 });
  const [isDraggingBall, setIsDraggingBall] = useState(false);

  // Helper to get team color for a player in mini-league mode
  const getPlayerTeamColor = useCallback((player: Player): string | undefined => {
    if (!miniLeagueTeams || !player.teamSide) return undefined;
    return player.teamSide === "a" ? miniLeagueTeams.teamAColor : miniLeagueTeams.teamBColor;
  }, [miniLeagueTeams]);

  // Substitution mode state
  const [subMode, setSubMode] = useState(false);
  const [selectedOnPitch, setSelectedOnPitch] = useState<string | null>(null);
  const [selectedOnBench, setSelectedOnBench] = useState<string | null>(null);
  const [subAnimationPlayers, setSubAnimationPlayers] = useState<{ in: string | null; out: string | null }>({ in: null, out: null });

  // Manual substitution confirmation dialog state
  const [manualSubConfirmOpen, setManualSubConfirmOpen] = useState(false);
  const [pendingManualSub, setPendingManualSub] = useState<{ 
    pitchPlayerId: string; 
    benchPlayerId: string;
    swapPlayerId?: string; // Optional: if set, includes a position swap in the sub
  } | null>(null);

  // Position swap mode state (swapping two players on pitch without substitution)
  const [swapMode, setSwapMode] = useState(false);
  const [swapPlayer1, setSwapPlayer1] = useState<string | null>(null);
  const [swapPlayer2, setSwapPlayer2] = useState<string | null>(null);
  const [pitchSwapConfirmOpen, setPitchSwapConfirmOpen] = useState(false);

  // Swap-based substitution state (for sequencing: swap dialog first, then sub dialog)
  const [pendingSwapBasedSub, setPendingSwapBasedSub] = useState<{
    pitchPlayerId: string;
    benchPlayerId: string;
    swapPlayerId: string;
  } | null>(null);
  const [swapBeforeSubDialogOpen, setSwapBeforeSubDialogOpen] = useState(false);

  // Bench-to-pitch drag substitution state
  const [benchToSubOpen, setBenchToSubOpen] = useState(false);
  const [benchToSubPlayer, setBenchToSubPlayer] = useState<string | null>(null);
  const [benchDragPlayer, setBenchDragPlayer] = useState<string | null>(null);
  const [benchDragPos, setBenchDragPos] = useState<{ x: number; y: number } | null>(null);
  const benchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const benchDragStartTouch = useRef<{ x: number; y: number } | null>(null);
  const [subAfterSwapDialogOpen, setSubAfterSwapDialogOpen] = useState(false);
  const [resetGameConfirmOpen, setResetGameConfirmOpen] = useState(false);
  const [pitchPlayerActionOpen, setPitchPlayerActionOpen] = useState(false);
  const [pitchPlayerActionTarget, setPitchPlayerActionTarget] = useState<string | null>(null);
  const [benchInjuryConfirmOpen, setBenchInjuryConfirmOpen] = useState(false);
  const [benchInjuryTarget, setBenchInjuryTarget] = useState<string | null>(null);
  const lastTapRef = useRef<{ playerId: string; time: number } | null>(null);
  const touchHandledRef = useRef(false);

  // Mock player mode state
  const [mockMode, setMockMode] = useState(() => savedState?.mockMode || false);

  // Match stats panel state
  const [statsOpen, setStatsOpen] = useState(false);

  // Set flag to indicate pitch board is open (for GlobalSubMonitor to know)
  useEffect(() => {
    localStorage.setItem(PITCH_BOARD_OPEN_KEY, "true");
    return () => {
      localStorage.removeItem(PITCH_BOARD_OPEN_KEY);
    };
  }, []);

  // Track if we've done initial load
  const hasLoadedRef = useRef(false);
  
  // Handle initialization and merging new players
  useEffect(() => {
    // Only process once per component mount
    if (hasLoadedRef.current) return;
    
    if (savedState) {
      // If mockMode is true, we have saved mock players - don't merge real players
      // Just use the saved state as-is
      if (savedState.mockMode) {
        hasLoadedRef.current = true;
        setHasInitialized(true);
        return;
      }
      
      // We have saved state with real players - check if we need to merge new real players
      const savedPlayerIds = new Set(savedState.players.map(p => p.id));
      const newPlayers = realPlayers.filter(p => !savedPlayerIds.has(p.id));
      
      // If there are new players not in saved state, add them
      if (newPlayers.length > 0) {
        setPlayers(prev => [...prev, ...newPlayers]);
      }
      
      hasLoadedRef.current = true;
      setHasInitialized(true);
    } else if (realPlayers.length > 0) {
      // No saved state, but we have real players - auto-place them
      // Use mini-league two-team mode if configured, otherwise single team mode
      if (miniLeagueTeams) {
        setPlayers(autoPlaceMiniLeaguePlayers(realPlayers, teamSize));
      } else {
        setPlayers(autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation));
      }
      hasLoadedRef.current = true;
      setHasInitialized(true);
    }
    // If no saved state and no realPlayers yet, wait for realPlayers to load
  }, [savedState, realPlayers, autoPlacePlayersOnPitch, autoPlaceMiniLeaguePlayers, miniLeagueTeams, teamSize, selectedFormation]);

  // Lineup skip handler (needs players + autoPlacePlayersOnPitch to be defined)
  const handleLineupSkip = useCallback(() => {
    if (!miniLeagueTeams) {
      setPlayers(autoPlacePlayersOnPitch(players, teamSize, selectedFormation));
    }
    setShowLineupPicker(false);
  }, [players, teamSize, selectedFormation, autoPlacePlayersOnPitch, miniLeagueTeams]);

  // Save pitch state to localStorage whenever it changes (only after initialization)
  useEffect(() => {
    if (!hasInitialized) return;
    
    savePitchState(teamId, {
      players,
      teamSize,
      selectedFormation,
      ballPosition,
      autoSubPlan,
      autoSubActive,
      autoSubPaused,
      mockMode,
      linkedEventId,
      goals,
    });
    
    // Also sync to database if this is an event group (mini-league match)
    if (isEventGroup) {
      forceEventGroupSync();
    }
  }, [hasInitialized, teamId, players, teamSize, selectedFormation, ballPosition, autoSubPlan, autoSubActive, autoSubPaused, mockMode, linkedEventId, goals, isEventGroup, forceEventGroupSync]);

  // Sync player position preferences from database when they change
  // This ensures updated preferences are reflected even when using saved state from localStorage
  useEffect(() => {
    if (!teamPlayerPositions || mockMode) return;
    
    setPlayers(prev => prev.map(player => {
      const dbPosition = teamPlayerPositions.find(p => p.user_id === player.id);
      if (dbPosition) {
        const newAssignedPositions = (dbPosition.preferred_positions || []) as PitchPosition[];
        const newNumber = dbPosition.jersey_number || player.number;
        
        // Only update if there's actually a change
        const positionsChanged = JSON.stringify(player.assignedPositions) !== JSON.stringify(newAssignedPositions);
        const numberChanged = player.number !== newNumber;
        
        if (positionsChanged || numberChanged) {
          return {
            ...player,
            assignedPositions: newAssignedPositions,
            number: newNumber,
          };
        }
      }
      return player;
    }));
  }, [teamPlayerPositions, mockMode]);

  // Handle player position assignment update
  const handleUpdatePositions = useCallback((playerId: string, positions: PitchPosition[]) => {
    setPlayers(prev => prev.map(p => 
      p.id === playerId ? { ...p, assignedPositions: positions } : p
    ));
  }, []);

  // Handle mock mode toggle - auto-apply formation when enabled
  const handleMockModeChange = useCallback((enabled: boolean) => {
    setMockMode(enabled);
    if (enabled) {
      const neededPlayers = parseInt(teamSize);
      // Generate exactly teamSize players for pitch + 2 for bench
      const mockPlayers = generateMockPlayers(neededPlayers + 2);
      
      // Auto-apply current formation with eligibility checking
      const updatedPlayers = autoPlacePlayersOnPitch(mockPlayers, teamSize, selectedFormation);
      setPlayers(updatedPlayers);
      // Ensure state gets saved by marking as initialized
      hasLoadedRef.current = true;
      setHasInitialized(true);
    } else {
      const freshRealPlayers = members
        .filter(m => m.role === "player")
        .map((m, index) => ({
          id: m.user_id,
          name: m.profiles?.display_name || `Player ${index + 1}`,
          number: index + 1,
          position: null as { x: number; y: number } | null,
          assignedPositions: [] as PitchPosition[],
          currentPitchPosition: undefined as PitchPosition | undefined,
          minutesPlayed: 0,
        }));
      setPlayers(freshRealPlayers);
    }
  }, [teamSize, selectedFormation, generateMockPlayers, members]);

  // Track previous team size to detect changes (not initial load)
  const prevTeamSizeRef = useRef<TeamSize | null>(null);
  const prevFormationRef = useRef<number | null>(null);
  
  // Update mock players when team size or formation changes - but NOT on initial mount
  useEffect(() => {
    if (mockMode) {
      // Skip initial mount - only react to actual changes
      if (prevTeamSizeRef.current === null) {
        prevTeamSizeRef.current = teamSize;
        prevFormationRef.current = selectedFormation;
        return;
      }
      
      // Only regenerate if team size or formation actually changed
      if (prevTeamSizeRef.current !== teamSize || prevFormationRef.current !== selectedFormation) {
        const neededPlayers = parseInt(teamSize);
        // Generate exactly teamSize players for pitch + 2 for bench
        const mockPlayers = generateMockPlayers(neededPlayers + 2);
        
        // Auto-apply current formation with eligibility checking
        const updatedPlayers = autoPlacePlayersOnPitch(mockPlayers, teamSize, selectedFormation);
        setPlayers(updatedPlayers);
        
        prevTeamSizeRef.current = teamSize;
        prevFormationRef.current = selectedFormation;
      }
    }
  }, [teamSize, mockMode, selectedFormation, generateMockPlayers]);

  // Arrow drawing state
  const isDrawingArrowRef = useRef(false);
  const arrowStartRef = useRef<{ x: number; y: number } | null>(null);
  const tempArrowRef = useRef<any>(null);
  const drawingToolRef = useRef(drawingTool);

  // Fetch saved formations - lazy load only when save/load dialog is opened
  const { data: savedFormations, isLoading: loadingFormations } = useQuery({
    queryKey: ["pitch-formations", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pitch_formations")
        .select("*, profiles:created_by(display_name)")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: saveDialogOpen || loadDialogOpen, // Only fetch when dialogs are open
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Save formation mutation
  const saveFormationMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!user) throw new Error("Not authenticated");
      
      const formationData = players.map(p => ({
        id: p.id,
        name: p.name,
        number: p.number,
        position: p.position,
        assignedPositions: p.assignedPositions,
        currentPitchPosition: p.currentPitchPosition,
      }));
      
      const drawingData = fabricCanvas ? JSON.stringify(fabricCanvas.toJSON()) : null;
      
      const { error } = await supabase.from("pitch_formations").insert({
        team_id: teamId,
        name,
        team_size: parseInt(teamSize),
        formation_data: formationData,
        drawing_data: drawingData,
        created_by: user.id,
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitch-formations", teamId] });
      toast({ title: "Formation saved", description: "Your formation has been saved successfully" });
      setSaveDialogOpen(false);
      setFormationName("");
    },
    onError: (error: any) => {
      toast({ title: "Error saving formation", description: error.message, variant: "destructive" });
    },
  });

  // Delete formation mutation
  const deleteFormationMutation = useMutation({
    mutationFn: async (formationId: string) => {
      const { error } = await supabase
        .from("pitch_formations")
        .delete()
        .eq("id", formationId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitch-formations", teamId] });
      toast({ title: "Formation deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Error deleting formation", description: error.message, variant: "destructive" });
    },
  });

  // Load a saved formation
  const loadFormation = useCallback((formation: any) => {
    // Set team size
    setTeamSize(formation.team_size.toString() as TeamSize);
    
    // Load player positions
    const formationData = formation.formation_data as Player[];
    setPlayers(prev => {
      return prev.map(p => {
        const savedPlayer = formationData.find(fp => fp.id === p.id);
        if (savedPlayer) {
          return { 
            ...p, 
            position: savedPlayer.position,
            assignedPositions: savedPlayer.assignedPositions || p.assignedPositions,
            currentPitchPosition: savedPlayer.currentPitchPosition || (savedPlayer.position ? getPositionFromCoords(savedPlayer.position.y, formation.team_size.toString() as TeamSize) : undefined),
          };
        }
        return { ...p, position: null, currentPitchPosition: undefined };
      });
    });
    
    // Load drawings
    if (formation.drawing_data && fabricCanvas) {
      try {
        const drawingJson = JSON.parse(formation.drawing_data);
        fabricCanvas.loadFromJSON(drawingJson).then(() => {
          fabricCanvas.renderAll();
        });
      } catch (e) {
        console.error("Error loading drawings:", e);
      }
    }
    
    setLoadDialogOpen(false);
    toast({ title: "Formation loaded", description: `Loaded "${formation.name}"` });
  }, [fabricCanvas, toast]);

  const handleSaveFormation = () => {
    if (!formationName.trim()) {
      toast({ title: "Please enter a name", variant: "destructive" });
      return;
    }
    saveFormationMutation.mutate(formationName.trim());
  };

  // Keep ref updated
  useEffect(() => {
    drawingToolRef.current = drawingTool;
  }, [drawingTool]);

  // Create arrow helper - uses lazy-loaded fabric module
  const createArrow = useCallback((startX: number, startY: number, endX: number, endY: number, color: string) => {
    if (!fabricModule) return null;
    
    const { Line, Triangle, Group } = fabricModule;
    const angle = Math.atan2(endY - startY, endX - startX);
    const headLength = 12;
    
    // Main line
    const line = new Line([startX, startY, endX, endY], {
      stroke: color,
      strokeWidth: 3,
      selectable: false,
      evented: false,
    });
    
    // Arrow head
    const triangle = new Triangle({
      left: endX,
      top: endY,
      width: headLength,
      height: headLength,
      fill: color,
      angle: (angle * 180 / Math.PI) + 90,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    
    const group = new Group([line, triangle], {
      selectable: false,
      evented: false,
    });
    
    return group;
  }, [fabricModule]);

  // Handle arrow drawing
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleMouseDown = (e: any) => {
      if (drawingTool !== "arrow") return;
      
      const pointer = fabricCanvas.getViewportPoint(e.e);
      isDrawingArrowRef.current = true;
      arrowStartRef.current = { x: pointer.x, y: pointer.y };
    };

    const handleMouseMove = (e: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current || drawingTool !== "arrow") return;
      
      const pointer = fabricCanvas.getViewportPoint(e.e);
      
      // Remove temp arrow
      if (tempArrowRef.current) {
        fabricCanvas.remove(tempArrowRef.current);
      }
      
      // Create new temp arrow
      const arrow = createArrow(
        arrowStartRef.current.x,
        arrowStartRef.current.y,
        pointer.x,
        pointer.y,
        drawingColor
      );
      
      if (arrow) {
        tempArrowRef.current = arrow;
        fabricCanvas.add(arrow);
        fabricCanvas.renderAll();
      }
    };

    const handleMouseUp = (e: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current || drawingTool !== "arrow") return;
      
      const pointer = fabricCanvas.getViewportPoint(e.e);
      
      // Remove temp arrow
      if (tempArrowRef.current) {
        fabricCanvas.remove(tempArrowRef.current);
        tempArrowRef.current = null;
      }
      
      // Create final arrow if there's enough distance
      const distance = Math.sqrt(
        Math.pow(pointer.x - arrowStartRef.current.x, 2) +
        Math.pow(pointer.y - arrowStartRef.current.y, 2)
      );
      
      if (distance > 20) {
        const arrow = createArrow(
          arrowStartRef.current.x,
          arrowStartRef.current.y,
          pointer.x,
          pointer.y,
          drawingColor
        );
        if (arrow) {
          fabricCanvas.add(arrow);
          fabricCanvas.renderAll();
        }
      }
      
      isDrawingArrowRef.current = false;
      arrowStartRef.current = null;
    };

    fabricCanvas.on("mouse:down", handleMouseDown);
    fabricCanvas.on("mouse:move", handleMouseMove);
    fabricCanvas.on("mouse:up", handleMouseUp);

    return () => {
      fabricCanvas.off("mouse:down", handleMouseDown);
      fabricCanvas.off("mouse:move", handleMouseMove);
      fabricCanvas.off("mouse:up", handleMouseUp);
    };
  }, [fabricCanvas, drawingTool, drawingColor, createArrow]);

  // Update drawing mode
  useEffect(() => {
    if (!fabricCanvas) return;

    if (drawingTool === "pen") {
      fabricCanvas.isDrawingMode = true;
      if (fabricCanvas.freeDrawingBrush) {
        fabricCanvas.freeDrawingBrush.color = drawingColor;
        fabricCanvas.freeDrawingBrush.width = 3;
      }
    } else {
      fabricCanvas.isDrawingMode = false;
    }
  }, [drawingTool, drawingColor, fabricCanvas]);

  const clearDrawings = useCallback(() => {
    if (!fabricCanvas) return;
    fabricCanvas.clear();
    fabricCanvas.backgroundColor = "transparent";
    fabricCanvas.renderAll();
  }, [fabricCanvas]);

  // Push current player state to undo history before making changes
  const pushToUndoHistory = useCallback((description: string, currentPlayers: Player[]) => {
    console.log("[Undo] pushToUndoHistory called:", { description, playerCount: currentPlayers.length, isLandscape });
    setUndoHistory(prev => {
      const newHistory = [...prev, { players: JSON.parse(JSON.stringify(currentPlayers)), description }];
      console.log("[Undo] New history length:", newHistory.length, "isLandscape:", isLandscape);
      if (newHistory.length > MAX_UNDO_HISTORY) {
        return newHistory.slice(-MAX_UNDO_HISTORY);
      }
      return newHistory;
    });
    
    // Show floating undo button for 30 seconds
    console.log("[Undo] Setting showFloatingUndo to true");
    setShowFloatingUndo(true);
    if (floatingUndoTimerRef.current) {
      clearTimeout(floatingUndoTimerRef.current);
    }
    floatingUndoTimerRef.current = setTimeout(() => {
      console.log("[Undo] Timer expired, hiding floating undo");
      setShowFloatingUndo(false);
    }, isLandscape ? 30000 : 5000);
  }, [isLandscape]);

  // Undo last sub or swap
  const handleUndo = useCallback(() => {
    // Guard against concurrent calls
    if (isUndoingRef.current) return;
    if (undoHistory.length === 0) return;
    
    isUndoingRef.current = true;
    
    const lastState = undoHistory[undoHistory.length - 1];
    
    // Restore players from the saved state
    setPlayers(lastState.players);
    
    // Remove the last item from history
    setUndoHistory(prev => {
      const newHistory = prev.slice(0, -1);
      // Hide floating undo if no more history
      if (newHistory.length === 0) {
        setShowFloatingUndo(false);
        if (floatingUndoTimerRef.current) {
          clearTimeout(floatingUndoTimerRef.current);
          floatingUndoTimerRef.current = null;
        }
      }
      return newHistory;
    });
    
    toast({ 
      title: "Undo successful", 
      description: `Reverted: ${lastState.description}` 
    });
    
    // Reset the flag after effects have processed
    requestAnimationFrame(() => {
      isUndoingRef.current = false;
    });
  }, [toast, undoHistory]);
  
  // Cleanup floating undo timer on unmount
  useEffect(() => {
    return () => {
      if (floatingUndoTimerRef.current) {
        clearTimeout(floatingUndoTimerRef.current);
      }
    };
  }, []);

  // Handle formation selection - preview changes and show confirmation
  const handleFormationChange = (value: string) => {
    const index = parseInt(value);
    if (index === selectedFormation) return; // No change
    const formation = FORMATIONS[teamSize][index];
    if (!formation) return;

    const numPositions = parseInt(teamSize);
    
    // Calculate what changes would happen
    const playersOnPitch = players.filter(p => p.position !== null);
    const benchPlayers = players.filter(p => p.position === null);
    const allPlayers = [...playersOnPitch, ...benchPlayers];
    
    const positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition }[] = [];
    const benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[] = [];
    
    // Who will be on pitch after change
    const willBeOnPitch = allPlayers.slice(0, numPositions);
    const willBeOnBench = allPlayers.slice(numPositions);
    
    // Players going from pitch to bench
    for (const player of playersOnPitch) {
      if (willBeOnBench.some(p => p.id === player.id)) {
        benchMoves.push({ player, direction: "to-bench", position: player.currentPitchPosition });
      }
    }
    
    // Players coming from bench to pitch
    for (let i = 0; i < willBeOnPitch.length; i++) {
      const player = willBeOnPitch[i];
      if (benchPlayers.some(p => p.id === player.id) && formation.positions[i]) {
        const newPos = getPositionFromCoords(formation.positions[i].y, teamSize);
        benchMoves.push({ player, direction: "to-pitch", position: newPos });
      }
    }
    
    // Position changes for players staying on pitch
    for (let i = 0; i < willBeOnPitch.length; i++) {
      const player = willBeOnPitch[i];
      if (player.currentPitchPosition && formation.positions[i] && playersOnPitch.some(p => p.id === player.id) && !willBeOnBench.some(p => p.id === player.id)) {
        const newPosition = getPositionFromCoords(formation.positions[i].y, teamSize);
        if (player.currentPitchPosition !== newPosition) {
          positionSwaps.push({ player, fromPosition: player.currentPitchPosition, toPosition: newPosition });
        }
      }
    }

    // If there are any changes, show confirmation
    if (positionSwaps.length > 0 || benchMoves.length > 0) {
      setPendingFormationChange({ index, positionSwaps, benchMoves });
      setFormationChangeDialogOpen(true);
      return;
    }

    // Apply immediately if no meaningful changes
    applyFormationChange(index);
  };

  const handleTacticalModeChange = useCallback((mode: TacticalMode) => {
    setTacticalMode(mode);

    if (mode === "neutral") {
      setTacticalFormationSuggestion(null);
      return;
    }

    const rec = RECOMMENDED_FORMATIONS[teamSize];
    const suggestedIndex = mode === "attack" ? rec.attack : rec.defend;
    const suggestedFormation = FORMATIONS[teamSize][suggestedIndex];

    if (suggestedIndex !== selectedFormation && suggestedFormation) {
      setTacticalFormationSuggestion({
        mode,
        formationIndex: suggestedIndex,
        formationName: suggestedFormation.name,
      });
    } else {
      setTacticalFormationSuggestion(null);
    }
  }, [teamSize, selectedFormation]);

  const handleApplyTacticalSuggestion = useCallback(() => {
    if (!tacticalFormationSuggestion) return;
    handleFormationChange(String(tacticalFormationSuggestion.formationIndex));
    setTacticalFormationSuggestion(null);
  }, [tacticalFormationSuggestion, handleFormationChange]);

  const handleDismissTacticalSuggestion = useCallback(() => {
    setTacticalFormationSuggestion(null);
    // Minimise the bottom drawer after dismissing
    setToolbarCollapsed(true);
    setPortraitSheetOpen(false);
  }, []);

  const applyFormationChange = useCallback((index: number) => {
    const formation = FORMATIONS[teamSize][index];
    if (!formation) return;

    setSelectedFormation(index);
    
    // Persist to database
    persistFormationToDb(formation.name);

    // For mini-league mode, re-place both teams with the new formation (reposition to formation)
    if (miniLeagueTeams) {
      setPlayers(prev => {
        // Ensure teamSide is set on all players before placement
        const playersWithTeamSide = prev.map(p => {
          if (p.teamSide) return p;
          let teamSide: "a" | "b" | undefined;
          if (miniLeagueTeams.teamAPlayerIds.includes(p.id)) {
            teamSide = "a";
          } else if (miniLeagueTeams.teamBPlayerIds.includes(p.id)) {
            teamSide = "b";
          }
          return { ...p, teamSide };
        });
        return autoPlaceMiniLeaguePlayers(playersWithTeamSide, teamSize, true, index, true);
      });
      toast({ title: "Formation applied", description: `${formation.name} formation set for both teams` });
      return;
    }

    const numPositions = parseInt(teamSize);
    
    setPlayers(prev => {
      const playersOnPitch = prev.filter(p => p.position !== null);
      const benchPlayers = prev.filter(p => p.position === null);
      const allPlayers = [...playersOnPitch, ...benchPlayers];
      
      const updated = prev.map(p => ({ ...p, position: null as { x: number; y: number } | null, currentPitchPosition: undefined as PitchPosition | undefined }));
      
      // Assign positions to first N players
      for (let i = 0; i < Math.min(numPositions, allPlayers.length); i++) {
        const playerIndex = updated.findIndex(p => p.id === allPlayers[i].id);
        if (playerIndex !== -1 && formation.positions[i]) {
          const pos = { ...formation.positions[i] };
          updated[playerIndex].position = pos;
          updated[playerIndex].currentPitchPosition = getPositionFromCoords(pos.y, teamSize);
        }
      }
      return updated;
    });

    toast({ title: "Formation applied", description: `${formation.name} formation set` });
  }, [teamSize, persistFormationToDb, toast, miniLeagueTeams, autoPlaceMiniLeaguePlayers]);

  // Handle formation change dialog confirm
  const handleFormationChangeConfirm = useCallback(() => {
    if (pendingFormationChange) {
      if (pendingFormationChange.newTeamSize) {
        // This is a team size change
        const newSize = pendingFormationChange.newTeamSize;
        setTeamSize(newSize);
        setSelectedFormation(0);
        const placedPlayers = autoPlacePlayersOnPitch(players, newSize, 0);
        setPlayers(placedPlayers);
        persistTeamSizeToDb(newSize);
      } else {
        applyFormationChange(pendingFormationChange.index);
      }
    }
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
    // Minimise the bottom drawer after applying
    setToolbarCollapsed(true);
    setPortraitSheetOpen(false);
  }, [pendingFormationChange, applyFormationChange, autoPlacePlayersOnPitch, players, persistTeamSizeToDb]);

  // Handle formation change dialog cancel
  const handleFormationChangeCancel = useCallback(() => {
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
  }, []);

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  };

  // Substitution dialog trigger - handles both direct subs and position swaps
  useEffect(() => {
    // Skip if we're undoing - prevents infinite loop
    if (isUndoingRef.current) return;
    
    if (subMode && selectedOnPitch && selectedOnBench) {
      const pitchPlayer = players.find(p => p.id === selectedOnPitch);
      const benchPlayer = players.find(p => p.id === selectedOnBench);
      
      if (pitchPlayer?.position && benchPlayer) {
        const pitchPositionType = pitchPlayer.currentPitchPosition;
        
        // Check if bench player can play in the pitch player's position
        const canPlayPosition = !benchPlayer.assignedPositions?.length || 
          !pitchPositionType || 
          benchPlayer.assignedPositions.includes(pitchPositionType);
        
        if (!canPlayPosition) {
          // Show swap dialog - need to find someone to swap positions
          setPendingSubBenchPlayer(selectedOnBench);
          setRequiredPosition(pitchPositionType || null);
          setPositionSwapDialogOpen(true);
          setSelectedOnPitch(null);
          setSelectedOnBench(null);
        } else {
          // Direct substitution - show confirmation dialog
          console.log("[Undo] Direct sub - showing ManualSubConfirmDialog");
          setPendingManualSub({ pitchPlayerId: selectedOnPitch, benchPlayerId: selectedOnBench });
          setManualSubConfirmOpen(true);
          setSelectedOnPitch(null);
          setSelectedOnBench(null);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOnPitch, selectedOnBench, subMode]);

  // Handle position swap and substitute
  const handleSwapAndSubstitute = (playerToRemoveId: string, playerToSwapId: string) => {
    const playerToRemove = players.find(p => p.id === playerToRemoveId);
    const playerToSwap = players.find(p => p.id === playerToSwapId);
    const benchPlayer = players.find(p => p.id === pendingSubBenchPlayer);
    
    if (!playerToRemove?.position || !playerToSwap?.position || !benchPlayer || !requiredPosition) return;
    
    // Push to undo history before making changes
    pushToUndoHistory(`Sub: ${benchPlayer.name} for ${playerToRemove.name} (with swap)`, playersRef.current);
    
    // Swap positions of the two on-pitch players, then sub in bench player
    const removePosition = { ...playerToRemove.position };
    const swapPosition = { ...playerToSwap.position };
    
    setSubAnimationPlayers({ in: pendingSubBenchPlayer, out: playerToRemoveId });
    
    setPlayers(prev => prev.map(p => {
      if (p.id === playerToRemoveId) {
        // This player goes to bench
        return { ...p, position: null, currentPitchPosition: undefined };
      }
      if (p.id === playerToSwapId) {
        // This player moves to the removed player's position
        return { ...p, position: removePosition, currentPitchPosition: requiredPosition };
      }
      if (p.id === pendingSubBenchPlayer) {
        // Bench player comes on to the swapped player's old position
        return { ...p, position: swapPosition, currentPitchPosition: playerToSwap.currentPitchPosition };
      }
      return p;
    }));
    
    toast({ title: "Substitution made", description: `${benchPlayer.name} comes on, ${playerToRemove.name} off` });
    
    setTimeout(() => {
      setSubAnimationPlayers({ in: null, out: null });
    }, 1500);
    
    setPositionSwapDialogOpen(false);
    setPendingSubBenchPlayer(null);
    setRequiredPosition(null);
  };

  // Handle selection from substitution preview dialog
  const handleSubPreviewSelect = (benchPlayerId: string, swapPlayerId?: string) => {
    const pitchPlayer = players.find(p => p.id === selectedOnPitch);
    const benchPlayer = players.find(p => p.id === benchPlayerId);
    
    if (!pitchPlayer?.position || !benchPlayer || !selectedOnPitch) return;
    
    if (swapPlayerId) {
      // Swap-based substitution - show combined confirmation dialog with all steps
      setSubPreviewOpen(false);
      // Delay opening confirmation dialog to ensure SubstitutionPreviewDialog closes first
      setTimeout(() => {
        setPendingManualSub({ pitchPlayerId: selectedOnPitch, benchPlayerId, swapPlayerId });
        setManualSubConfirmOpen(true);
      }, 150);
    } else {
      // Direct substitution - show confirmation dialog with step-by-step instructions
      setSubPreviewOpen(false);
      // Delay opening confirmation dialog to ensure SubstitutionPreviewDialog closes first
      setTimeout(() => {
        setPendingManualSub({ pitchPlayerId: selectedOnPitch, benchPlayerId });
        setManualSubConfirmOpen(true);
      }, 150);
    }
  };
  // Handle pre-swap from substitution preview dialog
  // This swaps the selected pitch player with another pitch player who can cover their position
  const handlePreSwapFromDialog = useCallback((pitchPlayerId: string, swapPlayerId: string) => {
    console.log('handlePreSwapFromDialog called!', { pitchPlayerId, swapPlayerId });
    
    const pitchPlayer = players.find(p => p.id === pitchPlayerId);
    const swapPlayer = players.find(p => p.id === swapPlayerId);
    
    console.log('Found players:', { pitchPlayer: pitchPlayer?.name, swapPlayer: swapPlayer?.name });
    
    if (!pitchPlayer?.position || !swapPlayer?.position) {
      console.log('Missing position data, returning early');
      return;
    }
    
    const pos1 = { ...pitchPlayer.position };
    const pos2 = { ...swapPlayer.position };
    const pitchPos1 = pitchPlayer.currentPitchPosition;
    const pitchPos2 = swapPlayer.currentPitchPosition;
    
    // Push to undo history before making changes
    pushToUndoHistory(`Swap: ${pitchPlayer.name} ↔ ${swapPlayer.name}`, playersRef.current);
    
    // Swap their positions
    setPlayers(prev => prev.map(p => {
      if (p.id === pitchPlayerId) {
        return { ...p, position: pos2, currentPitchPosition: pitchPos2 };
      }
      if (p.id === swapPlayerId) {
        return { ...p, position: pos1, currentPitchPosition: pitchPos1 };
      }
      return p;
    }));
    
    toast({ 
      title: "Positions swapped", 
      description: `${pitchPlayer.name} ↔ ${swapPlayer.name}` 
    });
    
    // Close dialog briefly, then reopen to show updated substitution options
    setSubPreviewOpen(false);
    setSelectedOnBench(null);
    
    // Keep the original player selected (now in swapped position)
    setSelectedOnPitch(pitchPlayerId);
    
    // Reopen dialog after brief delay to show new direct substitution options
    setTimeout(() => {
      setSubPreviewOpen(true);
    }, 150);
  }, [players, toast]);

  // Handle confirming the position swap (first step of swap-based sub)
  const handleConfirmSwapBeforeSub = useCallback(() => {
    // Close swap dialog, then open sub confirmation dialog after delay
    setSwapBeforeSubDialogOpen(false);
    setTimeout(() => {
      setSubAfterSwapDialogOpen(true);
    }, 150);
  }, []);

  // Handle cancelling the swap-based sub flow
  const handleCancelSwapBasedSub = useCallback(() => {
    setSwapBeforeSubDialogOpen(false);
    setSubAfterSwapDialogOpen(false);
    setPendingSwapBasedSub(null);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
  }, []);

  // Handle confirming the final substitution (second step of swap-based sub)
  const handleConfirmSubAfterSwap = useCallback(() => {
    if (!pendingSwapBasedSub) return;
    
    const pitchPlayer = players.find(p => p.id === pendingSwapBasedSub.pitchPlayerId);
    const benchPlayer = players.find(p => p.id === pendingSwapBasedSub.benchPlayerId);
    const swapPlayer = players.find(p => p.id === pendingSwapBasedSub.swapPlayerId);
    
    if (!pitchPlayer?.position || !benchPlayer || !swapPlayer?.position) {
      handleCancelSwapBasedSub();
      return;
    }
    
    // Push to undo history before making changes
    pushToUndoHistory(`Sub: ${benchPlayer.name} for ${pitchPlayer.name} (with swap)`, playersRef.current);
    
    const pitchPosition = { ...pitchPlayer.position };
    const pitchPositionType = pitchPlayer.currentPitchPosition;
    const swapPosition = { ...swapPlayer.position };
    
    setSubAnimationPlayers({ in: pendingSwapBasedSub.benchPlayerId, out: pendingSwapBasedSub.pitchPlayerId });
    
    setPlayers(prev => prev.map(p => {
      if (p.id === pendingSwapBasedSub.pitchPlayerId) {
        // This player goes to bench
        return { ...p, position: null, currentPitchPosition: undefined };
      }
      if (p.id === pendingSwapBasedSub.swapPlayerId) {
        // This player moves to the removed player's position
        return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
      }
      if (p.id === pendingSwapBasedSub.benchPlayerId) {
        // Bench player comes on to the swapped player's old position
        return { ...p, position: swapPosition, currentPitchPosition: swapPlayer.currentPitchPosition };
      }
      return p;
    }));
    
    toast({ title: "Substitution made", description: `${benchPlayer.name} comes on, ${pitchPlayer.name} off` });
    
    setTimeout(() => {
      setSubAnimationPlayers({ in: null, out: null });
    }, 1500);
    
    setSubAfterSwapDialogOpen(false);
    setPendingSwapBasedSub(null);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    setSubMode(false);
  }, [pendingSwapBasedSub, players, handleCancelSwapBasedSub, toast, pushToUndoHistory]);
  // Handle player click in sub mode or swap mode
  const handlePlayerClick = (playerId: string, isOnPitch: boolean) => {
    // Block all interactions in read-only mode
    if (readOnly) return;
    
    // Handle swap mode (only for pitch players)
    if (swapMode && isOnPitch) {
      if (!swapPlayer1) {
        setSwapPlayer1(playerId);
      } else if (swapPlayer1 === playerId) {
        // Deselect if same player clicked
        setSwapPlayer1(null);
      } else {
        // Block swap if target player is not in the valid set
        if (!getValidSwapPlayerIds.has(playerId)) {
          toast({
            title: "Cannot swap",
            description: "Players are not eligible to play in each other's positions based on their position preferences.",
            variant: "destructive",
          });
          return;
        }
        // Second player selected - show confirmation
        setSwapPlayer2(playerId);
        setPitchSwapConfirmOpen(true);
      }
      return;
    }
    
    if (!subMode) {
      // Outside sub/swap mode: double-tap a pitch player opens the action menu
      if (isOnPitch) {
        const now = Date.now();
        const last = lastTapRef.current;
        if (last && last.playerId === playerId && now - last.time < 400) {
          // Double tap detected
          lastTapRef.current = null;
          setPitchPlayerActionTarget(playerId);
          setPitchPlayerActionOpen(true);
        } else {
          lastTapRef.current = { playerId, time: now };
        }
      }
      return;
    }
    
    if (isOnPitch) {
      console.log('[PlayerClick] Pitch player clicked:', playerId);
      const newSelected = selectedOnPitch === playerId ? null : playerId;
      setSelectedOnPitch(newSelected);
    } else {
      console.log('[PlayerClick] Bench player clicked:', playerId);
      setSelectedOnBench(prev => prev === playerId ? null : playerId);
    }
  };

  // Toggle swap mode
  const toggleSwapMode = () => {
    if (readOnly) return;
    const newSwapMode = !swapMode;
    setSwapMode(newSwapMode);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
    
    // Exit sub mode if entering swap mode
    if (newSwapMode && subMode) {
      setSubMode(false);
      setSelectedOnPitch(null);
      setSelectedOnBench(null);
    }
    
    // Deactivate drawing tools when entering swap mode
    if (newSwapMode) {
      setDrawingTool("none");
      setShowFloatingDrawToolbar(false);
      // Close bottom drawer so pitch is fully visible
      setPortraitSheetOpen(false);
    }
  };

  // Confirm position swap between two pitch players
  const handleConfirmPitchSwap = useCallback(() => {
    if (!swapPlayer1 || !swapPlayer2) return;
    
    const player1 = players.find(p => p.id === swapPlayer1);
    const player2 = players.find(p => p.id === swapPlayer2);
    
    if (!player1?.position || !player2?.position) {
      setPitchSwapConfirmOpen(false);
      setSwapPlayer1(null);
      setSwapPlayer2(null);
      return;
    }
    
    const pos1 = { ...player1.position };
    const pos2 = { ...player2.position };
    const pitchPos1 = player1.currentPitchPosition;
    const pitchPos2 = player2.currentPitchPosition;
    
    // Push to undo history before making changes
    pushToUndoHistory(`Swap: ${player1.name} ↔ ${player2.name}`, playersRef.current);
    
    // Swap positions
    setPlayers(prev => prev.map(p => {
      if (p.id === swapPlayer1) {
        return { ...p, position: pos2, currentPitchPosition: pitchPos2 };
      }
      if (p.id === swapPlayer2) {
        return { ...p, position: pos1, currentPitchPosition: pitchPos1 };
      }
      return p;
    }));
    
    toast({ 
      title: "Positions swapped", 
      description: `${player1.name} ↔ ${player2.name}` 
    });
    
    setPitchSwapConfirmOpen(false);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
    setSwapMode(false);
  }, [swapPlayer1, swapPlayer2, players, toast, pushToUndoHistory]);

  // Cancel position swap
  const handleCancelPitchSwap = useCallback(() => {
    setPitchSwapConfirmOpen(false);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
  }, []);

  // Confirm pitch swap with accommodation (a third player moves to make the swap work)
  const handleConfirmPitchSwapWithAccommodation = useCallback((accommodatorId: string, accommodatorNewPosition: string) => {
    if (!swapPlayer1 || !swapPlayer2) return;
    
    const player1 = players.find(p => p.id === swapPlayer1);
    const player2 = players.find(p => p.id === swapPlayer2);
    const accommodator = players.find(p => p.id === accommodatorId);
    
    if (!player1?.position || !player2?.position || !accommodator?.position) {
      setPitchSwapConfirmOpen(false);
      setSwapPlayer1(null);
      setSwapPlayer2(null);
      return;
    }
    
    const pos1 = { ...player1.position };
    const pos2 = { ...player2.position };
    const accPos = { ...accommodator.position };
    const pitchPos1 = player1.currentPitchPosition;
    const pitchPos2 = player2.currentPitchPosition;
    const accPitchPos = accommodator.currentPitchPosition;
    
    pushToUndoHistory(`Swap: ${player1.name} ↔ ${player2.name} (${accommodator.name} accommodates)`, playersRef.current);
    
    // Determine who goes where based on accommodation:
    // The accommodator takes the position that the mismatched player can't fill
    // The mismatched player takes the accommodator's old position
    setPlayers(prev => prev.map(p => {
      if (p.id === swapPlayer1 && accommodatorNewPosition === pitchPos2) {
        // player1 couldn't play pos2, so player1 takes accommodator's old position
        return { ...p, position: accPos, currentPitchPosition: accPitchPos };
      } else if (p.id === swapPlayer1) {
        return { ...p, position: pos2, currentPitchPosition: pitchPos2 };
      }
      if (p.id === swapPlayer2 && accommodatorNewPosition === pitchPos1) {
        // player2 couldn't play pos1, so player2 takes accommodator's old position
        return { ...p, position: accPos, currentPitchPosition: accPitchPos };
      } else if (p.id === swapPlayer2) {
        return { ...p, position: pos1, currentPitchPosition: pitchPos1 };
      }
      if (p.id === accommodatorId) {
        // Accommodator moves to the position they're covering
        if (accommodatorNewPosition === pitchPos2) {
          return { ...p, position: pos2, currentPitchPosition: pitchPos2 as any };
        } else {
          return { ...p, position: pos1, currentPitchPosition: pitchPos1 as any };
        }
      }
      return p;
    }));
    
    toast({ 
      title: "Positions swapped with accommodation", 
      description: `${player1.name} ↔ ${player2.name} (${accommodator.name} moved to ${accommodatorNewPosition})` 
    });
    
    setPitchSwapConfirmOpen(false);
    setSwapPlayer1(null);
    setSwapPlayer2(null);
    setSwapMode(false);
  }, [swapPlayer1, swapPlayer2, players, toast, pushToUndoHistory]);

  // Cancel sub mode
  const toggleSubMode = () => {
    if (readOnly) return;
    const newSubMode = !subMode;
    setSubMode(newSubMode);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    
    // Exit swap mode if entering sub mode
    if (newSubMode && swapMode) {
      setSwapMode(false);
      setSwapPlayer1(null);
      setSwapPlayer2(null);
    }
    
    // When entering sub mode, expand bench and toolbar so users can access both pitch players and bench
    if (newSubMode) {
      setBenchCollapsed(false);
      if (isLandscape) {
        setToolbarCollapsed(false);
        setBottomSheetTab("bench");
      }
      // Deactivate drawing tools when entering sub mode
      setDrawingTool("none");
      setShowFloatingDrawToolbar(false);
      // Close bottom drawer so pitch is fully visible
      setPortraitSheetOpen(false);
    }
  };

  // Auto-sub plan handlers
  const handleStartAutoSubPlan = useCallback((plan: SubstitutionEvent[]) => {
    setAutoSubPlan(plan);
    setAutoSubActive(true);
    toast({ title: "Auto-sub plan started", description: `${plan.length} substitutions scheduled` });
  }, [toast]);

  const handleCancelAutoSubPlan = useCallback(() => {
    setAutoSubPlan([]);
    setAutoSubActive(false);
    setAutoSubPaused(false);
    setPendingAutoSub(null);
    setSubConfirmDialogOpen(false);
    toast({ title: "Auto-sub plan cancelled" });
  }, [toast]);

  const handleTogglePauseAutoSub = useCallback(() => {
    setAutoSubPaused(prev => {
      const newPaused = !prev;
      toast({ 
        title: newPaused ? "Auto-subs paused" : "Auto-subs resumed",
        description: newPaused ? "Sub alerts will not trigger until resumed" : "Sub alerts will trigger when due"
      });
      return newPaused;
    });
  }, [toast]);

  const handleToggleLockPlayer = useCallback((playerId: string) => {
    setLockedPlayerIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  }, []);

  const handleSkipNextSub = useCallback(() => {
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const nextSub = remainingSubs.find(s => s.half === half && s.time >= currentElapsed)
      || remainingSubs.find(s => s.half > half)
      || remainingSubs[0];
    if (!nextSub) return;

    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const benchPlayers = players.filter(p => p.position === null);
    const skippedId = `${nextSub.half}-${nextSub.time}-${nextSub.playerOut.id}`;

    if (benchPlayers.length > 0) {
      const recalculated = recalculateRemainingPlan(
        players, parseInt(teamSize), halfDurationSeconds, currentElapsed, half, nextSub, rotateGkAtHalftime
      );
      const cleanedPlan = recalculated.filter(
        sub => `${sub.half}-${sub.time}-${sub.playerOut.id}` !== skippedId
      );
      setAutoSubPlan(cleanedPlan);
      toast({ title: "Substitution skipped", description: `Plan recalculated with ${cleanedPlan.length} remaining subs` });
    } else {
      setAutoSubPlan(prev => prev.filter(s => s !== nextSub));
      toast({ title: "Substitution skipped" });
    }
    skipCooldownRef.current = Date.now();
  }, [autoSubPlan, players, teamSize, toast]);

  const handleExecuteNow = useCallback(() => {
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const nextSub = remainingSubs.find(s => s.half === half && s.time >= currentElapsed)
      || remainingSubs.find(s => s.half > half)
      || remainingSubs[0];
    if (!nextSub) return;

    // Find batch subs at same time
    const batchSubs = remainingSubs.filter(s => s.half === nextSub.half && s.time === nextSub.time && s !== nextSub);

    setPendingAutoSub(nextSub);
    setPendingBatchSubs(batchSubs);
    setSubConfirmDialogOpen(true);

    const playerOutName = nextSub.playerOut.name || `#${nextSub.playerOut.number}`;
    const playerInName = nextSub.playerIn.name || `#${nextSub.playerIn.number}`;
    const msg = batchSubs.length > 0
      ? `Time for ${batchSubs.length + 1} substitutions`
      : `Execute now: ${playerOutName} ➜ ${playerInName}`;
    if (isSoundEnabled(teamId)) {
      playSubAlertBeep(msg);
    }
  }, [autoSubPlan, teamId]);

  const handleRegeneratePlan = useCallback(() => {
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;

    // Create a dummy "skipped" sub to trigger recalculation
    const dummySub: SubstitutionEvent = {
      time: currentElapsed,
      half,
      playerOut: players[0],
      playerIn: players[0],
      executed: true,
    };

    const recalculated = recalculateRemainingPlan(
      players, parseInt(teamSize), halfDurationSeconds, currentElapsed, half, dummySub, rotateGkAtHalftime
    );

    const currentRemainingSignature = autoSubPlan
      .filter(s => !s.executed)
      .map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`)
      .join("|");
    const recalculatedSignature = recalculated
      .map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`)
      .join("|");

    const isUnchanged = currentRemainingSignature === recalculatedSignature;

    setAutoSubPlan(recalculated);
    toast({
      title: isUnchanged ? "Plan unchanged" : "Plan regenerated",
      description: isUnchanged
        ? "No better alternatives available right now"
        : `${recalculated.length} substitutions scheduled`,
    });
  }, [autoSubPlan, players, teamSize, toast]);

  // Track last update time for minutes played calculation
  const lastTimeUpdateRef = useRef<{ seconds: number; half: 1 | 2 } | null>(null);
  const hasInitializedTimeRef = useRef(false);
  const skipCooldownRef = useRef<number>(0); // Timestamp of last skip to prevent immediate re-trigger

  // Timer update callback - check for pending subs and track minutes played
  const handleTimerUpdate = useCallback((elapsedSeconds: number, currentHalf: 1 | 2) => {
    // Mark game as in progress once timer starts
    if (elapsedSeconds > 0 && !gameInProgress) {
      setGameInProgress(true);
    }
    
    // On first call, just set the ref without adding time
    // This prevents counting time that elapsed while pitch board was closed
    if (!hasInitializedTimeRef.current) {
      hasInitializedTimeRef.current = true;
      lastTimeUpdateRef.current = { seconds: elapsedSeconds, half: currentHalf };
      return;
    }
    
    // Track minutes played for players on pitch
    const lastUpdate = lastTimeUpdateRef.current;
    if (lastUpdate && lastUpdate.half === currentHalf && elapsedSeconds > lastUpdate.seconds) {
      const secondsElapsed = elapsedSeconds - lastUpdate.seconds;
      // Always add time to players on pitch - the initialization guard handles the first call
      // and loadPitchState handles catching up time when component remounts
      setPlayers(prev => prev.map(p => {
        if (p.position !== null) {
          // Player is on pitch, add time
          return { ...p, minutesPlayed: (p.minutesPlayed || 0) + secondsElapsed };
        }
        return p;
      }));
    }
    lastTimeUpdateRef.current = { seconds: elapsedSeconds, half: currentHalf };

    // Don't trigger subs if paused or in skip cooldown
    if (!autoSubActive || autoSubPlan.length === 0 || autoSubPaused) return;
    if (Date.now() - skipCooldownRef.current < 3000) return; // 3s cooldown after skip
    
    // Find all unexecuted subs for current half that are due (skip locked players)
    const dueSubs = autoSubPlan.filter(sub => 
      !sub.executed && 
      sub.half === currentHalf && 
      elapsedSeconds >= sub.time &&
      !pendingAutoSub &&
      !lockedPlayerIds.has(sub.playerOut.id)
    );
    
    if (dueSubs.length > 0) {
      // Group subs by time - find the earliest time and get all subs at that time
      const earliestTime = Math.min(...dueSubs.map(s => s.time));
      const batchSubs = dueSubs.filter(s => s.time === earliestTime);
      const [primarySub, ...additionalSubs] = batchSubs;
      
      // Play alert beep with notification message
      const playerOutName = primarySub.playerOut.name || `#${primarySub.playerOut.number}`;
      const playerInName = primarySub.playerIn.name || `#${primarySub.playerIn.number}`;
      const notificationBody = batchSubs.length > 1
        ? `Time for ${batchSubs.length} substitutions`
        : `Time to sub: ${playerOutName} ➜ ${playerInName}`;
      if (isSoundEnabled(teamId)) {
        playSubAlertBeep(notificationBody);
      }
      
      // Create database notification (triggers server-side push)
      createSubNotification(notificationBody);
      
      setPendingAutoSub(primarySub);
      setPendingBatchSubs(additionalSubs);
      setSubConfirmDialogOpen(true);
    }
  }, [autoSubActive, autoSubPlan, autoSubPaused, pendingAutoSub, createSubNotification, gameInProgress, lockedPlayerIds]);

  // Half change callback - check for halftime subs (including batch)
  const handleHalfChange = useCallback((newHalf: 1 | 2) => {
    if (newHalf !== 2) return;

    // Case 1: Auto-sub plan active — check for halftime subs
    if (autoSubActive && autoSubPlan.length > 0) {
      const halftimeSubs = autoSubPlan.filter(sub => 
        !sub.executed && 
        sub.half === 2 && 
        sub.time === 0
      );
      
      if (halftimeSubs.length > 0) {
        setTimeout(() => {
          const [primarySub, ...additionalSubs] = halftimeSubs;
          const notificationBody = halftimeSubs.length > 1
            ? `Halftime: ${halftimeSubs.length} substitutions`
            : `Halftime sub: ${primarySub.playerOut.name || `#${primarySub.playerOut.number}`} ➜ ${primarySub.playerIn.name || `#${primarySub.playerIn.number}`}`;
          if (isSoundEnabled(teamId)) {
            playSubAlertBeep(notificationBody);
          }
          createSubNotification(notificationBody);
          
          setPendingAutoSub(primarySub);
          setPendingBatchSubs(additionalSubs);
          setSubConfirmDialogOpen(true);
        }, 500);
      }
      return;
    }

    // Case 2: No auto-sub plan, but a preferred 2nd half GK was selected — prompt GK swap
    if (preferredSecondHalfGkId) {
      const currentGk = players.find(p => p.currentPitchPosition === "GK" && p.position !== null);
      const secondHalfGk = players.find(p => p.id === preferredSecondHalfGkId);
      
      if (currentGk && secondHalfGk && currentGk.id !== secondHalfGk.id) {
        const gkSwapEvent: SubstitutionEvent = {
          time: 0,
          half: 2,
          playerOut: currentGk,
          playerIn: secondHalfGk,
          executed: false,
        };
        
        setTimeout(() => {
          const notificationBody = `Halftime GK swap: ${currentGk.name} ➜ ${secondHalfGk.name}`;
          if (isSoundEnabled(teamId)) {
            playSubAlertBeep(notificationBody);
          }
          createSubNotification(notificationBody);
          
          setPendingAutoSub(gkSwapEvent);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
      }
    }
  }, [autoSubActive, autoSubPlan, createSubNotification, preferredSecondHalfGkId, players]);

  // Execute auto-sub (handles batch subs)
  const handleConfirmAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    
    // Combine primary and batch subs
    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];
    let updatedPlayers = [...players];
    const executedSubIds: string[] = [];
    let successCount = 0;
    
    // Push to undo history before making changes
    const subDescription = allPendingSubs.length > 1
      ? `Batch sub: ${allPendingSubs.length} substitutions`
      : `Auto-sub: ${pendingAutoSub.playerIn.name} for ${pendingAutoSub.playerOut.name}`;
    pushToUndoHistory(subDescription, playersRef.current);
    
    for (const sub of allPendingSubs) {
      const { playerOut, playerIn, positionSwap } = sub;
      
      // Find current player positions in our updated list
      const currentPlayerOut = updatedPlayers.find(p => p.id === playerOut.id);
      const currentPlayerIn = updatedPlayers.find(p => p.id === playerIn.id);
      
      // Check if the playerIn is still on the bench
      if (currentPlayerIn?.position !== null) {
        executedSubIds.push(`${sub.half}-${sub.time}-${playerOut.id}`);
        continue;
      }
      
      // Check if playerOut is still on the pitch
      if (!currentPlayerOut?.position) {
        executedSubIds.push(`${sub.half}-${sub.time}-${playerOut.id}`);
        continue;
      }
      
      if (!currentPlayerIn) {
        continue;
      }
      
      const pitchPosition = { ...currentPlayerOut.position };
      const pitchPositionType = currentPlayerOut.currentPitchPosition;
      
      if (positionSwap) {
        const swapPlayer = updatedPlayers.find(p => p.id === positionSwap.player.id);
        if (swapPlayer?.position) {
          const swapPosition = { ...swapPlayer.position };
          
          updatedPlayers = updatedPlayers.map(p => {
            if (p.id === playerOut.id) {
              return { ...p, position: null, currentPitchPosition: undefined };
            }
            if (p.id === positionSwap.player.id) {
              return { ...p, position: pitchPosition, currentPitchPosition: positionSwap.toPosition };
            }
            if (p.id === playerIn.id) {
              return { ...p, position: swapPosition, currentPitchPosition: positionSwap.fromPosition };
            }
            return p;
          });
        } else {
          updatedPlayers = updatedPlayers.map(p => {
            if (p.id === playerOut.id) {
              return { ...p, position: null, currentPitchPosition: undefined };
            }
            if (p.id === playerIn.id) {
              return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
            }
            return p;
          });
        }
      } else {
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerOut.id) {
            return { ...p, position: null, currentPitchPosition: undefined };
          }
          if (p.id === playerIn.id) {
            return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
          }
          return p;
        });
      }
      
      executedSubIds.push(`${sub.half}-${sub.time}-${playerOut.id}`);
      successCount++;
    }
    
    // Apply all player changes at once
    setPlayers(updatedPlayers);
    
    // Set animation for primary sub only
    setSubAnimationPlayers({ in: pendingAutoSub.playerIn.id, out: pendingAutoSub.playerOut.id });
    
    // Mark all processed subs as executed
    setAutoSubPlan(prev => prev.map(sub => {
      const subId = `${sub.half}-${sub.time}-${sub.playerOut.id}`;
      if (executedSubIds.includes(subId)) {
        return { ...sub, executed: true };
      }
      return sub;
    }));
    
    const toastDescription = allPendingSubs.length > 1
      ? `${successCount} substitutions made`
      : `${pendingAutoSub.playerIn.name} replaces ${pendingAutoSub.playerOut.name}`;
    toast({ title: allPendingSubs.length > 1 ? "Substitutions made" : "Substitution made", description: toastDescription });
    
    setTimeout(() => {
      setSubAnimationPlayers({ in: null, out: null });
    }, 1500);
    
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    
    // Check if all subs executed
    const remainingSubs = autoSubPlan.filter(sub => 
      !sub.executed && !executedSubIds.includes(`${sub.half}-${sub.time}-${sub.playerOut.id}`)
    );
    if (remainingSubs.length === 0) {
      setAutoSubActive(false);
      toast({ title: "All substitutions complete" });
    }
  }, [pendingAutoSub, pendingBatchSubs, players, autoSubPlan, toast, pushToUndoHistory]);

  const handleSkipAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    
    // Combine primary and batch subs for skipping
    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];
    const skippedIds = allPendingSubs.map(s => `${s.half}-${s.time}-${s.playerOut.id}`);
    
    // Instead of just marking as executed, recalculate remaining subs
    const minutesPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minutesPerHalf * 60;
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const currentHalf = gameTimerRef.current?.getCurrentHalf() || 1;
    
    const benchPlayers = players.filter(p => p.position === null);
    
    if (benchPlayers.length > 0) {
      // Recalculate plan from current state
      const recalculatedPlan = recalculateRemainingPlan(
        players,
        parseInt(teamSize),
        halfDurationSeconds,
        currentElapsed,
        currentHalf,
        pendingAutoSub,
        rotateGkAtHalftime
      );

      const cleanedPlan = recalculatedPlan.filter(sub => 
        !skippedIds.includes(`${sub.half}-${sub.time}-${sub.playerOut.id}`)
      );
      
      setAutoSubPlan(cleanedPlan);
      const skippedCount = allPendingSubs.length;
      toast({ 
        title: skippedCount > 1 ? `${skippedCount} substitutions skipped` : "Substitution skipped", 
        description: `Plan recalculated with ${cleanedPlan.length} remaining subs` 
      });
    } else {
      // No bench players left, just remove the skipped subs
      setAutoSubPlan(prev => prev.filter(sub => 
        !skippedIds.includes(`${sub.half}-${sub.time}-${sub.playerOut.id}`)
      ));
      toast({ title: allPendingSubs.length > 1 ? "Substitutions skipped" : "Substitution skipped" });
    }
    
    skipCooldownRef.current = Date.now();
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
  }, [pendingAutoSub, pendingBatchSubs, autoSubPlan, players, teamSize, toast]);

  // Ball drag handlers
  const handleBallDragStart = () => {
    setIsDraggingBall(true);
  };

  const handleBallDrag = (e: React.DragEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
  };

  const handleBallDragEnd = () => {
    setIsDraggingBall(false);
  };

  const handleBallTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingBall(true);
  };

  const handleBallTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingBall || !containerRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * 100 / zoom;
    const y = ((touch.clientY - rect.top) / rect.height) * 100 / zoom;
    setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
  };

  const handleBallTouchEnd = () => {
    setIsDraggingBall(false);
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  // Reset game - clears all player minutes, timer, and positions
  const handleResetGame = useCallback(() => {
    // Stop the timer first
    gameTimerRef.current?.resetTimer();
    
    // Reset pitch settings to team defaults from props
    setMinutesPerHalf(initialMinutesPerHalf);
    setRotationSpeed(initialRotationSpeed);
    setDisablePositionSwaps(initialDisablePositionSwaps);
    
    // Reset team size to initial value
    const defaultTeamSize: TeamSize = initialTeamSize && ["4", "7", "9", "11"].includes(String(initialTeamSize)) 
      ? String(initialTeamSize) as TeamSize 
      : "7";
    setTeamSize(defaultTeamSize);
    
    // Reset formation to initial value for the team size
    const formations = FORMATIONS[defaultTeamSize];
    let defaultFormationIndex = 0;
    if (initialFormation) {
      const index = formations.findIndex(f => f.name === initialFormation);
      if (index >= 0) defaultFormationIndex = index;
    }
    setSelectedFormation(defaultFormationIndex);
    
    // Reset players - clear minutes and re-place on pitch with default formation
    const resetPlayers = players.map(p => ({
      ...p,
      minutesPlayed: 0,
    }));
    
    // Re-place players using default formation
    const placedPlayers = autoPlacePlayersOnPitch(resetPlayers, defaultTeamSize, defaultFormationIndex);
    setPlayers(placedPlayers);
    
    // Clear auto-sub plan
    setAutoSubPlan([]);
    setAutoSubActive(false);
    setAutoSubPaused(false);
    
    // Reset sub mode
    setSubMode(false);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    
    // Reset game in progress flag so Plan button is enabled again
    setGameInProgress(false);
    
    // Force remount all GameTimer instances to pick up clean state
    setTimerResetKey(prev => prev + 1);
    
    // Clear persisted state
    clearPitchState();
    
    // Reset hasLoadedRef so fresh state can be saved
    hasLoadedRef.current = false;
    
    toast({
      title: "Game Reset",
      description: "All player minutes and settings have been reset to defaults.",
    });
  }, [players, initialMinutesPerHalf, initialRotationSpeed, initialDisablePositionSwaps, initialTeamSize, initialFormation, autoPlacePlayersOnPitch, toast]);

  // Reset formation only - moves players back to formation positions and ball to center
  const handleResetFormation = useCallback(() => {
    const formation = FORMATIONS[teamSize][selectedFormation];
    if (!formation) return;

    // During a game, only reposition players currently on the pitch (preserve bench/stats)
    const onPitch = players.filter(p => p.position !== null);
    const onBench = players.filter(p => p.position === null);

    if (onPitch.length > 0 && gameInProgress) {
      // Map on-pitch players back to formation slots using smart matching
      const slots = formation.positions.map((pos, index) => ({
        pos,
        pitchPos: getPositionFromCoords(pos.y, teamSize),
        assignedPlayer: null as Player | null,
      }));

      const assigned = new Set<string>();

      // Pass 1: specialists
      for (const player of onPitch) {
        if (assigned.has(player.id)) continue;
        if (player.assignedPositions?.length === 1) {
          const slot = slots.find(s => s.pitchPos === player.assignedPositions![0] && !s.assignedPlayer);
          if (slot) { slot.assignedPlayer = player; assigned.add(player.id); }
        }
      }
      // Pass 2: multi-position
      for (const player of onPitch) {
        if (assigned.has(player.id)) continue;
        if (player.assignedPositions?.length) {
          const slot = slots.find(s => !s.assignedPlayer && player.assignedPositions!.includes(s.pitchPos));
          if (slot) { slot.assignedPlayer = player; assigned.add(player.id); }
        }
      }
      // Pass 3: flex / remaining
      for (const player of onPitch) {
        if (assigned.has(player.id)) continue;
        const slot = slots.find(s => !s.assignedPlayer);
        if (slot) { slot.assignedPlayer = player; assigned.add(player.id); }
      }

      const result: Player[] = [];
      for (const slot of slots) {
        if (slot.assignedPlayer) {
          result.push({ ...slot.assignedPlayer, position: slot.pos, currentPitchPosition: slot.pitchPos });
        }
      }
      // Any on-pitch players that didn't fit stay on bench
      for (const player of onPitch) {
        if (!assigned.has(player.id)) {
          result.push({ ...player, position: null, currentPitchPosition: undefined });
        }
      }
      result.push(...onBench);
      setPlayers(result);
    } else {
      // Pre-game: full re-place
      const placedPlayers = autoPlacePlayersOnPitch(players, teamSize, selectedFormation);
      setPlayers(placedPlayers);
    }

    // Reset ball to center
    setBallPosition({ x: 50, y: 50 });
    
    toast({
      title: "Formation Reset",
      description: "Players and ball have been moved back to formation positions.",
    });
  }, [players, teamSize, selectedFormation, gameInProgress, autoPlacePlayersOnPitch, toast]);

  // Handle team size change - preview changes and show confirmation
  const handleTeamSizeChange = useCallback((newSize: TeamSize) => {
    if (newSize === teamSize) return;
    
    // Skip confirmation for mini-league mode (auto-place both teams)
    if (miniLeagueTeams) {
      setTeamSize(newSize);
      setSelectedFormation(0);
      const playersWithTeamSide = players.map(p => {
        if (p.teamSide) return p;
        let teamSide: "a" | "b" | undefined;
        if (miniLeagueTeams.teamAPlayerIds.includes(p.id)) {
          teamSide = "a";
        } else if (miniLeagueTeams.teamBPlayerIds.includes(p.id)) {
          teamSide = "b";
        }
        return { ...p, teamSide };
      });
      const placedPlayers = autoPlaceMiniLeaguePlayers(playersWithTeamSide, newSize, true);
      setPlayers(placedPlayers);
      persistTeamSizeToDb(newSize);
      return;
    }
    
    const newFormation = FORMATIONS[newSize][0];
    if (!newFormation) return;
    
    const numPositions = parseInt(newSize);
    const playersOnPitch = players.filter(p => p.position !== null);
    const benchPlayers = players.filter(p => p.position === null);
    const allPlayers = [...playersOnPitch, ...benchPlayers];
    
    const positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition }[] = [];
    const benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[] = [];
    
    const willBeOnPitch = allPlayers.slice(0, numPositions);
    const willBeOnBench = allPlayers.slice(numPositions);
    
    // Players going to bench
    for (const player of playersOnPitch) {
      if (willBeOnBench.some(p => p.id === player.id)) {
        benchMoves.push({ player, direction: "to-bench", position: player.currentPitchPosition });
      }
    }
    
    // Players coming on from bench
    for (let i = 0; i < willBeOnPitch.length; i++) {
      const player = willBeOnPitch[i];
      if (benchPlayers.some(p => p.id === player.id) && newFormation.positions[i]) {
        const newPos = getPositionFromCoords(newFormation.positions[i].y, newSize);
        benchMoves.push({ player, direction: "to-pitch", position: newPos });
      }
    }
    
    // Position changes for players staying on pitch
    for (let i = 0; i < willBeOnPitch.length; i++) {
      const player = willBeOnPitch[i];
      if (player.currentPitchPosition && newFormation.positions[i] && playersOnPitch.some(p => p.id === player.id) && !willBeOnBench.some(p => p.id === player.id)) {
        const newPosition = getPositionFromCoords(newFormation.positions[i].y, newSize);
        if (player.currentPitchPosition !== newPosition) {
          positionSwaps.push({ player, fromPosition: player.currentPitchPosition, toPosition: newPosition });
        }
      }
    }
    
    if (positionSwaps.length > 0 || benchMoves.length > 0) {
      setPendingFormationChange({ index: 0, newTeamSize: newSize, positionSwaps, benchMoves });
      setFormationChangeDialogOpen(true);
      return;
    }
    
    // No changes, apply directly
    setTeamSize(newSize);
    setSelectedFormation(0);
    const placedPlayers = autoPlacePlayersOnPitch(players, newSize, 0);
    setPlayers(placedPlayers);
    persistTeamSizeToDb(newSize);
  }, [players, teamSize, autoPlacePlayersOnPitch, autoPlaceMiniLeaguePlayers, miniLeagueTeams, persistTeamSizeToDb]);

  const getPinchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handlePitchTouchStart = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;
    
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = getPinchDistance(e.touches);
      setLastPinchDistance(distance);
    }
  };

  const handlePitchTouchMove = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;
    
    // Handle pinch zoom
    if (e.touches.length === 2 && lastPinchDistance !== null) {
      e.preventDefault();
      const newDistance = getPinchDistance(e.touches);
      if (newDistance !== null) {
        const scale = newDistance / lastPinchDistance;
        setZoom(prev => Math.min(Math.max(prev * scale, 0.5), 3));
        setLastPinchDistance(newDistance);
      }
      return;
    }
    
    // Handle player drag - block in readOnly mode
    if (readOnly) return;
    if (touchDragPlayer && containerRef.current) {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 100 / zoom;
      const y = ((touch.clientY - rect.top) / rect.height) * 100 / zoom;

      setPlayers(prev => 
        prev.map(p => 
          p.id === touchDragPlayer 
            ? { ...p, position: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) } }
            : p
        )
      );
    }
  };

  const handlePitchTouchEnd = (e: React.TouchEvent) => {
    if (lastPinchDistance !== null) {
      setLastPinchDistance(null);
      return;
    }
    
    if (readOnly) return;
    if (!touchDragPlayer) return;
    
    const touch = e.changedTouches[0];
    const benchElement = document.getElementById('pitch-bench');
    
    if (benchElement) {
      const benchRect = benchElement.getBoundingClientRect();
      if (
        touch.clientX >= benchRect.left &&
        touch.clientX <= benchRect.right &&
        touch.clientY >= benchRect.top &&
        touch.clientY <= benchRect.bottom
      ) {
        setPlayers(prev =>
          prev.map(p =>
            p.id === touchDragPlayer ? { ...p, position: null } : p
          )
        );
      }
    }
    
    setTouchDragPlayer(null);
    setTouchOffset(null);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.min(Math.max(prev + delta, 0.5), 3));
    }
  };

  const handleDragStart = (playerId: string) => {
    if (readOnly) return;
    setDraggedPlayer(playerId);
  };

  const handleDragEnd = () => {
    setDraggedPlayer(null);
  };

  const handlePitchDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (readOnly) return;
    if (!draggedPlayer || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setPlayers(prev => 
      prev.map(p => 
        p.id === draggedPlayer 
          ? { ...p, position: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) } }
          : p
      )
    );
    setDraggedPlayer(null);
  };

  const handleBenchDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (readOnly) return;
    if (!draggedPlayer) return;

    setPlayers(prev =>
      prev.map(p =>
        p.id === draggedPlayer ? { ...p, position: null } : p
      )
    );
    setDraggedPlayer(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // Touch handlers for mobile drag-and-drop
  const handleTouchStart = (playerId: string, e: React.TouchEvent) => {
    if (readOnly) return;
    // Don't preventDefault immediately - let click events fire for taps
    // Instead, set up drag state that will be used by touchmove
    setTouchDragPlayer(playerId);
    const touch = e.touches[0];
    setTouchOffset({ x: touch.clientX, y: touch.clientY });
  };

  // Touch handler for bench players
  const handleBenchTouchMove = useCallback((e: React.TouchEvent) => {
    if (readOnly) return;
    if (!touchDragPlayer || !containerRef.current) return;
    e.preventDefault();
    
    const touch = e.touches[0];
    const pitchRect = containerRef.current.getBoundingClientRect();
    
    // Check if touch is over the pitch
    if (
      touch.clientX >= pitchRect.left &&
      touch.clientX <= pitchRect.right &&
      touch.clientY >= pitchRect.top &&
      touch.clientY <= pitchRect.bottom
    ) {
      const x = ((touch.clientX - pitchRect.left) / pitchRect.width) * 100;
      const y = ((touch.clientY - pitchRect.top) / pitchRect.height) * 100;
      
      setPlayers(prev => 
        prev.map(p => 
          p.id === touchDragPlayer 
            ? { ...p, position: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) } }
            : p
        )
      );
    }
  }, [readOnly, touchDragPlayer]);

  const handleBenchTouchEnd = useCallback(() => {
    setTouchDragPlayer(null);
    setTouchOffset(null);
  }, []);

  // Portrait bench long-press drag handlers
  const handleBenchLongPressStart = useCallback((playerId: string, e: React.TouchEvent) => {
    if (readOnly || subMode || swapMode) return;
    const touch = e.touches[0];
    benchDragStartTouch.current = { x: touch.clientX, y: touch.clientY };
    benchLongPressTimer.current = setTimeout(() => {
      setBenchDragPlayer(playerId);
      setBenchDragPos({ x: touch.clientX, y: touch.clientY });
      if (navigator.vibrate) navigator.vibrate(30);
    }, 400);
  }, [readOnly, subMode, swapMode]);

  const handleBenchLongPressMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (benchLongPressTimer.current && benchDragStartTouch.current) {
      const dx = touch.clientX - benchDragStartTouch.current.x;
      const dy = touch.clientY - benchDragStartTouch.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(benchLongPressTimer.current);
        benchLongPressTimer.current = null;
      }
    }
    if (benchDragPlayer) {
      e.preventDefault();
      setBenchDragPos({ x: touch.clientX, y: touch.clientY });
    }
  }, [benchDragPlayer]);

  const handleBenchLongPressEnd = useCallback(() => {
    if (benchLongPressTimer.current) {
      clearTimeout(benchLongPressTimer.current);
      benchLongPressTimer.current = null;
    }
    if (benchDragPlayer && benchDragPos) {
      // Check both portrait and landscape pitch areas
      const pitchEl = document.getElementById('portrait-pitch-area') || document.getElementById('landscape-pitch-area');
      if (pitchEl) {
        const rect = pitchEl.getBoundingClientRect();
        const isOnPitch = benchDragPos.x >= rect.left && benchDragPos.x <= rect.right &&
          benchDragPos.y >= rect.top && benchDragPos.y <= rect.bottom;
        const elAtPoint = document.elementFromPoint(benchDragPos.x, benchDragPos.y);
        const isOnDrawer = elAtPoint?.closest('#pitch-bench-portrait') || 
                           elAtPoint?.closest('#pitch-bench-landscape') ||
                           elAtPoint?.closest('[data-portrait-drawer]');
        
        if (isOnPitch && !isOnDrawer) {
          setBenchToSubPlayer(benchDragPlayer);
          setBenchToSubOpen(true);
          setPortraitSheetOpen(false);
          setToolbarCollapsed(true);
        }
      }
    }
    setBenchDragPlayer(null);
    setBenchDragPos(null);
    benchDragStartTouch.current = null;
  }, [benchDragPlayer, benchDragPos]);

  // Document-level touch listeners for bench drag (so drag works outside the bench container)
  useEffect(() => {
    if (!benchDragPlayer) return;
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      setBenchDragPos({ x: touch.clientX, y: touch.clientY });
    };
    const onEnd = () => {
      handleBenchLongPressEnd();
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [benchDragPlayer, handleBenchLongPressEnd]);

  // Memoize derived player lists to prevent recalculation on every render
  const playersOnPitch = useMemo(() => players.filter(p => p.position !== null), [players]);
  const playersOnBench = useMemo(() => players.filter(p => p.position === null), [players]);

  // Tactical mode: batch-compute visual offsets (CSS translate) for on-pitch players
  const tacticalOffsets = useMemo(() => 
    computeTacticalOffsets(players, tacticalMode, teamSize),
    [players, tacticalMode, teamSize]
  );

  // Compute ball visual offset to avoid overlapping with tactically-shifted players
  const ballOffset = useMemo(() =>
    computeBallOffset(ballPosition, players, tacticalOffsets, tacticalMode),
    [ballPosition, players, tacticalOffsets, tacticalMode]
  );

  // Calculate which bench players can come on for the selected pitch player
  const getValidBenchPlayerIds = useMemo(() => {
    if (!subMode || !selectedOnPitch) return new Set<string>();
    
    const pitchPlayer = players.find(p => p.id === selectedOnPitch);
    if (!pitchPlayer?.currentPitchPosition) return new Set<string>();
    
    const requiredPos = pitchPlayer.currentPitchPosition;
    const validIds = new Set<string>();
    
    playersOnBench.forEach(benchPlayer => {
      // Skip injured players - they cannot be subbed on
      if (benchPlayer.isInjured) return;
      
      // Can directly play in the required position (or has no positions assigned = can play anywhere)
      const canPlayDirectly = !benchPlayer.assignedPositions?.length || 
        benchPlayer.assignedPositions.includes(requiredPos);
      
      if (canPlayDirectly) {
        validIds.add(benchPlayer.id);
        return;
      }
      
      // Check if any other pitch player can swap to the required position
      // allowing this bench player to come on elsewhere
      const otherPitchPlayers = playersOnPitch.filter(p => p.id !== selectedOnPitch);
      
      // Find players who can swap to the required position
      for (const otherPitchPlayer of otherPitchPlayers) {
        // Player can cover position if they have no assigned positions (can play anywhere)
        // OR if their assigned positions include the required position
        const canCoverRequiredPos = !otherPitchPlayer.assignedPositions?.length || 
          otherPitchPlayer.assignedPositions.includes(requiredPos);
        
        // Bench player can play in the other player's position if they have no assigned positions
        // (can play anywhere) OR their assigned positions include the other player's current position
        const benchCanPlayOtherPos = !benchPlayer.assignedPositions?.length || 
          benchPlayer.assignedPositions.includes(otherPitchPlayer.currentPitchPosition!);
        
        if (
          otherPitchPlayer.currentPitchPosition !== requiredPos &&
          canCoverRequiredPos &&
          benchCanPlayOtherPos
        ) {
          validIds.add(benchPlayer.id);
          break;
        }
      }
    });
    
    return validIds;
  }, [subMode, selectedOnPitch, players, playersOnBench, playersOnPitch]);

  // Calculate which pitch players can swap with the selected pitch player based on position preferences
  const getValidSwapPlayerIds = useMemo(() => {
    if (!swapMode || !swapPlayer1) return new Set<string>();
    
    const selectedPlayer = players.find(p => p.id === swapPlayer1);
    if (!selectedPlayer?.currentPitchPosition) return new Set<string>();
    
    const selectedPos = selectedPlayer.currentPitchPosition;
    const validIds = new Set<string>();
    
    playersOnPitch.forEach(pitchPlayer => {
      // Skip the selected player itself
      if (pitchPlayer.id === swapPlayer1) return;
      
      const targetPos = pitchPlayer.currentPitchPosition;
      if (!targetPos) return;
      
      // Check if selected player can play in target's position
      const selectedCanPlayTarget = !selectedPlayer.assignedPositions?.length || 
        selectedPlayer.assignedPositions.includes(targetPos);
      
      // Check if target player can play in selected player's position
      const targetCanPlaySelected = !pitchPlayer.assignedPositions?.length || 
        pitchPlayer.assignedPositions.includes(selectedPos);
      
      // Both players must be able to play in each other's positions
      if (selectedCanPlayTarget && targetCanPlaySelected) {
        validIds.add(pitchPlayer.id);
      }
    });
    
    return validIds;
  }, [swapMode, swapPlayer1, players, playersOnPitch]);

  // Toggle player injury status
  const togglePlayerInjury = useCallback((playerId: string) => {
    if (readOnly) return;
    setPlayers(prev => prev.map(p => 
      p.id === playerId ? { ...p, isInjured: !p.isInjured } : p
    ));
    const player = players.find(p => p.id === playerId);
    const newInjuredState = !player?.isInjured;
    toast({
      title: newInjuredState ? "Player marked as injured" : "Player marked as fit",
      description: `${player?.name} ${newInjuredState ? "will not be available for substitutions" : "is now available for substitutions"}`,
    });
    
    // If player was in auto-sub plan, recalculate
    if (autoSubActive && newInjuredState) {
      const isInPlan = autoSubPlan.some(sub => 
        !sub.executed && (sub.playerIn.id === playerId)
      );
      if (isInPlan) {
        const minutesPerHalfSecs = (gameTimerRef.current?.getMinutesPerHalf() || 10) * 60;
        const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
        const currentHalf = gameTimerRef.current?.getCurrentHalf() || 1;
        
        const updatedPlayers = players.map(p => 
          p.id === playerId ? { ...p, isInjured: true } : p
        );
        
        const recalculatedPlan = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          minutesPerHalfSecs,
          currentElapsed,
          currentHalf,
          autoSubPlan.find(sub => !sub.executed && sub.playerIn.id === playerId)!,
          rotateGkAtHalftime
        );
        
        setAutoSubPlan(recalculatedPlan);
        toast({
          title: "Sub plan updated",
          description: "Auto-substitution plan recalculated due to injury",
        });
      }
    }
  }, [readOnly, players, toast, autoSubActive, autoSubPlan, teamSize]);

  // Mark a pitch player as injured: sub them off, bring a bench player on, regenerate plan
  const handleMarkInjuredOnPitch = useCallback((playerId: string, replacementId?: string) => {
    if (readOnly) return;
    const player = players.find(p => p.id === playerId);
    if (!player || player.position === null) return;

    const injuredPosition = player.position;
    const injuredPitchPos = player.currentPitchPosition;

    // Use the chosen replacement or null
    const replacement = replacementId ? players.find(p => p.id === replacementId) : null;

    pushToUndoHistory("Injury sub off", players);

    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) {
        return { ...p, position: null, currentPitchPosition: undefined, isInjured: true };
      }
      if (replacement && p.id === replacement.id) {
        return { ...p, position: injuredPosition, currentPitchPosition: injuredPitchPos };
      }
      return p;
    }));

    if (replacement) {
      toast({
        title: "Injury substitution made",
        description: `${player.name} injured → ${replacement.name} subbed on`,
      });
    } else {
      toast({
        title: "Player injured & subbed off",
        description: `${player.name} moved to bench (no bench players available to replace)`,
      });
    }

    // Regenerate auto-sub plan if active
    if (autoSubActive) {
      const minutesPerHalfSecs = (gameTimerRef.current?.getMinutesPerHalf() || 10) * 60;
      const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
      const currentHalf = gameTimerRef.current?.getCurrentHalf() || 1;

      const updatedPlayers = players.map(p => {
        if (p.id === playerId) {
          return { ...p, position: null, currentPitchPosition: undefined, isInjured: true };
        }
        if (replacement && p.id === replacement.id) {
          return { ...p, position: injuredPosition, currentPitchPosition: injuredPitchPos };
        }
        return p;
      });

      // Find any sub referencing the injured or replacement player to trigger recalculation
      const relevantSub = autoSubPlan.find(sub =>
        !sub.executed && (sub.playerOut.id === playerId || sub.playerIn.id === playerId ||
          (replacement && (sub.playerOut.id === replacement.id || sub.playerIn.id === replacement.id)))
      );
      if (relevantSub) {
        const recalculatedPlan = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          minutesPerHalfSecs,
          currentElapsed,
          currentHalf,
          relevantSub,
          rotateGkAtHalftime
        );
        setAutoSubPlan(recalculatedPlan);
        toast({
          title: "Sub plan updated",
          description: "Auto-substitution plan recalculated due to injury",
        });
      }
    }
  }, [readOnly, players, toast, autoSubActive, autoSubPlan, teamSize, pushToUndoHistory]);

  // Add fill-in player to the bench
  const handleAddFillInPlayer = useCallback((playerData: { name: string; number?: number; positions: PitchPosition[] }) => {
    if (readOnly) return;
    
    const fillInId = `fill-in-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newPlayer: Player = {
      id: fillInId,
      name: playerData.name,
      number: playerData.number,
      position: null, // On bench
      assignedPositions: playerData.positions,
      currentPitchPosition: undefined,
      minutesPlayed: 0,
      isFillIn: true,
    };
    
    setPlayers(prev => [...prev, newPlayer]);
    toast({
      title: "Fill-in player added",
      description: `${playerData.name} has been added to the bench`,
    });
  }, [readOnly, toast]);

  // Remove fill-in player
  const handleRemoveFillInPlayer = useCallback((playerId: string) => {
    if (readOnly) return;
    
    const player = players.find(p => p.id === playerId);
    if (!player?.isFillIn) return;
    
    // Don't allow removing if player is currently on pitch
    if (player.position !== null) {
      toast({
        title: "Cannot remove",
        description: "Move the player to the bench first before removing",
        variant: "destructive",
      });
      return;
    }
    
    setPlayers(prev => prev.filter(p => p.id !== playerId));
    toast({
      title: "Fill-in player removed",
      description: `${player.name} has been removed`,
    });
  }, [readOnly, players, toast]);

  // Get existing jersey numbers for auto-suggest
  const existingJerseyNumbers = useMemo(() => {
    return players.map(p => p.number).filter((n): n is number => n !== undefined);
  }, [players]);

  // Auto-open substitution preview dialog when a pitch player is selected in sub mode
  useEffect(() => {
    console.log('[AutoOpen] subMode:', subMode, 'selectedOnPitch:', selectedOnPitch, 'benchLength:', playersOnBench.length);
    if (subMode && selectedOnPitch && playersOnBench.length > 0) {
      const pitchPlayer = players.find(p => p.id === selectedOnPitch);
      console.log('[AutoOpen] pitchPlayer:', pitchPlayer?.name, 'currentPitchPosition:', pitchPlayer?.currentPitchPosition);
      if (pitchPlayer?.currentPitchPosition) {
        console.log('[AutoOpen] Opening dialog!');
        setSubPreviewOpen(true);
      } else {
        console.log('[AutoOpen] NOT opening - no currentPitchPosition');
      }
    } else {
      console.log('[AutoOpen] NOT opening - conditions not met');
    }
  }, [subMode, selectedOnPitch, playersOnBench.length, players]);

  // Calculate which pitch players can move to accommodate the selected bench player
  const movablePitchPlayerIds = useMemo(() => {
    if (!subMode || !selectedOnBench || !selectedOnPitch) return new Set<string>();
    
    const benchPlayer = players.find(p => p.id === selectedOnBench);
    const pitchPlayer = players.find(p => p.id === selectedOnPitch);
    
    if (!benchPlayer || !pitchPlayer?.currentPitchPosition) return new Set<string>();
    
    const requiredPos = pitchPlayer.currentPitchPosition;
    
    // If bench player can directly fill the position, no one needs to move
    const canPlayDirectly = !benchPlayer.assignedPositions?.length || 
      benchPlayer.assignedPositions.includes(requiredPos);
    
    if (canPlayDirectly) return new Set<string>();
    
    // Find players who can swap to the required position
    const movableIds = new Set<string>();
    
    playersOnPitch.filter(p => p.id !== selectedOnPitch).forEach(otherPitchPlayer => {
      // Other player can cover required position if they have no assigned positions (can play anywhere)
      // OR their assigned positions include the required position
      const canCoverRequired = !otherPitchPlayer.assignedPositions?.length || 
        otherPitchPlayer.assignedPositions.includes(requiredPos);
      
      // Bench player can play in other player's position if they have no assigned positions (can play anywhere)
      // OR their assigned positions include the other player's current position
      const benchCanPlayOther = !benchPlayer.assignedPositions?.length || 
        benchPlayer.assignedPositions.includes(otherPitchPlayer.currentPitchPosition!);
      
      if (
        otherPitchPlayer.currentPitchPosition !== requiredPos &&
        canCoverRequired &&
        benchCanPlayOther
      ) {
        movableIds.add(otherPitchPlayer.id);
      }
    });
    
    return movableIds;
  }, [subMode, selectedOnBench, selectedOnPitch, players, playersOnPitch]);

  // Note: ManualSubConfirmDialog is now triggered by the substitution dialog trigger effect above (in the subMode section)

  // Handle manual substitution confirmation
  const handleConfirmManualSub = useCallback(() => {
    if (!pendingManualSub) return;
    
    // Use playersRef.current to avoid stale closure issues
    const currentPlayers = playersRef.current;
    const pitchPlayer = currentPlayers.find(p => p.id === pendingManualSub.pitchPlayerId);
    const benchPlayer = currentPlayers.find(p => p.id === pendingManualSub.benchPlayerId);
    const swapPlayer = pendingManualSub.swapPlayerId 
      ? currentPlayers.find(p => p.id === pendingManualSub.swapPlayerId) 
      : null;
    
    console.log("[Undo] handleConfirmManualSub called:", { 
      pitchPlayer: pitchPlayer?.name, 
      benchPlayer: benchPlayer?.name,
      swapPlayer: swapPlayer?.name,
      pitchPlayerHasPosition: !!pitchPlayer?.position,
      currentPlayersCount: currentPlayers.length
    });
    
    if (!pitchPlayer?.position || !benchPlayer) {
      console.log("[Undo] Early return - missing player or position");
      setManualSubConfirmOpen(false);
      setPendingManualSub(null);
      setSelectedOnPitch(null);
      setSelectedOnBench(null);
      return;
    }
    
    // Handle swap-based substitution
    if (swapPlayer?.position) {
      // Push to undo history before making changes
      pushToUndoHistory(`Sub: ${benchPlayer.name} for ${pitchPlayer.name} (with swap)`, currentPlayers);
      
      const pitchPosition = { ...pitchPlayer.position };
      const pitchPositionType = pitchPlayer.currentPitchPosition;
      const swapPosition = { ...swapPlayer.position };
      const swapPositionType = swapPlayer.currentPitchPosition;
      
      setSubAnimationPlayers({ in: pendingManualSub.benchPlayerId, out: pendingManualSub.pitchPlayerId });
      
      setPlayers(prev => prev.map(p => {
        if (p.id === pendingManualSub.pitchPlayerId) {
          // This player goes to bench
          return { ...p, position: null, currentPitchPosition: undefined };
        }
        if (p.id === pendingManualSub.swapPlayerId) {
          // This player moves to the removed player's position
          return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        }
        if (p.id === pendingManualSub.benchPlayerId) {
          // Bench player comes on to the swapped player's old position
          return { ...p, position: swapPosition, currentPitchPosition: swapPositionType };
        }
        return p;
      }));
      
      toast({ title: "Substitution made", description: `${benchPlayer.name} comes on, ${pitchPlayer.name} off` });
    } else {
      // Direct substitution (no swap)
      pushToUndoHistory(`Sub: ${benchPlayer.name} for ${pitchPlayer.name}`, currentPlayers);
      
      const pitchPosition = { ...pitchPlayer.position };
      const pitchPositionType = pitchPlayer.currentPitchPosition;
      
      setSubAnimationPlayers({ in: pendingManualSub.benchPlayerId, out: pendingManualSub.pitchPlayerId });
      
      setPlayers(prev => prev.map(p => {
        if (p.id === pendingManualSub.pitchPlayerId) {
          return { ...p, position: null, currentPitchPosition: undefined };
        }
        if (p.id === pendingManualSub.benchPlayerId) {
          return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        }
        return p;
      }));
      
      toast({ title: "Substitution made", description: `${benchPlayer.name} replaces ${pitchPlayer.name}` });
    }
    
    setTimeout(() => {
      setSubAnimationPlayers({ in: null, out: null });
    }, 1500);
    
    // Reset state - exit sub mode after completing a sub
    setManualSubConfirmOpen(false);
    setPendingManualSub(null);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    setSubMode(false);

    // Auto-regenerate the plan if auto-subs are active
    if (autoSubActive) {
      setTimeout(() => {
        handleRegeneratePlan();
        toast({ title: "Auto-sub plan updated", description: "Plan regenerated to account for manual substitution" });
      }, 200);
    }
  }, [pendingManualSub, toast, pushToUndoHistory, autoSubActive, handleRegeneratePlan]);

  // Handle manual substitution cancel
  const handleCancelManualSub = useCallback(() => {
    setManualSubConfirmOpen(false);
    setPendingManualSub(null);
    setSelectedOnBench(null);
  }, []);

  // Handle bench-to-pitch substitution selection
  const handleBenchToSubSelect = useCallback((pitchPlayerId: string, swapPlayerId?: string) => {
    if (!benchToSubPlayer) return;
    setBenchToSubOpen(false);
    // Reuse existing manual sub confirmation flow
    setTimeout(() => {
      setPendingManualSub({ 
        pitchPlayerId, 
        benchPlayerId: benchToSubPlayer,
        swapPlayerId 
      });
      setManualSubConfirmOpen(true);
    }, 150);
  }, [benchToSubPlayer]);

  // Calculate which positions on pitch are occupied by the filtered position type
  // (Position zone indicators removed)

  // Landscape layout: pitch full screen on left, controls stacked on right
  if (isLandscape) {
    return createPortal(
      <div className="fixed inset-0 w-screen h-screen bg-background flex flex-col overflow-hidden" style={{ height: '100dvh', zIndex: 99999 }}>
        {/* LinkedEventHeader removed from top in landscape - now integrated into toolbar */}
        
        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main pitch area - full height */}
          <div className="flex-1 h-full relative overflow-hidden">
            {/* Top left: Close button + Read-only badge */}
            <div className="absolute top-2 left-2 z-50 flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onClose}
                className="bg-background/80 backdrop-blur-sm"
              >
                <X className="h-5 w-5" />
              </Button>
              {readOnly && (
                <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                  <Eye className="h-3 w-3 mr-1" />
                  View Only
                </Badge>
              )}
            </div>
          
          {/* Floating draggable timer */}
          <div 
            className="absolute z-50 cursor-move touch-none select-none"
            style={{ 
              left: floatingTimerPosition.x, 
              top: floatingTimerPosition.y,
            }}
            onMouseDown={handleTimerDragStart}
            onTouchStart={handleTimerTouchStart}
          >
            <div className="flex flex-col items-center bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-lg">
              <div className="flex items-center gap-2">
              <GameTimer 
                key={timerResetKey}
                ref={gameTimerRef} 
                compact
                teamId={teamId} 
                teamName={teamName} 
                onTimeUpdate={handleTimerUpdate} 
                onHalfChange={handleHalfChange} 
                readOnly={readOnly}
                hideExtras
                minutesPerHalf={minutesPerHalf}
                onMinutesPerHalfChange={handleMinutesPerHalfChange}
              />
              {autoSubActive && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-primary text-primary-foreground px-1.5 py-0.5 rounded animate-pulse">
                  AUTO
                </span>
              )}
              </div>
              {tacticalMode !== "neutral" && (
                <span className="text-[9px] text-muted-foreground font-medium mt-0.5">
                  {FORMATIONS[teamSize][selectedFormation]?.name} • {TACTICAL_MODE_LABELS[tacticalMode]}
                </span>
              )}
            </div>
          </div>

          {/* Floating score tracker in landscape mode */}
          {gameInProgress && !hideScores && (
            <div className="absolute top-2 right-14 z-[61]">
              <ScoreTracker
                goals={goals}
                onAddGoal={handleAddGoal}
                onRemoveGoal={handleRemoveGoal}
                players={players}
                currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
                elapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
                teamName={teamName}
                opponentName={opponentName}
                readOnly={readOnly}
                isGameFinished={gameTimerRef.current?.isGameFinished() || false}
                miniLeagueTeams={miniLeagueTeams}
                mini
              />
            </div>
          )}

          {/* Floating undo button - shows for 30 seconds after a sub/swap, positioned above Sub/Swap FABs */}
          {!readOnly && showFloatingUndo && undoHistory.length > 0 && (
            <div className="absolute bottom-4 right-4 z-[9999] animate-fade-in">
              <Button 
                variant="secondary" 
                size="sm"
                onClick={handleUndo}
                className="shadow-md gap-1.5 opacity-90 hover:opacity-100"
              >
                <Undo2 className="h-4 w-4" />
                Undo
              </Button>
            </div>
          )}

          {/* Floating FABs - always visible on pitch in landscape */}
          {!readOnly && (
            <div 
              className="absolute z-50 flex flex-col gap-2 animate-fade-in"
              style={{
                bottom: floatingSubsPosition.y,
                left: floatingSubsPosition.x,
                touchAction: "none",
              }}
            >
              {/* Swap Positions FAB */}
              {playersOnPitch.length >= 2 && !subMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSwapMode();
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-full shadow-lg transition-colors",
                    isTabletLandscape || isDesktopLandscape ? "px-4 py-3" : "px-3 py-2",
                    swapMode 
                      ? "bg-accent text-accent-foreground" 
                      : "bg-muted text-foreground hover:bg-muted/80 border border-border"
                  )}
                >
                  <ArrowLeftRight className={isTabletLandscape || isDesktopLandscape ? "h-5 w-5" : "h-4 w-4"} />
                  <span className={isTabletLandscape || isDesktopLandscape ? "text-base font-medium" : "text-sm font-medium"}>
                    {swapMode ? "Cancel" : "Swap Pos"}
                  </span>
                </button>
              )}

              {/* Make Sub FAB */}
              {!swapMode && (
                <button
                  onClick={() => {
                    if (!floatingSubsDragRef.current) {
                      setSubMode(prev => !prev);
                      setSelectedOnPitch(null);
                      setSelectedOnBench(null);
                    }
                  }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    floatingSubsDragRef.current = {
                      startX: touch.clientX,
                      startY: touch.clientY,
                      startPosX: floatingSubsPosition.x,
                      startPosY: floatingSubsPosition.y,
                    };
                  }}
                  onTouchMove={(e) => {
                    if (!floatingSubsDragRef.current) return;
                    const touch = e.touches[0];
                    const deltaX = touch.clientX - floatingSubsDragRef.current.startX;
                    const deltaY = floatingSubsDragRef.current.startY - touch.clientY;
                    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                      const newX = Math.max(8, Math.min(200, floatingSubsDragRef.current.startPosX + deltaX));
                      const newY = Math.max(8, Math.min(300, floatingSubsDragRef.current.startPosY + deltaY));
                      setFloatingSubsPosition({ x: newX, y: newY });
                      e.preventDefault();
                    }
                  }}
                  onTouchEnd={() => { floatingSubsDragRef.current = null; }}
                  className={cn(
                    "flex items-center gap-2 rounded-full shadow-lg transition-colors cursor-grab active:cursor-grabbing",
                    isTabletLandscape || isDesktopLandscape ? "px-4 py-3" : "px-3 py-2",
                    subMode 
                      ? "bg-secondary text-secondary-foreground" 
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                >
                  <Users className={isTabletLandscape || isDesktopLandscape ? "h-5 w-5" : "h-4 w-4"} />
                  <span className={isTabletLandscape || isDesktopLandscape ? "text-base font-medium" : "text-sm font-medium"}>
                    {subMode ? "Cancel" : `Make Sub (${playersOnBench.length})`}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Bench drag floating indicator - landscape */}
          {benchDragPlayer && benchDragPos && (
            <div 
              className="fixed z-[100] pointer-events-none animate-scale-in"
              style={{ left: benchDragPos.x - 30, top: benchDragPos.y - 40 }}
            >
              <div className="w-[60px] h-[60px] rounded-full bg-primary border-2 border-primary-foreground shadow-2xl flex items-center justify-center animate-pulse">
                <span className="text-primary-foreground text-xs font-bold text-center leading-tight px-1 truncate">
                  {players.find(p => p.id === benchDragPlayer)?.name?.split(' ')[0] || '?'}
                </span>
              </div>
              <div className="text-center mt-0.5">
                <span className="text-[9px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full shadow-lg">
                  Drop on pitch
                </span>
              </div>
            </div>
          )}

          <div 
            id="landscape-pitch-area"
            className="w-full h-full"
            onWheel={handleWheel}
          >
            <div 
              className={cn(
                "w-full h-full origin-center transition-transform duration-100",
                drawingTool === "none" ? "touch-none" : ""
              )}
              onDrop={handlePitchDrop}
              onDragOver={handleDragOver}
              onTouchStart={drawingTool === "none" ? handlePitchTouchStart : undefined}
              onTouchMove={drawingTool === "none" ? handlePitchTouchMove : undefined}
              onTouchEnd={drawingTool === "none" ? handlePitchTouchEnd : undefined}
              style={{
                background: `linear-gradient(to bottom, 
                  hsl(var(--pitch-green) / 0.85) 0%, 
                  hsl(var(--pitch-green)) 50%, 
                  hsl(var(--pitch-green) / 0.85) 100%)`,
                transform: `scale(${zoom})`,
              }}
            >
              {/* Pitch markings */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <circle cx="50" cy="50" r="12" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <circle cx="50" cy="50" r="0.5" fill="white" opacity="0.7" />
                <rect x="25" y="2" width="50" height="18" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <rect x="25" y="80" width="50" height="18" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <rect x="35" y="2" width="30" height="8" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <rect x="35" y="90" width="30" height="8" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <circle cx="50" cy="12" r="0.5" fill="white" opacity="0.7" />
                <circle cx="50" cy="88" r="0.5" fill="white" opacity="0.7" />
                <path d="M 2 5 A 3 3 0 0 0 5 2" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <path d="M 98 5 A 3 3 0 0 1 95 2" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <path d="M 2 95 A 3 3 0 0 1 5 98" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
                <path d="M 98 95 A 3 3 0 0 0 95 98" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              </svg>

              {/* Swap mode connection line with arrows */}
              {swapMode && swapPlayer1 && swapPlayer2 && (() => {
                const p1 = players.find(p => p.id === swapPlayer1);
                const p2 = players.find(p => p.id === swapPlayer2);
                if (!p1?.position || !p2?.position) return null;
                
                // Calculate arrow positions along the line (at 30% and 70%)
                const midX1 = p1.position.x + (p2.position.x - p1.position.x) * 0.35;
                const midY1 = p1.position.y + (p2.position.y - p1.position.y) * 0.35;
                const midX2 = p1.position.x + (p2.position.x - p1.position.x) * 0.65;
                const midY2 = p1.position.y + (p2.position.y - p1.position.y) * 0.65;
                
                // Calculate angle for arrow rotation
                const angle = Math.atan2(p2.position.y - p1.position.y, p2.position.x - p1.position.x) * 180 / Math.PI;
                
                return (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 35 }}>
                    <defs>
                      <linearGradient id="swapLineGradientLandscape" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="50%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f59e0b" />
                      </linearGradient>
                    </defs>
                    <line
                      x1={`${p1.position.x}%`}
                      y1={`${p1.position.y}%`}
                      x2={`${p2.position.x}%`}
                      y2={`${p2.position.y}%`}
                      stroke="url(#swapLineGradientLandscape)"
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      strokeLinecap="round"
                      className="animate-pulse"
                    />
                    {/* Arrow pointing from p1 to p2 */}
                    <g transform={`translate(${midX1}%, ${midY1}%)`}>
                      <polygon 
                        points="-6,-4 6,0 -6,4" 
                        fill="#f59e0b"
                        transform={`rotate(${angle})`}
                        className="animate-pulse"
                      />
                    </g>
                    {/* Arrow pointing from p2 to p1 */}
                    <g transform={`translate(${midX2}%, ${midY2}%)`}>
                      <polygon 
                        points="-6,-4 6,0 -6,4" 
                        fill="#f59e0b"
                        transform={`rotate(${angle + 180})`}
                        className="animate-pulse"
                      />
                    </g>
                    <circle cx={`${p1.position.x}%`} cy={`${p1.position.y}%`} r="6" fill="#f59e0b" opacity="0.6" />
                    <circle cx={`${p2.position.x}%`} cy={`${p2.position.y}%`} r="6" fill="#f59e0b" opacity="0.6" />
                  </svg>
                );
              })()}

              {/* Drawing canvas layer */}
              <div 
                ref={isLandscape ? containerRef : undefined}
                className="absolute inset-0 w-full h-full"
                style={{
                  zIndex: drawingTool !== "none" ? 30 : 5,
                  pointerEvents: drawingTool !== "none" ? "auto" : "none",
                  touchAction: "none",
                }}
              >
                <canvas 
                  ref={isLandscape ? canvasRef : undefined} 
                  className="w-full h-full"
                  style={{ touchAction: "none" }}
                />
              </div>

              {/* Ball */}
              <SoccerBall
                size={28}
                isDragging={isDraggingBall}
                draggable
                onDragStart={handleBallDragStart}
                onDrag={handleBallDrag}
                onDragEnd={handleBallDragEnd}
                onTouchStart={handleBallTouchStart}
                onTouchMove={handleBallTouchMove}
                onTouchEnd={handleBallTouchEnd}
                readOnly={readOnly}
                className="absolute"
                style={{
                  left: `${ballPosition.x + ballOffset.dx}%`,
                  top: `${ballPosition.y + ballOffset.dy}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: 40,
                  transition: tacticalMode !== "neutral" ? "left 0.4s ease, top 0.4s ease" : undefined,
                }}
              />

              {/* Players on pitch */}
              {playersOnPitch.map(player => (
                <PlayerToken
                  key={player.id}
                  player={player}
                  onDragStart={() => !subMode && !swapMode && !readOnly && handleDragStart(player.id)}
                  onDragEnd={handleDragEnd}
                onTouchStart={(e) => {
                    if (readOnly) return;
                    touchHandledRef.current = true;
                    if (subMode || swapMode) {
                      handlePlayerClick(player.id, true);
                      return;
                    }
                    // Double-tap detection for pitch action menu
                    const now = Date.now();
                    const last = lastTapRef.current;
                    if (last && last.playerId === player.id && now - last.time < 400) {
                      lastTapRef.current = null;
                      e.preventDefault();
                      setTouchDragPlayer(null);
                      setTouchOffset(null);
                      setPitchPlayerActionTarget(player.id);
                      setPitchPlayerActionOpen(true);
                    } else {
                      lastTapRef.current = { playerId: player.id, time: now };
                      handleTouchStart(player.id, e);
                    }
                  }}
                  onClick={!readOnly ? () => { if (touchHandledRef.current) { touchHandledRef.current = false; return; } handlePlayerClick(player.id, true); } : undefined}
                  isDragging={draggedPlayer === player.id || touchDragPlayer === player.id}
                  isSelected={(subMode && selectedOnPitch === player.id) || (swapMode && (swapPlayer1 === player.id || swapPlayer2 === player.id))}
                  isSubTarget={subMode && !selectedOnPitch && selectedOnPitch !== player.id}
                  isInvalidTarget={swapMode && swapPlayer1 !== null && swapPlayer1 !== player.id && !getValidSwapPlayerIds.has(player.id)}
                  isMovable={movablePitchPlayerIds.has(player.id)}
                  isPreviewHighlight={previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id}
                  previewHighlightType={previewSwapPlayers.sourceId === player.id ? "source" : previewSwapPlayers.targetId === player.id ? "target" : null}
                  subAnimation={subAnimationPlayers.in === player.id ? "in" : null}
                  readOnly={readOnly}
                  teamColor={getPlayerTeamColor(player)}
                  style={{
                    position: "absolute",
                    ...(() => {
                      const isDragging = draggedPlayer === player.id || touchDragPlayer === player.id;
                      const offset = !isDragging ? tacticalOffsets.get(player.id) : undefined;
                      const tx = offset?.dx ?? 0;
                      const ty = offset?.dy ?? 0;
                      return {
                        left: `${player.position!.x + tx}%`,
                        top: `${player.position!.y + ty}%`,
                        transform: "translate(-50%, -50%)",
                        transition: isDragging ? "none" : "left 0.4s ease-out, top 0.4s ease-out",
                      };
                    })(),
                    zIndex: previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id ? 30 : (touchDragPlayer === player.id ? 50 : 10),
                    cursor: readOnly ? "default" : ((subMode || swapMode) ? "pointer" : "grab"),
                  }}
                />
              ))}

              {/* Preview swap arrow overlay */}
              {previewSwapPlayers.sourceId && previewSwapPlayers.targetId && (() => {
                const sourcePlayer = playersOnPitch.find(p => p.id === previewSwapPlayers.sourceId);
                const targetPlayer = playersOnPitch.find(p => p.id === previewSwapPlayers.targetId);
                if (!sourcePlayer?.position || !targetPlayer?.position) return null;
                
                const x1 = targetPlayer.position.x;
                const y1 = targetPlayer.position.y;
                const x2 = sourcePlayer.position.x;
                const y2 = sourcePlayer.position.y;
                
                // Calculate arrow angle
                const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
                
                return (
                  <svg 
                    className="absolute inset-0 w-full h-full pointer-events-none z-20"
                    style={{ overflow: 'visible' }}
                  >
                    <defs>
                      <marker
                        id="preview-arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon
                          points="0 0, 10 3.5, 0 7"
                          fill="#22d3ee"
                        />
                      </marker>
                    </defs>
                    {/* Animated dashed line with arrow */}
                    <line
                      x1={`${x1}%`}
                      y1={`${y1}%`}
                      x2={`${x2}%`}
                      y2={`${y2}%`}
                      stroke="#22d3ee"
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      markerEnd="url(#preview-arrowhead)"
                      className="animate-pulse"
                      style={{ 
                        strokeLinecap: 'round',
                        filter: 'drop-shadow(0 0 4px rgba(34, 211, 238, 0.6))'
                      }}
                    />
                    {/* Label showing position */}
                    <text
                      x={`${(x1 + x2) / 2}%`}
                      y={`${(y1 + y2) / 2 - 2}%`}
                      textAnchor="middle"
                      className="fill-cyan-400 text-[10px] font-bold"
                      style={{ 
                        paintOrder: 'stroke',
                        stroke: 'rgba(0,0,0,0.8)',
                        strokeWidth: '3px'
                      }}
                    >
                      → {sourcePlayer.currentPitchPosition}
                    </text>
                  </svg>
                );
              })()}
            </div>
          </div>
        </div>
        </div>
        {/* Swipe-up zone at bottom edge to open sheet */}
        {toolbarCollapsed && (
          <div
            className="absolute bottom-0 left-0 right-0 z-[45] flex justify-center items-end pointer-events-auto"
            style={{ height: 56 }}
            onTouchStart={(e) => {
              const el = e.currentTarget;
              el.dataset.swipeStartY = String(e.touches[0].clientY);
              el.dataset.swipeStartT = String(Date.now());
            }}
            onTouchEnd={(e) => {
              const startY = Number(e.currentTarget.dataset.swipeStartY || 0);
              const startT = Number(e.currentTarget.dataset.swipeStartT || 0);
              if (!startY) return;
              const deltaY = startY - e.changedTouches[0].clientY;
              const elapsed = Date.now() - startT;
              const velocity = deltaY / Math.max(elapsed, 1);
              // Open on fast flick (velocity > 0.3px/ms) or sufficient distance (>20px)
              if (deltaY > 20 || velocity > 0.3) setToolbarCollapsed(false);
            }}
          >
            <div className="w-10 h-1 rounded-full bg-foreground/30 mb-1.5" />
          </div>
        )}

        {/* Floating settings button - always visible in landscape when sheet closed */}
        {toolbarCollapsed && !readOnly && (
          <>
            {/* Floating settings button - always visible in landscape when sheet closed */}
            <button
              className="absolute bottom-3 right-3 z-[55] w-10 h-10 rounded-full bg-background/80 backdrop-blur border border-border shadow-lg flex items-center justify-center"
              onClick={() => setToolbarCollapsed(false)}
            >
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            </button>


            <button
              className={cn(
                "absolute bottom-3 z-[55] w-10 h-10 rounded-full backdrop-blur border shadow-lg flex items-center justify-center",
                drawingTool !== "none"
                  ? "bg-primary text-primary-foreground border-primary"
                  : showFloatingDrawToolbar
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-background/80 border-border"
              )}
              style={{ right: 60 }}
              onClick={() => setShowFloatingDrawToolbar(prev => !prev)}
            >
              <Pencil className="h-5 w-5" />
            </button>

            {/* Floating Draw Toolbar */}
            {showFloatingDrawToolbar && (
              <div className="absolute bottom-16 z-[55] animate-fade-in" style={{ right: 12 }}>
                <div className="bg-background/95 backdrop-blur border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Button 
                      variant={drawingTool === "pen" ? "default" : "outline"} 
                      size="icon"
                      className={isTabletLandscape || isDesktopLandscape ? "h-12 w-12" : "h-10 w-10"}
                      onClick={() => {
                        setDrawingTool(drawingTool === "pen" ? "none" : "pen");
                        if (drawingTool !== "pen") setShowFloatingDrawToolbar(false);
                      }}
                    >
                      <Pencil className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant={drawingTool === "arrow" ? "default" : "outline"} 
                      size="icon"
                      className={isTabletLandscape || isDesktopLandscape ? "h-12 w-12" : "h-10 w-10"}
                      onClick={() => {
                        setDrawingTool(drawingTool === "arrow" ? "none" : "arrow");
                        if (drawingTool !== "arrow") setShowFloatingDrawToolbar(false);
                      }}
                    >
                      <MoveRight className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className={isTabletLandscape || isDesktopLandscape ? "h-12 w-12" : "h-10 w-10"}
                      onClick={clearDrawings}
                    >
                      <Eraser className="h-5 w-5" />
                    </Button>
                    {drawingTool !== "none" && (
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        className={isTabletLandscape || isDesktopLandscape ? "h-12 w-12" : "h-10 w-10"}
                        onClick={() => {
                          setDrawingTool("none");
                          setShowFloatingDrawToolbar(false);
                        }}
                      >
                        <X className="h-5 w-5" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2 justify-center">
                    {["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308"].map(color => (
                      <button
                        key={color}
                        className={cn(
                          "w-8 h-8 rounded-full border-2",
                          drawingColor === color ? "border-primary ring-2 ring-primary/50" : "border-muted-foreground/30"
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setDrawingColor(color)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Bottom Sheet Overlay for landscape controls */}
        {!toolbarCollapsed && (
          <div className="absolute inset-0 z-[60] flex flex-col pointer-events-none" style={{ height: '100%' }}>
            {/* Backdrop - pass through when drawing */}
            <div 
              className={cn("flex-1", drawingTool === "none" ? "pointer-events-auto" : "pointer-events-none")}
              onClick={drawingTool === "none" ? () => setToolbarCollapsed(true) : undefined}
            />
            {/* Sheet */}
            <div className="pointer-events-auto bg-background border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-200"
              style={{ height: `${sheetHeightPct}%` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Draggable header area - handle + tabs */}
              <div
                className="cursor-grab touch-none"
                onTouchStart={(e) => {
                  sheetDragRef.current = { startY: e.touches[0].clientY, startPct: sheetHeightPct };
                  e.currentTarget.dataset.dragStartT = String(Date.now());
                }}
                onTouchMove={(e) => {
                  if (!sheetDragRef.current) return;
                  const containerH = window.innerHeight;
                  const deltaY = sheetDragRef.current.startY - e.touches[0].clientY;
                  const deltaPct = (deltaY / containerH) * 100;
                  const newPct = Math.min(90, Math.max(15, sheetDragRef.current.startPct + deltaPct));
                  setSheetHeightPct(newPct);
                }}
                onTouchEnd={(e) => {
                  if (!sheetDragRef.current) return;
                  const elapsed = Date.now() - Number(e.currentTarget.dataset.dragStartT || 0);
                  const deltaY = sheetDragRef.current.startY - e.changedTouches[0].clientY;
                  const velocity = deltaY / Math.max(elapsed, 1);
                  // Fast downward flick → collapse
                  if (velocity < -0.4) {
                    setToolbarCollapsed(true);
                    setSheetHeightPct(50);
                  } else if (velocity > 0.4) {
                    // Fast upward flick → expand
                    setSheetHeightPct(82);
                  } else if (sheetHeightPct < 25) {
                    setToolbarCollapsed(true);
                    setSheetHeightPct(50);
                  } else if (sheetHeightPct < 65) {
                    setSheetHeightPct(50);
                  } else {
                    setSheetHeightPct(82);
                  }
                  sheetDragRef.current = null;
                }}
              >
                {/* Handle bar */}
                <div className="flex justify-center pt-2 pb-1">
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border px-2 gap-1">
                {(["bench", "subs", "setup"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setBottomSheetTab(tab)}
                    className={cn(
                      "flex-1 py-2 text-sm font-medium rounded-t-md transition-colors",
                      bottomSheetTab === tab 
                        ? "bg-muted text-foreground border-b-2 border-primary" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab === "bench" ? `Bench (${playersOnBench.length})` : tab === "subs" ? "Subs" : "Setup"}
                  </button>
                ))}


              </div>
              </div>


              {/* Tab content */}
              <div className="overflow-y-auto p-3" style={{ maxHeight: `calc(${sheetHeightPct}vh - 120px)` }}>
                {/* Bench Tab */}
                {bottomSheetTab === "bench" && (
                  <div className="space-y-3">
                    {/* Position Filter Chips + Fill-In */}
                    <div className="flex items-center gap-2">
                      <div className="flex gap-2 flex-1 min-w-0">
                        {(["GK", "DEF", "MID", "FWD"] as PitchPosition[]).map(pos => {
                          const count = playersOnBench.filter(p => p.assignedPositions?.includes(pos) || !p.assignedPositions?.length).length;
                          const totalCount = players.filter(p => p.assignedPositions?.includes(pos)).length;
                          return (
                            <button
                              key={pos}
                              onClick={() => setBenchPositionFilter(benchPositionFilter === pos ? null : pos)}
                              className={cn(
                                "rounded-md border font-medium text-sm px-3.5 py-2 transition-colors whitespace-nowrap min-h-[36px]",
                                benchPositionFilter === pos 
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                              )}
                            >
                              {pos} ({count})
                            </button>
                          );
                        })}
                        {benchPositionFilter && (
                          <button
                            onClick={() => setBenchPositionFilter(null)}
                            className="rounded-md border font-medium text-sm px-3 py-2 bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 min-h-[36px]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Bench Players - horizontal scroll */}
                    <div 
                      id="pitch-bench-landscape"
                      className="flex flex-nowrap overflow-x-auto scrollbar-none min-h-14 pb-1 gap-2"
                      style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}
                      onDrop={!subMode ? handleBenchDrop : undefined}
                      onDragOver={!subMode ? handleDragOver : undefined}
                      onTouchMove={handleBenchLongPressMove}
                      onTouchEnd={handleBenchLongPressEnd}
                    >
                      {playersOnBench.length === 0 && (
                        <p className="text-xs text-muted-foreground whitespace-nowrap">Drag here</p>
                      )}
                      {subMode && selectedOnPitch && getValidBenchPlayerIds.size === 0 && playersOnBench.length > 0 && (
                        <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                          No players can fill this position
                        </p>
                      )}
                      {playersOnBench
                        .filter(player => {
                          if (subMode && selectedOnPitch) {
                            return getValidBenchPlayerIds.has(player.id);
                          }
                          return !benchPositionFilter || player.assignedPositions?.includes(benchPositionFilter) || !player.assignedPositions?.length;
                        })
                        .map(player => (
                          <div key={player.id} className="shrink-0">
                            <PlayerToken
                              player={player}
                              onDragStart={() => !subMode && !readOnly && handleDragStart(player.id)}
                              onDragEnd={handleDragEnd}
                             onTouchStart={(e) => {
                               if (readOnly) return;
                               touchHandledRef.current = true;
                                if (subMode || swapMode) return;
                                const now = Date.now();
                                const last = lastTapRef.current;
                                if (last && last.playerId === player.id && now - last.time < 400) {
                                  lastTapRef.current = null;
                                  e.preventDefault();
                                  if (benchLongPressTimer.current) {
                                    clearTimeout(benchLongPressTimer.current);
                                    benchLongPressTimer.current = null;
                                  }
                                  setBenchInjuryTarget(player.id);
                                  setBenchInjuryConfirmOpen(true);
                                } else {
                                  lastTapRef.current = { playerId: player.id, time: now };
                                  handleBenchLongPressStart(player.id, e);
                                }
                             }}
                             onClick={
                               !readOnly && subMode && !player.isInjured 
                                 ? () => { if (touchHandledRef.current) { touchHandledRef.current = false; return; } handlePlayerClick(player.id, false); }
                                 : !readOnly && !subMode && !swapMode
                                   ? () => {
                                       if (touchHandledRef.current) { touchHandledRef.current = false; return; }
                                       const now = Date.now();
                                       const last = lastTapRef.current;
                                       if (last && last.playerId === player.id && now - last.time < 400) {
                                         lastTapRef.current = null;
                                         setBenchInjuryTarget(player.id);
                                         setBenchInjuryConfirmOpen(true);
                                       } else {
                                         lastTapRef.current = { playerId: player.id, time: now };
                                         // Single tap during active game: open BenchToSubDialog for quick "slot in"
                                         if (gameInProgress && !player.isInjured && playersOnPitch.length > 0) {
                                           setBenchToSubPlayer(player.id);
                                           setBenchToSubOpen(true);
                                         }
                                       }
                                     }
                                   : undefined
                             }
                              onInjuryToggle={undefined}
                              onRemoveFillIn={!subMode && !swapMode && player.isFillIn ? () => handleRemoveFillInPlayer(player.id) : undefined}
                              isDragging={draggedPlayer === player.id || touchDragPlayer === player.id}
                              isSelected={subMode && selectedOnBench === player.id}
                              isSubTarget={subMode && selectedOnPitch !== null && selectedOnBench !== player.id && !player.isInjured}
                              subAnimation={subAnimationPlayers.out === player.id ? "out" : null}
                              variant="bench"
                              readOnly={readOnly}
                              teamColor={getPlayerTeamColor(player)}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Subs Tab */}
                {bottomSheetTab === "subs" && (
                  <div className="space-y-3">
                    {!readOnly && (
                      <>
                        {/* Auto-Subs section - shown first */}
                        {!disableAutoSubs && !subMode && !swapMode && (
                          <div className={cn(autoSubActive && "pb-2 border-b border-border")}>
                            {!autoSubActive ? (
                              <Button 
                                variant="outline" 
                                className="w-full h-12 text-base" 
                                onClick={handleOpenNewPlan}
                              >
                                <Calendar className="h-4 w-4 mr-1.5" />
                                Auto-Subs
                              </Button>
                            ) : (
                              <Suspense fallback={<DialogLoader />}>
                                <AutoSubManager
                                  autoSubPlan={autoSubPlan}
                                  autoSubPaused={autoSubPaused}
                                  players={players}
                                  lockedPlayerIds={lockedPlayerIds}
                                  currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
                                  currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
                                  minutesPerHalf={minutesPerHalf}
                                  onTogglePause={handleTogglePauseAutoSub}
                                  onCancelPlan={handleCancelAutoSubPlan}
                                  onSkipNext={handleSkipNextSub}
                                  onExecuteNow={handleExecuteNow}
                                  onEditPlan={handleOpenEditPlan}
                                  onRegeneratePlan={handleRegeneratePlan}
                                  onToggleLockPlayer={handleToggleLockPlayer}
                                  compact
                                />
                              </Suspense>
                            )}
                          </div>
                        )}

                        {/* Make Sub / Swap - shown when not in a mode */}
                        {!subMode && !swapMode && (
                          <>
                            <Button
                              variant="outline"
                              className="w-full h-12 text-base"
                              onClick={() => { toggleSubMode(); setToolbarCollapsed(true); }}
                            >
                              <RefreshCw className="h-4 w-4 mr-1.5" />
                              Make Sub
                            </Button>

                            {playersOnPitch.length >= 2 && (
                              <Button
                                variant="outline"
                                className="w-full h-12 text-base"
                                onClick={() => { toggleSwapMode(); setToolbarCollapsed(true); }}
                              >
                                <ArrowLeftRight className="h-4 w-4 mr-1.5" />
                                Swap Positions
                              </Button>
                            )}
                          </>
                        )}

                        {/* Sub/Swap mode active UI */}
                        {(subMode || swapMode) && (
                          <>
                            <Button
                              variant="default"
                              className="w-full h-10 text-sm"
                              onClick={() => { subMode ? toggleSubMode() : toggleSwapMode(); setToolbarCollapsed(true); }}
                            >
                              {subMode ? <><RefreshCw className="h-4 w-4 mr-1.5" />Cancel Sub</> : <><ArrowLeftRight className="h-4 w-4 mr-1.5" />Cancel Swap</>}
                            </Button>
                            {subMode && selectedOnPitch && (
                              <Button variant="outline" className="w-full h-9 text-xs" onClick={() => setSubPreviewOpen(true)}>
                                <List className="h-3.5 w-3.5 mr-1.5" />
                                Options
                              </Button>
                            )}
                            {subMode && (
                              <p className="text-xs text-muted-foreground text-center">
                                {selectedOnPitch ? "Select bench player" : "Select on pitch"}
                              </p>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Setup Tab */}
                {bottomSheetTab === "setup" && (
                  <div className="space-y-4 px-1">
                    {/* Tactical Mode Selector */}
                    <TacticalModeSelector value={tacticalMode} onChange={handleTacticalModeChange} readOnly={readOnly} />
                    {tacticalFormationSuggestion && (
                      <div className="rounded-lg border border-border bg-muted/60 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-foreground">
                            Suggested for <span className="font-semibold">{tacticalFormationSuggestion.mode === "attack" ? "Attack" : "Defend"}</span>: <span className="font-semibold">{tacticalFormationSuggestion.formationName}</span>
                          </p>
                          <button type="button" onClick={handleDismissTacticalSuggestion} className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss formation suggestion">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button type="button" size="sm" className="h-8" onClick={handleApplyTacticalSuggestion}>Apply formation</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleDismissTacticalSuggestion}>Dismiss</Button>
                        </div>
                      </div>
                    )}
                    {/* Segmented controls for core settings - landscape */}
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Players</Label>
                        <div className="flex rounded-lg border border-border overflow-hidden">
                          {(["3","4","5","6","7","8","9","10","11"] as const).map((size) => (
                            <button
                              key={size}
                              type="button"
                              disabled={readOnly}
                              onClick={() => handleTeamSizeChange(size)}
                              className={cn(
                                "flex-1 py-2.5 text-base font-medium transition-colors min-w-0",
                                teamSize === size
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Formation</Label>
                        <div className="flex rounded-lg border border-border overflow-hidden">
                          {FORMATIONS[teamSize].map((f, i) => (
                            <button
                              key={i}
                              type="button"
                              disabled={readOnly}
                              onClick={() => handleFormationChange(i.toString())}
                              className={cn(
                                "flex-1 py-2.5 text-base font-medium transition-colors",
                                selectedFormation === i
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Primary actions - context-aware */}
                    {!readOnly && !miniLeagueTeams && !gameInProgress && (
                      <div className="grid grid-cols-2 gap-3">
                        <Button variant="outline" className="h-12 text-base" onClick={() => setShowLineupPicker(true)}>
                          <List className="h-4 w-4 mr-1.5" />
                          Select Lineup
                        </Button>
                        <Button variant="outline" className="h-12 text-base" onClick={() => setStatsOpen(true)}>
                          <BarChart3 className="h-4 w-4 mr-1.5" />
                          Stats
                        </Button>
                        <Button variant="outline" className="h-12 text-base" onClick={handleResetFormation}>
                          <RotateCcw className="h-4 w-4 mr-1.5" />
                          Reset Formation
                        </Button>
                        <Button variant="outline" className="h-12 text-base" onClick={() => setPositionEditorOpen(true)}>
                          <Settings2 className="h-4 w-4 mr-1.5" />
                          Positions
                        </Button>
                      </div>
                    )}
                    {(readOnly || miniLeagueTeams || gameInProgress) && !readOnly && (
                      <div className="grid grid-cols-2 gap-3">
                        <Button variant="outline" className="h-12 text-base" onClick={() => setStatsOpen(true)}>
                          <BarChart3 className="h-4 w-4 mr-1.5" />
                          Stats
                        </Button>
                        <Button variant="outline" className="h-12 text-base" onClick={handleResetFormation}>
                          <RotateCcw className="h-4 w-4 mr-1.5" />
                          Reset Formation
                        </Button>
                      </div>
                    )}
                    {(readOnly || miniLeagueTeams || gameInProgress) && readOnly && (
                      <Button variant="outline" className="w-full h-12 text-base" onClick={() => setStatsOpen(true)}>
                        <BarChart3 className="h-4 w-4 mr-1.5" />
                        Stats
                      </Button>
                    )}

                    {/* More Options - collapsible */}
                    {!readOnly && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center justify-center w-full py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors gap-1.5">
                          <span>More Options</span>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-2 pt-1">
                          <div className="grid grid-cols-2 gap-2">
                            <Button variant="outline" className="h-10 text-sm" onClick={() => setPositionEditorOpen(true)}>
                              <Settings2 className="h-4 w-4 mr-1.5" />
                              Positions
                            </Button>
                            <Suspense fallback={null}>
                              <AddFillInPlayerDialog
                                onAddPlayer={handleAddFillInPlayer}
                                existingNumbers={existingJerseyNumbers}
                              />
                            </Suspense>
                          </div>
                          {parseInt(teamSize) >= 7 && (
                            <div className="flex items-center justify-between py-1">
                              <Label className="text-sm">Rotate GK at Halftime</Label>
                              <Switch checked={rotateGkAtHalftime} onCheckedChange={setRotateGkAtHalftime} />
                            </div>
                          )}
                          <div className="flex items-center justify-between py-1">
                            <Label className="text-sm">Hide Scores</Label>
                            <Switch checked={hideScores} onCheckedChange={setHideScores} />
                          </div>
                          <div className="flex items-center justify-between py-1">
                            <Label className="text-sm">Starting Lineup Screen</Label>
                            <Switch checked={showLineupPickerSetting} onCheckedChange={handleShowLineupPickerSettingChange} />
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Reset Game - always visible at bottom */}
                    {!readOnly && (
                      <Button variant="outline" className="w-full h-12 text-base text-destructive" onClick={() => setResetGameConfirmOpen(true)}>
                        <RotateCcw className="h-4.5 w-4.5 mr-2" />
                        Reset Game
                      </Button>
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {/* Sub mode instruction banner */}
        {subMode && (
          <div className={cn(
            "absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg animate-fade-in",
            "bg-primary text-primary-foreground"
          )}>
            <p className="text-sm font-medium">
              {!selectedOnPitch 
                ? "Tap player on pitch to sub off" 
                : "Tap bench player to sub on"
              }
            </p>
          </div>
        )}

        {/* Swap mode instruction banner */}
        {swapMode && (
          <div className={cn(
            "absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg animate-fade-in",
            swapPlayer1 && getValidSwapPlayerIds.size === 0 
              ? "bg-destructive text-destructive-foreground" 
              : "bg-primary text-primary-foreground"
          )}>
            <p className="text-sm font-medium">
              {!swapPlayer1 
                ? "Tap first player to swap" 
                : getValidSwapPlayerIds.size === 0
                  ? "No players can swap to this position"
                  : "Tap second player to swap with"
              }
            </p>
          </div>
        )}

        {/* Position Editor Dialog */}
        <PlayerPositionEditor
          open={positionEditorOpen}
          onOpenChange={setPositionEditorOpen}
          players={players}
          onUpdatePositions={handleUpdatePositions}
        />

        {/* Position Swap Dialog */}
        <PositionSwapDialog
          open={positionSwapDialogOpen}
          onOpenChange={setPositionSwapDialogOpen}
          benchPlayer={players.find(p => p.id === pendingSubBenchPlayer) || null}
          pitchPlayers={playersOnPitch}
          requiredPosition={requiredPosition}
          onSwapAndSubstitute={handleSwapAndSubstitute}
          onCancel={() => {
            setPositionSwapDialogOpen(false);
            setPendingSubBenchPlayer(null);
            setRequiredPosition(null);
          }}
        />

        {/* Substitution Preview Dialog */}
        <SubstitutionPreviewDialog
          open={subPreviewOpen}
          onOpenChange={(open) => {
            setSubPreviewOpen(open);
            if (!open) {
              setSelectedOnPitch(null);
              setSelectedOnBench(null);
              setPreviewSwapPlayers({ sourceId: null, targetId: null });
            }
          }}
          pitchPlayer={players.find(p => p.id === selectedOnPitch) || null}
          benchPlayers={playersOnBench}
          allPitchPlayers={playersOnPitch}
          onSelectOption={handleSubPreviewSelect}
          miniLeagueTeams={miniLeagueTeams}
        />

        {/* Formation Change Dialog */}
        <FormationChangeDialog
          open={formationChangeDialogOpen}
          onOpenChange={setFormationChangeDialogOpen}
          currentFormation={FORMATIONS[teamSize][selectedFormation]?.name || ""}
          newFormation={pendingFormationChange ? FORMATIONS[pendingFormationChange.newTeamSize || teamSize][pendingFormationChange.index]?.name || "" : ""}
          positionSwaps={pendingFormationChange?.positionSwaps || []}
          benchMoves={pendingFormationChange?.benchMoves || []}
          onConfirm={handleFormationChangeConfirm}
          onCancel={handleFormationChangeCancel}
          isTeamSizeChange={!!pendingFormationChange?.newTeamSize}
          currentTeamSize={teamSize}
          newTeamSize={pendingFormationChange?.newTeamSize}
        />

        {/* Auto-Sub Plan Dialog */}
        <AutoSubPlanDialog
          open={autoSubPlanDialogOpen}
          onOpenChange={setAutoSubPlanDialogOpen}
          players={players}
          teamSize={parseInt(teamSize)}
          minutesPerHalf={minutesPerHalf}
          onStartPlan={handleStartAutoSubPlan}
          existingPlan={autoSubActive ? autoSubPlan : undefined}
          editMode={autoSubPlanEditMode}
          rotationSpeed={rotationSpeed}
          disablePositionSwaps={disablePositionSwaps}
          disableBatchSubs={disableBatchSubs}
          rotateGkAtHalftime={rotateGkAtHalftime}
          currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
          currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
          showStepper={autoSubFromPreGame}
        />

        {/* Sub Confirm Dialog */}
        <SubConfirmDialog
          open={subConfirmDialogOpen}
          onOpenChange={setSubConfirmDialogOpen}
          substitution={pendingAutoSub}
          onConfirm={handleConfirmAutoSub}
          onSkip={handleSkipAutoSub}
          players={players}
        />

        {/* Manual Sub Confirm Dialog */}
        <ManualSubConfirmDialog
          open={manualSubConfirmOpen}
          onOpenChange={setManualSubConfirmOpen}
          playerOut={players.find(p => p.id === pendingManualSub?.pitchPlayerId) || null}
          playerIn={players.find(p => p.id === pendingManualSub?.benchPlayerId) || null}
          positionSwap={pendingManualSub?.swapPlayerId ? (() => {
            const pitchPlayer = players.find(p => p.id === pendingManualSub.pitchPlayerId);
            const swapPlayer = players.find(p => p.id === pendingManualSub.swapPlayerId);
            if (!swapPlayer || !pitchPlayer?.currentPitchPosition || !swapPlayer.currentPitchPosition) return null;
            return {
              player: swapPlayer,
              fromPosition: swapPlayer.currentPitchPosition,
              toPosition: pitchPlayer.currentPitchPosition,
            };
          })() : null}
          onConfirm={handleConfirmManualSub}
          onCancel={handleCancelManualSub}
        />

        {/* Pitch Position Swap Confirm Dialog */}
        <PitchSwapConfirmDialog
          open={pitchSwapConfirmOpen}
          onOpenChange={setPitchSwapConfirmOpen}
          player1={players.find(p => p.id === swapPlayer1) || null}
          player2={players.find(p => p.id === swapPlayer2) || null}
          allPitchPlayers={players.filter(p => p.position !== null)}
          onConfirm={handleConfirmPitchSwap}
          onCancel={handleCancelPitchSwap}
          onConfirmWithAccommodation={handleConfirmPitchSwapWithAccommodation}
        />

        {/* Swap Before Sub Dialog (step 1 of swap-based substitution) */}
        <PitchSwapConfirmDialog
          open={swapBeforeSubDialogOpen}
          onOpenChange={(open) => {
            // Don't cancel on close - only cancel via the Cancel button
            // This prevents clearing pendingSwapBasedSub when transitioning to next dialog
          }}
          player1={players.find(p => p.id === pendingSwapBasedSub?.swapPlayerId) || null}
          player2={players.find(p => p.id === pendingSwapBasedSub?.pitchPlayerId) || null}
          onConfirm={handleConfirmSwapBeforeSub}
          onCancel={handleCancelSwapBasedSub}
        />

        {/* Sub After Swap Dialog (step 2 of swap-based substitution) */}
        <ManualSubConfirmDialog
          open={subAfterSwapDialogOpen}
          onOpenChange={(open) => {
            // Don't cancel on close - only cancel via the Cancel button
            // This allows the substitution to complete before state is cleared
          }}
          playerOut={players.find(p => p.id === pendingSwapBasedSub?.pitchPlayerId) || null}
          playerIn={players.find(p => p.id === pendingSwapBasedSub?.benchPlayerId) || null}
          onConfirm={handleConfirmSubAfterSwap}
          onCancel={handleCancelSwapBasedSub}
        />

        {/* Landscape Event Selector Sheet - only show in non-readOnly mode */}
        {!readOnly && !gameInProgress && (
          <LandscapeEventSelector
            open={landscapeEventSelectorOpen}
            onOpenChange={setLandscapeEventSelectorOpen}
            teamId={teamId}
            currentEventId={linkedEventId}
            onSelectEvent={(eventId) => {
              handleLinkEvent(eventId);
              setLandscapeEventSelectorOpen(false);
            }}
          />
        )}

        {/* Pitch Player Action Menu (injury on pitch) - landscape */}
        <Suspense fallback={null}>
          <PitchPlayerActionMenu
            open={pitchPlayerActionOpen}
            onOpenChange={(open) => {
              setPitchPlayerActionOpen(open);
              if (!open) setPitchPlayerActionTarget(null);
            }}
            player={players.find(p => p.id === pitchPlayerActionTarget) || null}
            benchPlayers={players.filter(p => p.position === null)}
            onMarkInjured={handleMarkInjuredOnPitch}
          />
        </Suspense>

        {/* Bench Injury Confirmation - landscape */}
        {benchInjuryConfirmOpen && createPortal(
          <div className="fixed inset-0 z-[999998] bg-black/80 animate-in fade-in-0" />,
          document.body
        )}
        {benchInjuryConfirmOpen && benchInjuryTarget && createPortal(
          <div className="fixed left-[50%] top-[50%] z-[999999] grid w-[calc(100%-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg rounded-lg animate-in fade-in-0 zoom-in-95">
            <div className="flex flex-col space-y-2 text-center sm:text-left">
              <h2 className="text-lg font-semibold">
                {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark as Fit?" : "Mark as Injured?"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {players.find(p => p.id === benchInjuryTarget)?.isInjured
                  ? `${players.find(p => p.id === benchInjuryTarget)?.name} will be available for substitutions again.`
                  : `${players.find(p => p.id === benchInjuryTarget)?.name} will not be available for substitutions.`}
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" className="mt-2 sm:mt-0" onClick={() => { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  togglePlayerInjury(benchInjuryTarget);
                  setBenchInjuryConfirmOpen(false);
                  setBenchInjuryTarget(null);
                }}
              >
                {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark Fit" : "Mark Injured"}
              </Button>
            </div>
          </div>,
          document.body
        )}

        {/* Match Stats Panel */}
        <MatchStatsPanel
          open={statsOpen}
          onOpenChange={setStatsOpen}
          players={players}
          elapsedGameTime={gameTimerRef.current?.getElapsedSeconds() || 0}
          goals={goals}
          teamName={teamName}
          opponentName={opponentName}
          hideScores={hideScores}
        />
      </div>,
      document.body
    );
  }

  // Portrait layout - bottom sheet pattern (matches landscape UX)
  const isNative = Capacitor.isNativePlatform();

  return createPortal(
    <div className={cn("fixed top-0 left-0 right-0 bottom-0 w-screen h-screen bg-background flex flex-col overflow-hidden", isNative && "pt-safe")} style={{ height: '100dvh', zIndex: 99999 }}>
      {/* Linked event header - shows at top when match header is enabled */}
      {showMatchHeader && (
        <LinkedEventHeader 
          eventId={linkedEventId || ''} 
          teamId={teamId}
          teamName={teamName} 
          onLinkEvent={readOnly || gameInProgress ? undefined : handleLinkEvent}
          showScoreToggle={gameInProgress && !hideScores}
          scoreExpanded={showScoreInPortrait}
          onToggleScore={() => setShowScoreInPortrait(!showScoreInPortrait)}
          currentScore={{ 
            team: goals.filter(g => !g.isOpponentGoal).length, 
            opponent: goals.filter(g => g.isOpponentGoal).length 
          }}
        />
      )}
      
      {/* Score tracker in portrait mode - show when game is in progress and expanded */}
      {gameInProgress && showScoreInPortrait && !hideScores && (
        <div className="px-4 py-2 bg-muted/30 border-b border-border shrink-0">
          <ScoreTracker
            goals={goals}
            onAddGoal={handleAddGoal}
            onRemoveGoal={handleRemoveGoal}
            players={players}
            currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
            elapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
            teamName={teamName}
            opponentName={opponentName}
            readOnly={readOnly}
            isGameFinished={gameTimerRef.current?.isGameFinished() || false}
            miniLeagueTeams={miniLeagueTeams}
          />
        </div>
      )}
      
      {/* Slim Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-background">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold flex-1 truncate">{teamName} - Pitch Board</h1>
        {readOnly && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
            <Eye className="h-3 w-3 mr-1" />
            View Only
          </Badge>
        )}
        {!readOnly && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setStatsOpen(true)}>
            <BarChart3 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Full-screen Pitch Area */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* Floating timer */}
        <div 
          className="absolute z-[55] select-none pointer-events-auto"
          style={{ 
            right: 8,
            top: gameInProgress && !hideScores && !showScoreInPortrait ? 52 : 8,
            touchAction: 'auto',
          }}
        >
          <div className="flex flex-col items-center bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-lg">
            <div className="flex items-center gap-2">
            <GameTimer 
              key={timerResetKey}
              ref={gameTimerRef} 
              compact
              teamId={teamId} 
              teamName={teamName} 
              onTimeUpdate={handleTimerUpdate} 
              onHalfChange={handleHalfChange} 
              readOnly={readOnly}
              hideExtras
              minutesPerHalf={minutesPerHalf}
              onMinutesPerHalfChange={handleMinutesPerHalfChange}
            />
            {autoSubActive && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-primary text-primary-foreground px-1.5 py-0.5 rounded animate-pulse">
                AUTO
              </span>
            )}
            </div>
            {tacticalMode !== "neutral" && (
              <span className="text-[9px] text-muted-foreground font-medium mt-0.5">
                {FORMATIONS[teamSize][selectedFormation]?.name} • {TACTICAL_MODE_LABELS[tacticalMode]}
              </span>
            )}
          </div>
        </div>

        {/* Floating score tracker */}
        {gameInProgress && !hideScores && !showScoreInPortrait && (
          <div className="absolute top-2 right-2 z-[61]">
            <ScoreTracker
              goals={goals}
              onAddGoal={handleAddGoal}
              onRemoveGoal={handleRemoveGoal}
              players={players}
              currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
              elapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
              teamName={teamName}
              opponentName={opponentName}
              readOnly={readOnly}
              isGameFinished={gameTimerRef.current?.isGameFinished() || false}
              miniLeagueTeams={miniLeagueTeams}
              mini
            />
          </div>
        )}

        {/* Floating undo button - bottom-right, above the chevron-up arrow */}
        {!readOnly && showFloatingUndo && undoHistory.length > 0 && !portraitSheetOpen && (
          <div
            className="absolute right-2 z-[64] animate-fade-in"
            style={{ bottom: subMode || swapMode ? 56 : 64 }}
          >
            <Button 
              variant="secondary" 
              size="sm"
              onClick={handleUndo}
              className="shadow-md gap-1.5 opacity-90 hover:opacity-100"
            >
              <Undo2 className="h-4 w-4" />
              Undo
            </Button>
          </div>
        )}

        {/* Floating FABs for Sub/Swap */}
        {!readOnly && !portraitSheetOpen && (
          <div className="absolute left-3 z-[63] flex flex-col gap-2 animate-fade-in"
            style={{ bottom: subMode || swapMode ? 64 : 32 }}
          >
            {/* Swap Positions FAB */}
            {playersOnPitch.length >= 2 && !subMode && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleSwapMode(); }}
                className={cn(
                  "flex items-center gap-2 rounded-full shadow-lg transition-colors px-3 py-2",
                  swapMode 
                    ? "bg-accent text-accent-foreground" 
                    : "bg-muted text-foreground hover:bg-muted/80 border border-border"
                )}
              >
                <ArrowLeftRight className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {swapMode ? "Cancel" : "Swap"}
                </span>
              </button>
            )}

            {/* Make Sub FAB */}
            {!swapMode && (
              <button
                onClick={() => {
                  setSubMode(prev => !prev);
                  setSelectedOnPitch(null);
                  setSelectedOnBench(null);
                  if (subMode) {
                    // Turning off sub mode - close sheet if open
                    setPortraitSheetOpen(false);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 rounded-full shadow-lg transition-colors px-3 py-2",
                  subMode 
                    ? "bg-secondary text-secondary-foreground" 
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {subMode ? "Cancel" : `Sub (${playersOnBench.length})`}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Floating settings button - bottom right to open sheet */}
        {!portraitSheetOpen && (
          <>
            <button
              className={cn(
                "absolute right-3 z-[63] w-10 h-10 rounded-full bg-background/80 backdrop-blur border border-border shadow-lg flex items-center justify-center",
                (subMode || swapMode) ? "bottom-14" : "bottom-3"
              )}
              onClick={() => setPortraitSheetOpen(true)}
            >
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            </button>

            {/* Floating Draw FAB - portrait */}
            {!readOnly && (
              <>
                <button
                  className={cn(
                    "absolute z-[63] w-10 h-10 rounded-full backdrop-blur border shadow-lg flex items-center justify-center",
                    (subMode || swapMode) ? "bottom-14" : "bottom-3",
                    drawingTool !== "none"
                      ? "bg-primary text-primary-foreground border-primary"
                      : showFloatingDrawToolbar
                        ? "bg-accent text-accent-foreground border-accent"
                        : "bg-background/80 border-border"
                  )}
                  style={{ right: 60 }}
                  onClick={() => setShowFloatingDrawToolbar(prev => !prev)}
                >
                  <Pencil className="h-5 w-5" />
                </button>


                {/* Floating Draw Toolbar - portrait */}
                {showFloatingDrawToolbar && (
                  <div className={cn("absolute right-3 z-[64] animate-fade-in", (subMode || swapMode) ? "bottom-[6.5rem]" : "bottom-16")}>
                    <div className="bg-background/95 backdrop-blur border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3">
                      <div className="flex gap-2">
                        <Button 
                          variant={drawingTool === "pen" ? "default" : "outline"} 
                          size="icon"
                          className="h-12 w-12"
                          onClick={() => {
                            setDrawingTool(drawingTool === "pen" ? "none" : "pen");
                            if (drawingTool !== "pen") setShowFloatingDrawToolbar(false);
                          }}
                        >
                          <Pencil className="h-5 w-5" />
                        </Button>
                        <Button 
                          variant={drawingTool === "arrow" ? "default" : "outline"} 
                          size="icon"
                          className="h-12 w-12"
                          onClick={() => {
                            setDrawingTool(drawingTool === "arrow" ? "none" : "arrow");
                            if (drawingTool !== "arrow") setShowFloatingDrawToolbar(false);
                          }}
                        >
                          <MoveRight className="h-5 w-5" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-12 w-12"
                          onClick={clearDrawings}
                        >
                          <Eraser className="h-5 w-5" />
                        </Button>
                        {drawingTool !== "none" && (
                          <Button 
                            variant="destructive" 
                            size="icon" 
                            className="h-12 w-12"
                            onClick={() => {
                              setDrawingTool("none");
                              setShowFloatingDrawToolbar(false);
                            }}
                          >
                            <X className="h-5 w-5" />
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-2 justify-center">
                        {["#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#eab308"].map(color => (
                          <button
                            key={color}
                            className={cn(
                              "w-8 h-8 rounded-full border-2",
                              drawingColor === color ? "border-primary ring-2 ring-primary/50" : "border-muted-foreground/30"
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => setDrawingColor(color)}
                          />
                        ))}
                      </div>
                      </div>
                    </div>
                )}
              </>
            )}
          </>
        )}

        {/* Swipe-up zone at bottom edge */}
        {!portraitSheetOpen && (
          <div
            className="absolute bottom-0 left-0 right-0 z-[45] flex justify-center items-end pointer-events-auto"
            style={{ height: 56 }}
            onTouchStart={(e) => {
              e.currentTarget.dataset.swipeStartY = String(e.touches[0].clientY);
              e.currentTarget.dataset.swipeStartT = String(Date.now());
            }}
            onTouchEnd={(e) => {
              const startY = Number(e.currentTarget.dataset.swipeStartY || 0);
              const startT = Number(e.currentTarget.dataset.swipeStartT || 0);
              if (!startY) return;
              const deltaY = startY - e.changedTouches[0].clientY;
              const elapsed = Date.now() - startT;
              const velocity = deltaY / Math.max(elapsed, 1);
              if (deltaY > 20 || velocity > 0.3) setPortraitSheetOpen(true);
            }}
          >
            <div className="w-10 h-1 rounded-full bg-foreground/30 mb-1.5" />
          </div>
        )}

        {/* Bottom Sheet Overlay */}
        {portraitSheetOpen && (
          <div className="absolute inset-0 z-[60] flex flex-col pointer-events-none" style={{ height: '100%' }}>
            {/* Backdrop - pass through when drawing */}
            <div 
              className={cn("flex-1", drawingTool === "none" ? "pointer-events-auto" : "pointer-events-none")}
              onClick={drawingTool === "none" ? () => setPortraitSheetOpen(false) : undefined}
            />
            {/* Sheet */}
            <div 
              data-portrait-drawer
              className="pointer-events-auto bg-background border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-200"
              style={{ height: `${portraitSheetHeightPct}%` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Draggable header area - handle + tabs */}
              <div
                className="cursor-grab touch-none"
                onTouchStart={(e) => {
                  portraitSheetDragRef.current = { startY: e.touches[0].clientY, startPct: portraitSheetHeightPct };
                  e.currentTarget.dataset.dragStartT = String(Date.now());
                }}
                onTouchMove={(e) => {
                  if (!portraitSheetDragRef.current) return;
                  const containerH = window.innerHeight;
                  const deltaY = portraitSheetDragRef.current.startY - e.touches[0].clientY;
                  const deltaPct = (deltaY / containerH) * 100;
                  const newPct = Math.min(85, Math.max(15, portraitSheetDragRef.current.startPct + deltaPct));
                  setPortraitSheetHeightPct(newPct);
                }}
                onTouchEnd={(e) => {
                  if (!portraitSheetDragRef.current) return;
                  const elapsed = Date.now() - Number(e.currentTarget.dataset.dragStartT || 0);
                  const deltaY = portraitSheetDragRef.current.startY - e.changedTouches[0].clientY;
                  const velocity = deltaY / Math.max(elapsed, 1);
                  // Fast downward flick → close
                  if (velocity < -0.4) {
                    setPortraitSheetOpen(false);
                    setPortraitSheetHeightPct(45);
                  } else if (velocity > 0.4) {
                    // Fast upward flick → expand
                    setPortraitSheetHeightPct(75);
                  } else if (portraitSheetHeightPct < 25) {
                    setPortraitSheetOpen(false);
                    setPortraitSheetHeightPct(45);
                  } else if (portraitSheetHeightPct < 60) {
                    setPortraitSheetHeightPct(45);
                  } else {
                    setPortraitSheetHeightPct(75);
                  }
                  portraitSheetDragRef.current = null;
                }}
              >
                {/* Handle bar */}
                <div className="flex justify-center pt-2 pb-1">
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border px-2 gap-1">
                  {(["bench", "subs", "setup"] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setBottomSheetTab(tab)}
                      className={cn(
                        "flex-1 py-2 text-sm font-medium rounded-t-md transition-colors",
                        bottomSheetTab === tab 
                          ? "bg-muted text-foreground border-b-2 border-primary" 
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab === "bench" ? `Bench (${playersOnBench.length})` : tab === "subs" ? "Subs" : "Setup"}
                    </button>
                  ))}


                </div>
              </div>


              {/* Tab content */}
              <div className="overflow-y-auto p-3" style={{ maxHeight: `calc(${portraitSheetHeightPct}vh - 120px)` }}>
                {/* Bench Tab */}
                {bottomSheetTab === "bench" && (
                  <div className="space-y-3">
                    {/* Position Filter Chips + Fill-In */}
                    <div className="flex items-center gap-2">
                      <div className="flex gap-2 flex-1 min-w-0">
                        {(["GK", "DEF", "MID", "FWD"] as PitchPosition[]).map(pos => {
                          const count = playersOnBench.filter(p => p.assignedPositions?.includes(pos) || !p.assignedPositions?.length).length;
                          return (
                            <button
                              key={pos}
                              onClick={() => setBenchPositionFilter(benchPositionFilter === pos ? null : pos)}
                              className={cn(
                                "rounded-md border font-medium text-sm px-3.5 py-2 transition-colors whitespace-nowrap min-h-[36px]",
                                benchPositionFilter === pos 
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                              )}
                            >
                              {pos} ({count})
                            </button>
                          );
                        })}
                        {benchPositionFilter && (
                          <button
                            onClick={() => setBenchPositionFilter(null)}
                            className="rounded-md border font-medium text-sm px-3 py-2 bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 min-h-[36px]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Sub mode tips */}
                    {subMode && !selectedOnPitch && playersOnBench.length > 0 && (
                      <p className="text-xs text-primary font-medium bg-primary/10 px-3 py-1.5 rounded">
                        Tap a player on pitch to sub off
                      </p>
                    )}
                    {subMode && selectedOnPitch && playersOnBench.length > 0 && getValidBenchPlayerIds.size > 0 && (
                      <p className="text-xs text-emerald-600 font-medium bg-emerald-500/10 px-3 py-1.5 rounded">
                        Tap a bench player to sub on
                      </p>
                    )}
                    {/* Bench Players - wrap layout for portrait */}
                    <div 
                      id="pitch-bench-portrait"
                      className="grid grid-cols-2 gap-2 min-h-14"
                      style={{ touchAction: 'pan-y' }}
                      onDrop={!subMode ? handleBenchDrop : undefined}
                      onDragOver={!subMode ? handleDragOver : undefined}
                      onTouchMove={handleBenchLongPressMove}
                      onTouchEnd={handleBenchLongPressEnd}
                    >
                      {playersOnBench.length === 0 && (
                        <p className="text-xs text-muted-foreground">Drag players here to substitute</p>
                      )}
                      {subMode && selectedOnPitch && getValidBenchPlayerIds.size === 0 && playersOnBench.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          No players can fill this position
                        </p>
                      )}
                      {playersOnBench
                        .filter(player => {
                          if (subMode && selectedOnPitch) {
                            return getValidBenchPlayerIds.has(player.id);
                          }
                          return !benchPositionFilter || player.assignedPositions?.includes(benchPositionFilter) || !player.assignedPositions?.length;
                        })
                        .map(player => (
                          <PlayerToken
                            key={player.id}
                            player={player}
                            onDragStart={() => !subMode && !readOnly && handleDragStart(player.id)}
                            onDragEnd={handleDragEnd}
                           onTouchStart={(e) => {
                             if (readOnly) return;
                             touchHandledRef.current = true;
                              if (subMode || swapMode) return;
                              const now = Date.now();
                              const last = lastTapRef.current;
                              if (last && last.playerId === player.id && now - last.time < 400) {
                                lastTapRef.current = null;
                                e.preventDefault();
                                if (benchLongPressTimer.current) {
                                  clearTimeout(benchLongPressTimer.current);
                                  benchLongPressTimer.current = null;
                                }
                                setBenchInjuryTarget(player.id);
                                setBenchInjuryConfirmOpen(true);
                              } else {
                                lastTapRef.current = { playerId: player.id, time: now };
                                handleBenchLongPressStart(player.id, e);
                              }
                           }}
                           onClick={
                             !readOnly && subMode && !player.isInjured 
                               ? () => { if (touchHandledRef.current) { touchHandledRef.current = false; return; } handlePlayerClick(player.id, false); }
                               : !readOnly && !subMode && !swapMode
                                 ? () => {
                                     if (touchHandledRef.current) { touchHandledRef.current = false; return; }
                                     const now = Date.now();
                                     const last = lastTapRef.current;
                                     if (last && last.playerId === player.id && now - last.time < 400) {
                                       lastTapRef.current = null;
                                       setBenchInjuryTarget(player.id);
                                       setBenchInjuryConfirmOpen(true);
                                     } else {
                                       lastTapRef.current = { playerId: player.id, time: now };
                                       // Single tap during active game: open BenchToSubDialog for quick "slot in"
                                       if (gameInProgress && !player.isInjured && playersOnPitch.length > 0) {
                                         setBenchToSubPlayer(player.id);
                                         setBenchToSubOpen(true);
                                       }
                                     }
                                   }
                                 : undefined
                           }
                            onInjuryToggle={undefined}
                            onRemoveFillIn={!subMode && !swapMode && player.isFillIn ? () => handleRemoveFillInPlayer(player.id) : undefined}
                            isDragging={draggedPlayer === player.id || touchDragPlayer === player.id || benchDragPlayer === player.id}
                            isSelected={subMode && selectedOnBench === player.id}
                            isSubTarget={subMode && selectedOnPitch !== null && selectedOnBench !== player.id && !player.isInjured}
                            subAnimation={subAnimationPlayers.out === player.id ? "out" : null}
                            variant="bench"
                            readOnly={readOnly}
                            teamColor={getPlayerTeamColor(player)}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Subs Tab */}
                {bottomSheetTab === "subs" && (
                  <div className="space-y-3">
                    {!readOnly && (
                      <>
                        {/* Auto-Subs section - shown first */}
                        {!disableAutoSubs && !subMode && !swapMode && (
                          <div className={cn(autoSubActive && "pb-2 border-b border-border")}>
                            {!autoSubActive ? (
                              <Button 
                                variant="outline" 
                                className="w-full h-12 text-base" 
                                onClick={handleOpenNewPlan}
                              >
                                <Calendar className="h-4 w-4 mr-1.5" />
                                Auto-Subs
                              </Button>
                            ) : (
                              <Suspense fallback={<DialogLoader />}>
                                <AutoSubManager
                                  autoSubPlan={autoSubPlan}
                                  autoSubPaused={autoSubPaused}
                                  players={players}
                                  lockedPlayerIds={lockedPlayerIds}
                                  currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
                                  currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
                                  minutesPerHalf={minutesPerHalf}
                                  onTogglePause={handleTogglePauseAutoSub}
                                  onCancelPlan={handleCancelAutoSubPlan}
                                  onSkipNext={handleSkipNextSub}
                                  onExecuteNow={handleExecuteNow}
                                  onEditPlan={handleOpenEditPlan}
                                  onRegeneratePlan={handleRegeneratePlan}
                                  onToggleLockPlayer={handleToggleLockPlayer}
                                />
                              </Suspense>
                            )}
                          </div>
                        )}

                        {/* Make Sub / Swap - shown when not in a mode */}
                        {!subMode && !swapMode && (
                          <>
                            <Button
                              variant="outline"
                              className="w-full h-12 text-base"
                              onClick={() => { toggleSubMode(); setPortraitSheetOpen(false); }}
                            >
                              <RefreshCw className="h-4 w-4 mr-1.5" />
                              Make Sub
                            </Button>

                            {playersOnPitch.length >= 2 && (
                              <Button
                                variant="outline"
                                className="w-full h-12 text-base"
                                onClick={() => { toggleSwapMode(); setPortraitSheetOpen(false); }}
                              >
                                <ArrowLeftRight className="h-4 w-4 mr-1.5" />
                                Swap Positions
                              </Button>
                            )}
                          </>
                        )}

                        {!readOnly && undoHistory.length > 0 && showFloatingUndo && (
                          <Button variant="outline" className="w-full h-10 text-sm" onClick={handleUndo}>
                            <Undo2 className="h-4 w-4 mr-1.5" />
                            Undo Last
                          </Button>
                        )}

                        {/* Sub/Swap mode active UI */}
                        {(subMode || swapMode) && (
                          <>
                            <Button
                              variant="default"
                              className="w-full h-11 text-sm"
                              onClick={() => { subMode ? toggleSubMode() : toggleSwapMode(); setPortraitSheetOpen(false); }}
                            >
                              {subMode ? <><RefreshCw className="h-4 w-4 mr-1.5" />Cancel Sub</> : <><ArrowLeftRight className="h-4 w-4 mr-1.5" />Cancel Swap</>}
                            </Button>
                            {subMode && selectedOnPitch && (
                              <Button variant="outline" className="w-full h-10 text-xs" onClick={() => setSubPreviewOpen(true)}>
                                <List className="h-3.5 w-3.5 mr-1.5" />
                                Sub Options
                              </Button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Setup Tab */}
                {bottomSheetTab === "setup" && (
                  <div className="space-y-3 px-1">
                    {/* Tactical Mode Selector */}
                    <TacticalModeSelector value={tacticalMode} onChange={handleTacticalModeChange} readOnly={readOnly} />
                    {tacticalFormationSuggestion && (
                      <div className="rounded-lg border border-border bg-muted/60 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-foreground">
                            Suggested for <span className="font-semibold">{tacticalFormationSuggestion.mode === "attack" ? "Attack" : "Defend"}</span>: <span className="font-semibold">{tacticalFormationSuggestion.formationName}</span>
                          </p>
                          <button type="button" onClick={handleDismissTacticalSuggestion} className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss formation suggestion">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button type="button" size="sm" className="h-8" onClick={handleApplyTacticalSuggestion}>Apply formation</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={handleDismissTacticalSuggestion}>Dismiss</Button>
                        </div>
                      </div>
                    )}
                    {/* Segmented controls for core settings - portrait */}
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Players</Label>
                        <div className="flex rounded-lg border border-border overflow-hidden">
                          {(["3","4","5","6","7","8","9","10","11"] as const).map((size) => (
                            <button
                              key={size}
                              type="button"
                              disabled={readOnly}
                              onClick={() => handleTeamSizeChange(size)}
                              className={cn(
                                "flex-1 py-2 text-sm font-medium transition-colors min-w-0",
                                teamSize === size
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Formation</Label>
                        <div className="flex rounded-lg border border-border overflow-hidden">
                          {FORMATIONS[teamSize].map((f, i) => (
                            <button
                              key={i}
                              type="button"
                              disabled={readOnly}
                              onClick={() => handleFormationChange(i.toString())}
                              className={cn(
                                "flex-1 py-2 text-sm font-medium transition-colors",
                                selectedFormation === i
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Primary actions - context-aware */}
                    <div className="grid grid-cols-2 gap-2">
                      {!readOnly && !miniLeagueTeams && !gameInProgress && (
                        <Button variant="outline" className="h-11 text-sm" onClick={() => setShowLineupPicker(true)}>
                          <List className="h-4 w-4 mr-1.5" />
                          Select Lineup
                        </Button>
                      )}
                      <Button variant="outline" className="h-11 text-sm" onClick={() => setStatsOpen(true)}>
                        <BarChart3 className="h-4 w-4 mr-1.5" />
                        Stats
                      </Button>
                      {!readOnly && (
                        <Button variant="outline" className="h-11 text-sm" onClick={handleResetFormation}>
                          <RotateCcw className="h-4 w-4 mr-1.5" />
                          Reset Formation
                        </Button>
                      )}
                    </div>

                    {/* More Options - collapsible */}
                    {!readOnly && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center justify-center w-full py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors gap-1.5">
                          <span>More Options</span>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-2 pt-1">
                          <div className="grid grid-cols-2 gap-2">
                            <Button variant="outline" className="h-10 text-sm" onClick={() => setPositionEditorOpen(true)}>
                              <Settings2 className="h-4 w-4 mr-1.5" />
                              Positions
                            </Button>
                            <Suspense fallback={null}>
                              <AddFillInPlayerDialog
                                onAddPlayer={handleAddFillInPlayer}
                                existingNumbers={existingJerseyNumbers}
                              />
                            </Suspense>
                          </div>
                          {parseInt(teamSize) >= 7 && (
                            <div className="flex items-center justify-between py-1">
                              <Label className="text-sm">Rotate GK at Halftime</Label>
                              <Switch checked={rotateGkAtHalftime} onCheckedChange={setRotateGkAtHalftime} />
                            </div>
                          )}
                          <div className="flex items-center justify-between py-1">
                            <Label className="text-sm">Hide Scores</Label>
                            <Switch checked={hideScores} onCheckedChange={setHideScores} />
                          </div>
                          <div className="flex items-center justify-between py-1">
                            <Label className="text-sm">Starting Lineup Screen</Label>
                            <Switch checked={showLineupPickerSetting} onCheckedChange={handleShowLineupPickerSettingChange} />
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Reset Game - always visible at bottom */}
                    {!readOnly && (
                      <Button variant="outline" className="w-full h-12 text-base text-destructive" onClick={() => setResetGameConfirmOpen(true)}>
                        <RotateCcw className="h-4.5 w-4.5 mr-2" />
                        Reset Game
                      </Button>
                    )}
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {/* Sub mode instruction banner - always anchored above bottom sheet/edge */}
        {subMode && (
          <div
            className={cn(
              "absolute z-[62] px-4 py-2 rounded-full shadow-lg animate-fade-in pointer-events-none",
              "bg-primary text-primary-foreground"
            )}
            style={{
              left: 12,
              right: 12,
              bottom: portraitSheetOpen ? `calc(${portraitSheetHeightPct}% + 8px)` : 12,
            }}
          >
            <p className="text-sm font-medium text-center">
              {!selectedOnPitch 
                ? "Tap player on pitch to sub off" 
                : "Tap bench player to sub on"
              }
            </p>
          </div>
        )}

        {/* Swap mode instruction banner - always anchored above bottom sheet/edge */}
        {swapMode && (
          <div
            className={cn(
              "absolute z-[62] px-4 py-2 rounded-full shadow-lg animate-fade-in pointer-events-none",
              swapPlayer1 && getValidSwapPlayerIds.size === 0 
                ? "bg-destructive text-destructive-foreground" 
                : "bg-primary text-primary-foreground"
            )}
            style={{
              left: 12,
              right: 12,
              bottom: portraitSheetOpen ? `calc(${portraitSheetHeightPct}% + 8px)` : 12,
            }}
          >
            <p className="text-sm font-medium text-center">
              {!swapPlayer1 
                ? "Tap first player to swap" 
                : getValidSwapPlayerIds.size === 0
                  ? "No valid swap targets"
                  : "Tap second player to swap with"
              }
            </p>
          </div>
        )}

        {/* Bench drag floating indicator */}
        {benchDragPlayer && benchDragPos && (
          <div 
            className="fixed z-[100] pointer-events-none animate-scale-in"
            style={{ left: benchDragPos.x - 30, top: benchDragPos.y - 40 }}
          >
            <div className="w-[60px] h-[60px] rounded-full bg-primary border-2 border-primary-foreground shadow-2xl flex items-center justify-center animate-pulse">
              <span className="text-primary-foreground text-xs font-bold text-center leading-tight px-1 truncate">
                {players.find(p => p.id === benchDragPlayer)?.name?.split(' ')[0] || '?'}
              </span>
            </div>
            <div className="text-center mt-0.5">
              <span className="text-[9px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full shadow-lg">
                Drop on pitch
              </span>
            </div>
          </div>
        )}

        {/* The Pitch */}
        <div 
          id="portrait-pitch-area"
          className="w-full h-full"
          onWheel={handleWheel}
        >
          <div 
            className={cn(
              "w-full h-full origin-center transition-transform duration-100",
              drawingTool === "none" ? "touch-none" : ""
            )}
            onDrop={handlePitchDrop}
            onDragOver={handleDragOver}
            onTouchStart={drawingTool === "none" ? handlePitchTouchStart : undefined}
            onTouchMove={drawingTool === "none" ? handlePitchTouchMove : undefined}
            onTouchEnd={drawingTool === "none" ? handlePitchTouchEnd : undefined}
            style={{
              background: `linear-gradient(to bottom, 
                hsl(var(--pitch-green) / 0.85) 0%, 
                hsl(var(--pitch-green)) 50%, 
                hsl(var(--pitch-green) / 0.85) 100%)`,
              transform: `scale(${zoom})`,
            }}
          >
            {/* Pitch markings */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <circle cx="50" cy="50" r="12" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <circle cx="50" cy="50" r="0.8" fill="white" opacity="0.7" />
              <rect x="30" y="2" width="40" height="12" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <rect x="38" y="2" width="24" height="5" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <path d="M 38 14 Q 50 20 62 14" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <rect x="30" y="86" width="40" height="12" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <rect x="38" y="93" width="24" height="5" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
              <path d="M 38 86 Q 50 80 62 86" fill="none" stroke="white" strokeWidth="0.3" opacity="0.7" />
            </svg>

            {/* Swap mode line connecting two players */}
            {swapMode && swapPlayer1 && swapPlayer2 && (() => {
              const p1 = playersOnPitch.find(p => p.id === swapPlayer1);
              const p2 = playersOnPitch.find(p => p.id === swapPlayer2);
              if (!p1?.position || !p2?.position) return null;
              const midX1 = (p1.position.x * 2 + p2.position.x) / 3;
              const midY1 = (p1.position.y * 2 + p2.position.y) / 3;
              const midX2 = (p1.position.x + p2.position.x * 2) / 3;
              const midY2 = (p1.position.y + p2.position.y * 2) / 3;
              const dx = p2.position.x - p1.position.x;
              const dy = p2.position.y - p1.position.y;
              const angle = Math.atan2(dy, dx) * (180 / Math.PI);
              return (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-25" style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="swapLineGradientPortrait" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                  <line x1={`${p1.position.x}%`} y1={`${p1.position.y}%`} x2={`${p2.position.x}%`} y2={`${p2.position.y}%`} stroke="url(#swapLineGradientPortrait)" strokeWidth="3" strokeDasharray="8 4" strokeLinecap="round" className="animate-pulse" />
                  <g transform={`translate(${midX1}%, ${midY1}%)`}><polygon points="-6,-4 6,0 -6,4" fill="#f59e0b" transform={`rotate(${angle})`} className="animate-pulse" /></g>
                  <g transform={`translate(${midX2}%, ${midY2}%)`}><polygon points="-6,-4 6,0 -6,4" fill="#f59e0b" transform={`rotate(${angle + 180})`} className="animate-pulse" /></g>
                  <circle cx={`${p1.position.x}%`} cy={`${p1.position.y}%`} r="6" fill="#f59e0b" opacity="0.6" />
                  <circle cx={`${p2.position.x}%`} cy={`${p2.position.y}%`} r="6" fill="#f59e0b" opacity="0.6" />
                </svg>
              );
            })()}

            {/* Drawing canvas layer */}
            <div 
              ref={!isLandscape ? containerRef : undefined}
              className="absolute inset-0 w-full h-full"
              style={{
                zIndex: drawingTool !== "none" ? 65 : 5,
                pointerEvents: drawingTool !== "none" ? "auto" : "none",
                touchAction: "none",
              }}
            >
              <canvas ref={!isLandscape ? canvasRef : undefined} className="w-full h-full" style={{ touchAction: "none" }} />
            </div>

            {/* Ball */}
            <SoccerBall
              size={28}
              isDragging={isDraggingBall}
              draggable
              onDragStart={handleBallDragStart}
              onDrag={handleBallDrag}
              onDragEnd={handleBallDragEnd}
              onTouchStart={handleBallTouchStart}
              onTouchMove={handleBallTouchMove}
              onTouchEnd={handleBallTouchEnd}
              readOnly={readOnly}
              className="absolute"
              style={{
                left: `${ballPosition.x + ballOffset.dx}%`,
                top: `${ballPosition.y + ballOffset.dy}%`,
                transform: "translate(-50%, -50%)",
                zIndex: 40,
                transition: tacticalMode !== "neutral" ? "left 0.4s ease, top 0.4s ease" : undefined,
              }}
            />

            {/* Players on pitch */}
            {playersOnPitch.map(player => (
              <PlayerToken
                key={player.id}
                player={player}
                onDragStart={() => !subMode && !swapMode && !readOnly && handleDragStart(player.id)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => {
                  if (readOnly) return;
                  touchHandledRef.current = true;
                  if (subMode || swapMode) {
                    handlePlayerClick(player.id, true);
                    return;
                  }
                  const now = Date.now();
                  const last = lastTapRef.current;
                  if (last && last.playerId === player.id && now - last.time < 400) {
                    lastTapRef.current = null;
                    e.preventDefault();
                    setTouchDragPlayer(null);
                    setTouchOffset(null);
                    setPitchPlayerActionTarget(player.id);
                    setPitchPlayerActionOpen(true);
                  } else {
                    lastTapRef.current = { playerId: player.id, time: now };
                    handleTouchStart(player.id, e);
                  }
                }}
                onClick={!readOnly ? () => { if (touchHandledRef.current) { touchHandledRef.current = false; return; } handlePlayerClick(player.id, true); } : undefined}
                isDragging={draggedPlayer === player.id || touchDragPlayer === player.id}
                isSelected={(subMode && selectedOnPitch === player.id) || (swapMode && (swapPlayer1 === player.id || swapPlayer2 === player.id))}
                isSubTarget={subMode && !selectedOnPitch && selectedOnPitch !== player.id}
                isInvalidTarget={swapMode && swapPlayer1 !== null && swapPlayer1 !== player.id && !getValidSwapPlayerIds.has(player.id)}
                isMovable={movablePitchPlayerIds.has(player.id)}
                isPreviewHighlight={previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id}
                previewHighlightType={previewSwapPlayers.sourceId === player.id ? "source" : previewSwapPlayers.targetId === player.id ? "target" : null}
                subAnimation={subAnimationPlayers.in === player.id ? "in" : null}
                readOnly={readOnly}
                teamColor={getPlayerTeamColor(player)}
                style={{
                  position: "absolute",
                  ...(() => {
                    const isDragging = draggedPlayer === player.id || touchDragPlayer === player.id;
                    const offset = !isDragging ? tacticalOffsets.get(player.id) : undefined;
                    const tx = offset?.dx ?? 0;
                    const ty = offset?.dy ?? 0;
                    return {
                      left: `${player.position!.x + tx}%`,
                      top: `${player.position!.y + ty}%`,
                      transform: "translate(-50%, -50%)",
                      transition: isDragging ? "none" : "left 0.4s ease-out, top 0.4s ease-out",
                    };
                  })(),
                  zIndex: previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id ? 30 : (touchDragPlayer === player.id ? 50 : 10),
                  cursor: readOnly ? "default" : ((subMode || swapMode) ? "pointer" : "grab"),
                }}
              />
            ))}

            {/* Preview swap arrow overlay */}
            {previewSwapPlayers.sourceId && previewSwapPlayers.targetId && (() => {
              const sourcePlayer = playersOnPitch.find(p => p.id === previewSwapPlayers.sourceId);
              const targetPlayer = playersOnPitch.find(p => p.id === previewSwapPlayers.targetId);
              if (!sourcePlayer?.position || !targetPlayer?.position) return null;
              const x1 = targetPlayer.position.x, y1 = targetPlayer.position.y;
              const x2 = sourcePlayer.position.x, y2 = sourcePlayer.position.y;
              return (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-20" style={{ overflow: 'visible' }}>
                  <defs>
                    <marker id="preview-arrowhead-portrait" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                      <polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" />
                    </marker>
                  </defs>
                  <line x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} stroke="#22d3ee" strokeWidth="3" strokeDasharray="8 4" markerEnd="url(#preview-arrowhead-portrait)" className="animate-pulse" style={{ strokeLinecap: 'round', filter: 'drop-shadow(0 0 4px rgba(34, 211, 238, 0.6))' }} />
                  <text x={`${(x1 + x2) / 2}%`} y={`${(y1 + y2) / 2 - 2}%`} textAnchor="middle" className="fill-cyan-400 text-[10px] font-bold" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.8)', strokeWidth: '3px' }}>
                    → {sourcePlayer.currentPitchPosition}
                  </text>
                </svg>
              );
            })()}
          </div>
        </div>
      </div>
      {/* Position Editor Dialog */}
      <PlayerPositionEditor
        open={positionEditorOpen}
        onOpenChange={setPositionEditorOpen}
        players={players}
        onUpdatePositions={handleUpdatePositions}
      />

      {/* Position Swap Dialog */}
      <PositionSwapDialog
        open={positionSwapDialogOpen}
        onOpenChange={setPositionSwapDialogOpen}
        benchPlayer={players.find(p => p.id === pendingSubBenchPlayer) || null}
        pitchPlayers={playersOnPitch}
        requiredPosition={requiredPosition}
        onSwapAndSubstitute={handleSwapAndSubstitute}
        onCancel={() => {
          setPositionSwapDialogOpen(false);
          setPendingSubBenchPlayer(null);
          setRequiredPosition(null);
        }}
      />

      {/* Substitution Preview Dialog */}
      <SubstitutionPreviewDialog
        open={subPreviewOpen}
        onOpenChange={(open) => {
          setSubPreviewOpen(open);
          if (!open) {
            setSelectedOnPitch(null);
            setSelectedOnBench(null);
            setPreviewSwapPlayers({ sourceId: null, targetId: null });
          }
        }}
        pitchPlayer={players.find(p => p.id === selectedOnPitch) || null}
        benchPlayers={playersOnBench}
        allPitchPlayers={playersOnPitch}
        onSelectOption={handleSubPreviewSelect}
        miniLeagueTeams={miniLeagueTeams}
      />

      {/* Bench-to-Pitch Substitution Dialog */}
      <Suspense fallback={null}>
        <BenchToSubDialog
          open={benchToSubOpen}
          onOpenChange={(open) => {
            setBenchToSubOpen(open);
            if (!open) setBenchToSubPlayer(null);
          }}
          benchPlayer={players.find(p => p.id === benchToSubPlayer) || null}
          allPitchPlayers={playersOnPitch}
          onSelectOption={handleBenchToSubSelect}
          miniLeagueTeams={miniLeagueTeams}
        />
      </Suspense>

      {/* Pitch Player Action Menu (injury on pitch) */}
      <Suspense fallback={null}>
        <PitchPlayerActionMenu
          open={pitchPlayerActionOpen}
          onOpenChange={(open) => {
            setPitchPlayerActionOpen(open);
            if (!open) setPitchPlayerActionTarget(null);
          }}
          player={players.find(p => p.id === pitchPlayerActionTarget) || null}
          benchPlayers={players.filter(p => p.position === null)}
          onMarkInjured={handleMarkInjuredOnPitch}
        />
      </Suspense>

      {/* Reset Game Confirmation */}
      {resetGameConfirmOpen && createPortal(
        <div className="fixed inset-0 z-[999998] bg-black/80 animate-in fade-in-0" onClick={() => setResetGameConfirmOpen(false)} />,
        document.body
      )}
      {resetGameConfirmOpen && createPortal(
        <div className="fixed left-[50%] top-[50%] z-[999999] grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg rounded-lg animate-in fade-in-0 zoom-in-95">
          <div className="flex flex-col space-y-2 text-center sm:text-left">
            <h2 className="text-lg font-semibold">Reset Game?</h2>
            <p className="text-sm text-muted-foreground">
              This will clear all player minutes, timer, substitutions, goals, and reset positions. This action cannot be undone.
            </p>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            <Button variant="outline" className="mt-2 sm:mt-0" onClick={() => setResetGameConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => { handleResetGame(); setResetGameConfirmOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Reset Game
            </Button>
          </div>
        </div>,
        document.body
      )}

      {/* Bench Injury Confirmation */}
      {benchInjuryConfirmOpen && createPortal(
        <div className="fixed inset-0 z-[999998] bg-black/80 animate-in fade-in-0" />,
        document.body
      )}
      {benchInjuryConfirmOpen && benchInjuryTarget && createPortal(
        <div className="fixed left-[50%] top-[50%] z-[999999] grid w-[calc(100%-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg rounded-lg animate-in fade-in-0 zoom-in-95">
          <div className="flex flex-col space-y-2 text-center sm:text-left">
            <h2 className="text-lg font-semibold">
              {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark as Fit?" : "Mark as Injured?"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {players.find(p => p.id === benchInjuryTarget)?.isInjured
                ? `${players.find(p => p.id === benchInjuryTarget)?.name} will be available for substitutions again.`
                : `${players.find(p => p.id === benchInjuryTarget)?.name} will not be available for substitutions.`}
            </p>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            <Button variant="outline" className="mt-2 sm:mt-0" onClick={() => { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                togglePlayerInjury(benchInjuryTarget);
                setBenchInjuryConfirmOpen(false);
                setBenchInjuryTarget(null);
              }}
            >
              {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark Fit" : "Mark Injured"}
            </Button>
          </div>
        </div>,
        document.body
      )}

      <FormationChangeDialog
        open={formationChangeDialogOpen}
        onOpenChange={setFormationChangeDialogOpen}
        currentFormation={FORMATIONS[teamSize][selectedFormation]?.name || ""}
        newFormation={pendingFormationChange ? FORMATIONS[pendingFormationChange.newTeamSize || teamSize][pendingFormationChange.index]?.name || "" : ""}
        positionSwaps={pendingFormationChange?.positionSwaps || []}
        benchMoves={pendingFormationChange?.benchMoves || []}
        onConfirm={handleFormationChangeConfirm}
        onCancel={handleFormationChangeCancel}
        isTeamSizeChange={!!pendingFormationChange?.newTeamSize}
        currentTeamSize={teamSize}
        newTeamSize={pendingFormationChange?.newTeamSize}
      />

      {/* Auto-Sub Plan Dialog */}
      <AutoSubPlanDialog
        open={autoSubPlanDialogOpen}
        onOpenChange={setAutoSubPlanDialogOpen}
        players={players}
        teamSize={parseInt(teamSize)}
        minutesPerHalf={minutesPerHalf}
        onStartPlan={handleStartAutoSubPlan}
        existingPlan={autoSubActive ? autoSubPlan : undefined}
        editMode={autoSubPlanEditMode}
        rotationSpeed={rotationSpeed}
        disablePositionSwaps={disablePositionSwaps}
        disableBatchSubs={disableBatchSubs}
        rotateGkAtHalftime={rotateGkAtHalftime}
        showStepper={autoSubFromPreGame}
      />

      {/* Sub Confirm Dialog */}
      <SubConfirmDialog
        open={subConfirmDialogOpen}
        onOpenChange={setSubConfirmDialogOpen}
        substitution={pendingAutoSub}
        batchSubstitutions={pendingBatchSubs}
        onConfirm={handleConfirmAutoSub}
        onSkip={handleSkipAutoSub}
        players={players}
      />

      {/* Manual Sub Confirm Dialog */}
      <ManualSubConfirmDialog
        open={manualSubConfirmOpen}
        onOpenChange={setManualSubConfirmOpen}
        playerOut={players.find(p => p.id === pendingManualSub?.pitchPlayerId) || null}
        playerIn={players.find(p => p.id === pendingManualSub?.benchPlayerId) || null}
        positionSwap={pendingManualSub?.swapPlayerId ? (() => {
          const pitchPlayer = players.find(p => p.id === pendingManualSub.pitchPlayerId);
          const swapPlayer = players.find(p => p.id === pendingManualSub.swapPlayerId);
          if (!swapPlayer || !pitchPlayer?.currentPitchPosition || !swapPlayer.currentPitchPosition) return null;
          return {
            player: swapPlayer,
            fromPosition: swapPlayer.currentPitchPosition,
            toPosition: pitchPlayer.currentPitchPosition,
          };
        })() : null}
        onConfirm={handleConfirmManualSub}
        onCancel={handleCancelManualSub}
      />

      {/* Pitch Position Swap Confirm Dialog */}
      <PitchSwapConfirmDialog
        open={pitchSwapConfirmOpen}
        onOpenChange={setPitchSwapConfirmOpen}
        player1={players.find(p => p.id === swapPlayer1) || null}
        player2={players.find(p => p.id === swapPlayer2) || null}
        allPitchPlayers={players.filter(p => p.position !== null)}
        onConfirm={handleConfirmPitchSwap}
        onCancel={handleCancelPitchSwap}
        onConfirmWithAccommodation={handleConfirmPitchSwapWithAccommodation}
      />

      {/* Swap Before Sub Dialog (step 1 of swap-based substitution) */}
      <PitchSwapConfirmDialog
        open={swapBeforeSubDialogOpen}
        onOpenChange={(open) => {
          // Only cancel if user explicitly closes dialog (not on confirm)
          if (!open && swapBeforeSubDialogOpen) {
            // Don't cancel if we're transitioning to sub dialog
            // The cancel handler will be called by onCancel button
          }
        }}
        player1={players.find(p => p.id === pendingSwapBasedSub?.swapPlayerId) || null}
        player2={players.find(p => p.id === pendingSwapBasedSub?.pitchPlayerId) || null}
        onConfirm={handleConfirmSwapBeforeSub}
        onCancel={handleCancelSwapBasedSub}
      />

      {/* Sub After Swap Dialog (step 2 of swap-based substitution) */}
      <ManualSubConfirmDialog
        open={subAfterSwapDialogOpen}
        onOpenChange={(open) => {
          // Only cancel if user explicitly closes dialog via X button (not on confirm)
          // The cancel handler will be called by onCancel button
        }}
        playerOut={players.find(p => p.id === pendingSwapBasedSub?.pitchPlayerId) || null}
        playerIn={players.find(p => p.id === pendingSwapBasedSub?.benchPlayerId) || null}
        onConfirm={handleConfirmSubAfterSwap}
        onCancel={handleCancelSwapBasedSub}
      />

      {/* Match Stats Panel */}
      <MatchStatsPanel
        open={statsOpen}
        onOpenChange={setStatsOpen}
        players={players}
        elapsedGameTime={gameTimerRef.current?.getElapsedSeconds() || 0}
        goals={goals}
        teamName={teamName}
        opponentName={opponentName}
        hideScores={hideScores}
      />
      {/* Pre-Game Lineup Screen */}
      {showLineupPicker && (
        <Suspense fallback={<DialogLoader />}>
          <PreGameLineupScreen
            players={players}
            teamSize={teamSize}
            selectedFormation={selectedFormation}
            rotateGkAtHalftime={rotateGkAtHalftime}
            onConfirm={handleLineupConfirm}
            onSkip={handleLineupSkip}
            onClose={() => setShowLineupPicker(false)}
            onTeamSizeChange={(size) => setTeamSize(size)}
            onFormationChange={(index) => setSelectedFormation(index)}
          />
        </Suspense>
      )}
    </div>,
    document.body
  );
}
