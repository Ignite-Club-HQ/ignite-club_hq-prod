import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { refreshStatusBar } from "@/lib/statusBarControl";
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
import { Pencil, Eraser, Trash2, ArrowLeft, RotateCcw, MoveRight, Save, FolderOpen, Loader2, ZoomIn, ZoomOut, X, RefreshCw, Users, Settings2, List, Clock, Calendar, BarChart3, Pause, Play, ChevronUp, ChevronLeft, ChevronRight, ChevronDown, Eye, ArrowLeftRight, Undo2, Flame, Shield, Circle, Swords, Pin, Link2, Settings, UserCog, ClipboardList, Check, UserPlus } from "lucide-react";
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
const AutoSubControlPanel = lazy(() => import("./AutoSubControlPanel"));
const PreGameLineupScreen = lazy(() => import("./PreGameLineupScreen"));
import TacticalModeSelector from "./TacticalModeSelector";
import { useAutoSubs } from "@/hooks/useAutoSubs";
import { usePitchSettings } from "@/hooks/usePitchSettings";
import { useDraggableTimer } from "@/hooks/useDraggableTimer";
import { PitchSettingsDialog } from "./PitchSettingsDialog";
import { TrainingSettingsDialog } from "./training/TrainingSettingsDialog";

import { useToast } from "@/hooks/use-toast";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePitchBoardNotifications } from "@/hooks/usePitchBoardNotifications";
import { useIsLandscape } from "@/hooks/useIsLandscape";
import { useEventGroupSync } from "@/hooks/useEventGroupSync";
import { hapticImpactMedium } from "@/lib/haptics";

// Import types and utils from extracted files
import { 
  Player, 
  SubstitutionEvent, 
  TeamSize, 
  DrawingTool,
  Goal,
  FORMATIONS,
  getPositionFromCoords,
  getSpecificPositionLabel,
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
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan
} from "./pitchStateUtils";
import { getCurrentGameSeconds } from "./timerUtils";
import { TacticalMode, computeTacticalOffsets, computeBallOffset, TACTICAL_MODE_LABELS, RECOMMENDED_FORMATIONS } from "./tacticalMode";
import { type PitchBoardMode } from "./ModeSwitch";
const TrainingBoard = lazy(() => import("./training/TrainingBoard"));

const SAVED_DEFAULT_TEAM_SIZES: TeamSize[] = ["3", "4", "5", "7", "9", "11"];
const isSavedDefaultTeamSize = (value: string): value is TeamSize => SAVED_DEFAULT_TEAM_SIZES.includes(value as TeamSize);

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
  initialMaxSpreadMinutes?: number;
  initialTeamSize?: number;
  initialFormation?: string;
  readOnly?: boolean;
  isSubsManager?: boolean;
  initialLinkedEventId?: string | null;
  initialShowMatchHeader?: boolean;
  initialShowLineupPicker?: boolean;
  // Initial board mode — defaults to "match". Pass "training" when launched
  // from a Training event so coaches land directly on the drill board.
  initialMode?: PitchBoardMode;
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

export default function PitchBoard({ teamId, teamName, members, onClose, disableAutoSubs = false, initialRotationSpeed = 1, initialDisablePositionSwaps = false, initialDisableBatchSubs = false, initialRotateGkAtHalftime = true, initialMinutesPerHalf = 10, initialMaxSpreadMinutes = 5, initialTeamSize, initialFormation, readOnly = false, isSubsManager = false, initialLinkedEventId, initialShowMatchHeader = true, initialShowLineupPicker = true, initialMode = "match", miniLeagueTeams }: PitchBoardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { pitchBoardNotificationsEnabled } = usePitchBoardNotifications();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLandscape, isMobileLandscape } = useIsLandscape();

  // Hide status bar in landscape on native to fill the whole screen
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const hideOrShow = async () => {
      try {
        if (isLandscape) {
          await StatusBar.hide();
        } else {
          // refreshStatusBar internally calls StatusBar.show() and re-applies
          // the correct theme-aware style/background in the right order.
          refreshStatusBar();
        }
      } catch (e) {
        console.warn('[PitchBoard] StatusBar toggle error:', e);
      }
    };
    hideOrShow();
    return () => {
      if (Capacitor.isNativePlatform()) {
        // Always restore the theme-aware status bar on unmount.
        refreshStatusBar();
      }
    };
  }, [isLandscape]);

  // Event group sync - syncs pitch board state to database for mini-league matches
  const { forceSync: forceEventGroupSync, isEventGroup } = useEventGroupSync(teamId, null);
  
  // State initialization flag
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Load saved state once for initialization
  // Use a sentinel to distinguish "not yet loaded" from "loaded but no state found"
  const savedStateLoadedRef = useRef(false);
  const savedStateRef = useRef<PitchBoardState | null>(null);
  if (!savedStateLoadedRef.current) {
    savedStateLoadedRef.current = true;
    const loaded = loadPitchState(teamId);
    savedStateRef.current = loaded;
    console.log("[PitchState] Initial load result:", loaded ? "found" : "not found", "teamId:", teamId);
  }
  const savedState = savedStateRef.current;
  
  // Pre-initialize time-tracking refs based on saved timer state.
  // This prevents handleTimerUpdate from re-adding time that was already
  // captured in savedState.players[].minutesPlayed (+ catchup).
  // Without this, GameTimer initializes with elapsedSeconds=0, fires
  // handleTimerUpdate(0), then restores to the full elapsed time, causing
  // handleTimerUpdate to add a delta equal to the entire game duration — doubling minutes.
  const lastTimeUpdateRef = useRef<{ seconds: number; half: 1 | 2 } | null>(null);
  const hasInitializedTimeRef = useRef(false);
  if (savedState && !hasInitializedTimeRef.current) {
    const timerNow = loadTimerStateForMinutes(teamId);
    if (timerNow) {
      const halfElapsed = getCurrentGameSeconds(timerNow);
      const currentHalf = (timerNow.currentHalf || 1) as 1 | 2;
      lastTimeUpdateRef.current = { seconds: halfElapsed, half: currentHalf };
      hasInitializedTimeRef.current = true;
      console.log("[PitchState] Pre-initialized time ref:", { halfElapsed, currentHalf });
    }
  }
  
  // Determine initial team size - prefer saved state, then DB value, then default
  const getInitialTeamSize = (): TeamSize => {
    if (savedState?.teamSize) return savedState.teamSize;
    const candidateSize = String(initialTeamSize || "");
    if (candidateSize && isSavedDefaultTeamSize(candidateSize)) {
      return candidateSize;
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
  
  // Lazy load Fabric.js - initialize when drawing mode is enabled
  const drawingEnabled = drawingTool !== "none";
  const drawingEverEnabledRef = useRef(false);
  if (drawingEnabled) drawingEverEnabledRef.current = true;
  const { 
    canvas: fabricCanvas, 
    isLoading: isFabricLoading, 
    isReady: isFabricReady,
    fabricModule,
    clearCanvas: clearFabricCanvas 
  } = useLazyFabric({
    canvasRef,
    containerRef,
    enabled: drawingEnabled || drawingEverEnabledRef.current,
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
    positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[];
    benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[];
    minorAdjustments?: { player: Player; fromLabel: string; toLabel: string }[];
  } | null>(null);

  // Auto-sub plan state (hook setup happens below after runSubAnimation is defined)
  const gameTimerRef = useRef<GameTimerRef>(null);
  const [autoSubPlanDialogOpen, setAutoSubPlanDialogOpen] = useState(false);
  const [autoSubPlanEditMode, setAutoSubPlanEditMode] = useState(false);
  const [autoSubFromPreGame, setAutoSubFromPreGame] = useState(false);
  const [preferredSecondHalfGkId, setPreferredSecondHalfGkId] = useState<string | undefined>(undefined);

  // Keep `preferredSecondHalfGkId` in sync with the live roster. A nominated
  // 2H GK is allowed to start on pitch as an outfielder, so only clear the
  // preference when the player is gone, injured, or already the 1H GK.
  const [linkedEventId, setLinkedEventId] = useState<string | null>(() => savedState?.linkedEventId || initialLinkedEventId || null);
  const [showMatchHeader, setShowMatchHeader] = useState(() => initialShowMatchHeader);
  const [goals, setGoals] = useState<Goal[]>(() => savedState?.goals || []);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(true); // Start collapsed by default
  const [mode, setModeRaw] = useState<PitchBoardMode>(initialMode); // Match | Training — default Match unless launched from a Training event

  // Temporary access gate: Training mode is restricted to club admins (and app admins)
  // while the feature is being rolled out. Non-admins are forced into Match mode and
  // the Training toggle is hidden in PitchSettingsDialog.
  const { data: canUseTraining = false } = useQuery({
    queryKey: ["pitch-training-access", user?.id, teamId],
    enabled: !!user?.id && !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id || !teamId) return false;
      // App admins always have access
      const { data: appAdminRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .limit(1);
      if (appAdminRows && appAdminRows.length > 0) return true;

      // Resolve the team's club, then check for a club_admin role on that club.
      // Mini-league / event-group "team ids" are synthetic and won't match a real
      // team row — in that case we fall back to any club_admin role for the user.
      const realTeamId = teamId.startsWith("event-group-") ? null : teamId;
      let clubId: string | null = null;
      if (realTeamId) {
        const { data: teamRow } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", realTeamId)
          .maybeSingle();
        clubId = teamRow?.club_id ?? null;
      }

      const query = supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .eq("role", "club_admin");
      const { data: adminRows } = clubId
        ? await query.eq("club_id", clubId).limit(1)
        : await query.limit(1);
      return !!(adminRows && adminRows.length > 0);
    },
  });

  // Wrap setMode so non-admins can never end up in Training mode, even if a
  // stale "training" value is restored from saved state or props.
  const setMode = useCallback((next: PitchBoardMode | ((prev: PitchBoardMode) => PitchBoardMode)) => {
    setModeRaw((prev) => {
      const resolved = typeof next === "function" ? (next as (p: PitchBoardMode) => PitchBoardMode)(prev) : next;
      if (resolved === "training" && !canUseTraining) return "match";
      return resolved;
    });
  }, [canUseTraining]);

  // If access changes (e.g. role revoked while board is open), force back to Match.
  useEffect(() => {
    if (!canUseTraining && mode === "training") {
      setModeRaw("match");
    }
  }, [canUseTraining, mode]);
  const [bottomSheetTab, setBottomSheetTab] = useState<"bench" | "setup">("bench");
  const [showFloatingDrawToolbar, setShowFloatingDrawToolbar] = useState(false);
  const [pinDrawingToolbar, setPinDrawingToolbar] = useState(false);
  const [pinPitchShortcuts, setPinPitchShortcuts] = useState(true);
  const [sheetHeightPct, setSheetHeightPct] = useState(35);
  const sheetDragRef = useRef<{ startY: number; startPct: number } | null>(null);
  const ignoreNextLandscapeBackdropClickRef = useRef(false);
  const ignoreNextLandscapeBenchOpenRef = useRef(false);
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
  const [maxSpreadMinutes, setMaxSpreadMinutes] = useState(() => initialMaxSpreadMinutes); // Max acceptable playing-time spread (minutes)
  const [showLineupPicker, setShowLineupPicker] = useState(() => {
    // Show lineup picker on mount if setting enabled AND linked to a game event AND no saved state (fresh game)
    return initialShowLineupPicker && !!initialLinkedEventId && !savedState && !readOnly && !miniLeagueTeams;
  });
  const [showLineupPickerSetting, setShowLineupPickerSetting] = useState(() => initialShowLineupPicker); // Persist setting
  // Settings ref for usePitchSettings (avoids stale closures)
  const pitchSettingsRef = useRef({
    rotationSpeed,
    disablePositionSwaps,
    disableBatchSubs,
    rotateGkAtHalftime,
    minutesPerHalf,
    maxSpreadMinutes,
    teamSize,
    selectedFormation,
    showMatchHeader,
    showLineupPickerSetting: showLineupPickerSetting,
  });
  // Keep ref in sync
  pitchSettingsRef.current = {
    rotationSpeed,
    disablePositionSwaps,
    disableBatchSubs,
    rotateGkAtHalftime,
    minutesPerHalf,
    maxSpreadMinutes,
    teamSize,
    selectedFormation,
    showMatchHeader,
    showLineupPickerSetting: showLineupPickerSetting,
  };

  const {
    isSavingSettings,
    savedTeamDefaultsRef,
    persistTeamSizeToDb,
    persistFormationToDb,
    persistRotationSpeed,
    persistDisablePositionSwaps,
    persistDisableBatchSubs,
    persistRotateGkAtHalftime,
    persistMinutesPerHalf,
    persistMaxSpreadMinutes,
    persistShowLineupPicker,
    handleSaveSettings,
  } = usePitchSettings({
    teamId,
    readOnly,
    settingsRef: pitchSettingsRef,
  });

  // Initialize saved defaults ref with initial props
  if (!savedTeamDefaultsRef.current.formation) {
    savedTeamDefaultsRef.current = {
      minutesPerHalf: initialMinutesPerHalf,
      rotationSpeed: initialRotationSpeed,
      disablePositionSwaps: initialDisablePositionSwaps,
      disableBatchSubs: initialDisableBatchSubs,
      rotateGkAtHalftime: initialRotateGkAtHalftime,
      maxSpreadMinutes: initialMaxSpreadMinutes,
      teamSize: getInitialTeamSize(),
      formation: initialFormation || null,
    };
  }
  
  // Tactical mode state
  type TacticalFormationSuggestion = {
    mode: Exclude<TacticalMode, "neutral">;
    formationIndex: number;
    formationName: string;
  };
  const [tacticalMode, setTacticalMode] = useState<TacticalMode>("neutral");
  const [tacticalFormationSuggestion, setTacticalFormationSuggestion] = useState<TacticalFormationSuggestion | null>(null);
  
  // Mini-league team selector for formation/tactical changes
  const [selectedTeamForSettings, setSelectedTeamForSettings] = useState<"a" | "b" | "both">("both");

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

  useEffect(() => {
    setMaxSpreadMinutes(initialMaxSpreadMinutes);
  }, [initialMaxSpreadMinutes]);

  // Sync team size and formation from props if no saved state - runs on mount and when props change
  useEffect(() => {
    // Keep local reset defaults in sync with backend defaults
    const candidateSize = String(initialTeamSize || "");
    const nextDefaultSize: TeamSize = isSavedDefaultTeamSize(candidateSize) ? candidateSize : "7";
    savedTeamDefaultsRef.current = {
      minutesPerHalf: initialMinutesPerHalf,
      rotationSpeed: initialRotationSpeed,
      disablePositionSwaps: initialDisablePositionSwaps,
      disableBatchSubs: initialDisableBatchSubs,
      rotateGkAtHalftime: initialRotateGkAtHalftime,
      maxSpreadMinutes: initialMaxSpreadMinutes,
      teamSize: nextDefaultSize,
      formation: initialFormation || null,
    };

    // Only sync if there's no saved state for this team (fresh session)
    if (!savedState && initialTeamSize) {
      const validSize = String(initialTeamSize) as TeamSize;
      if (isSavedDefaultTeamSize(validSize)) {
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
  }, [initialTeamSize, initialFormation, initialMinutesPerHalf, initialRotationSpeed, initialDisablePositionSwaps, initialDisableBatchSubs, initialRotateGkAtHalftime, savedState]);

  // Setting change handlers — update local state and persist via hook
  const handleRotationSpeedChange = useCallback(async (speed: number) => {
    setRotationSpeed(speed);
    await persistRotationSpeed(speed);
  }, [persistRotationSpeed]);

  const handleDisablePositionSwapsChange = useCallback(async (disabled: boolean) => {
    setDisablePositionSwaps(disabled);
    await persistDisablePositionSwaps(disabled);
  }, [persistDisablePositionSwaps]);

  const handleDisableBatchSubsChange = useCallback(async (disabled: boolean) => {
    setDisableBatchSubs(disabled);
    await persistDisableBatchSubs(disabled);
  }, [persistDisableBatchSubs]);

  const handleRotateGkAtHalftimeChange = useCallback(async (enabled: boolean) => {
    setRotateGkAtHalftime(enabled);
    await persistRotateGkAtHalftime(enabled);
  }, [persistRotateGkAtHalftime]);

  const handleMinutesPerHalfChange = useCallback(async (minutes: number) => {
    setMinutesPerHalf(minutes);
    await persistMinutesPerHalf(minutes);
  }, [persistMinutesPerHalf]);

  const handleMaxSpreadMinutesChange = useCallback(async (minutes: number) => {
    setMaxSpreadMinutes(minutes);
    await persistMaxSpreadMinutes(minutes);
  }, [persistMaxSpreadMinutes]);

  const handleShowLineupPickerSettingChange = useCallback(async (enabled: boolean) => {
    setShowLineupPickerSetting(enabled);
    await persistShowLineupPicker(enabled);
  }, [persistShowLineupPicker]);

  const handleLineupConfirm = useCallback((updatedPlayers: Player[], firstHalfGkId?: string, secondHalfGkId?: string) => {
    // Reset player minutes for a fresh game setup.
    // Dedupe by id defensively — duplicate ids here would render the same
    // player twice in the auto-sub planner and projected-minutes view.
    const seen = new Set<string>();
    const freshPlayers = updatedPlayers
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .map(p => ({ ...p, minutesPlayed: 0 }));
    setPlayers(freshPlayers);
    setPreferredSecondHalfGkId(secondHalfGkId);
    if (firstHalfGkId || secondHalfGkId) {
      console.log("[PitchBoard] Lineup confirmed with GK rotation:", { firstHalfGkId, secondHalfGkId });
    }
    // Open auto-sub dialog BEFORE hiding lineup picker to prevent pitch board flash
    setAutoSubPlanEditMode(false);
    setAutoSubFromPreGame(true);
    setAutoSubPlanDialogOpen(true);
    // Hide lineup picker after a brief delay so dialog renders on top
    setTimeout(() => {
      setShowLineupPicker(false);
    }, 100);
  }, []);


  const handleLinkEvent = useCallback(async (eventId: string | null) => {
    const previousLinkedEventId = linkedEventId;
    setLinkedEventId(eventId);
    
    // Only send email notifications when linking (not unlinking) and event is different
    if (eventId && eventId !== previousLinkedEventId && user?.id) {
      try {
        const isEventGroup = teamId.startsWith("event-group-");
        let recipientUserIds: string[] = [];

        if (isEventGroup) {
          // Mini-league: notify Referee + Subs Manager of this specific match
          const groupId = teamId.replace("event-group-", "");
          const { data: matchDuties } = await supabase
            .from('event_group_duties')
            .select('assigned_to')
            .eq('group_id', groupId)
            .in('name', ['Referee', 'Subs Manager'])
            .not('assigned_to', 'is', null);

          recipientUserIds = (matchDuties || [])
            .map((d: any) => d.assigned_to as string)
            .filter(uid => uid && uid !== user.id);
        } else {
          // Regular team: notify coaches/admins + Subs Manager for the linked event
          const { data: teamAdmins } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('team_id', teamId)
            .in('role', ['team_admin', 'coach']);

          const ids = new Set<string>(
            (teamAdmins || [])
              .map((r: any) => r.user_id as string)
              .filter(uid => uid && uid !== user.id)
          );

          if (eventId) {
            const { data: subsManagers } = await supabase
              .from('duties')
              .select('assigned_to')
              .eq('event_id', eventId)
              .eq('name', 'Subs Manager')
              .not('assigned_to', 'is', null);
            (subsManagers || []).forEach((d: any) => {
              if (d.assigned_to && d.assigned_to !== user.id) ids.add(d.assigned_to as string);
            });
          }

          recipientUserIds = Array.from(ids);
        }

        if (recipientUserIds.length > 0) {
          // Get event details for the notification message
          const { data: eventData } = await supabase
            .from('events')
            .select('title')
            .eq('id', eventId)
            .single();
          
          const eventTitle = eventData?.title || 'a game';
          
          for (const recipientUserId of recipientUserIds) {
            supabase.rpc('send_pitch_board_notification_email_rpc', {
              _recipient_user_id: recipientUserId,
              _team_id: teamId,
              _team_name: teamName,
              _notification_type: 'game_linked',
              _notification_message: `The pitch board has been linked to "${eventTitle}"`,
              _event_id: eventId,
            }).then((r: any) => {
              if (r?.error) console.error('[PitchBoard] Failed to send game linked email:', r.error);
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
  
  // Draggable + resizable floating timer (landscape & portrait)
  const {
    floatingTimerPosition,
    floatingTimerScale,
    handleTimerDragStart,
    handleTimerTouchStart,
    portraitTimerPosition,
    portraitTimerScale,
    handlePortraitTimerTouchStart,
  } = useDraggableTimer();

  // Helper to get pinch distance
  const getPinchDist = (touches: React.TouchList | TouchList) => {
    const t0 = touches[0];
    const t1 = touches[1];
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };


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
    const isFinished = gameTimerRef.current?.isGameFinished();
    const isRunning = gameTimerRef.current?.isRunning();
    const elapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    // Only block new plans if game is truly finished (was started and completed)
    if (!editMode && isFinished && elapsed > 0 && !isRunning) {
      toast({ title: "Game has finished", description: "Auto-sub plans can only be created during an active game" });
      return;
    }
    setAutoSubPlanEditMode(editMode === true);
    setAutoSubFromPreGame(false);
    setAutoSubPlanDialogOpen(true);
  }, [toast]);

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
    staleTime: 30 * 1000, // Refetch after 30s to pick up jersey/position changes
    gcTime: 10 * 60 * 1000,
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

  const handleUpdateGoal = useCallback((updatedGoal: Goal) => {
    setGoals(prev => prev.map(g => g.id === updatedGoal.id ? updatedGoal : g));
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
  const realPlayers = useMemo(() => {
    // Dedupe members by user_id first — a person can appear multiple times in
    // `members` if they hold more than one role on the team (e.g. player +
    // team_admin), or if upstream joins fan out duplicate rows. Without this
    // dedupe the lineup setup screen renders the same player multiple times.
    const seen = new Set<string>();
    const uniquePlayers = members.filter((m) => {
      if (m.role !== "player") return false;
      if (!m.user_id || seen.has(m.user_id)) return false;
      seen.add(m.user_id);
      return true;
    });
    return uniquePlayers.map((m, index) => {
      const savedPos = teamPlayerPositions?.find(p => p.user_id === m.user_id || p.child_id === m.user_id);
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
    });
  }, [members, teamPlayerPositions, miniLeagueTeams]);

  const savedPlayers = savedState?.players || [];
  const isStrictMatchEventRoster = !!(initialLinkedEventId || savedState?.linkedEventId) && !miniLeagueTeams;
  const strictMatchRosterPlayerIds = useMemo(
    () => new Set(realPlayers.map((player) => player.id)),
    [realPlayers]
  );
  const savedRosterMissingCurrentPlayers =
    savedPlayers.length > 0 && realPlayers.some((player) => !savedPlayers.some((savedPlayer) => savedPlayer.id === player.id));
  const savedRosterHasPlayersOutsideCurrentRoster =
    isStrictMatchEventRoster &&
    savedPlayers.length > 0 &&
    realPlayers.length > 0 &&
    savedPlayers.some((player) => !strictMatchRosterPlayerIds.has(player.id));
  const savedRosterHasNoPlayersOnPitch =
    savedPlayers.length > 0 && savedPlayers.every((player) => player.position === null);
  const applyStrictMatchRoster = useCallback((sourcePlayers: Player[]): Player[] => {
    // Dedupe by id first — defensive guard against any upstream path that
    // may have produced duplicate roster rows (e.g. async merges, multi-role
    // members). Without this the auto-sub planner and projected-minutes view
    // render the same player multiple times.
    const seenIds = new Set<string>();
    const dedupedSource = sourcePlayers.filter(p => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });
    if (!isStrictMatchEventRoster || realPlayers.length === 0) return dedupedSource;

    const filteredPlayers = dedupedSource.filter((player) => strictMatchRosterPlayerIds.has(player.id) || player.isFillIn);
    const filteredIds = new Set(filteredPlayers.map((player) => player.id));
    const missingCurrentPlayers = realPlayers
      .filter((player) => !filteredIds.has(player.id))
      .map((player) => ({ ...player, position: null, currentPitchPosition: undefined }));

    return [...filteredPlayers, ...missingCurrentPlayers];
  }, [isStrictMatchEventRoster, realPlayers, strictMatchRosterPlayerIds]);
  const hasSamePlayerOrder = useCallback((a: Player[], b: Player[]) => (
    a.length === b.length && a.every((player, index) => player.id === b[index]?.id)
  ), []);
  const shouldRebuildFromRealRoster =
    !!savedState &&
    !savedState.mockMode &&
    realPlayers.length > 0 &&
    (savedPlayers.length === 0 || savedRosterMissingCurrentPlayers || savedRosterHasNoPlayersOnPitch);

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
    if (shouldRebuildFromRealRoster) {
      console.log("[PitchState] useState init - rebuilding stale saved roster from live team members");
      return miniLeagueTeams
        ? autoPlaceMiniLeaguePlayers(realPlayers, getInitialTeamSize())
        : autoPlacePlayersOnPitch(realPlayers, getInitialTeamSize(), getInitialFormationIndex(getInitialTeamSize()));
    }
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
      // NOTE: Player minute catchup removed — handleTimerUpdate is the single
      // source of truth for minute tracking. The catchup here was adding minutes
      // that handleTimerUpdate would ALSO add via its delta calculation, causing
      // double-counted player minutes (e.g. showing 15 min at 7 min game time).
      return applyStrictMatchRoster(savedState.players);
    }
    if (savedState && !savedState.mockMode && realPlayers.length > 0) {
      console.log("[PitchState] useState init - ignoring stale empty saved state and using real players");
      return miniLeagueTeams
        ? autoPlaceMiniLeaguePlayers(realPlayers, getInitialTeamSize())
        : autoPlacePlayersOnPitch(realPlayers, getInitialTeamSize(), getInitialFormationIndex(getInitialTeamSize()));
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
  const recoveredInvalidSavedRosterRef = useRef(shouldRebuildFromRealRoster);

  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null);
  const [touchDragPlayer, setTouchDragPlayer] = useState<string | null>(null);
  const [touchOffset, setTouchOffset] = useState<{ x: number; y: number } | null>(null);
  const touchIdRef = useRef<number | null>(null); // Track which finger initiated the drag
  
  // Track recently-released players to suppress CSS transition "drift" on drop
  const recentlyDraggedRef = useRef<Set<string>>(new Set());

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);

  // Ball position state
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number }>(() => savedState?.ballPosition || { x: 50, y: 50 });
  const [isDraggingBall, setIsDraggingBall] = useState(false);
  const isDraggingBallRef = useRef(false);
  const recentlyDraggedBallRef = useRef(false);

  // Helper to get team color for a player in mini-league mode
  const getPlayerTeamColor = useCallback((player: Player): string | undefined => {
    if (!miniLeagueTeams || !player.teamSide) return undefined;
    return player.teamSide === "a" ? miniLeagueTeams.teamAColor : miniLeagueTeams.teamBColor;
  }, [miniLeagueTeams]);

  // Substitution mode state
  const [subMode, setSubMode] = useState(false);
  const [selectedOnPitch, setSelectedOnPitch] = useState<string | null>(null);
  const [selectedOnBench, setSelectedOnBench] = useState<string | null>(null);
  const [subAnimationPlayers, setSubAnimationPlayers] = useState<{ in: string | null; out: string | null; swap: string | null }>({ in: null, out: null, swap: null });
  const subAnimationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Sequential chain animation helper
  const runSubAnimation = useCallback((playerOutId: string, playerInId: string, swapPlayerId?: string) => {
    // Clear any existing animation timers
    subAnimationTimers.current.forEach(t => clearTimeout(t));
    subAnimationTimers.current = [];

    // Step 1: Immediately highlight player going off
    setSubAnimationPlayers({ in: null, out: playerOutId, swap: null });

    // Step 2: After 500ms, show player coming on
    const t1 = setTimeout(() => {
      setSubAnimationPlayers({ in: playerInId, out: playerOutId, swap: null });
    }, 500);
    subAnimationTimers.current.push(t1);

    // Step 3: After 1000ms, show swap player moving (if applicable)
    if (swapPlayerId) {
      const t2 = setTimeout(() => {
        setSubAnimationPlayers({ in: playerInId, out: playerOutId, swap: swapPlayerId });
      }, 1000);
      subAnimationTimers.current.push(t2);
    }

    // Step 4: Clear all animations
    const tClear = setTimeout(() => {
      setSubAnimationPlayers({ in: null, out: null, swap: null });
      subAnimationTimers.current = [];
    }, swapPlayerId ? 2500 : 1800);
    subAnimationTimers.current.push(tClear);
  }, []);

  // Refs for deferred dependencies (defined later, but used inside hook callbacks)
  const pushToUndoHistoryRef_autoSubs = useRef<((description: string, snapshot: Player[]) => void) | null>(null);
  const runSubAnimationRef_autoSubs = useRef<((playerOutId: string, playerInId: string, swapPlayerId?: string) => void) | null>(null);

  // ── Auto-sub hook (centralizes plan state & handlers) ──
  const {
    autoSubPlan, setAutoSubPlan,
    autoSubActive, setAutoSubActive,
    autoSubPaused, setAutoSubPaused,
    lockedPlayerIds,
    pendingAutoSub, setPendingAutoSub,
    pendingBatchSubs, setPendingBatchSubs,
    subConfirmDialogOpen, setSubConfirmDialogOpen,
    subDuePlayerIds, setSubDuePlayerIds,
    nextSubInfo,
    subDueTimerRef,
    handleStartAutoSubPlan,
    handleCancelAutoSubPlan,
    handleTogglePauseAutoSub,
    handleToggleLockPlayer,
    handleSkipNextSub,
    handleExecuteNow,
    handleRegeneratePlan,
    regeneratePlanRef,
    handleConfirmAutoSub,
    handleSkipAutoSub,
    checkForDueSubs,
    updateNextSubInfo,
    checkHalftimeSubs,
    skipCooldownRef,
  } = useAutoSubs({
    initialPlan: savedState?.autoSubPlan || [],
    initialActive: savedState?.autoSubActive || false,
    initialPaused: savedState?.autoSubPaused || false,
    gameTimerRef,
    playersRef,
    setPlayers,
    teamSize,
    rotateGkAtHalftime,
    pushToUndoHistoryRef: pushToUndoHistoryRef_autoSubs,
    runSubAnimationRef: runSubAnimationRef_autoSubs,
  });

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
  const [timerFormationDropdownOpen, setTimerFormationDropdownOpen] = useState(false);
  const [timerTacticalDropdownOpen, setTimerTacticalDropdownOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [trainingMenuOpen, setTrainingMenuOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [fillInDialogOpen, setFillInDialogOpen] = useState(false);
  const [trainingSettingsDialogOpen, setTrainingSettingsDialogOpen] = useState(false);
  const [autoSubPanelOpen, setAutoSubPanelOpen] = useState(false);
  const [pitchPlayerActionOpen, setPitchPlayerActionOpen] = useState(false);
  const [pitchPlayerActionTarget, setPitchPlayerActionTarget] = useState<string | null>(null);
  const [benchInjuryConfirmOpen, setBenchInjuryConfirmOpen] = useState(false);
  const [benchInjuryTarget, setBenchInjuryTarget] = useState<string | null>(null);
  const lastTapRef = useRef<{ playerId: string; time: number } | null>(null);
  const touchHandledRef = useRef(false);

  // Mock player mode state
  const [mockMode, setMockMode] = useState(() => savedState?.mockMode || false);

  useEffect(() => {
    if (!isStrictMatchEventRoster || mockMode || realPlayers.length === 0) return;

    setPlayers(prev => {
      const filtered = applyStrictMatchRoster(prev);
      return hasSamePlayerOrder(prev, filtered) ? prev : filtered;
    });
  }, [isStrictMatchEventRoster, mockMode, realPlayers.length, applyStrictMatchRoster, hasSamePlayerOrder]);

  // Sync players when realPlayers loads asynchronously (e.g. children finishing fetch after PitchBoard opened)
  useEffect(() => {
    if (mockMode || realPlayers.length === 0) return;

    if (shouldRebuildFromRealRoster && !recoveredInvalidSavedRosterRef.current) {
      recoveredInvalidSavedRosterRef.current = true;
      clearPitchState(teamId);
      console.log("[PitchState] Restoring live roster because saved state is stale", {
        savedCount: savedPlayers.length,
        realCount: realPlayers.length,
        missingCurrentPlayers: savedRosterMissingCurrentPlayers,
        noPlayersOnPitch: savedRosterHasNoPlayersOnPitch,
      });
      setPlayers(
        miniLeagueTeams
          ? autoPlaceMiniLeaguePlayers(realPlayers, teamSize)
          : autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation)
      );
      return;
    }

    if (players.length > 0) return;

    const hasStaleEmptySavedState = !!savedState && !savedState.mockMode && savedState.players.length === 0;
    if (hasStaleEmptySavedState) {
      console.log("[PitchState] Clearing stale empty saved state and restoring real players");
      clearPitchState(teamId);
    }

    console.log("[PitchState] realPlayers loaded async, syncing", realPlayers.length, "players");
    setPlayers(
      miniLeagueTeams
        ? autoPlaceMiniLeaguePlayers(realPlayers, teamSize)
        : autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation)
    );
  }, [realPlayers, players.length, mockMode, savedState, teamId, miniLeagueTeams, teamSize, selectedFormation, autoPlaceMiniLeaguePlayers, autoPlacePlayersOnPitch, shouldRebuildFromRealRoster, savedPlayers.length, savedRosterMissingCurrentPlayers, savedRosterHasPlayersOutsideCurrentRoster, savedRosterHasNoPlayersOnPitch]);

  // Match stats panel state
  const [statsOpen, setStatsOpen] = useState(false);
  const [elapsedGameTime, setElapsedGameTime] = useState(0);

  // Set flag to indicate pitch board is open (for GlobalSubMonitor to know)
  useEffect(() => {
    localStorage.setItem(PITCH_BOARD_OPEN_KEY, "true");
    // Clear widget-dismissed flag so widget reappears when pitch board closes
    localStorage.removeItem("pitch-widget-dismissed");
    return () => {
      localStorage.removeItem(PITCH_BOARD_OPEN_KEY);
    };
  }, []);

  // Handle expired sub notification taps — if opened from a pending_sub notification
  // but no sub dialog appears, show a toast and let the user see the pitch board.
  // We listen for the 'open-pitch-board' event so this works even if PitchBoard is already mounted.
  useEffect(() => {
    const checkExpiredSub = () => {
      const source = localStorage.getItem('pitch-board-open-source');
      if (source !== 'pending_sub') return;
      localStorage.removeItem('pitch-board-open-source');
      
      // Wait a moment for auto-sub system to potentially open the dialog
      setTimeout(() => {
        if (!subConfirmDialogOpen) {
          toast({
            title: "Substitution has passed",
            description: "That substitution is no longer pending. You can review the current game state here.",
          });
        }
      }, 1500);
    };

    // Check on mount (cold open from notification)
    checkExpiredSub();

    // Also check when pitch board is re-opened via event (already mounted)
    const handleOpenEvent = () => checkExpiredSub();
    window.addEventListener('open-pitch-board', handleOpenEvent);
    return () => window.removeEventListener('open-pitch-board', handleOpenEvent);
  }, []);

  // Auto-reset game 30 minutes after completion
  const autoResetDoneRef = useRef(false);
  const shouldAutoReset = useRef(false);
  useEffect(() => {
    if (autoResetDoneRef.current) return;
    const timerState = loadTimerStateForMinutes(teamId);
    if (timerState?.isGameFinished && timerState?.gameFinishedAt) {
      const minutesSinceFinished = (Date.now() - timerState.gameFinishedAt) / (1000 * 60);
      if (minutesSinceFinished >= 30) {
        shouldAutoReset.current = true;
        autoResetDoneRef.current = true;
        console.log(`Game for team ${teamId} finished ${Math.round(minutesSinceFinished)} mins ago - will auto-reset`);
      }
    }
  }, [teamId]);

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

      if (savedState.players.length === 0 && realPlayers.length > 0) {
        console.log("[PitchState] Replacing stale empty saved state with live roster");
        clearPitchState(teamId);
        setPlayers(
          miniLeagueTeams
            ? autoPlaceMiniLeaguePlayers(realPlayers, teamSize)
            : autoPlacePlayersOnPitch(realPlayers, teamSize, selectedFormation)
        );
        hasLoadedRef.current = true;
        setHasInitialized(true);
        return;
      }
      
      // We have saved state with real players - check if we need to merge new real players
      const savedPlayerIds = new Set(savedState.players.map(p => p.id));
      const newPlayers = realPlayers.filter(p => !savedPlayerIds.has(p.id));
      if (isStrictMatchEventRoster && savedRosterHasPlayersOutsideCurrentRoster) {
        setPlayers(prev => applyStrictMatchRoster(prev));
      }
      
      // If there are new players not in saved state, add them
      if (newPlayers.length > 0) {
        setPlayers(prev => applyStrictMatchRoster([...prev, ...newPlayers]));
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
  }, [savedState, realPlayers, autoPlacePlayersOnPitch, autoPlaceMiniLeaguePlayers, miniLeagueTeams, teamSize, selectedFormation, isStrictMatchEventRoster, savedRosterHasPlayersOutsideCurrentRoster, applyStrictMatchRoster]);

  // Lineup skip handler (needs players + autoPlacePlayersOnPitch to be defined)
  const handleLineupSkip = useCallback(() => {
    if (!miniLeagueTeams) {
      setPlayers(autoPlacePlayersOnPitch(players, teamSize, selectedFormation));
    }
    setShowLineupPicker(false);
    // Proceed to step 2: auto-sub setup (same as confirm flow)
    setTimeout(() => {
      setAutoSubPlanEditMode(false);
      setAutoSubFromPreGame(true);
      setAutoSubPlanDialogOpen(true);
    }, 300);
  }, [players, teamSize, selectedFormation, autoPlacePlayersOnPitch, miniLeagueTeams]);

  // Save pitch state to localStorage whenever it changes (only after initialization)
  // Debounced to avoid excessive saves during drag operations
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!hasInitialized) return;
    
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // During active drag, debounce saves to reduce jank
    const isActiveDrag = touchDragPlayer !== null || draggedPlayer !== null;
    const delay = isActiveDrag ? 300 : 0;
    
    saveTimeoutRef.current = setTimeout(() => {
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
    }, delay);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hasInitialized, teamId, players, teamSize, selectedFormation, ballPosition, autoSubPlan, autoSubActive, autoSubPaused, mockMode, linkedEventId, goals, isEventGroup, forceEventGroupSync, touchDragPlayer, draggedPlayer]);

  // Sync player position preferences from database when they change
  // This ensures updated preferences are reflected even when using saved state from localStorage
  useEffect(() => {
    if (!teamPlayerPositions || mockMode) return;
    
    setPlayers(prev => prev.map(player => {
      const dbPosition = teamPlayerPositions.find(p => p.user_id === player.id || p.child_id === player.id);
      if (dbPosition) {
        const newAssignedPositions = (dbPosition.preferred_positions || []) as PitchPosition[];
        const newNumber = dbPosition.jersey_number ?? player.number;
        
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

  // Disable drawing mode when any overlay/panel opens (settings, bench sheet, timer interactions, etc.)
  useEffect(() => {
    if (settingsMenuOpen || portraitSheetOpen || settingsDialogOpen || autoSubPanelOpen || !toolbarCollapsed) {
      if (drawingTool !== "none") {
        setDrawingTool("none");
        setShowFloatingDrawToolbar(false);
      }
    }
  }, [settingsMenuOpen, portraitSheetOpen, settingsDialogOpen, autoSubPanelOpen, toolbarCollapsed, drawingTool]);

  // Drop a stale `preferredSecondHalfGkId` whenever the live roster makes it
  // invalid — the player no longer exists, has been moved onto the pitch, or
  // is now serving as the starting GK. Letting it linger would cause the
  // AutoSubPlan dialog to lock in the wrong "GK 2H" badge after the coach
  // changes who is keeping goal.
  useEffect(() => {
    if (!preferredSecondHalfGkId) return;
    const target = players.find((p) => p.id === preferredSecondHalfGkId);
    if (!target || target.isInjured || target.currentPitchPosition === "GK") {
      setPreferredSecondHalfGkId(undefined);
    }
  }, [players, preferredSecondHalfGkId]);

  // Create arrow helper - uses lazy-loaded fabric module
  const createArrow = useCallback((startX: number, startY: number, endX: number, endY: number, color: string) => {
    if (!fabricModule) return null;

    const { Path } = fabricModule;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx);
    const shaftLength = Math.hypot(dx, dy);
    const headLength = Math.max(10, Math.min(24, shaftLength * 0.18));
    const headSpread = Math.PI / 7;

    const leftHeadX = endX - headLength * Math.cos(angle - headSpread);
    const leftHeadY = endY - headLength * Math.sin(angle - headSpread);
    const rightHeadX = endX - headLength * Math.cos(angle + headSpread);
    const rightHeadY = endY - headLength * Math.sin(angle + headSpread);

    const arrowPathData = [
      ["M", startX, startY],
      ["L", endX, endY],
      ["M", endX, endY],
      ["L", leftHeadX, leftHeadY],
      ["M", endX, endY],
      ["L", rightHeadX, rightHeadY],
    ];

    const arrow = new Path(arrowPathData as any, {
      stroke: color,
      strokeWidth: 3,
      strokeUniform: true,
      fill: "",
      strokeLineCap: "butt",
      strokeLineJoin: "round",
      selectable: false,
      evented: false,
      data: {
        kind: "pitch-arrow",
        startX,
        startY,
        endX,
        endY,
      },
    });

    return arrow;
  }, [fabricModule]);

  // Handle arrow drawing
  useEffect(() => {
    if (!fabricCanvas) return;

    const getArrowPointer = (eventPayload: any) => {
      if (eventPayload?.scenePoint) return eventPayload.scenePoint;

      const nativeEvent = eventPayload?.e ?? eventPayload;
      const canvasWithScenePoint = fabricCanvas as any;
      if (typeof canvasWithScenePoint.getScenePoint === "function") {
        const scenePoint = canvasWithScenePoint.getScenePoint(nativeEvent);
        if (scenePoint?.x !== undefined && scenePoint?.y !== undefined) {
          return scenePoint;
        }
      }

      return eventPayload?.viewportPoint ?? eventPayload?.pointer ?? fabricCanvas.getViewportPoint(nativeEvent);
    };

    const handleMouseDown = (e: any) => {
      if (drawingTool !== "arrow") return;
      
      const pointer = getArrowPointer(e);
      if (!pointer) return;
      isDrawingArrowRef.current = true;
      arrowStartRef.current = { x: pointer.x, y: pointer.y };
    };

    const handleMouseMove = (e: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current || drawingTool !== "arrow") return;
      
      const pointer = getArrowPointer(e);
      if (!pointer) return;
      
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
      
      const pointer = getArrowPointer(e);
      if (!pointer) return;
      
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

    // In mini-league mode, skip preview dialog and apply directly
    if (miniLeagueTeams) {
      applyFormationChange(index);
      return;
    }

    const numPositions = parseInt(teamSize);
    
    // Calculate what changes would happen
    const playersOnPitch = players.filter(p => p.position !== null);
    const benchPlayers = players.filter(p => p.position === null);
    const allPlayers = [...playersOnPitch, ...benchPlayers];
    
    const positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[] = [];
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
    // Use optimal matching to minimize position changes instead of naive index assignment
    const minorAdjustments: { player: Player; fromLabel: string; toLabel: string }[] = [];
    const stayingOnPitch = willBeOnPitch.filter(
      p => p.currentPitchPosition && playersOnPitch.some(pp => pp.id === p.id) && !willBeOnBench.some(bp => bp.id === p.id)
    );
    
    // Build new formation slot info
    const formationSlots = formation.positions.map((pos, i) => ({
      index: i,
      position: getPositionFromCoords(pos.y, teamSize),
      x: pos.x,
      y: pos.y,
      taken: false,
    }));
    
    // Mark slots taken by bench-to-pitch players
    for (let i = 0; i < willBeOnPitch.length; i++) {
      const player = willBeOnPitch[i];
      if (benchPlayers.some(p => p.id === player.id)) {
        formationSlots[i].taken = true;
      }
    }
    
    // Greedy matching: first pass - exact position+side matches, second - same position, third - remaining
    const playerSlotMap = new Map<string, number>(); // player.id -> slot index
    const availableSlots = () => formationSlots.filter(s => !s.taken);
    
    // Pass 1: exact specific label match (e.g. "Left Mid" → "Left Mid")
    for (const player of stayingOnPitch) {
      if (playerSlotMap.has(player.id)) continue;
      const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition!);
      const slot = availableSlots().find(s => {
        const toLabel = getSpecificPositionLabel(s.x, s.position);
        return toLabel === fromLabel;
      });
      if (slot) {
        slot.taken = true;
        playerSlotMap.set(player.id, slot.index);
      }
    }
    
    // Pass 2: same position category (e.g. MID → MID, any side)
    for (const player of stayingOnPitch) {
      if (playerSlotMap.has(player.id)) continue;
      const slot = availableSlots().find(s => s.position === player.currentPitchPosition);
      if (slot) {
        slot.taken = true;
        playerSlotMap.set(player.id, slot.index);
      }
    }
    
    // Pass 3: assign remaining players to closest available slots
    for (const player of stayingOnPitch) {
      if (playerSlotMap.has(player.id)) continue;
      const remaining = availableSlots();
      if (remaining.length > 0) {
        // Pick slot closest to player's current position
        const px = player.position?.x ?? 50;
        const py = player.position?.y ?? 50;
        remaining.sort((a, b) => {
          const distA = Math.abs(a.x - px) + Math.abs(a.y - py);
          const distB = Math.abs(b.x - px) + Math.abs(b.y - py);
          return distA - distB;
        });
        remaining[0].taken = true;
        playerSlotMap.set(player.id, remaining[0].index);
      }
    }
    
    // Now compute swaps and adjustments from the optimal mapping
    for (const player of stayingOnPitch) {
      const slotIdx = playerSlotMap.get(player.id);
      if (slotIdx == null) continue;
      const slot = formationSlots[slotIdx];
      const newPosition = slot.position;
      if (player.currentPitchPosition !== newPosition) {
        positionSwaps.push({ player, fromPosition: player.currentPitchPosition!, toPosition: newPosition, fromX: player.position?.x, toX: slot.x });
      } else {
        const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition!);
        const toLabel = getSpecificPositionLabel(slot.x, newPosition);
        if (fromLabel !== toLabel) {
          minorAdjustments.push({ player, fromLabel, toLabel });
        }
      }
    }

    // If there are any changes, show confirmation
    if (positionSwaps.length > 0 || benchMoves.length > 0 || minorAdjustments.length > 0) {
      setPendingFormationChange({ index, positionSwaps, benchMoves, minorAdjustments });
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

  // Send push notification to team coaches/admins and Subs Manager assignees when formation or team size changes
  const notifyFormationOrSizeChange = useCallback(async (
    changeType: 'formation' | 'team_size', 
    detail: string,
    changeDetails?: {
      positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[];
      benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[];
    }
  ) => {
    // Notify whenever formation changes (during setup or active game), skip only for read-only or finished games
    if (!user?.id || readOnly || gameTimerRef.current?.isGameFinished()) return;
    try {
      const recipientIds = new Set<string>();
      // Always include the current user so they get a record of the change
      recipientIds.add(user.id);
      const isEventGroup = teamId.startsWith("event-group-");

      if (isEventGroup) {
        // Mini-league: notify Referee + Subs Manager of this specific match
        const groupId = teamId.replace("event-group-", "");
        const { data: matchDuties } = await supabase
          .from("event_group_duties")
          .select("assigned_to")
          .eq("group_id", groupId)
          .in("name", ["Referee", "Subs Manager"])
          .not("assigned_to", "is", null);
        matchDuties?.forEach(d => {
          if (d.assigned_to) recipientIds.add(d.assigned_to);
        });
      } else {
        // Regular team: notify coaches/admins
        const { data: staffRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId)
          .in("role", ["coach", "team_admin"]);
        
        staffRoles?.forEach(r => {
          if (r.user_id) recipientIds.add(r.user_id);
        });

        // Also include Subs Manager assignees for regular events
        if (linkedEventId) {
          const { data: subsManagers } = await supabase
            .from("duties")
            .select("assigned_to")
            .eq("event_id", linkedEventId)
            .eq("name", "Subs Manager")
            .not("assigned_to", "is", null);
          subsManagers?.forEach(d => {
            if (d.assigned_to) recipientIds.add(d.assigned_to);
          });
        }
      }

      // Build detailed change description for notification body
      const changeParts: string[] = [];
      if (changeDetails) {
        const benchExits = changeDetails.benchMoves.filter(m => m.direction === "to-bench");
        const pitchEntries = changeDetails.benchMoves.filter(m => m.direction === "to-pitch");
        const swaps = changeDetails.positionSwaps;
        
        if (benchExits.length > 0) {
          changeParts.push(`📤 Off: ${benchExits.map(m => m.player.name).join(", ")}`);
        }
        if (pitchEntries.length > 0) {
          changeParts.push(`📥 On: ${pitchEntries.map(m => `${m.player.name} (${m.position || ""})`).join(", ")}`);
        }
        if (swaps.length > 0) {
          changeParts.push(`🔄 Moved: ${swaps.map(s => `${s.player.name} ${s.fromPosition}→${s.toPosition}`).join(", ")}`);
        }
      }

      const title = changeType === 'formation' 
        ? `⚽ ${teamName} - Formation Changed`
        : `⚽ ${teamName} - Team Size Changed`;
      const baseSummary = changeType === 'formation'
        ? `Formation changed to ${detail}`
        : `Team size changed to ${detail} players`;
      const body = changeParts.length > 0 
        ? `${baseSummary}\n${changeParts.join("\n")}`
        : baseSummary;

      // Create in-app notifications with details via SECURITY DEFINER RPC
      // (direct inserts fail RLS when the current user isn't a coach/admin in the same team)
      const notificationMessage = changeParts.length > 0
        ? `${baseSummary} — ${changeParts.join(" • ")}`
        : baseSummary;

      const recipientArray = Array.from(recipientIds);
      if (recipientArray.length > 0) {
        console.log("[Formation notify] Sending to", recipientArray.length, "recipients, teamId:", teamId);
        const { error: rpcError } = await supabase.rpc("notify_formation_change", {
          _recipient_ids: recipientArray,
          _message: notificationMessage,
          _related_id: teamId,
        });
        if (rpcError) {
          console.error("Formation notification RPC error:", JSON.stringify(rpcError));
        } else {
          console.log("[Formation notify] RPC success — notifications inserted");
        }
      } else {
        console.warn("[Formation notify] No recipients found");
      }
    } catch (e) {
      console.error("Failed to send formation change notification:", e);
    }
  }, [user?.id, teamId, teamName, readOnly, linkedEventId]);

  const applyFormationChange = useCallback((index: number, changeDetails?: { positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[]; benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[] }) => {
    const formation = FORMATIONS[teamSize][index];
    if (!formation) return;

    setSelectedFormation(index);
    
    // Persist to database
    persistFormationToDb(formation.name);

    // For mini-league mode, re-place teams with the new formation
    if (miniLeagueTeams) {
      const targetTeam = selectedTeamForSettings;
      setPlayers(prev => {
        // Ensure teamSide is set on all players
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
        
        if (targetTeam === "both") {
          return autoPlaceMiniLeaguePlayers(playersWithTeamSide, teamSize, true, index, true);
        }
        
        // Single team formation change - use autoPlaceMiniLeaguePlayers for the target team,
        // but preserve the other team's positions
        const scaleToBottomHalf = (pos: { x: number; y: number }) => ({
          x: pos.x,
          y: 50 + (pos.y / 100) * 45,
        });
        const scaleToTopHalf = (pos: { x: number; y: number }) => ({
          x: 100 - pos.x,
          y: 50 - (pos.y / 100) * 45,
        });
        const scaleFunc = targetTeam === "a" ? scaleToBottomHalf : scaleToTopHalf;
        
        // Get on-pitch players for target team in a stable order
        const teamOnPitch = playersWithTeamSide.filter(pp => pp.teamSide === targetTeam && pp.position !== null);
        const teamOnBench = playersWithTeamSide.filter(pp => pp.teamSide === targetTeam && pp.position === null);
        
        return playersWithTeamSide.map(p => {
          if (p.teamSide !== targetTeam) return p; // Leave other team unchanged
          if (p.position === null) return p; // Leave bench players unchanged
          
          const playerIndex = teamOnPitch.findIndex(pp => pp.id === p.id);
          
          if (playerIndex >= 0 && playerIndex < formation.positions.length) {
            const pos = scaleFunc(formation.positions[playerIndex]);
            return {
              ...p,
              position: pos,
              currentPitchPosition: getPositionFromCoords(formation.positions[playerIndex].y, teamSize),
            };
          }
          // More players than formation slots - send to bench
          return { ...p, position: null, currentPitchPosition: undefined };
        });
      });
      
      const teamLabel = targetTeam === "both" ? "both teams" 
        : targetTeam === "a" ? (miniLeagueTeams.teamAName || "Team A")
        : (miniLeagueTeams.teamBName || "Team B");
      toast({ title: "Formation applied", description: `${formation.name} set for ${teamLabel}` });
      return;
    }

    const numPositions = parseInt(teamSize);
    
    setPlayers(prev => {
      const playersOnPitch = prev.filter(p => p.position !== null);
      const benchPlayers = prev.filter(p => p.position === null);
      const allPlayers = [...playersOnPitch, ...benchPlayers];
      
      const updated = prev.map(p => ({ ...p, position: null as { x: number; y: number } | null, currentPitchPosition: undefined as PitchPosition | undefined }));
      
      // Determine who goes on pitch
      const willBeOnPitch = allPlayers.slice(0, numPositions);
      const stayingOnPitch = willBeOnPitch.filter(p => playersOnPitch.some(pp => pp.id === p.id));
      const comingFromBench = willBeOnPitch.filter(p => benchPlayers.some(bp => bp.id === p.id));
      
      // Build formation slots
      const slots = formation.positions.map((pos, i) => ({
        index: i,
        position: getPositionFromCoords(pos.y, teamSize),
        x: pos.x,
        y: pos.y,
        taken: false,
      }));
      
      // Optimal matching for staying players
      const playerSlotMap = new Map<string, number>();
      const availSlots = () => slots.filter(s => !s.taken);
      
      // Pass 1: exact specific label match
      for (const player of stayingOnPitch) {
        if (playerSlotMap.has(player.id)) continue;
        const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition!);
        const slot = availSlots().find(s => getSpecificPositionLabel(s.x, s.position) === fromLabel);
        if (slot) { slot.taken = true; playerSlotMap.set(player.id, slot.index); }
      }
      // Pass 2: same category
      for (const player of stayingOnPitch) {
        if (playerSlotMap.has(player.id)) continue;
        const slot = availSlots().find(s => s.position === player.currentPitchPosition);
        if (slot) { slot.taken = true; playerSlotMap.set(player.id, slot.index); }
      }
      // Pass 3: closest remaining
      for (const player of stayingOnPitch) {
        if (playerSlotMap.has(player.id)) continue;
        const remaining = availSlots();
        if (remaining.length > 0) {
          const px = player.position?.x ?? 50;
          const py = player.position?.y ?? 50;
          remaining.sort((a, b) => (Math.abs(a.x - px) + Math.abs(a.y - py)) - (Math.abs(b.x - px) + Math.abs(b.y - py)));
          remaining[0].taken = true;
          playerSlotMap.set(player.id, remaining[0].index);
        }
      }
      
      // Place staying players at their matched slots
      for (const player of stayingOnPitch) {
        const slotIdx = playerSlotMap.get(player.id);
        if (slotIdx == null) continue;
        const playerIndex = updated.findIndex(p => p.id === player.id);
        if (playerIndex !== -1) {
          const pos = { ...formation.positions[slotIdx] };
          updated[playerIndex].position = pos;
          updated[playerIndex].currentPitchPosition = getPositionFromCoords(pos.y, teamSize);
        }
      }
      
      // Place bench-to-pitch players in remaining slots
      const remainingSlots = slots.filter(s => !s.taken);
      for (let i = 0; i < comingFromBench.length && i < remainingSlots.length; i++) {
        const playerIndex = updated.findIndex(p => p.id === comingFromBench[i].id);
        if (playerIndex !== -1) {
          const pos = { ...formation.positions[remainingSlots[i].index] };
          updated[playerIndex].position = pos;
          updated[playerIndex].currentPitchPosition = getPositionFromCoords(pos.y, teamSize);
        }
      }
      
      return updated;
    });

    toast({ title: "Formation applied", description: `${formation.name} formation set` });

    // Notify team staff about the formation change
    notifyFormationOrSizeChange('formation', formation.name, changeDetails);

    // Auto-regenerate the plan if auto-subs are active
    if (autoSubActive) {
      setTimeout(() => {
        regeneratePlanRef.current?.();
      }, 300);
    }
  }, [teamSize, persistFormationToDb, toast, miniLeagueTeams, autoPlaceMiniLeaguePlayers, autoSubActive, notifyFormationOrSizeChange, selectedTeamForSettings]);

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
        // Notify team staff about the team size change
        notifyFormationOrSizeChange('team_size', newSize, {
          positionSwaps: pendingFormationChange.positionSwaps,
          benchMoves: pendingFormationChange.benchMoves,
        });
      } else {
        applyFormationChange(pendingFormationChange.index, {
          positionSwaps: pendingFormationChange.positionSwaps,
          benchMoves: pendingFormationChange.benchMoves,
        });
      }
    }
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
    // Minimise the bottom drawer after applying
    setToolbarCollapsed(true);
    setPortraitSheetOpen(false);

    // Auto-regenerate the plan if auto-subs are active
    if (autoSubActive) {
      setTimeout(() => {
        regeneratePlanRef.current?.();
        toast({ title: "Auto-sub plan updated", description: "Plan regenerated to account for formation change" });
      }, 300);
    }
  }, [pendingFormationChange, applyFormationChange, autoPlacePlayersOnPitch, players, persistTeamSizeToDb, autoSubActive, toast, notifyFormationOrSizeChange]);

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
    
    runSubAnimation(playerToRemoveId, pendingSubBenchPlayer!, playerToSwapId);
    
    setPlayers(prev => prev.map(p => {
      if (p.id === playerToRemoveId) {
        return { ...p, position: null, currentPitchPosition: undefined };
      }
      if (p.id === playerToSwapId) {
        return { ...p, position: removePosition, currentPitchPosition: requiredPosition };
      }
      if (p.id === pendingSubBenchPlayer) {
        return { ...p, position: swapPosition, currentPitchPosition: playerToSwap.currentPitchPosition };
      }
      return p;
    }));
    
    toast({ title: "Substitution made", description: `${benchPlayer.name} comes on, ${playerToRemove.name} off` });
    
    setPositionSwapDialogOpen(false);
    setPendingSubBenchPlayer(null);
    setRequiredPosition(null);
  };

  // Handle selection from substitution preview dialog
  const handleSubPreviewSelect = (benchPlayerId: string, swapPlayerId?: string) => {
    const pitchPlayer = players.find(p => p.id === selectedOnPitch);
    const benchPlayer = players.find(p => p.id === benchPlayerId);
    
    if (!pitchPlayer?.position || !benchPlayer || !selectedOnPitch) return;
    
    const capturedPitchPlayerId = selectedOnPitch;
    
    // Close dialog and clear selectedOnPitch to prevent useEffect from reopening it
    setSubPreviewOpen(false);
    setSelectedOnPitch(null);
    
    if (swapPlayerId) {
      // Swap-based substitution - show combined confirmation dialog with all steps
      setTimeout(() => {
        setPendingManualSub({ pitchPlayerId: capturedPitchPlayerId, benchPlayerId, swapPlayerId });
        setManualSubConfirmOpen(true);
      }, 150);
    } else {
      // Direct substitution - show confirmation dialog with step-by-step instructions
      setTimeout(() => {
        setPendingManualSub({ pitchPlayerId: capturedPitchPlayerId, benchPlayerId });
        setManualSubConfirmOpen(true);
      }, 150);
    }
  };
  // Handle pre-swap from substitution preview dialog
  // This swaps the selected pitch player with another pitch player who can cover their position
  const handlePreSwapFromDialog = useCallback((pitchPlayerId: string, swapPlayerId: string, opts?: { reopenSubDialog?: boolean }) => {
    const reopenSubDialog = opts?.reopenSubDialog ?? true;
    const pitchPlayer = players.find(p => p.id === pitchPlayerId);
    const swapPlayer = players.find(p => p.id === swapPlayerId);

    if (!pitchPlayer?.position || !swapPlayer?.position) return;

    const pos1 = { ...pitchPlayer.position };
    const pos2 = { ...swapPlayer.position };
    const pitchPos1 = pitchPlayer.currentPitchPosition;
    const pitchPos2 = swapPlayer.currentPitchPosition;

    pushToUndoHistory(`Swap: ${pitchPlayer.name} ↔ ${swapPlayer.name}`, playersRef.current);

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

    if (!reopenSubDialog) return;

    // In-dialog flow: reopen the substitution picker with updated options.
    setSubPreviewOpen(false);
    setSelectedOnBench(null);
    setSelectedOnPitch(pitchPlayerId);
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
    
    runSubAnimation(pendingSwapBasedSub.pitchPlayerId, pendingSwapBasedSub.benchPlayerId, pendingSwapBasedSub.swapPlayerId);
    
    setPlayers(prev => prev.map(p => {
      if (p.id === pendingSwapBasedSub.pitchPlayerId) {
        return { ...p, position: null, currentPitchPosition: undefined };
      }
      if (p.id === pendingSwapBasedSub.swapPlayerId) {
        return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
      }
      if (p.id === pendingSwapBasedSub.benchPlayerId) {
        return { ...p, position: swapPosition, currentPitchPosition: swapPlayer.currentPitchPosition };
      }
      return p;
    }));
    
    toast({ title: "Substitution made", description: `${benchPlayer.name} comes on, ${pitchPlayer.name} off` });
    
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
          const selectedPlayer = players.find(p => p.id === swapPlayer1);
          const targetPlayer = players.find(p => p.id === playerId);
          const isCrossTeam = miniLeagueTeams && selectedPlayer?.teamSide && targetPlayer?.teamSide && selectedPlayer.teamSide !== targetPlayer.teamSide;
          toast({
            title: "Cannot swap",
            description: isCrossTeam 
              ? "You can only swap players on the same team."
              : "Players are not eligible to play in each other's positions based on their position preferences.",
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

    // Auto-regenerate the plan if auto-subs are active
    if (autoSubActive) {
      setTimeout(() => {
        regeneratePlanRef.current?.();
        toast({ title: "Auto-sub plan updated", description: "Plan regenerated to account for position swap" });
      }, 200);
    }
  }, [swapPlayer1, swapPlayer2, players, toast, pushToUndoHistory, autoSubActive]);

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

    // Auto-regenerate the plan if auto-subs are active
    if (autoSubActive) {
      setTimeout(() => {
        regeneratePlanRef.current?.();
        toast({ title: "Auto-sub plan updated", description: "Plan regenerated to account for position swap" });
      }, 200);
    }
  }, [swapPlayer1, swapPlayer2, players, toast, pushToUndoHistory, autoSubActive]);

  // Cancel sub mode
  const toggleSubMode = () => {
    if (readOnly) return;
    const newSubMode = !subMode;
    
    // Check if there are any available bench players (not injured)
    if (newSubMode) {
      const availableBenchPlayers = players.filter(p => p.position === null && !p.isInjured);
      if (availableBenchPlayers.length === 0) {
        toast({
          title: "No subs available",
          description: players.some(p => p.position === null)
            ? "All bench players are currently injured."
            : "There are no players on the bench to bring on.",
        });
        return;
      }
    }
    
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
        setSheetHeightPct(50);
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

  // Keep refs in sync for the auto-sub hook
  pushToUndoHistoryRef_autoSubs.current = pushToUndoHistory;
  runSubAnimationRef_autoSubs.current = runSubAnimation;

  // lastTimeUpdateRef and hasInitializedTimeRef are declared near the top of the component
  // (after savedState loading) to allow pre-initialization from saved timer state.

  // Timer update callback - check for pending subs and track minutes played
  const handleTimerUpdate = useCallback((elapsedSeconds: number, currentHalf: 1 | 2) => {
    // Mark game as in progress once timer starts
    if (elapsedSeconds > 0 && !gameInProgress) {
      setGameInProgress(true);
    }
    
    // On first call, initialize the ref so the next tick computes a correct delta.
    // We do NOT return early — we still want sub checks below to run.
    if (!hasInitializedTimeRef.current) {
      hasInitializedTimeRef.current = true;
      lastTimeUpdateRef.current = { seconds: elapsedSeconds, half: currentHalf };
      // Fall through — no time is added because delta will be 0 on this call
    }
    
    // Track minutes played for players on pitch
    const lastUpdate = lastTimeUpdateRef.current;
    if (lastUpdate) {
      let secondsElapsed = 0;
      if (lastUpdate.half === currentHalf && elapsedSeconds > lastUpdate.seconds) {
        // Normal tick within the same half
        secondsElapsed = elapsedSeconds - lastUpdate.seconds;
      } else if (lastUpdate.half === 1 && currentHalf === 2 && elapsedSeconds === 0) {
        // Half transition: account for the final second of half 1
        // GameTimer jumps from (halfDuration-1) to 0 when switching halves,
        // so the last second would otherwise be lost
        const halfDuration = gameTimerRef.current?.getMinutesPerHalf() 
          ? gameTimerRef.current.getMinutesPerHalf() * 60 
          : minutesPerHalf * 60;
        secondsElapsed = Math.max(0, halfDuration - lastUpdate.seconds);
      }
      if (secondsElapsed > 0) {
        setPlayers(prev => prev.map(p => {
          if (p.position !== null) {
            return { ...p, minutesPlayed: (p.minutesPlayed || 0) + secondsElapsed };
          }
          return p;
        }));
      }
    }
    lastTimeUpdateRef.current = { seconds: elapsedSeconds, half: currentHalf };

    // Update reactive elapsed game time for MatchStatsPanel
    const totalElapsed = currentHalf === 2 
      ? (gameTimerRef.current?.getMinutesPerHalf() || minutesPerHalf) * 60 + elapsedSeconds 
      : elapsedSeconds;
    setElapsedGameTime(totalElapsed);

    // Delegate next-sub countdown and due-sub detection to the hook
    updateNextSubInfo(elapsedSeconds, currentHalf);
    checkForDueSubs(elapsedSeconds, currentHalf);
  }, [updateNextSubInfo, checkForDueSubs, gameInProgress]);

  // Half change callback - check for halftime subs (including batch)
  const handleHalfChange = useCallback((newHalf: 1 | 2) => {
    // Delegate auto-sub halftime checks to the hook
    if (checkHalftimeSubs(newHalf)) return;

    // Case 2: No auto-sub plan, but a preferred 2nd half GK was selected — prompt GK swap
    if (newHalf === 2 && preferredSecondHalfGkId) {
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
          playSubAlertBeep(notificationBody);
          setPendingAutoSub(gkSwapEvent);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
        return;
      }
    }

    // Case 3: No subs and no GK swap — still show halftime notification
    if (newHalf === 2) {
      setTimeout(() => {
        playSubAlertBeep("Half Time!");
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(true);
      }, 500);
    }
  }, [checkHalftimeSubs, preferredSecondHalfGkId, players, setPendingAutoSub, setPendingBatchSubs, setSubConfirmDialogOpen]);

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
    recentlyDraggedBallRef.current = true;
    setTimeout(() => { recentlyDraggedBallRef.current = false; }, 500);
    setIsDraggingBall(false);
  };

  const handleBallTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingBallRef.current = true;
    setIsDraggingBall(true);
    // Immediately update position on touch start
    if (containerRef.current) {
      const touch = e.touches[0];
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;
      setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
    }
  };

  const handleBallTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingBallRef.current || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * 100;
    const y = ((touch.clientY - rect.top) / rect.height) * 100;
    setBallPosition({ x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) });
  };

  const handleBallTouchEnd = () => {
    isDraggingBallRef.current = false;
    recentlyDraggedBallRef.current = true;
    setTimeout(() => { recentlyDraggedBallRef.current = false; }, 500);
    setIsDraggingBall(false);
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  // Reset game - clears all player minutes, timer, and positions
  const handleResetGame = useCallback((silent = false) => {
    // Stop the timer first
    gameTimerRef.current?.resetTimer();
    
    // Reset pitch settings to last saved team defaults
    const savedDefaults = savedTeamDefaultsRef.current;
    setMinutesPerHalf(savedDefaults.minutesPerHalf);
    setRotationSpeed(savedDefaults.rotationSpeed);
    setDisablePositionSwaps(savedDefaults.disablePositionSwaps);
    setDisableBatchSubs(savedDefaults.disableBatchSubs);
    setRotateGkAtHalftime(savedDefaults.rotateGkAtHalftime);
    setMaxSpreadMinutes(savedDefaults.maxSpreadMinutes);
    
    // Reset team size to saved default value
    const defaultTeamSize: TeamSize = savedDefaults.teamSize;
    setTeamSize(defaultTeamSize);
    
    // Reset formation to saved default value for the team size
    const formations = FORMATIONS[defaultTeamSize];
    let defaultFormationIndex = 0;
    if (savedDefaults.formation) {
      const index = formations.findIndex(f => f.name === savedDefaults.formation);
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
    clearPitchState(teamId);
    
    // Reset hasLoadedRef so fresh state can be saved
    hasLoadedRef.current = false;
    
    if (!silent) {
      toast({
        title: "Game Reset",
        description: "All player minutes and settings have been reset to defaults.",
      });
    }
  }, [players, autoPlacePlayersOnPitch, toast]);

  // Helper: if the game is at full time, silently reset before showing lineup picker
  const handleSetupGame = useCallback(() => {
    if (gameTimerRef.current?.isGameFinished()) {
      handleResetGame(true);
    }
    setShowLineupPicker(true);
  }, [handleResetGame]);

  // Execute deferred auto-reset after handleResetGame is available
  useEffect(() => {
    if (shouldAutoReset.current) {
      shouldAutoReset.current = false;
      handleResetGame();
    }
  }, [handleResetGame]);

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
    
    const positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[] = [];
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
    const minorAdjustments: { player: Player; fromLabel: string; toLabel: string }[] = [];
    for (let i = 0; i < willBeOnPitch.length; i++) {
      const player = willBeOnPitch[i];
      if (player.currentPitchPosition && newFormation.positions[i] && playersOnPitch.some(p => p.id === player.id) && !willBeOnBench.some(p => p.id === player.id)) {
        const newPosition = getPositionFromCoords(newFormation.positions[i].y, newSize);
        if (player.currentPitchPosition !== newPosition) {
          positionSwaps.push({ player, fromPosition: player.currentPitchPosition, toPosition: newPosition, fromX: player.position?.x, toX: newFormation.positions[i].x });
        } else {
          const fromLabel = getSpecificPositionLabel(player.position?.x, player.currentPitchPosition);
          const toLabel = getSpecificPositionLabel(newFormation.positions[i].x, newPosition);
          if (fromLabel !== toLabel) {
            minorAdjustments.push({ player, fromLabel, toLabel });
          }
        }
      }
    }
    
    if (positionSwaps.length > 0 || benchMoves.length > 0 || minorAdjustments.length > 0) {
      setPendingFormationChange({ index: 0, newTeamSize: newSize, positionSwaps, benchMoves, minorAdjustments });
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

  const getPinchDistance = (touches: React.TouchList): number | null => {
    if (touches.length < 2) return null;
    return getPinchDist(touches);
  };

  const handlePitchTouchStart = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;
    
    // Pinch zoom (2 fingers) - zoom without moving pitch
    if (e.touches.length === 2) {
      const dist = getPinchDistance(e.touches);
      if (dist !== null) {
        setLastPinchDistance(dist);
      }
    }
  };

  const handlePitchTouchMove = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;
    
    // Pinch zoom (2 fingers)
    if (e.touches.length === 2 && lastPinchDistance !== null) {
      e.preventDefault();
      const dist = getPinchDistance(e.touches);
      if (dist !== null) {
        const delta = (dist - lastPinchDistance) * 0.005;
        setZoom(prev => Math.min(Math.max(prev + delta, 1), 3));
        setLastPinchDistance(dist);
      }
      return;
    }
    
    // Handle player drag - block in readOnly mode
    if (readOnly) return;
    if (touchDragPlayer && containerRef.current && touchIdRef.current !== null) {
      // Find the specific finger that started this drag
      const touch = Array.from(e.touches).find(t => t.identifier === touchIdRef.current);
      if (!touch) return;
      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;

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
    // Reset pinch distance when fingers lift
    if (e.touches.length < 2) {
      setLastPinchDistance(null);
    }
    
    if (readOnly) return;
    if (!touchDragPlayer) return;
    
    // Only respond to the finger that started this drag
    const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return;
    
    // Mark player as recently-dragged to suppress CSS transition AND tactical offset drift
    const draggedId = touchDragPlayer;
    recentlyDraggedRef.current.add(draggedId);
    setTimeout(() => recentlyDraggedRef.current.delete(draggedId), 500);
    
    const benchElement = document.getElementById('pitch-bench');

    let droppedOnBench = false;
    if (benchElement) {
      const benchRect = benchElement.getBoundingClientRect();
      if (
        touch.clientX >= benchRect.left &&
        touch.clientX <= benchRect.right &&
        touch.clientY >= benchRect.top &&
        touch.clientY <= benchRect.bottom
      ) {
        droppedOnBench = true;
        const benchPlayersAvail = players.filter(p => p.position === null && !p.isInjured);
        if (benchPlayersAvail.length > 0) {
          // Open sub picker instead of bare bench drop
          setSelectedOnPitch(touchDragPlayer);
          setSubPreviewOpen(true);
        } else {
          setPlayers(prev =>
            prev.map(p =>
              p.id === touchDragPlayer ? { ...p, position: null } : p
            )
          );
        }
      }
    }

    // Detect drop on another pitch token → swap positions
    if (!droppedOnBench) {
      const dropEl = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetTokenEl = (dropEl as HTMLElement | null)?.closest('[data-player-variant="pitch"][data-player-id]') as HTMLElement | null;
      const targetId = targetTokenEl?.getAttribute('data-player-id') || null;
      if (targetId && targetId !== touchDragPlayer) {
        const target = players.find(p => p.id === targetId);
        const src = players.find(p => p.id === touchDragPlayer);
        if (src?.position && target?.position) {
          handlePreSwapFromDialog(touchDragPlayer, targetId, { reopenSubDialog: false });
          setTouchDragPlayer(null);
          setTouchOffset(null);
          touchIdRef.current = null;
          return;
        }
      }
    }

    // Final position update from touchend to prevent coordinate gap with last touchmove
    if (!droppedOnBench && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;
      setPlayers(prev =>
        prev.map(p =>
          p.id === touchDragPlayer
            ? { ...p, position: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) } }
            : p
        )
      );
    }
    
    setTouchDragPlayer(null);
    setTouchOffset(null);
    touchIdRef.current = null;
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.min(Math.max(prev + delta, 1), 3));
    }
  };

  const handleDragStart = (playerId: string) => {
    if (readOnly) return;
    setDraggedPlayer(playerId);
    // Auto-expand the bench so users can drop directly onto it without opening it first
    const dragged = players.find(p => p.id === playerId);
    if (dragged?.position) {
      setBenchCollapsed(false);
      // Landscape uses the bottom sheet; open it on the bench tab
      setBottomSheetTab("bench");
      setSheetHeightPct(prev => (prev < 50 ? 50 : prev));
      setToolbarCollapsed(false);
    }
  };

  const handleDragEnd = () => {
    setDraggedPlayer(null);
  };

  const handlePitchDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (readOnly) return;
    if (!draggedPlayer || !containerRef.current) return;

    // Detect drop on another pitch player → swap positions
    const dropEl = document.elementFromPoint(e.clientX, e.clientY);
    const targetTokenEl = (dropEl as HTMLElement | null)?.closest('[data-player-variant="pitch"][data-player-id]') as HTMLElement | null;
    const targetId = targetTokenEl?.getAttribute('data-player-id') || null;

    if (targetId && targetId !== draggedPlayer) {
      const dragged = players.find(p => p.id === draggedPlayer);
      const target = players.find(p => p.id === targetId);
      if (dragged?.position && target?.position) {
        handlePreSwapFromDialog(draggedPlayer, targetId, { reopenSubDialog: false });
        setDraggedPlayer(null);
        return;
      }
    }

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

    const dragged = players.find(p => p.id === draggedPlayer);
    const benchPlayersAvail = players.filter(p => p.position === null && !p.isInjured);

    // If dragging a pitch player to the bench AND there's at least one available
    // bench player, open the substitution picker (drag-to-sub shortcut).
    if (dragged?.position && benchPlayersAvail.length > 0) {
      setSelectedOnPitch(draggedPlayer);
      setSubPreviewOpen(true);
      setDraggedPlayer(null);
      return;
    }

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
    // Only allow one drag at a time – ignore if already tracking a finger
    if (touchDragPlayer !== null) return;
    const touch = e.touches[0];
    touchIdRef.current = touch.identifier;
    setTouchDragPlayer(playerId);
    setTouchOffset({ x: touch.clientX, y: touch.clientY });
    // Auto-expand bench when starting to drag a pitch player
    const dragged = players.find(p => p.id === playerId);
    if (dragged?.position) setBenchCollapsed(false);
  };

  // Touch handler for bench players
  const handleBenchTouchMove = useCallback((e: React.TouchEvent) => {
    if (readOnly) return;
    if (!touchDragPlayer || !containerRef.current || touchIdRef.current === null) return;
    const touch = Array.from(e.touches).find(t => t.identifier === touchIdRef.current);
    if (!touch) return;
    e.preventDefault();
    
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
    touchIdRef.current = null;
  }, []);

  // Portrait bench long-press drag handlers
  const handleBenchLongPressStart = useCallback((playerId: string, e: React.TouchEvent) => {
    if (readOnly || subMode || swapMode) return;
    const touch = e.touches[0];
    benchDragStartTouch.current = { x: touch.clientX, y: touch.clientY };
    benchLongPressTimer.current = setTimeout(() => {
      setBenchDragPlayer(playerId);
      setBenchDragPos({ x: touch.clientX, y: touch.clientY });
      hapticImpactMedium();
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

  // ── Auto-regenerate the sub plan when the on-pitch composition changes ──
  // Whenever a manual swap, drag-to-bench, drag-to-pitch, or any other action
  // changes who is currently on the pitch, the existing auto-sub plan can become
  // stale (referencing players who are no longer on the pitch / bench as expected).
  // Triggering a regeneration here keeps both the next-sub card and the timeline
  // in `AutoSubControlPanel` (and projected minutes in `AutoSubPlanDialog`) in sync
  // with reality. Auto-sub executions also change `players`, but those subs are
  // already marked `executed: true` so regeneration is a no-op for them.
  const onPitchSignatureRef = useRef<string>("");
  const lastRegenAtRef = useRef<number>(0);
  useEffect(() => {
    if (!autoSubActive) return;
    if (autoSubPlan.length === 0) return;
    // Stable, order-independent signature of who is on the pitch.
    const sig = playersOnPitch
      .map(p => p.id)
      .sort()
      .join("|");
    const prev = onPitchSignatureRef.current;
    // First run after autosubs activate — capture baseline, no regen.
    if (!prev) {
      onPitchSignatureRef.current = sig;
      return;
    }
    if (prev === sig) return;
    onPitchSignatureRef.current = sig;
    // Debounce against rapid back-to-back state updates (e.g. animation phases).
    const now = Date.now();
    if (now - lastRegenAtRef.current < 250) return;
    lastRegenAtRef.current = now;
    // Defer to next tick so any in-flight setPlayers commits land first.
    const t = setTimeout(() => {
      regeneratePlanRef.current?.();
    }, 50);
    return () => clearTimeout(t);
  }, [playersOnPitch, autoSubActive, autoSubPlan.length, regeneratePlanRef]);

  // ── Cancel auto-subs if the plan references a player who no longer exists ──
  // Catches any removal path (fill-in delete, roster change, etc.) so the
  // panel can't keep showing a "next sub" for a deleted player.
  useEffect(() => {
    if (!autoSubActive || autoSubPlan.length === 0) return;
    const playerIds = new Set(players.map(p => p.id));
    const remaining = autoSubPlan.filter(s => !s.executed);
    const orphaned = remaining.some(
      s => !playerIds.has(s.playerIn.id) || !playerIds.has(s.playerOut.id)
    );
    if (orphaned) {
      handleCancelAutoSubPlan();
      toast({
        title: "Auto-subs cancelled",
        description: "A player in the plan was removed",
      });
    }
  }, [players, autoSubActive, autoSubPlan, handleCancelAutoSubPlan, toast]);

  // Filtered on-pitch players for mini-league team selector (hides the other team)
  const filteredPlayersOnPitch = useMemo(() => {
    if (!miniLeagueTeams || selectedTeamForSettings === "both") return playersOnPitch;
    return playersOnPitch.filter(p => p.teamSide === selectedTeamForSettings);
  }, [playersOnPitch, miniLeagueTeams, selectedTeamForSettings]);

  // Tactical mode: batch-compute visual offsets (CSS translate) for on-pitch players
  const tacticalOffsets = useMemo(() => 
    computeTacticalOffsets(players, tacticalMode, teamSize, !!miniLeagueTeams),
    [players, tacticalMode, teamSize, miniLeagueTeams]
  );

  // Compute ball visual offset to avoid overlapping with tactically-shifted players
  // Don't apply offset while actively dragging the ball
  const ballOffset = useMemo(() =>
    (isDraggingBall || recentlyDraggedBallRef.current) ? { dx: 0, dy: 0 } : computeBallOffset(ballPosition, players, tacticalOffsets, tacticalMode),
    [ballPosition, players, tacticalOffsets, tacticalMode, isDraggingBall]
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
      
      // In mini-league mode, only allow swaps within the same team
      if (miniLeagueTeams && selectedPlayer.teamSide && pitchPlayer.teamSide && selectedPlayer.teamSide !== pitchPlayer.teamSide) return;
      
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
        
        const executedSubs = autoSubPlan.filter(s => s.executed);
        const remainingSubs = autoSubPlan.filter(s => !s.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          minutesPerHalfSecs,
          currentElapsed,
          currentHalf,
          autoSubPlan.find(sub => !sub.executed && sub.playerIn.id === playerId)!,
          rotateGkAtHalftime
        );
        
        // Safety guard: don't let recalculation wipe remaining plan
        let finalPlan: typeof autoSubPlan;
        if (recalculated.length > 0 || remainingSubs.length === 0) {
          finalPlan = [...executedSubs, ...recalculated];
        } else {
          const benchPlayers = updatedPlayers.filter(p => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[PitchBoard] Injury recalculation returned empty — preserving existing plan");
            finalPlan = [...executedSubs, ...remainingSubs];
          } else {
            finalPlan = [...executedSubs, ...recalculated];
          }
        }
        setAutoSubPlan(finalPlan);
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
        const executedSubs = autoSubPlan.filter(s => s.executed);
        const remainingSubs = autoSubPlan.filter(s => !s.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          minutesPerHalfSecs,
          currentElapsed,
          currentHalf,
          relevantSub,
          rotateGkAtHalftime
        );
        
        // Safety guard: don't let recalculation wipe remaining plan
        let finalPlan: typeof autoSubPlan;
        if (recalculated.length > 0 || remainingSubs.length === 0) {
          finalPlan = [...executedSubs, ...recalculated];
        } else {
          const benchPlayers = updatedPlayers.filter(p => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[PitchBoard] Injury recalculation returned empty — preserving existing plan");
            finalPlan = [...executedSubs, ...remainingSubs];
          } else {
            finalPlan = [...executedSubs, ...recalculated];
          }
        }
        setAutoSubPlan(finalPlan);
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

    // If autosubs reference this fill-in player, fully cancel the plan
    // (clears plan, active flag, paused flag, and any pending sub dialog state).
    const referencedInPlan = autoSubPlan.some(
      sub => sub.playerIn.id === playerId || sub.playerOut.id === playerId
    );
    if (autoSubActive && referencedInPlan) {
      handleCancelAutoSubPlan();
      toast({
        title: "Auto-subs cancelled",
        description: `${player.name} was in the plan — auto-subs have been cancelled`,
      });
    } else {
      toast({
        title: "Fill-in player removed",
        description: `${player.name} has been removed`,
      });
    }
  }, [readOnly, players, toast, autoSubPlan, autoSubActive, handleCancelAutoSubPlan]);

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
      
      runSubAnimation(pendingManualSub.pitchPlayerId, pendingManualSub.benchPlayerId, pendingManualSub.swapPlayerId);
      
      setPlayers(prev => prev.map(p => {
        if (p.id === pendingManualSub.pitchPlayerId) {
          return { ...p, position: null, currentPitchPosition: undefined };
        }
        if (p.id === pendingManualSub.swapPlayerId) {
          return { ...p, position: pitchPosition, currentPitchPosition: pitchPositionType };
        }
        if (p.id === pendingManualSub.benchPlayerId) {
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
      
      runSubAnimation(pendingManualSub.pitchPlayerId, pendingManualSub.benchPlayerId);
      
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
    
    // Reset state - exit sub mode after completing a sub
    setManualSubConfirmOpen(false);
    setPendingManualSub(null);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    setSubMode(false);

    // Note: the on-pitch composition effect (see playersOnPitch useEffect)
    // will detect this manual sub and regenerate the auto-sub plan automatically,
    // so we no longer need to call handleRegeneratePlan() here.
  }, [pendingManualSub, toast, pushToUndoHistory]);

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
      <div
        className={cn(
          "fixed inset-0 w-screen h-screen bg-background flex flex-col overflow-hidden pl-safe pr-safe",
          // On native we call StatusBar.hide() in landscape, so the OS status bar
          // is gone and pt-safe would leave a stale gap above the header. Only
          // apply top safe-area padding on web (browser chrome / display cutouts).
          !Capacitor.isNativePlatform() && "pt-safe",
        )}
        style={{ height: '100dvh', zIndex: 99999 }}
      >
        {/* Landscape header bar — sits flush at the top on native (status bar
            hidden) and below the safe area on web. */}
        <div className="shrink-0 h-12 bg-background border-b border-border flex items-center px-3 gap-2 z-[60]">
          {/* Left: Back + Team name */}
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold truncate">{teamName}</span>
          {readOnly && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              <Eye className="h-3 w-3 mr-1" />
              View Only
            </Badge>
          )}
          {!readOnly && isSubsManager && (
            <Badge variant="default" className="text-[10px] shrink-0 bg-primary/90">
              <UserCog className="h-3 w-3 mr-1" />
              Subs Manager
            </Badge>
          )}
          
          <div className="flex-1" />

          {/* Sub-related controls group - centered */}
          <div className="flex items-center gap-3">

            {/* Swap & Sub buttons */}
            {!readOnly && (
              <>
                {playersOnPitch.length >= 2 && !subMode && (
                  <Button
                    variant={swapMode ? "secondary" : "ghost"}
                    size="sm"
                    className="h-10 shrink-0 gap-1.5 px-3 text-sm"
                    onClick={(e) => { e.stopPropagation(); toggleSwapMode(); }}
                  >
                    <ArrowLeftRight className="h-4 w-4" />
                    {swapMode ? "Cancel" : "Swap"}
                  </Button>
                )}
                {!swapMode && (
                  <Button
                    variant={subMode ? "secondary" : "default"}
                    size="sm"
                    className="h-10 shrink-0 gap-1.5 px-3 text-sm"
                    onClick={() => toggleSubMode()}
                  >
                    <Users className="h-4 w-4" />
                    {subMode ? "Cancel" : `Sub (${playersOnBench.length})`}
                  </Button>
                )}
                {(subMode || swapMode) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 shrink-0 gap-1.5 px-3 text-sm text-destructive"
                    onClick={() => { if (subMode) toggleSubMode(); else toggleSwapMode(); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}

          </div>

          <div className="flex-1" />

          {/* Right: Utility controls */}
          <div className="flex items-center gap-1">
            {!readOnly && !linkedEventId && !subMode && !swapMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 gap-1.5 px-3 text-sm"
                onClick={() => setLandscapeEventSelectorOpen(true)}
              >
                <Link2 className="h-4 w-4" />
                Link
              </Button>
            )}
            {!readOnly && !subMode && !swapMode && !(gameInProgress && gameTimerRef.current?.isRunning() && !gameTimerRef.current?.isGameFinished()) && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 shrink-0 gap-1.5 px-3 text-sm"
                onClick={handleSetupGame}
              >
                <Play className="h-4 w-4" />
                Setup
              </Button>
            )}
            {!readOnly && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <div className="relative">
                  <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0" onClick={() => setSettingsMenuOpen(prev => !prev)}>
                    <Settings className="h-6 w-6" />
                  </Button>
                  {settingsMenuOpen && createPortal(
                    <>
                      <div className="fixed inset-0 z-[99998]" onClick={() => setSettingsMenuOpen(false)} />
                      <div className="fixed top-12 right-2 bg-background border rounded-lg shadow-xl z-[99999] min-w-[200px] py-1">
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mode</div>
                        <button
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                          onClick={() => setSettingsMenuOpen(false)}
                        >
                          <Swords className="h-4 w-4" />
                          <span className="flex-1 font-semibold">Match Mode</span>
                          <Check className="h-4 w-4 text-primary" />
                        </button>
                        <button
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                          onClick={() => { setMode("training"); setSettingsMenuOpen(false); }}
                        >
                          <ClipboardList className="h-4 w-4" />
                          <span className="flex-1">Training Mode</span>
                        </button>
                        <div className="h-px bg-border mx-2 my-1" />
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { handleResetFormation(); setSettingsMenuOpen(false); }}>
                          <RotateCcw className="h-4 w-4" />
                          Reset Formation
                        </button>
                        {!disableAutoSubs && (
                          <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { if (autoSubActive) { setAutoSubPanelOpen(true); } else { handleOpenNewPlan(); } setSettingsMenuOpen(false); }}>
                            <RefreshCw className="h-4 w-4" />
                            {autoSubActive ? "Auto Sub Plan" : "Auto Subs"}
                          </button>
                        )}
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setStatsOpen(true); setSettingsMenuOpen(false); }}>
                          <BarChart3 className="h-4 w-4" />
                          Match Stats
                        </button>
                        <div className="h-px bg-border mx-2 my-1" />
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setResetGameConfirmOpen(true); setSettingsMenuOpen(false); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                          <span className="text-destructive">Reset Game</span>
                        </button>
                        <div className="h-px bg-border mx-2 my-1" />
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setSettingsMenuOpen(false); setFillInDialogOpen(true); }}>
                          <UserPlus className="h-4 w-4" />
                          Add Fill-In Player
                        </button>
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setSettingsDialogOpen(true); setSettingsMenuOpen(false); }}>
                          <Settings2 className="h-4 w-4" />
                          All Settings
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
                </div>
                <PitchSettingsDialog
                  selectedFormation={selectedFormation}
                  onFormationChange={handleFormationChange}
                  formations={FORMATIONS[teamSize]}
                  teamSize={teamSize}
                  onTeamSizeChange={handleTeamSizeChange}
                  minutesPerHalf={minutesPerHalf}
                  onMinutesPerHalfChange={handleMinutesPerHalfChange}
                  rotationSpeed={rotationSpeed}
                  onRotationSpeedChange={handleRotationSpeedChange}
                  disablePositionSwaps={disablePositionSwaps}
                  onDisablePositionSwapsChange={setDisablePositionSwaps}
                  disableBatchSubs={disableBatchSubs}
                  onDisableBatchSubsChange={setDisableBatchSubs}
                  rotateGkAtHalftime={rotateGkAtHalftime}
                  onRotateGkAtHalftimeChange={setRotateGkAtHalftime}
                  maxSpreadMinutes={maxSpreadMinutes}
                  onMaxSpreadMinutesChange={handleMaxSpreadMinutesChange}
                  onOpenPositionEditor={() => setPositionEditorOpen(true)}
                  mockMode={mockMode}
                  onMockModeChange={handleMockModeChange}
                  readOnly={readOnly}
                  gameInProgress={gameInProgress}
                  gameTimerRunning={!!gameTimerRef.current?.isRunning()}
                  gameFinished={!!gameTimerRef.current?.isGameFinished()}
                  onResetGame={handleResetGame}
                  onResetFormation={handleResetFormation}
                  onOpenStats={() => setStatsOpen(true)}
                  onSaveSettings={handleSaveSettings}
                  isSaving={isSavingSettings}
                  showMatchHeader={showMatchHeader}
                  onShowMatchHeaderChange={setShowMatchHeader}
                  hideScores={hideScores}
                  onHideScoresChange={setHideScores}
                  showLineupPicker={showLineupPickerSetting}
                  onShowLineupPickerChange={handleShowLineupPickerSettingChange}
                   onOpenLineupPicker={handleSetupGame}
                  onAddFillInPlayer={() => {
                    setToolbarCollapsed(false);
                    setSheetHeightPct(50);
                  }}
                  hideTrigger
                  externalOpen={settingsDialogOpen}
                  onExternalOpenChange={setSettingsDialogOpen}
                  pitchBoardMode={mode}
                  onPitchBoardModeChange={setMode}
                  canUseTrainingMode={canUseTraining}
                />
                <Suspense fallback={null}>
                  <AddFillInPlayerDialog
                    onAddPlayer={handleAddFillInPlayer}
                    existingNumbers={players.map(p => p.number).filter((n): n is number => typeof n === 'number')}
                    hideTrigger
                    externalOpen={fillInDialogOpen}
                    onExternalOpenChange={setFillInDialogOpen}
                  />
                </Suspense>
              </>
            )}
            {readOnly && (
              <div className="relative">
                <Button variant="ghost" size="icon" className="h-12 w-12 shrink-0" onClick={() => setSettingsMenuOpen(prev => !prev)}>
                  <Settings className="h-6 w-6" />
                </Button>
                {settingsMenuOpen && createPortal(
                  <>
                    <div className="fixed inset-0 z-[99998]" onClick={() => setSettingsMenuOpen(false)} />
                    <div className="fixed top-12 right-2 bg-background border rounded-lg shadow-xl z-[99999] min-w-[180px] py-1">
                      <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setStatsOpen(true); setSettingsMenuOpen(false); }}>
                        <BarChart3 className="h-4 w-4" />
                        Match Stats
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Mini-league team selector strip - landscape */}
        {miniLeagueTeams && !readOnly && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-b border-border bg-background z-[60]">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Team:</span>
            {(["a", "b", "both"] as const).map((team) => (
              <button
                key={team}
                className={cn(
                  "h-7 px-3 text-xs font-semibold rounded-md transition-colors",
                  selectedTeamForSettings === team
                    ? "text-white shadow-sm"
                    : "bg-muted hover:bg-muted/80 text-foreground"
                )}
                style={selectedTeamForSettings === team ? {
                  backgroundColor: team === "a" ? miniLeagueTeams.teamAColor 
                    : team === "b" ? miniLeagueTeams.teamBColor 
                    : 'hsl(var(--primary))',
                } : undefined}
                onClick={(e) => { e.stopPropagation(); setSelectedTeamForSettings(team); }}
              >
                {team === "a" ? (miniLeagueTeams.teamAName || "Team A")
                  : team === "b" ? (miniLeagueTeams.teamBName || "Team B")
                  : "Both"}
              </button>
            ))}
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 flex overflow-visible">
          {/* Main pitch area - full height */}
          <div className="flex-1 h-full relative overflow-visible z-[65]">
          
          {/* Floating draggable timer */}
          <div 
            className="absolute z-[70] cursor-move touch-none select-none origin-top-left"
            style={{ 
              left: floatingTimerPosition.x, 
              top: floatingTimerPosition.y,
              transform: `scale(${floatingTimerScale})`,
            }}
            onMouseDown={handleTimerDragStart}
            onTouchStart={handleTimerTouchStart}
          >
             <div className="flex flex-col items-center bg-zinc-800 rounded-lg px-3 py-1.5 shadow-lg">
               {/* Main row: Score | Timer | Play */}
               <div className="flex items-center gap-2 w-full justify-center">
                {gameInProgress && !hideScores && (
                  <ScoreTracker
                    goals={goals}
                    onAddGoal={handleAddGoal}
                    onRemoveGoal={handleRemoveGoal}
                    onUpdateGoal={handleUpdateGoal}
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
                )}
                <GameTimer 
                  key={timerResetKey}
                  ref={gameTimerRef} 
                  compact
                  compactLarge={!(gameInProgress && !hideScores)}
                  teamId={teamId} 
                  teamName={teamName} 
                  onTimeUpdate={handleTimerUpdate} 
                  onHalfChange={handleHalfChange} 
                  readOnly={readOnly}
                  hideExtras
                  minutesPerHalf={minutesPerHalf}
                  onMinutesPerHalfChange={handleMinutesPerHalfChange}
                />
                {!readOnly && !disableAutoSubs && autoSubActive && (
                  <button
                    className="flex items-center justify-center w-5 h-5 rounded-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAutoSubPanelOpen(true);
                    }}
                    title="Auto Subs active"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                  </button>
                )}
              </div>
              {/* Bottom row: Formation • Tactical */}
              <div className="flex items-center gap-1.5 mt-0.5 relative">
                <button
                  className="text-sm text-white/70 font-medium hover:text-white/90 transition-colors px-2 py-1 rounded hover:bg-white/10 active:bg-white/20 min-h-[32px] flex items-center"
                  onClick={(e) => { e.stopPropagation(); if (!readOnly) setTimerFormationDropdownOpen(prev => !prev); }}
                >
                  {FORMATIONS[teamSize][selectedFormation]?.name} ▾
                </button>
                <span className="text-white/30 text-sm">•</span>
                <button
                  className="flex items-center gap-1.5 text-sm text-white/70 font-medium hover:text-white/90 transition-colors px-2 py-1 rounded hover:bg-white/10 active:bg-white/20 min-h-[32px]"
                  onClick={(e) => { e.stopPropagation(); if (!readOnly) setTimerTacticalDropdownOpen(prev => !prev); }}
                >
                  {tacticalMode === "defend" && <Shield className="h-4 w-4 text-blue-400" />}
                  {tacticalMode === "neutral" && <Circle className="h-4 w-4 text-white/60" />}
                  {tacticalMode === "attack" && <Swords className="h-4 w-4 text-orange-400" />}
                  {TACTICAL_MODE_LABELS[tacticalMode]} ▾
                </button>
                {/* Tactical dropdown */}
                {timerTacticalDropdownOpen && (
                  <>
                  <div className="fixed inset-0 z-[59]" onClick={(e) => { e.stopPropagation(); setTimerTacticalDropdownOpen(false); }} />
                  <div className="absolute top-full right-0 mt-1 bg-background border rounded-lg shadow-xl z-[60] min-w-[130px] py-1">
                    {(["defend", "neutral", "attack"] as TacticalMode[]).map((mode) => (
                      <button
                        key={mode}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2",
                          mode === tacticalMode && "bg-muted font-semibold"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTacticalModeChange(mode);
                          setTimerTacticalDropdownOpen(false);
                        }}
                      >
                        {mode === "defend" && <Shield className="h-3.5 w-3.5 text-blue-500" />}
                        {mode === "neutral" && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                        {mode === "attack" && <Swords className="h-3.5 w-3.5 text-orange-500" />}
                        {TACTICAL_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  </>
                )}
                {/* Formation dropdown */}
                {timerFormationDropdownOpen && (
                  <>
                  <div className="fixed inset-0 z-[59]" onClick={(e) => { e.stopPropagation(); setTimerFormationDropdownOpen(false); }} />
                  <div className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-xl z-[60] min-w-[160px] py-1 max-h-64 overflow-y-auto">
                    {/* Team selector moved to top strip */}
                    {FORMATIONS[teamSize].map((f, i) => (
                      <button
                        key={i}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                          i === selectedFormation && "bg-muted font-semibold"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFormationChange(String(i));
                          setTimerFormationDropdownOpen(false);
                        }}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>
            </div>
            {/* Undo button below widget */}
            {!readOnly && showFloatingUndo && undoHistory.length > 0 && (
              <div className="flex justify-center mt-1.5 animate-fade-in">
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); handleUndo(); }}
                  className="shadow-md gap-1.5 opacity-90 hover:opacity-100 cursor-pointer"
                >
                  <Undo2 className="h-4 w-4" />
                  Undo
                </Button>
              </div>
            )}
          </div>

          {/* Score tracker now integrated into the floating timer widget above */}

          {/* Undo button now inside the floating timer widget above */}

          {/* Swap/Sub FABs moved to header - this section intentionally removed */}

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

          {/* Formation suggestion floating popup - landscape */}
          {tacticalFormationSuggestion && !readOnly && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] animate-fade-in">
              <div className="flex flex-col items-center gap-3 bg-card border border-border rounded-2xl px-6 py-5 shadow-xl max-w-[280px]">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                  {tacticalFormationSuggestion.mode === "attack"
                    ? <Swords className="h-5 w-5 text-primary" />
                    : <Shield className="h-5 w-5 text-primary" />}
                </div>
                <div className="text-center space-y-1">
                  <p className="text-base font-bold">
                    Try {tacticalFormationSuggestion.formationName}?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tacticalFormationSuggestion.mode === "attack"
                      ? "More forwards for attacking play"
                      : "Extra defenders for solid cover"}
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full mt-1">
                  <Button type="button" className="flex-1 h-10" onClick={handleApplyTacticalSuggestion}>
                    Apply
                  </Button>
                  <Button type="button" variant="outline" className="flex-1 h-10" onClick={handleDismissTacticalSuggestion}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div 
            id="landscape-pitch-area"
            className={cn("w-full h-full", zoom > 1 ? "overflow-auto" : "overflow-hidden")}
            style={{ zIndex: 0 }}
            onWheel={handleWheel}
          >
            <div 
              className={cn(
              "transition-transform duration-100",
              drawingTool === "none" && zoom <= 1 ? "touch-none" : ""
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
                width: `${zoom * 100}%`,
                height: `${zoom * 100}%`,
                position: 'relative',
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
                onPointerUp={() => {
                  if (showFloatingDrawToolbar && !pinDrawingToolbar && !isDrawingArrowRef.current && drawingTool === "none") {
                    setTimeout(() => {
                      setDrawingTool("none");
                      setShowFloatingDrawToolbar(false);
                    }, 50);
                  }
                }}
                style={{
                  zIndex: drawingTool !== "none" || showFloatingDrawToolbar ? 30 : 5,
                  pointerEvents: drawingTool !== "none" || showFloatingDrawToolbar ? "auto" : "none",
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
                  transition: isDraggingBall ? "none" : (tacticalMode !== "neutral" ? "left 0.4s ease, top 0.4s ease" : undefined),
                  pointerEvents: drawingEnabled ? "none" : "auto",
                }}
              />

              {/* Players on pitch */}
              {filteredPlayersOnPitch.map(player => (
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
                      touchIdRef.current = null;
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
                  subAnimation={subAnimationPlayers.in === player.id ? "in" : subAnimationPlayers.swap === player.id ? "swap" : null}
                  readOnly={readOnly}
                  teamColor={getPlayerTeamColor(player)}
                  isNextSub={nextSubInfo?.playerOutId === player.id}
                  nextSubCountdown={nextSubInfo?.playerOutId === player.id ? nextSubInfo.countdown : null}
                  isSubDue={subDuePlayerIds.has(player.id)}
                  style={{
                    position: "absolute",
                    ...(() => {
                      const isDragging = draggedPlayer === player.id || touchDragPlayer === player.id;
                      const recentlyDropped = recentlyDraggedRef.current.has(player.id);
                      // Suppress both transition AND tactical offset for recently-dropped players
                      const offset = (!isDragging && !recentlyDropped) ? tacticalOffsets.get(player.id) : undefined;
                      const tx = offset?.dx ?? 0;
                      const ty = offset?.dy ?? 0;
                      return {
                        left: `${player.position!.x + tx}%`,
                        top: `${player.position!.y + ty}%`,
                        transform: "translate(-50%, -50%)",
                        transition: (isDragging || recentlyDropped || touchDragPlayer !== null || draggedPlayer !== null) ? "none" : "left 0.6s cubic-bezier(0.4, 0, 0.2, 1), top 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                      };
                    })(),
                    zIndex: (subAnimationPlayers.in === player.id || subAnimationPlayers.swap === player.id) ? 40 : previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id ? 30 : (touchDragPlayer === player.id ? 50 : 10),
                    cursor: readOnly ? "default" : ((subMode || swapMode) ? "pointer" : "grab"),
                    pointerEvents: drawingEnabled ? "none" : "auto",
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
            className="absolute bottom-0 left-0 right-0 z-[66] flex justify-center items-end pointer-events-auto"
            style={{ height: 56 }}
            onTouchStart={(e) => {
              const el = e.currentTarget;
              if (ignoreNextLandscapeBenchOpenRef.current || drawingTool !== "none" || showFloatingDrawToolbar) {
                delete el.dataset.swipeStartY;
                delete el.dataset.swipeStartT;
                return;
              }
              el.dataset.swipeStartY = String(e.touches[0].clientY);
              el.dataset.swipeStartT = String(Date.now());
            }}
            onTouchEnd={(e) => {
              const startY = Number(e.currentTarget.dataset.swipeStartY || 0);
              const startT = Number(e.currentTarget.dataset.swipeStartT || 0);
              delete e.currentTarget.dataset.swipeStartY;
              delete e.currentTarget.dataset.swipeStartT;
              if (ignoreNextLandscapeBenchOpenRef.current || drawingTool !== "none" || showFloatingDrawToolbar) return;
              if (!startY || !startT) return;
              const deltaY = startY - e.changedTouches[0].clientY;
              const elapsed = Date.now() - startT;
              const velocity = deltaY / Math.max(elapsed, 1);
              // Open on fast flick (velocity > 0.3px/ms) or sufficient distance (>20px)
              if (deltaY > 20 || velocity > 0.3) { setSheetHeightPct(50); setToolbarCollapsed(false); }
            }}
            onTouchCancel={(e) => {
              delete e.currentTarget.dataset.swipeStartY;
              delete e.currentTarget.dataset.swipeStartT;
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
              className={cn(
                "absolute bottom-3 right-3 z-[70] w-12 h-12 rounded-full bg-background/95 backdrop-blur-md border-2 border-border shadow-xl flex items-center justify-center",
                showFloatingDrawToolbar && "pointer-events-none opacity-70"
              )}
              onPointerDown={(e) => { e.stopPropagation(); }}
              onClick={(e) => {
                e.stopPropagation();
                if (showFloatingDrawToolbar) return;
                ignoreNextLandscapeBackdropClickRef.current = true;
                setBottomSheetTab("bench");
                setSheetHeightPct(50);
                setToolbarCollapsed(false);
                window.setTimeout(() => {
                  ignoreNextLandscapeBackdropClickRef.current = false;
                }, 0);
              }}
            >
              <Users className="h-6 w-6 text-foreground" />
            </button>


            <button
              className={cn(
                "absolute bottom-3 z-[70] w-12 h-12 rounded-full backdrop-blur-md border-2 shadow-xl flex items-center justify-center",
                drawingTool !== "none"
                  ? "bg-primary text-primary-foreground border-primary"
                  : showFloatingDrawToolbar
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-background/95 border-border text-foreground"
              )}
              style={{ right: 76 }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                ignoreNextLandscapeBenchOpenRef.current = true;
                window.setTimeout(() => {
                  ignoreNextLandscapeBenchOpenRef.current = false;
                }, 300);
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                ignoreNextLandscapeBenchOpenRef.current = true;
                window.setTimeout(() => {
                  ignoreNextLandscapeBenchOpenRef.current = false;
                }, 300);
              }}
              onClick={(e) => {
                e.stopPropagation();
                setShowFloatingDrawToolbar(prev => !prev);
              }}
            >
              <Pencil className="h-6 w-6" />
            </button>

            {/* Floating Draw Toolbar */}
            {showFloatingDrawToolbar && (
              <div className="absolute bottom-[4.5rem] z-[71] animate-fade-in" style={{ right: 12 }} onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                <div className="bg-background/95 backdrop-blur border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Button 
                      variant={drawingTool === "pen" ? "default" : "outline"} 
                      size="icon"
                      className="h-12 w-12"
                      onTouchStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                        const nextTool = drawingTool === "pen" ? "none" : "pen";
                        setDrawingTool(nextTool);
                        if (nextTool !== "none" && !pinDrawingToolbar) setShowFloatingDrawToolbar(false);
                      }}
                    >
                      <Pencil className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant={drawingTool === "arrow" ? "default" : "outline"} 
                      size="icon"
                      className="h-12 w-12"
                      onTouchStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        ignoreNextLandscapeBenchOpenRef.current = true;
                        window.setTimeout(() => {
                          ignoreNextLandscapeBenchOpenRef.current = false;
                        }, 300);
                        const nextTool = drawingTool === "arrow" ? "none" : "arrow";
                        setDrawingTool(nextTool);
                        if (nextTool !== "none" && !pinDrawingToolbar) setShowFloatingDrawToolbar(false);
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
                    <Button 
                      variant={pinDrawingToolbar ? "default" : "outline"} 
                      size="icon" 
                      className="h-12 w-12"
                      onClick={() => setPinDrawingToolbar(prev => !prev)}
                      title={pinDrawingToolbar ? "Unpin drawing tools" : "Pin drawing tools"}
                    >
                      <Pin className={cn("h-5 w-5", pinDrawingToolbar && "rotate-45")} />
                    </Button>
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
          <div className="absolute inset-0 z-[68] flex flex-col pointer-events-none" style={{ height: '100%' }}>
            {/* Backdrop - pass through when drawing */}
            <div 
              className={cn("flex-1", drawingTool === "none" ? "pointer-events-auto" : "pointer-events-none")}
              onClick={drawingTool === "none" ? () => {
                if (ignoreNextLandscapeBackdropClickRef.current) return;
                setToolbarCollapsed(true);
              } : undefined}
            />
            {/* Sheet */}
            <div className="pointer-events-auto bg-background border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-200 flex flex-col"
              style={{ maxHeight: `${sheetHeightPct}%`, height: 'auto' }}
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
                  const newPct = Math.min(85, Math.max(25, sheetDragRef.current.startPct + deltaPct));
                  setSheetHeightPct(newPct);
                }}
                onTouchEnd={(e) => {
                  const elapsed = Date.now() - Number(e.currentTarget.dataset.dragStartT || "0");
                  const deltaY = sheetDragRef.current ? sheetDragRef.current.startY - e.changedTouches[0].clientY : 0;
                  const velocity = deltaY / Math.max(elapsed, 1);
                  if (velocity < -0.4) {
                    setToolbarCollapsed(true);
                    setSheetHeightPct(35);
                  } else if (velocity > 0.4) {
                    // Fast upward flick → expand
                    if (sheetHeightPct > 55) {
                      setSheetHeightPct(80);
                    } else {
                      setSheetHeightPct(50);
                    }
                  } else if (sheetHeightPct < 30) {
                    setToolbarCollapsed(true);
                    setSheetHeightPct(35);
                  } else if (sheetHeightPct < 42) {
                    setSheetHeightPct(35);
                  } else if (sheetHeightPct < 65) {
                    setSheetHeightPct(50);
                  } else {
                    setSheetHeightPct(80);
                  }
                  sheetDragRef.current = null;
                }}
              >
                {/* Handle bar */}
                <div className="flex items-center justify-center gap-2 pt-2 pb-1">
                  {autoSubActive && autoSubPlan.length > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                  {autoSubActive && autoSubPlan.length > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                </div>
      </div>


              {/* Tab content */}
              <div className="overflow-y-auto p-3 flex-1 min-h-0">
                {/* Bench content */}
                  <div className="space-y-3">
                    {/* Position Filter Chips - sticky */}
                    <div className="sticky top-[-12px] z-10 bg-background py-2 -mx-3 px-3 space-y-2">
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
                      {/* Auto Subs Quick Access - Landscape (inside sticky area) */}
                      {!readOnly && !disableAutoSubs && (
                        <>
                          {autoSubPlan.length > 0 ? (
                            <button
                              className="w-full flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 text-primary text-sm font-medium px-3 py-2 min-h-[36px] transition-colors hover:bg-primary/20"
                              onClick={() => {
                                setAutoSubPanelOpen(true);
                              }}
                            >
                              <ArrowLeftRight className="h-4 w-4" />
                              Auto Subs ({autoSubPlan.filter(s => s.executed).length}/{autoSubPlan.length})
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                              </span>
                            </button>
                          ) : (
                            <button
                              className="w-full flex items-center justify-center gap-2 rounded-md border border-border bg-muted/50 text-muted-foreground text-sm font-medium px-3 py-2 min-h-[36px] transition-colors hover:bg-muted"
                              onClick={() => {
                                openAutoSubPlanDialog();
                              }}
                            >
                              <ArrowLeftRight className="h-4 w-4" />
                              Setup Auto Subs
                            </button>
                          )}
                        </>
                      )}
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
                          // Mini-league team filter
                          if (miniLeagueTeams && selectedTeamForSettings !== "both" && player.teamSide !== selectedTeamForSettings) return false;
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
                              isNextSub={nextSubInfo?.playerInId === player.id}
                              nextSubCountdown={nextSubInfo?.playerInId === player.id ? nextSubInfo.countdown : null}
                              isSubDue={subDuePlayerIds.has(player.id)}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Pitch Shortcuts moved to landscape header bar */}

        {/* Tactical Mode moved to landscape header bar */}

        {/* Sub mode instruction banner */}
        {subMode && (
          <div className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[75] px-5 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none",
            "bg-primary text-primary-foreground"
          )}>
            <p className="text-sm font-medium whitespace-nowrap">
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
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[75] px-5 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none",
            swapPlayer1 && getValidSwapPlayerIds.size === 0 
              ? "bg-destructive text-destructive-foreground" 
              : "bg-primary text-primary-foreground"
          )}>
            <p className="text-sm font-medium whitespace-nowrap">
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
          miniLeagueTeams={miniLeagueTeams}
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
          minorAdjustments={pendingFormationChange?.minorAdjustments || []}
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
          maxSpreadMinutes={maxSpreadMinutes}
          currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
          currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
          showStepper={autoSubFromPreGame}
          miniLeagueTeams={miniLeagueTeams}
          preferredSecondHalfGkId={preferredSecondHalfGkId}
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

        {/* Landscape Event Selector Sheet - allow linking mid-game if no event linked */}
        {!readOnly && (!gameInProgress || !linkedEventId) && (
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
        <AlertDialog open={benchInjuryConfirmOpen} onOpenChange={(open) => { if (!open) { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); } }}>
          <AlertDialogContent className="z-[999999]">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark as Fit?" : "Mark as Injured?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {players.find(p => p.id === benchInjuryTarget)?.isInjured
                  ? `${players.find(p => p.id === benchInjuryTarget)?.name} will be available for substitutions again.`
                  : `${players.find(p => p.id === benchInjuryTarget)?.name} will not be available for substitutions.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); }}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (benchInjuryTarget) togglePlayerInjury(benchInjuryTarget);
                  setBenchInjuryConfirmOpen(false);
                  setBenchInjuryTarget(null);
                }}
              >
                {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark Fit" : "Mark Injured"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Match Stats Panel */}
        <MatchStatsPanel
          open={statsOpen}
          onOpenChange={setStatsOpen}
          players={players}
          elapsedGameTime={elapsedGameTime}
          goals={goals}
          teamName={teamName}
          opponentName={opponentName}
          hideScores={hideScores}
        />

        {/* Reset Game Confirmation - landscape */}
        <AlertDialog open={resetGameConfirmOpen} onOpenChange={setResetGameConfirmOpen}>
          <AlertDialogContent className="z-[999999]">
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Game?</AlertDialogTitle>
              <AlertDialogDescription>
                This will clear all player minutes, timer, substitutions, goals, and reset positions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { handleResetGame(); setResetGameConfirmOpen(false); }}
              >
                Reset Game
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Auto-Sub Control Panel - landscape */}
        {autoSubPanelOpen && autoSubActive && (
          <Suspense fallback={<DialogLoader />}>
            <AutoSubControlPanel
              autoSubPlan={autoSubPlan}
              autoSubPaused={autoSubPaused}
              players={players}
              lockedPlayerIds={lockedPlayerIds}
              currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
              currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
              minutesPerHalf={minutesPerHalf}
              onTogglePause={handleTogglePauseAutoSub}
              onCancelPlan={() => { handleCancelAutoSubPlan(); setAutoSubPanelOpen(false); }}
              onSkipNext={handleSkipNextSub}
              onExecuteNow={handleExecuteNow}
              onEditPlan={() => { handleOpenEditPlan(); setAutoSubPanelOpen(false); }}
              onRegeneratePlan={handleRegeneratePlan}
              onToggleLockPlayer={handleToggleLockPlayer}
              onClose={() => setAutoSubPanelOpen(false)}
            />
          </Suspense>
        )}

        {/* Pre-Game Lineup Screen - landscape */}
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
              rotationSpeed={rotationSpeed}
              onRotationSpeedChange={setRotationSpeed}
            />
          </Suspense>
        )}

        {/* Training Mode overlay (landscape) — portal'd to body so it covers the match. */}
        {mode === "training" && createPortal(
          <div
            className="fixed top-0 left-0 right-0 bottom-0 w-screen h-screen flex flex-col bg-background"
            style={{ height: '100dvh', zIndex: 999999 }}
          >
            <div className="shrink-0 flex items-center gap-2 px-3 h-11 border-b border-border bg-background">
              <div className="flex-1 min-w-0 text-sm font-medium truncate">{teamName}</div>
              <div className="relative">
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setTrainingMenuOpen(prev => !prev)}>
                  <Settings className="h-5 w-5" />
                </Button>
                {trainingMenuOpen && createPortal(
                  <>
                    <div className="fixed inset-0 z-[9999998]" onClick={() => setTrainingMenuOpen(false)} />
                    <div className="fixed top-12 right-2 bg-background border rounded-lg shadow-xl z-[9999999] min-w-[200px] py-1">
                      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mode</div>
                      <button
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        onClick={() => { setMode("match"); setTrainingMenuOpen(false); }}
                      >
                        <Swords className="h-4 w-4" />
                        <span className="flex-1">Match Mode</span>
                      </button>
                      <button
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        onClick={() => setTrainingMenuOpen(false)}
                      >
                        <ClipboardList className="h-4 w-4" />
                        <span className="flex-1 font-semibold">Training Mode</span>
                        <Check className="h-4 w-4 text-primary" />
                      </button>
                      <div className="h-px bg-border mx-2 my-1" />
                      <button
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        onClick={() => { setTrainingSettingsDialogOpen(true); setTrainingMenuOpen(false); }}
                      >
                        <Settings2 className="h-4 w-4" />
                        Training Settings
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <Suspense fallback={<PitchBoardLoading message="Loading Training Mode..." />}>
                <TrainingBoard
                  isLandscape={isLandscape}
                  readOnly={readOnly}
                  teamId={teamId}
                  teamName={teamName}
                  members={members}
                  linkedEventId={linkedEventId}
                />
              </Suspense>
            </div>
          </div>,
          document.body
        )}
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
          onLinkEvent={readOnly || (gameInProgress && !!linkedEventId) ? undefined : handleLinkEvent}
          isGameInProgress={gameInProgress}
        />
        )}

      {/* Slim Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0 bg-background">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold flex-1 truncate min-w-0">{teamName}</h1>
        {readOnly && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0.5 shrink-0">
            <Eye className="h-3 w-3 mr-1" />
            View Only
          </Badge>
        )}
        {!readOnly && isSubsManager && (
          <Badge variant="default" className="text-xs px-1.5 py-0.5 shrink-0 bg-primary/90">
            <UserCog className="h-3 w-3 mr-1" />
            Subs Manager
          </Badge>
        )}
        {!readOnly && (
          <>
            {/* Swap button */}
            {playersOnPitch.length >= 2 && !subMode && (
              <Button
                variant={swapMode ? "outline" : "ghost"}
                size="sm"
                className="h-9 shrink-0 gap-1 px-2 text-xs"
                onClick={toggleSwapMode}
              >
                <ArrowLeftRight className="h-4 w-4" />
                {swapMode ? "Cancel" : "Swap"}
              </Button>
            )}
            {/* Sub button */}
            {!swapMode && (
              <Button
                variant={subMode ? "secondary" : "default"}
                size="sm"
                className="h-9 shrink-0 gap-1 px-2 text-xs"
                onClick={() => toggleSubMode()}
              >
                <Users className="h-4 w-4" />
                {subMode ? "Cancel" : `Sub (${playersOnBench.length})`}
              </Button>
            )}
            {!subMode && !swapMode && !(gameInProgress && gameTimerRef.current?.isRunning() && !gameTimerRef.current?.isGameFinished()) && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 gap-1 px-2 text-xs"
                onClick={handleSetupGame}
              >
                <Play className="h-4 w-4" />
                Setup
              </Button>
            )}
            <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
            <div className="relative">
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setSettingsMenuOpen(prev => !prev)}>
                <Settings className="h-4 w-4" />
              </Button>
              {settingsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[99998]" onClick={() => setSettingsMenuOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 bg-background border rounded-lg shadow-xl z-[99999] min-w-[200px] py-1">
                    {!readOnly && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mode</div>
                        <button
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                          onClick={() => setSettingsMenuOpen(false)}
                        >
                          <Swords className="h-4 w-4" />
                          <span className="flex-1 font-semibold">Match Mode</span>
                          <Check className="h-4 w-4 text-primary" />
                        </button>
                        <button
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                          onClick={() => { setMode("training"); setSettingsMenuOpen(false); }}
                        >
                          <ClipboardList className="h-4 w-4" />
                          <span className="flex-1">Training Mode</span>
                        </button>
                        <div className="h-px bg-border mx-2 my-1" />
                      </>
                    )}
                    {!readOnly && (
                      <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { handleResetFormation(); setSettingsMenuOpen(false); }}>
                        <RotateCcw className="h-4 w-4" />
                        Reset Formation
                      </button>
                    )}
                    {!readOnly && !disableAutoSubs && (
                      <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { if (autoSubActive) { setAutoSubPanelOpen(true); } else { handleOpenNewPlan(); } setSettingsMenuOpen(false); }}>
                        <RefreshCw className="h-4 w-4" />
                        {autoSubActive ? "Auto Sub Plan" : "Auto Subs"}
                      </button>
                    )}
                    <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setStatsOpen(true); setSettingsMenuOpen(false); }}>
                      <BarChart3 className="h-4 w-4" />
                      Match Stats
                    </button>
                    {!readOnly && (
                      <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setResetGameConfirmOpen(true); setSettingsMenuOpen(false); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                        <span className="text-destructive">Reset Game</span>
                      </button>
                    )}
                    {!readOnly && (
                      <>
                        <div className="h-px bg-border mx-2 my-1" />
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setSettingsMenuOpen(false); setFillInDialogOpen(true); }}>
                          <UserPlus className="h-4 w-4" />
                          Add Fill-In Player
                        </button>
                        <button className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2" onClick={() => { setSettingsDialogOpen(true); setSettingsMenuOpen(false); }}>
                          <Settings2 className="h-4 w-4" />
                          All Settings
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            {!readOnly && (
              <PitchSettingsDialog
                selectedFormation={selectedFormation}
                onFormationChange={handleFormationChange}
                formations={FORMATIONS[teamSize]}
                teamSize={teamSize}
                onTeamSizeChange={handleTeamSizeChange}
                minutesPerHalf={minutesPerHalf}
                onMinutesPerHalfChange={handleMinutesPerHalfChange}
                rotationSpeed={rotationSpeed}
                onRotationSpeedChange={handleRotationSpeedChange}
                disablePositionSwaps={disablePositionSwaps}
                onDisablePositionSwapsChange={setDisablePositionSwaps}
                disableBatchSubs={disableBatchSubs}
                onDisableBatchSubsChange={setDisableBatchSubs}
                rotateGkAtHalftime={rotateGkAtHalftime}
                onRotateGkAtHalftimeChange={setRotateGkAtHalftime}
                maxSpreadMinutes={maxSpreadMinutes}
                onMaxSpreadMinutesChange={handleMaxSpreadMinutesChange}
                onOpenPositionEditor={() => setPositionEditorOpen(true)}
                mockMode={mockMode}
                onMockModeChange={handleMockModeChange}
                readOnly={readOnly}
                gameInProgress={gameInProgress}
                gameTimerRunning={!!gameTimerRef.current?.isRunning()}
                gameFinished={!!gameTimerRef.current?.isGameFinished()}
                onResetGame={handleResetGame}
                onResetFormation={handleResetFormation}
                onOpenStats={() => setStatsOpen(true)}
                onSaveSettings={handleSaveSettings}
                isSaving={isSavingSettings}
                showMatchHeader={showMatchHeader}
                onShowMatchHeaderChange={setShowMatchHeader}
                hideScores={hideScores}
                onHideScoresChange={setHideScores}
                showLineupPicker={showLineupPickerSetting}
                onShowLineupPickerChange={handleShowLineupPickerSettingChange}
                onOpenLineupPicker={handleSetupGame}
                hideTrigger
                externalOpen={settingsDialogOpen}
                onExternalOpenChange={setSettingsDialogOpen}
                pitchBoardMode={mode}
                onPitchBoardModeChange={setMode}
                canUseTrainingMode={canUseTraining}
              />
            )}
            <TrainingSettingsDialog
              open={trainingSettingsDialogOpen}
              onOpenChange={setTrainingSettingsDialogOpen}
            />
          </>
        )}
      </div>

      {/* Training Mode overlay — portal'd to document.body so it sits above the
          PitchBoard portal AND any global dock/header. Match body stays mounted
          so its state (timer, subs, players) is preserved. */}
      {mode === "training" && createPortal(
        <div
          className={cn(
            "fixed top-0 left-0 right-0 bottom-0 w-screen h-screen flex flex-col bg-background",
            isNative && "pt-safe"
          )}
          style={{
            height: '100dvh',
            zIndex: 999999,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {/* Training-mode header */}
          <div className="shrink-0 flex items-center gap-2 px-3 h-11 border-b border-border bg-background">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 -ml-1"
              onClick={onClose}
              aria-label="Close training mode"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0 text-sm font-medium truncate">{teamName}</div>
            <div className="relative">
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setTrainingMenuOpen(prev => !prev)}>
                <Settings className="h-5 w-5" />
              </Button>
              {trainingMenuOpen && createPortal(
                <>
                  <div className="fixed inset-0 z-[9999998]" onClick={() => setTrainingMenuOpen(false)} />
                  <div className="fixed top-12 right-2 bg-background border rounded-lg shadow-xl z-[9999999] min-w-[200px] py-1">
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Mode</div>
                    <button
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                      onClick={() => { setMode("match"); setTrainingMenuOpen(false); }}
                    >
                      <Swords className="h-4 w-4" />
                      <span className="flex-1">Match Mode</span>
                    </button>
                    <button
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                      onClick={() => setTrainingMenuOpen(false)}
                    >
                      <ClipboardList className="h-4 w-4" />
                      <span className="flex-1 font-semibold">Training Mode</span>
                      <Check className="h-4 w-4 text-primary" />
                    </button>
                    <div className="h-px bg-border mx-2 my-1" />
                    <button
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                      onClick={() => { setTrainingSettingsDialogOpen(true); setTrainingMenuOpen(false); }}
                    >
                      <Settings2 className="h-4 w-4" />
                      Training Settings
                    </button>
                  </div>
                </>,
                document.body
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <Suspense fallback={<PitchBoardLoading message="Loading Training Mode..." />}>
              <TrainingBoard
                isLandscape={isLandscape}
                readOnly={readOnly}
                teamId={teamId}
                teamName={teamName}
                members={members}
                linkedEventId={linkedEventId}
              />
            </Suspense>
          </div>
        </div>,
        document.body
      )}

      {/* Mini-league team selector strip - portrait */}
      {miniLeagueTeams && !readOnly && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-background">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Team:</span>
          {(["a", "b", "both"] as const).map((team) => (
            <button
              key={team}
              className={cn(
                "h-8 px-3 text-xs font-semibold rounded-md transition-colors",
                selectedTeamForSettings === team
                  ? "text-white shadow-sm"
                  : "bg-muted hover:bg-muted/80 text-foreground"
              )}
              style={selectedTeamForSettings === team ? {
                backgroundColor: team === "a" ? miniLeagueTeams.teamAColor 
                  : team === "b" ? miniLeagueTeams.teamBColor 
                  : 'hsl(var(--primary))',
              } : undefined}
              onClick={() => setSelectedTeamForSettings(team)}
            >
              {team === "a" ? (miniLeagueTeams.teamAName || "Team A")
                : team === "b" ? (miniLeagueTeams.teamBName || "Team B")
                : "Both"}
            </button>
          ))}
        </div>
      )}

      {/* Full-screen Pitch Area */}
      <div className="flex-1 min-h-0 relative overflow-visible z-[65]">
        {/* Floating score + timer combined row - draggable + resizable */}
        <div 
          className={cn("absolute z-[70] select-none pointer-events-auto touch-none cursor-move", portraitTimerPosition ? "origin-top-left" : "origin-top-right")}
          style={{ 
            ...(portraitTimerPosition 
              ? { left: portraitTimerPosition.x, top: portraitTimerPosition.y, right: 'auto' }
              : { right: 8, top: 8 }
            ),
            transform: `scale(${portraitTimerScale})`,
          }}
          onTouchStart={handlePortraitTimerTouchStart}
        >
           <div className="flex flex-col items-end">
            <div className="flex flex-col items-center bg-zinc-800 rounded-lg px-3 py-1.5 shadow-lg">
              {/* Main row: Score | Timer */}
              <div className="flex items-center gap-2 w-full justify-center">
                {gameInProgress && !hideScores && !showScoreInPortrait && (
                  <ScoreTracker
                    goals={goals}
                    onAddGoal={handleAddGoal}
                    onRemoveGoal={handleRemoveGoal}
                    onUpdateGoal={handleUpdateGoal}
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
                )}
                <GameTimer 
                  key={timerResetKey}
                  ref={gameTimerRef} 
                  compact
                  compactLarge={!(gameInProgress && !hideScores && !showScoreInPortrait)}
                  teamId={teamId} 
                  teamName={teamName} 
                  onTimeUpdate={handleTimerUpdate} 
                  onHalfChange={handleHalfChange} 
                  readOnly={readOnly}
                  hideExtras
                  minutesPerHalf={minutesPerHalf}
                  onMinutesPerHalfChange={handleMinutesPerHalfChange}
                />
                {!readOnly && !disableAutoSubs && autoSubActive && (
                  <button
                    className="flex items-center justify-center w-5 h-5 rounded-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAutoSubPanelOpen(true);
                    }}
                    title="Auto Subs active"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                  </button>
                )}
              </div>
              {/* Bottom row: Formation • Tactical */}
              <div className="flex items-center gap-2 mt-0.5 relative">
                <button
                   className="text-sm text-white/70 font-medium hover:text-white/90 transition-colors px-2.5 py-1.5 rounded hover:bg-white/10 active:bg-white/20 min-h-[44px] flex items-center"
                  onClick={(e) => { e.stopPropagation(); if (!readOnly) setTimerFormationDropdownOpen(prev => !prev); }}
                >
                  {FORMATIONS[teamSize][selectedFormation]?.name} ▾
                </button>
                <span className="text-white/30 text-sm">•</span>
                <button
                  className="flex items-center gap-1.5 text-sm text-white/70 font-medium hover:text-white/90 transition-colors px-2.5 py-1.5 rounded hover:bg-white/10 active:bg-white/20 min-h-[44px]"
                  onClick={(e) => { e.stopPropagation(); if (!readOnly) setTimerTacticalDropdownOpen(prev => !prev); }}
                >
                  {tacticalMode === "defend" && <Shield className="h-4 w-4 text-blue-400" />}
                  {tacticalMode === "neutral" && <Circle className="h-4 w-4 text-white/60" />}
                  {tacticalMode === "attack" && <Swords className="h-4 w-4 text-orange-400" />}
                  {TACTICAL_MODE_LABELS[tacticalMode]} ▾
                </button>
                {/* Tactical dropdown - portrait */}
                {timerTacticalDropdownOpen && (
                  <>
                  <div className="fixed inset-0 z-[59]" onClick={(e) => { e.stopPropagation(); setTimerTacticalDropdownOpen(false); }} />
                   <div data-timer-dropdown className="absolute top-full right-0 mt-1 bg-background border rounded-lg shadow-xl z-[60] min-w-[130px] py-1">
                    {(["defend", "neutral", "attack"] as TacticalMode[]).map((mode) => (
                      <button
                        key={mode}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2",
                          mode === tacticalMode && "bg-muted font-semibold"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTacticalModeChange(mode);
                          setTimerTacticalDropdownOpen(false);
                        }}
                      >
                        {mode === "defend" && <Shield className="h-3.5 w-3.5 text-blue-500" />}
                        {mode === "neutral" && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                        {mode === "attack" && <Swords className="h-3.5 w-3.5 text-orange-500" />}
                        {TACTICAL_MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  </>
                )}
                {/* Formation dropdown */}
                {timerFormationDropdownOpen && (
                  <>
                  <div className="fixed inset-0 z-[59]" onClick={(e) => { e.stopPropagation(); setTimerFormationDropdownOpen(false); }} />
                   <div data-timer-dropdown className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-xl z-[60] min-w-[160px] py-1 max-h-64 overflow-y-auto">
                    {/* Team selector moved to top strip */}
                    {FORMATIONS[teamSize].map((f, i) => (
                      <button
                        key={i}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                          i === selectedFormation && "bg-muted font-semibold"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFormationChange(String(i));
                          setTimerFormationDropdownOpen(false);
                        }}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Floating undo button - below timer widget in portrait */}
        {!readOnly && showFloatingUndo && undoHistory.length > 0 && !portraitSheetOpen && (
          <div className="absolute top-2 left-2 z-[64] animate-fade-in">
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

        {/* Swap/Sub FABs moved to header */}

        {/* Floating settings button - bottom right to open sheet */}
        {!portraitSheetOpen && (
          <>
            <button
              className={cn(
                "absolute right-3 z-[70] w-12 h-12 rounded-full bg-background/95 backdrop-blur-md border-2 border-border shadow-xl flex items-center justify-center",
                "bottom-3"
              )}
              onPointerDown={(e) => { e.stopPropagation(); }}
              onClick={() => {
                setDrawingTool("none");
                setShowFloatingDrawToolbar(false);
                setPortraitSheetOpen(true);
              }}
            >
              <Users className="h-6 w-6 text-foreground" />
            </button>

            {/* Floating Draw FAB - portrait */}
            {!readOnly && (
              <>
                <button
                  className={cn(
                    "absolute z-[70] w-12 h-12 rounded-full backdrop-blur-md border-2 shadow-xl flex items-center justify-center",
                    "bottom-3",
                    drawingTool !== "none"
                      ? "bg-primary text-primary-foreground border-primary"
                      : showFloatingDrawToolbar
                        ? "bg-accent text-accent-foreground border-accent"
                        : "bg-background/95 border-border text-foreground"
                  )}
                  style={{ right: 76 }}
                  onPointerDown={(e) => { e.stopPropagation(); }}
                  onClick={() => setShowFloatingDrawToolbar(prev => !prev)}
                >
                  <Pencil className="h-6 w-6" />
                </button>

                {/* Floating Draw Toolbar - portrait */}
                {showFloatingDrawToolbar && (
                  <div className={cn("absolute right-3 z-[71] animate-fade-in", (subMode || swapMode) ? "bottom-[6.5rem]" : "bottom-16")} onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                    <div className="bg-background/95 backdrop-blur border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3">
                      <div className="flex gap-2">
                        <Button 
                          variant={drawingTool === "pen" ? "default" : "outline"} 
                          size="icon"
                          className="h-12 w-12"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const nextTool = drawingTool === "pen" ? "none" : "pen";
                            setDrawingTool(nextTool);
                            if (nextTool !== "none" && !pinDrawingToolbar) setShowFloatingDrawToolbar(false);
                          }}
                        >
                          <Pencil className="h-5 w-5" />
                        </Button>
                        <Button 
                          variant={drawingTool === "arrow" ? "default" : "outline"} 
                          size="icon"
                          className="h-12 w-12"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const nextTool = drawingTool === "arrow" ? "none" : "arrow";
                            setDrawingTool(nextTool);
                            if (nextTool !== "none" && !pinDrawingToolbar) setShowFloatingDrawToolbar(false);
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
                        <Button 
                          variant={pinDrawingToolbar ? "default" : "outline"} 
                          size="icon" 
                          className="h-12 w-12"
                          onClick={() => setPinDrawingToolbar(prev => !prev)}
                          title={pinDrawingToolbar ? "Unpin drawing tools" : "Pin drawing tools"}
                        >
                          <Pin className={cn("h-5 w-5", pinDrawingToolbar && "rotate-45")} />
                        </Button>
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

            {/* Portrait Bottom Sheet */}
            {portraitSheetOpen && (
              <div className="absolute inset-0 z-[60] flex flex-col pointer-events-none" style={{ height: '100%' }}>
                <div className={cn("flex-1", drawingTool === "none" ? "pointer-events-auto" : "pointer-events-none")} onClick={drawingTool === "none" ? () => setPortraitSheetOpen(false) : undefined} />
                <div className="pointer-events-auto bg-background/100 border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-200 flex flex-col" style={{ maxHeight: `${portraitSheetHeightPct}vh`, height: 'auto', backgroundColor: 'hsl(var(--background))' }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>

              {/* Handle bar - draggable */}
              <div 
                className="flex justify-center pt-2 pb-1 cursor-grab touch-none"
                onTouchStart={(e) => {
                  portraitSheetDragRef.current = { startY: e.touches[0].clientY, startPct: portraitSheetHeightPct };
                }}
                onTouchMove={(e) => {
                  if (!portraitSheetDragRef.current) return;
                  const deltaY = portraitSheetDragRef.current.startY - e.touches[0].clientY;
                  const deltaPct = (deltaY / window.innerHeight) * 100;
                  const newPct = Math.min(85, Math.max(30, portraitSheetDragRef.current.startPct + deltaPct));
                  setPortraitSheetHeightPct(newPct);
                }}
                onTouchEnd={() => {
                  if (!portraitSheetDragRef.current) return;
                  // Snap to nearest point: 45, 65, 85
                  if (portraitSheetHeightPct < 38) {
                    setPortraitSheetOpen(false);
                    setPortraitSheetHeightPct(45);
                  } else if (portraitSheetHeightPct < 55) {
                    setPortraitSheetHeightPct(45);
                  } else if (portraitSheetHeightPct < 75) {
                    setPortraitSheetHeightPct(65);
                  } else {
                    setPortraitSheetHeightPct(85);
                  }
                  portraitSheetDragRef.current = null;
                }}
              >
                <div className="flex items-center justify-center gap-2">
                  {autoSubActive && autoSubPlan.length > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                  {autoSubActive && autoSubPlan.length > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                </div>
              </div>

              {/* Tab content */}
              <div className="overflow-y-auto p-3" style={{ maxHeight: `calc(${portraitSheetHeightPct}vh - 60px)` }}>
                {/* Bench content */}
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
                    {/* Auto Subs Quick Access - Portrait */}
                    {!readOnly && !disableAutoSubs && (
                      <div className="py-1">
                        {autoSubPlan.length > 0 ? (
                          <button
                            className="w-full flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 text-primary text-sm font-medium px-3 py-2 min-h-[36px] transition-colors hover:bg-primary/20"
                            onClick={() => {
                              setPortraitSheetOpen(false);
                              setTimeout(() => setAutoSubPanelOpen(true), 200);
                            }}
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                            Auto Subs ({autoSubPlan.filter(s => s.executed).length}/{autoSubPlan.length})
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                            </span>
                          </button>
                        ) : (
                          <button
                            className="w-full flex items-center justify-center gap-2 rounded-md border border-border bg-muted/50 text-muted-foreground text-sm font-medium px-3 py-2 min-h-[36px] transition-colors hover:bg-muted"
                            onClick={() => {
                              setPortraitSheetOpen(false);
                              setTimeout(() => openAutoSubPlanDialog(), 200);
                            }}
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                            Setup Auto Subs
                          </button>
                        )}
                      </div>
                    )}
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
                          // Mini-league team filter
                          if (miniLeagueTeams && selectedTeamForSettings !== "both" && player.teamSide !== selectedTeamForSettings) return false;
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
                            isNextSub={nextSubInfo?.playerInId === player.id}
                            nextSubCountdown={nextSubInfo?.playerInId === player.id ? nextSubInfo.countdown : null}
                            isSubDue={subDuePlayerIds.has(player.id)}
                          />
                        ))}
                    </div>
                  </div>
              </div>
            </div>
          </div>
        )}

        {/* Sub mode instruction banner - centered on pitch, above FABs */}
        {subMode && (
          <div
            className={cn(
              "absolute left-1/2 -translate-x-1/2 z-[75] px-5 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none",
              "bg-primary text-primary-foreground"
            )}
            style={{
              bottom: portraitSheetOpen ? `calc(${portraitSheetHeightPct}% + 8px)` : 72,
            }}
          >
            <p className="text-sm font-medium text-center whitespace-nowrap">
              {!selectedOnPitch 
                ? "Tap player on pitch to sub off" 
                : "Tap bench player to sub on"
              }
            </p>
          </div>
        )}

        {/* Swap mode instruction banner - centered on pitch, above FABs */}
        {swapMode && (
          <div
            className={cn(
              "absolute left-1/2 -translate-x-1/2 z-[75] px-5 py-2.5 rounded-full shadow-lg animate-fade-in pointer-events-none",
              swapPlayer1 && getValidSwapPlayerIds.size === 0 
                ? "bg-destructive text-destructive-foreground" 
                : "bg-primary text-primary-foreground"
            )}
            style={{
              bottom: portraitSheetOpen ? `calc(${portraitSheetHeightPct}% + 8px)` : 72,
            }}
          >
            <p className="text-sm font-medium text-center whitespace-nowrap">
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

        {/* Formation suggestion floating popup - portrait */}
        {tacticalFormationSuggestion && !readOnly && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] animate-fade-in">
            <div className="flex flex-col items-center gap-3 bg-card border border-border rounded-2xl px-6 py-5 shadow-xl max-w-[280px]">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                {tacticalFormationSuggestion.mode === "attack"
                  ? <Swords className="h-5 w-5 text-primary" />
                  : <Shield className="h-5 w-5 text-primary" />}
              </div>
              <div className="text-center space-y-1">
                <p className="text-base font-bold">
                  Try {tacticalFormationSuggestion.formationName}?
                </p>
                <p className="text-sm text-muted-foreground">
                  {tacticalFormationSuggestion.mode === "attack"
                    ? "More forwards for attacking play"
                    : "Extra defenders for solid cover"}
                </p>
              </div>
              <div className="flex items-center gap-2 w-full mt-1">
                <Button type="button" className="flex-1 h-10" onClick={handleApplyTacticalSuggestion}>
                  Apply
                </Button>
                <Button type="button" variant="outline" className="flex-1 h-10" onClick={handleDismissTacticalSuggestion}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* The Pitch */}
        <div 
          id="portrait-pitch-area"
          className={cn("w-full h-full", zoom > 1 ? "overflow-auto" : "overflow-hidden")}
          onWheel={handleWheel}
        >
          <div 
            className={cn(
            "transition-transform duration-100",
            drawingTool === "none" && zoom <= 1 ? "touch-none" : ""
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
              width: `${zoom * 100}%`,
              height: `${zoom * 100}%`,
              position: 'relative',
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
              onPointerUp={() => {
                if (showFloatingDrawToolbar && !pinDrawingToolbar && !isDrawingArrowRef.current && drawingTool === "none") {
                  setTimeout(() => {
                    setDrawingTool("none");
                    setShowFloatingDrawToolbar(false);
                  }, 50);
                }
              }}
              style={{
                zIndex: drawingTool !== "none" || showFloatingDrawToolbar ? 65 : 5,
                pointerEvents: drawingTool !== "none" || showFloatingDrawToolbar ? "auto" : "none",
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
                transition: isDraggingBall ? "none" : (tacticalMode !== "neutral" ? "left 0.4s ease, top 0.4s ease" : undefined),
                pointerEvents: drawingEnabled ? "none" : "auto",
              }}
            />

            {/* Players on pitch */}
            {filteredPlayersOnPitch.map(player => (
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
                    touchIdRef.current = null;
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
                subAnimation={subAnimationPlayers.in === player.id ? "in" : subAnimationPlayers.swap === player.id ? "swap" : null}
                readOnly={readOnly}
                teamColor={getPlayerTeamColor(player)}
                isNextSub={nextSubInfo?.playerOutId === player.id}
                nextSubCountdown={nextSubInfo?.playerOutId === player.id ? nextSubInfo.countdown : null}
                isSubDue={subDuePlayerIds.has(player.id)}
                style={{
                  position: "absolute",
                    ...(() => {
                    const isDragging = draggedPlayer === player.id || touchDragPlayer === player.id;
                    const recentlyDropped = recentlyDraggedRef.current.has(player.id);
                    // Suppress both transition AND tactical offset for recently-dropped players
                    const offset = (!isDragging && !recentlyDropped) ? tacticalOffsets.get(player.id) : undefined;
                    const tx = offset?.dx ?? 0;
                    const ty = offset?.dy ?? 0;
                    return {
                      left: `${player.position!.x + tx}%`,
                      top: `${player.position!.y + ty}%`,
                      transform: "translate(-50%, -50%)",
                      transition: (isDragging || recentlyDropped || touchDragPlayer !== null || draggedPlayer !== null) ? "none" : "left 0.6s cubic-bezier(0.4, 0, 0.2, 1), top 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                    };
                  })(),
                  zIndex: (subAnimationPlayers.in === player.id || subAnimationPlayers.swap === player.id) ? 40 : previewSwapPlayers.sourceId === player.id || previewSwapPlayers.targetId === player.id ? 30 : (touchDragPlayer === player.id ? 50 : 10),
                  cursor: readOnly ? "default" : ((subMode || swapMode) ? "pointer" : "grab"),
                  pointerEvents: drawingEnabled ? "none" : "auto",
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
        miniLeagueTeams={miniLeagueTeams}
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

      {/* Reset Game Confirmation - portrait */}
      <AlertDialog open={resetGameConfirmOpen} onOpenChange={setResetGameConfirmOpen}>
        <AlertDialogContent className="z-[999999]">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Game?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all player minutes, timer, substitutions, goals, and reset positions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { handleResetGame(); setResetGameConfirmOpen(false); }}
            >
              Reset Game
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bench Injury Confirmation - portrait */}
      <AlertDialog open={benchInjuryConfirmOpen} onOpenChange={(open) => { if (!open) { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); } }}>
        <AlertDialogContent className="z-[999999]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark as Fit?" : "Mark as Injured?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {players.find(p => p.id === benchInjuryTarget)?.isInjured
                ? `${players.find(p => p.id === benchInjuryTarget)?.name} will be available for substitutions again.`
                : `${players.find(p => p.id === benchInjuryTarget)?.name} will not be available for substitutions.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setBenchInjuryConfirmOpen(false); setBenchInjuryTarget(null); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (benchInjuryTarget) togglePlayerInjury(benchInjuryTarget);
                setBenchInjuryConfirmOpen(false);
                setBenchInjuryTarget(null);
              }}
            >
              {players.find(p => p.id === benchInjuryTarget)?.isInjured ? "Mark Fit" : "Mark Injured"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Formation Change Dialog - portrait */}
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
        minorAdjustments={pendingFormationChange?.minorAdjustments || []}
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
        maxSpreadMinutes={maxSpreadMinutes}
        currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
        currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
        showStepper={autoSubFromPreGame}
        miniLeagueTeams={miniLeagueTeams}
        preferredSecondHalfGkId={preferredSecondHalfGkId}
      />

      {/* Auto-Sub Control Panel */}
      {autoSubPanelOpen && autoSubActive && (
        <Suspense fallback={<DialogLoader />}>
          <AutoSubControlPanel
            autoSubPlan={autoSubPlan}
            autoSubPaused={autoSubPaused}
            players={players}
            lockedPlayerIds={lockedPlayerIds}
            currentElapsedSeconds={gameTimerRef.current?.getElapsedSeconds() || 0}
            currentHalf={gameTimerRef.current?.getCurrentHalf() || 1}
            minutesPerHalf={minutesPerHalf}
            onTogglePause={handleTogglePauseAutoSub}
            onCancelPlan={() => { handleCancelAutoSubPlan(); setAutoSubPanelOpen(false); }}
            onSkipNext={handleSkipNextSub}
            onExecuteNow={handleExecuteNow}
            onEditPlan={() => { handleOpenEditPlan(); setAutoSubPanelOpen(false); }}
            onRegeneratePlan={handleRegeneratePlan}
            onToggleLockPlayer={handleToggleLockPlayer}
            onClose={() => setAutoSubPanelOpen(false)}
          />
        </Suspense>
      )}

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
        elapsedGameTime={elapsedGameTime}
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
            rotationSpeed={rotationSpeed}
            onRotationSpeedChange={setRotationSpeed}
          />
        </Suspense>
      )}
    </div>,
    document.body
  );
}
