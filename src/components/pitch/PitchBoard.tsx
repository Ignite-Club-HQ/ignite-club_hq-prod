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
import { Pencil, Eraser, Trash2, ArrowLeft, RotateCcw, MoveRight, Save, FolderOpen, Loader2, ZoomIn, ZoomOut, X, RefreshCw, Users, Settings2, List, Clock, Calendar, BarChart3, Pause, Play, ChevronUp, ChevronLeft, ChevronRight, ChevronDown, Eye, ArrowLeftRight, Undo2, Flame, Shield, Circle, Swords, Pin, Link2, Link2Off, Settings, UserCog, ClipboardList, Check, UserPlus } from "lucide-react";
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
const AutoSubPlanDialog = lazyWithRetry(() => import("./AutoSubPlanDialog"));
const SubstitutionPreviewDialog = lazyWithRetry(() => import("./SubstitutionPreviewDialog"));
const BenchToSubDialog = lazyWithRetry(() => import("./BenchToSubDialog"));
const MatchStatsPanel = lazyWithRetry(() => import("./MatchStatsPanel"));
const PlayerPositionEditor = lazyWithRetry(() => import("./PlayerPositionEditor"));
const PositionSwapDialog = lazyWithRetry(() => import("./PositionSwapDialog"));
const PitchSwapConfirmDialog = lazyWithRetry(() => import("./PitchSwapConfirmDialog"));
const ManualSubConfirmDialog = lazyWithRetry(() => import("./ManualSubConfirmDialog"));
const FormationChangeDialog = lazyWithRetry(() => import("./FormationChangeDialog"));
const PitchPlayerActionMenu = lazyWithRetry(() => import("./PitchPlayerActionMenu"));
const SubConfirmDialog = lazyWithRetry(() => import("./SubConfirmDialog"));
const AddFillInPlayerDialog = lazyWithRetry(() => import("./AddFillInPlayerDialog"));
const AutoSubManager = lazyWithRetry(() => import("./AutoSubManager"));
const AutoSubControlPanel = lazyWithRetry(() => import("./AutoSubControlPanel"));
const PreGameLineupScreen = lazyWithRetry(() => import("./PreGameLineupScreen"));
import TacticalModeSelector from "./TacticalModeSelector";
import { useAutoSubs } from "@/hooks/useAutoSubs";
import { usePitchSettings } from "@/hooks/usePitchSettings";
import { useDraggableTimer } from "@/hooks/useDraggableTimer";
import { useWakeLock } from "@/hooks/useWakeLock";
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

import { useEventGoingAttendees } from "@/hooks/useEventGoingAttendees";
import { useEventLineupHydration } from "./hooks/useEventLineupHydration";
import { hapticImpactMedium, hapticImpactLight } from "@/lib/haptics";

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
  PITCH_BOARD_OPEN_PATH_KEY,
  PITCH_BOARD_LAST_CONTEXT_KEY,
  TIMER_STORAGE_KEY,
  PitchBoardState,
  TimerState,
  MiniLeagueTeams
} from "./types";
import ScoreTracker from "./ScoreTracker";
import {
  savePitchState,
  clearPitchState,
  loadTimerStateForMinutes,
} from "./pitchStateUtils";
import { getCurrentGameSeconds } from "./timerUtils";
import { usePitchBoardTimer } from "./hooks/usePitchBoardTimer";
import { usePitchBoardEventLink } from "./hooks/usePitchBoardEventLink";
import { usePitchBoardFillIn } from "./hooks/usePitchBoardFillIn";
import { usePitchBoardBall } from "./hooks/usePitchBoardBall";
import { usePitchBoardFormationChangeDialog, type FormationChangeDialogDeps } from "./hooks/usePitchBoardFormationChangeDialog";
import { usePitchBoardLineup, type LineupDeps } from "./hooks/usePitchBoardLineup";
import { usePitchBoardPinchZoom } from "./hooks/usePitchBoardPinchZoom";
import { usePitchBoardDragDrop, type DragDropDeps } from "./hooks/usePitchBoardDragDrop";
import { usePitchBoardTactical } from "./hooks/usePitchBoardTactical";
import { usePitchBoardSubSelection } from "./hooks/usePitchBoardSubSelection";
import { usePitchBoardManualSub } from "./hooks/usePitchBoardManualSub";
import { usePitchBoardBenchToSub } from "./hooks/usePitchBoardBenchToSub";
import { usePitchBoardPropSync } from "./hooks/usePitchBoardPropSync";
import { usePitchBoardPersistence } from "./hooks/usePitchBoardPersistence";
import { usePitchBoardPlayerBootstrap } from "./hooks/usePitchBoardPlayerBootstrap";
import { usePitchBoardLifecycle } from "./hooks/usePitchBoardLifecycle";
import { usePitchBoardDrawing } from "./hooks/usePitchBoardDrawing";
import { usePitchBoardPlanRepair } from "./hooks/usePitchBoardPlanRepair";
import { usePitchBoardInitialState, isSavedDefaultTeamSize } from "./hooks/usePitchBoardInitialState";
import { TacticalMode, computeTacticalOffsets, computeBallOffset, TACTICAL_MODE_LABELS, RECOMMENDED_FORMATIONS } from "./tacticalMode";
import { type PitchBoardMode } from "./ModeSwitch";
import { PitchBoardLayoutContext } from "./PitchBoardLayoutContext";
import type { PitchBoardLayoutContextValue } from "./PitchBoardLayoutContext";
import { acknowledgeHalftimePrompt, canShowHalftimePrompt, getHalftimePromptAckKey, hasAcknowledgedHalftimePrompt } from "./halftimePromptAck";
import PitchBoardLandscapeLayout from "./PitchBoardLandscapeLayout";
import PitchBoardPortraitLayout from "./PitchBoardPortraitLayout";

import { Download } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const TrainingBoard = lazyWithRetry(() => import("./training/TrainingBoard"));




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
  onUnlinkEvent?: () => void;
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

function PitchBoardInner({ teamId, teamName, members, onClose, disableAutoSubs = false, initialRotationSpeed = 1, initialDisablePositionSwaps = false, initialDisableBatchSubs = false, initialRotateGkAtHalftime = true, initialMinutesPerHalf = 10, initialMaxSpreadMinutes = 5, initialTeamSize, initialFormation, readOnly = false, isSubsManager = false, initialLinkedEventId, initialShowMatchHeader = true, initialShowLineupPicker = true, initialMode = "match", miniLeagueTeams, onUnlinkEvent }: PitchBoardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { pitchBoardNotificationsEnabled } = usePitchBoardNotifications();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isLandscape, isMobileLandscape } = useIsLandscape();

  // One-time discovery hint: now that the Swap button is gone, surface drag-to-swap once.
  useEffect(() => {
    if (readOnly) return;
    try {
      const KEY = "pitchboard.dragSwapHintShown.v1";
      if (localStorage.getItem(KEY)) return;
      const t = setTimeout(() => {
        toast({
          title: "Quick tip",
          description: "Tap a player on the pitch to sub or swap them. Drag also works.",
        });
        try { localStorage.setItem(KEY, "1"); } catch {}
      }, 1200);
      return () => clearTimeout(t);
    } catch {}
  }, [readOnly, toast]);

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
  // readOnly (spectator / BoardViewerDialog) must never write back: its mirrored
  // localStorage copy goes stale while the coach's clock advances.
  const { forceSync: forceEventGroupSync, isEventGroup } = useEventGroupSync(teamId, null, { readOnly });
  
  // State initialization flag
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Step 9b: one-shot saved-state load + initial team-size/formation getters.
  const { savedState, getInitialTeamSize, getInitialFormationIndex } =
    usePitchBoardInitialState({ teamId, initialTeamSize, initialFormation });
  
  // Timer state + per-tick minute math live in usePitchBoardTimer (audit #9
  // step 1 of the PitchBoard split). Setters/callbacks that are created
  // later in the component body are wired in via refs — see assignments
  // after `useState<Player[]>`, after `useAutoSubs`, and after the
  // `elapsedGameTime` state declaration further down.
  const setPlayersRef = useRef<React.Dispatch<React.SetStateAction<Player[]>> | null>(null);
  const setElapsedGameTimeRef = useRef<React.Dispatch<React.SetStateAction<number>> | null>(null);
  const updateNextSubInfoRef_timer = useRef<((elapsedSeconds: number, currentHalf: 1 | 2) => void) | null>(null);
  const checkForDueSubsRef_timer = useRef<((elapsedSeconds: number, currentHalf: 1 | 2) => void) | null>(null);
  const minutesPerHalfRef = useRef<number>(initialMinutesPerHalf);
  const gameTimerRef = useRef<GameTimerRef>(null);
  const {
    gameInProgress,
    setGameInProgress,
    timerResetKey,
    setTimerResetKey,
    lastTimeUpdateRef,
    hasInitializedTimeRef,
    handleTimerUpdate,
  } = usePitchBoardTimer({
    teamId,
    savedState,
    minutesPerHalfRef,
    gameTimerRef,
    setPlayersRef,
    setElapsedGameTimeRef,
    updateNextSubInfoRef: updateNextSubInfoRef_timer,
    checkForDueSubsRef: checkForDueSubsRef_timer,
  });
  
  

  
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

  // Formation/team-size change dialog state + handlers live in
  // usePitchBoardFormationChangeDialog. Dependencies are passed via a ref
  // (updated on every render below) so the hook can be declared early.
  const formationDialogDepsRef = useRef<FormationChangeDialogDeps | null>(null);
  const {
    formationChangeDialogOpen,
    setFormationChangeDialogOpen,
    pendingFormationChange,
    setPendingFormationChange,
    handleFormationChangeConfirm,
    handleFormationChangeCancel,
  } = usePitchBoardFormationChangeDialog(formationDialogDepsRef);

  // Lineup confirm/skip + formation change (preview & apply) live in
  // usePitchBoardLineup. Same ref-passing pattern as above.
  const lineupDepsRef = useRef<LineupDeps | null>(null);
  const {
    handleLineupConfirm,
    handleLineupSkip,
    handleFormationChange,
    applyFormationChange,
  } = usePitchBoardLineup(lineupDepsRef);

  // Auto-sub plan state (hook setup happens below after runSubAnimation is defined)
  // gameTimerRef is declared above as part of usePitchBoardTimer wiring.
  const [autoSubPlanDialogOpen, setAutoSubPlanDialogOpen] = useState(false);
  const [autoSubPlanEditMode, setAutoSubPlanEditMode] = useState(false);
  const [autoSubFromPreGame, setAutoSubFromPreGame] = useState(false);
  const [preferredSecondHalfGkId, setPreferredSecondHalfGkId] = useState<string | undefined>(undefined);

  // Keep `preferredSecondHalfGkId` in sync with the live roster. A nominated
  // 2H GK is allowed to start on pitch as an outfielder, so only clear the
  // preference when the player is gone, injured, or already the 1H GK.
  // Prefer the event the board was launched from. Falling back to savedState
  // first caused stale links (or no link at all) when entering from "Prepare
  // Lineup" on a different event than the previously-saved game.
  const {
    linkedEventId,
    setLinkedEventId,
    handleLinkEvent,
    linkedEventDetails,
    opponentName,
  } = usePitchBoardEventLink({
    initialLinkedEventId,
    savedLinkedEventId: savedState?.linkedEventId,
    teamId,
    teamName,
    userId: user?.id,
  });
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
  // Track if game has started. Initialize from saved timer state so that
  // a page reload mid-match (or a parent re-render before the first timer
  // tick) cannot let the prop-sync effect below clobber the live
  // minutesPerHalf with a transient `|| 10` fallback from the parent.
  // gameInProgress + timerResetKey are owned by usePitchBoardTimer above.
  const [showScoreInPortrait, setShowScoreInPortrait] = useState(false); // Toggle score visibility in portrait
  const [hideScores, setHideScores] = useState(false); // Hide scores and disable scoring
  const [landscapeEventSelectorOpen, setLandscapeEventSelectorOpen] = useState(false); // Event selector for landscape toolbar
  const [minutesPerHalf, setMinutesPerHalf] = useState(() => {
    // If a game is already in progress for this team, the saved timer state
    // is the source of truth — using the parent prop here can land on a
    // transient `|| 10` fallback during a React Query refetch and silently
    // shorten the live half.
    try {
      const t = loadTimerStateForMinutes(teamId);
      if (t && t.minutesPerHalf && (t.isRunning || (t.elapsedSeconds && t.elapsedSeconds > 0) || t.currentHalf === 2 || t.isGameFinished)) {
        return t.minutesPerHalf;
      }
    } catch {}
    return initialMinutesPerHalf;
  }); // Time per half for settings
  const [rotationSpeed, setRotationSpeed] = useState(() => initialRotationSpeed); // Subs speed
  const [disablePositionSwaps, setDisablePositionSwaps] = useState(() => initialDisablePositionSwaps); // Disable position swaps in auto sub generation
  const [disableBatchSubs, setDisableBatchSubs] = useState(() => initialDisableBatchSubs); // Disable batch subs (multiple at once)
  const [rotateGkAtHalftime, setRotateGkAtHalftime] = useState(() => initialRotateGkAtHalftime); // Rotate GK at halftime
  const [maxSpreadMinutes, setMaxSpreadMinutes] = useState(() => initialMaxSpreadMinutes); // Max acceptable playing-time spread (minutes)
  const [showLineupPicker, setShowLineupPicker] = useState(() => {
    // Show lineup picker on mount only when launching into a fresh match context.
    // Skip the picker if:
    //  - saved state exists for the same event, OR
    //  - the user has already set up a lineup (any player placed on pitch) or
    //    configured auto-subs for this team — even if the saved event differs.
    //    Re-opening from the match should drop straight into the board, not setup.
    const savedForSameEvent = !!savedState && savedState.linkedEventId === initialLinkedEventId;
    const hasExistingLineup = !!savedState && (
      (savedState.players?.some(p => p && p.position !== null)) ||
      ((savedState.autoSubPlan?.length ?? 0) > 0)
    );
    return initialShowLineupPicker
      && !!initialLinkedEventId
      && !savedForSameEvent
      && !hasExistingLineup
      && !readOnly
      && !miniLeagueTeams;
  });
  const [showLineupPickerSetting, setShowLineupPickerSetting] = useState(() => initialShowLineupPicker); // Persist setting
  const halftimePromptAckKey = useMemo(
    () => getHalftimePromptAckKey(loadTimerStateForMinutes(teamId), savedState),
    [teamId, savedState]
  );
  const handleAcknowledgeHalftimePrompt = useCallback(() => {
    acknowledgeHalftimePrompt(getHalftimePromptAckKey(loadTimerStateForMinutes(teamId), savedState) ?? halftimePromptAckKey);
  }, [teamId, savedState, halftimePromptAckKey]);
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
  
  // Tactical mode state now lives in usePitchBoardTactical (declared below after handleFormationChange + ball state).

  
  // Mini-league team selector for formation/tactical changes
  const [selectedTeamForSettings, setSelectedTeamForSettings] = useState<"a" | "b" | "both">("both");

  // Step 9a — prop → state sync effects (7 effects + savedTeamDefaultsRef
  // refresh) now live in usePitchBoardPropSync.
  usePitchBoardPropSync({
    teamId,
    savedState,
    initialTeamSize,
    initialFormation,
    initialMinutesPerHalf,
    initialRotationSpeed,
    initialDisablePositionSwaps,
    initialDisableBatchSubs,
    initialRotateGkAtHalftime,
    initialMaxSpreadMinutes,
    gameInProgress,
    minutesPerHalf,
    setTeamSize,
    setSelectedFormation,
    setMinutesPerHalf,
    setRotationSpeed,
    setDisablePositionSwaps,
    setDisableBatchSubs,
    setRotateGkAtHalftime,
    setMaxSpreadMinutes,
    savedTeamDefaultsRef,
  });

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

  // handleLineupConfirm now lives in usePitchBoardLineup (declared at top).


  // handleLinkEvent now lives in usePitchBoardEventLink (top of component).



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

  // linkedEventDetails, opponentName, and the 24h auto-unlink effect now live
  // in usePitchBoardEventLink (top of component).


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

  // RSVP'd-going filter — when the board is linked to a fixture, only players
  // who RSVP'd "going" should appear on the pitch/bench/autosubs. Mini-league
  // mode uses its own team-builder and is exempt. Staff aren't in realPlayers
  // (filtered to role==='player') so this doesn't affect them.
  const { data: goingAttendeeIds } = useEventGoingAttendees(linkedEventId);
  const shouldFilterByGoing = !!linkedEventId && !miniLeagueTeams && !!goingAttendeeIds;

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
      // When linked to an event, restrict to RSVP'd "going" players only.
      if (shouldFilterByGoing && !goingAttendeeIds!.has(m.user_id)) return false;
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
  }, [members, teamPlayerPositions, miniLeagueTeams, shouldFilterByGoing, goingAttendeeIds]);


  // Fill-in purge gate: when the saved state belongs to a DIFFERENT event than
  // the one we're opening, drop fill-ins (they were ad-hoc for the prior match).
  // Same-event resume (phone-lock case) is untouched; no-event ad-hoc games
  // (no linkedEventId on either side) are untouched.
  const savedStateIsForDifferentEvent =
    !!savedState &&
    !!savedState.linkedEventId &&
    !!initialLinkedEventId &&
    savedState.linkedEventId !== initialLinkedEventId;
  const savedPlayers = savedStateIsForDifferentEvent
    ? (savedState?.players || []).filter((p) => !p.isFillIn)
    : (savedState?.players || []);
  const savedAutoSubPlan = savedStateIsForDifferentEvent
    ? (savedState?.autoSubPlan || []).filter((step: any) =>
        savedPlayers.some((p) => p.id === step.playerId)
      )
    : (savedState?.autoSubPlan || []);
  const isStrictMatchEventRoster = !!(initialLinkedEventId || savedState?.linkedEventId) && !miniLeagueTeams;
  const strictMatchRosterPlayerIds = useMemo(
    () => new Set(realPlayers.map((player) => player.id)),
    [realPlayers]
  );
  // Guard: don't compare saved vs real roster until the RSVP-going filter has
  // resolved. On reopen, `goingAttendeeIds` is briefly undefined, so
  // `realPlayers` momentarily contains ALL team members instead of just the
  // RSVP'd-going subset. Without this gate, `shouldRebuildFromRealRoster`
  // fires, clears localStorage, and auto-places everyone — wiping the lineup
  // the user just set. See PreGameLineupScreen save path.
  const rsvpFilterReady = !linkedEventId || miniLeagueTeams || !!goingAttendeeIds;
  const savedRosterMissingCurrentPlayers =
    rsvpFilterReady &&
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
    if (savedPlayers.length > 0) {
      console.log("[PitchState] useState init - using saved players", savedStateIsForDifferentEvent ? "(fill-ins stripped: different event)" : "");
      // For mini-league mode, we need to check if saved state has proper two-team layout
      // If Team B players are not on the top half (y < 50), re-place all players
      if (miniLeagueTeams) {
        // Apply teamSide to saved players first
        const playersWithTeamSide = savedPlayers.map(p => {
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
      return applyStrictMatchRoster(savedPlayers);
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

  // Player drag/drop is owned by usePitchBoardDragDrop. We declare it here
  // (before the rest of the component reads its state/refs) but pass deps via
  // a ref that is reassigned further down — same pattern as
  // usePitchBoardFormationChangeDialog / usePitchBoardLineup.
  const dragDropDepsRef = useRef<DragDropDeps>({} as DragDropDeps);
  const {
    draggedPlayer,
    touchDragPlayer,
    touchOffset,
    setTouchDragPlayer,
    setTouchOffset,
    touchIdRef,
    playerDragOffsetRef,
    playerDragStartRef,
    recentlyDraggedRef,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handlePitchDrop,
    handleBenchDrop,
    handleTouchStart,
    applyPitchTouchMove,
    finalizePitchTouchEnd,
    handleBenchTouchMove,
    handleBenchTouchEnd,
  } = usePitchBoardDragDrop(dragDropDepsRef);




  // Zoom state
  const {
    zoom,
    setZoom,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleWheel,
    tryPinchStart,
    tryPinchMove,
    tryPinchEnd,
    pitchZoomScrollRef,
  } = usePitchBoardPinchZoom();

  // Ball state + drag/touch handlers live in usePitchBoardBall
  const {
    ballPosition,
    setBallPosition,
    isDraggingBall,
    recentlyDraggedBallRef,
    handleBallDragStart,
    handleBallDrag,
    handleBallDragEnd,
    handleBallTouchStart,
    handleBallTouchMove,
    handleBallTouchEnd,
  } = usePitchBoardBall({
    containerRef,
    initialBallPosition: savedState?.ballPosition,
  });

  // Helper to get team color for a player in mini-league mode
  const getPlayerTeamColor = useCallback((player: Player): string | undefined => {
    if (!miniLeagueTeams || !player.teamSide) return undefined;
    return player.teamSide === "a" ? miniLeagueTeams.teamAColor : miniLeagueTeams.teamBColor;
  }, [miniLeagueTeams]);

  // Substitution mode selection + derived sets now live in usePitchBoardSubSelection.
  // (Hook call placed after swapMode/swapPlayer1 are declared, since it depends on them.)
  const [subAnimationPlayers, setSubAnimationPlayers] = useState<{ in: string | null; out: string | null; swap: string | null }>({ in: null, out: null, swap: null });
  const subAnimationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Brief visual + haptic feedback when two pitch players swap positions via drag.
  const [swapFlashIds, setSwapFlashIds] = useState<string[]>([]);
  const swapFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSwapFeedback = useCallback((idA: string, idB: string) => {
    if (swapFlashTimerRef.current) clearTimeout(swapFlashTimerRef.current);
    setSwapFlashIds([idA, idB]);
    hapticImpactLight();
    swapFlashTimerRef.current = setTimeout(() => {
      setSwapFlashIds([]);
      swapFlashTimerRef.current = null;
    }, 600);
  }, []);

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
    initialPlan: savedAutoSubPlan,
    initialActive: savedState?.autoSubActive || false,
    initialPaused: savedState?.autoSubPaused || false,
    gameTimerRef,
    playersRef,
    setPlayers,
    teamSize,
    halftimePromptAckKey,
    rotateGkAtHalftime,
    pushToUndoHistoryRef: pushToUndoHistoryRef_autoSubs,
    runSubAnimationRef: runSubAnimationRef_autoSubs,
  });

  // manualSubConfirmOpen + pendingManualSub now live in usePitchBoardManualSub (declared below).


  // Position swap mode state (swapping two players on pitch without substitution)
  const [swapMode, setSwapMode] = useState(false);
  const [swapPlayer1, setSwapPlayer1] = useState<string | null>(null);
  const [swapPlayer2, setSwapPlayer2] = useState<string | null>(null);
  const [pitchSwapConfirmOpen, setPitchSwapConfirmOpen] = useState(false);

  // Step 8a — substitution selection state + derived sets
  const {
    subMode,
    setSubMode,
    selectedOnPitch,
    setSelectedOnPitch,
    selectedOnBench,
    setSelectedOnBench,
    getValidBenchPlayerIds,
    getValidSwapPlayerIds,
    movablePitchPlayerIds,
  } = usePitchBoardSubSelection({
    players,
    swapMode,
    swapPlayer1,
    miniLeagueTeams,
  });




  // Swap-based substitution state (for sequencing: swap dialog first, then sub dialog)
  const [pendingSwapBasedSub, setPendingSwapBasedSub] = useState<{
    pitchPlayerId: string;
    benchPlayerId: string;
    swapPlayerId: string;
  } | null>(null);
  const [swapBeforeSubDialogOpen, setSwapBeforeSubDialogOpen] = useState(false);

  // Step 8c — Bench-to-pitch quick substitution sheet state
  const {
    benchToSubOpen,
    setBenchToSubOpen,
    benchToSubPlayer,
    setBenchToSubPlayer,
  } = usePitchBoardBenchToSub();

  // Step 8b — manual-sub confirm dialog flow (state + handlers + trigger effect)
  const {
    manualSubConfirmOpen,
    setManualSubConfirmOpen,
    pendingManualSub,
    setPendingManualSub,
    handleConfirmManualSub,
    handleCancelManualSub,
    handleBenchToSubSelect,
    manualSubDepsRef,
  } = usePitchBoardManualSub();
  const [benchDragPlayer, setBenchDragPlayer] = useState<string | null>(null);
  const [benchDragPos, setBenchDragPos] = useState<{ x: number; y: number } | null>(null);
  const benchLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const benchDragStartTouch = useRef<{ x: number; y: number } | null>(null);
  const [subAfterSwapDialogOpen, setSubAfterSwapDialogOpen] = useState(false);
  const [resetGameConfirmOpen, setResetGameConfirmOpen] = useState(false);
  const [cancelPlanConfirmOpen, setCancelPlanConfirmOpen] = useState(false);
  const [timerFormationDropdownOpen, setTimerFormationDropdownOpen] = useState(false);
  const [timerTacticalDropdownOpen, setTimerTacticalDropdownOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [trainingMenuOpen, setTrainingMenuOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  // fillInDialogOpen state lives in usePitchBoardFillIn (declared below).
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

  // Shared-session fill-in sync moved into usePitchBoardFillIn (below).

  // Match stats panel state
  const [statsOpen, setStatsOpen] = useState(false);
  const [elapsedGameTime, setElapsedGameTime] = useState(0);

  // Keep the screen awake while the pitch board is open so iOS / Android
  // don't auto-lock mid-game and tear down the WebView (which causes a
  // 4-5s "Loading your profile..." reload when the user returns).
  useWakeLock(true);

  // Step 9e — open-flag/context lifecycle + expired-sub toast + auto-reset.
  const { autoResetDoneRef, shouldAutoReset } = usePitchBoardLifecycle({
    teamId,
    teamName,
    readOnly,
    subConfirmDialogOpen,
    toast,
  });

  // Step 9d — player bootstrap (saved-state merge / fresh auto-place).
  const { hasLoadedRef } = usePitchBoardPlayerBootstrap({
    savedState,
    realPlayers,
    teamId,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    isStrictMatchEventRoster,
    savedRosterHasPlayersOutsideCurrentRoster,
    applyStrictMatchRoster,
    autoPlacePlayersOnPitch,
    autoPlaceMiniLeaguePlayers,
    setPlayers,
    setHasInitialized,
  });

  // handleLineupSkip now lives in usePitchBoardLineup (declared at top).

  // Step 9c — persistence (localStorage debounced save + active_games auto-sub mirror)
  usePitchBoardPersistence({
    hasInitialized,
    teamId,
    userId: user?.id,
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
    isEventGroup,
    forceEventGroupSync,
    touchDragPlayer,
    draggedPlayer,
    readOnly,
  });



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

  // Arrow drawing state (refs owned by usePitchBoardDrawing below)

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
      } as never);
      
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

  // Step 9f — drawing/arrow lifecycle (refs, overlay-disable, arrow handlers, pen mode, clear).
  const {
    drawingToolRef,
    isDrawingArrowRef,
    createArrow,
    clearDrawings,
  } = usePitchBoardDrawing({
    drawingTool,
    setDrawingTool,
    drawingColor,
    setShowFloatingDrawToolbar,
    settingsMenuOpen,
    portraitSheetOpen,
    settingsDialogOpen,
    autoSubPanelOpen,
    toolbarCollapsed,
    fabricCanvas,
    fabricModule,
  });
  void createArrow; // currently unused outside the hook — keep handle for future external triggers

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

  // handleFormationChange now lives in usePitchBoardLineup (declared at top).

  const {
    tacticalMode,
    setTacticalMode,
    tacticalFormationSuggestion,
    setTacticalFormationSuggestion,
    handleTacticalModeChange,
    handleApplyTacticalSuggestion,
    handleDismissTacticalSuggestion,
    tacticalOffsets,
    ballOffset,
  } = usePitchBoardTactical({
    players,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    ballPosition,
    isDraggingBall,
    recentlyDraggedBallRef,
    handleFormationChange,
    setToolbarCollapsed,
    setPortraitSheetOpen,
  });

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

  // applyFormationChange now lives in usePitchBoardLineup (declared at top).

  // Keep the formation-dialog hook's dependency ref in sync each render so its
  // confirm handler can call into late-defined functions like
  // applyFormationChange / notifyFormationOrSizeChange.
  formationDialogDepsRef.current = {
    players,
    setPlayers,
    setTeamSize,
    setSelectedFormation,
    autoPlacePlayersOnPitch,
    persistTeamSizeToDb,
    notifyFormationOrSizeChange,
    applyFormationChange,
    setToolbarCollapsed,
    setPortraitSheetOpen,
    autoSubActive,
    regeneratePlanRef,
    toast,
  };

  // Keep lineup hook's dep ref synced each render.
  lineupDepsRef.current = {
    players,
    teamSize,
    selectedFormation,
    miniLeagueTeams,
    autoSubActive,
    selectedTeamForSettings,
    setPlayers,
    setSelectedFormation,
    setPreferredSecondHalfGkId,
    setAutoSubPlanEditMode,
    setAutoSubFromPreGame,
    setAutoSubPlanDialogOpen,
    setShowLineupPicker,
    setPendingFormationChange,
    setFormationChangeDialogOpen,
    autoPlacePlayersOnPitch,
    autoPlaceMiniLeaguePlayers,
    persistFormationToDb,
    notifyFormationOrSizeChange,
    regeneratePlanRef,
    toast,
  };

  // Keep manual-sub hook's dep ref synced each render.
  manualSubDepsRef.current = {
    isUndoingRef,
    playersRef,
    subMode,
    selectedOnPitch,
    selectedOnBench,
    players,
    benchToSubPlayer,
    setPlayers,
    setSelectedOnPitch,
    setSelectedOnBench,
    setSubMode,
    setPendingSubBenchPlayer,
    setRequiredPosition,
    setPositionSwapDialogOpen,
    setBenchToSubOpen,
    runSubAnimation,
    pushToUndoHistory,
    toast,
  };


  // Substitution dialog trigger now lives in usePitchBoardManualSub.

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
    const dragStart = playerDragStartRef.current?.playerId === pitchPlayerId ? playerDragStartRef.current : null;
    const pitchPlayer = players.find(p => p.id === pitchPlayerId);
    const swapPlayer = players.find(p => p.id === swapPlayerId);

    if (!pitchPlayer || (!pitchPlayer.position && !dragStart?.position) || !swapPlayer?.position) return;

    const pos1 = dragStart?.position ? { ...dragStart.position } : { ...pitchPlayer.position! };
    const pos2 = { ...swapPlayer.position };
    const pitchPos1 = dragStart?.currentPitchPosition ?? pitchPlayer?.currentPitchPosition;
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
      // Single tap = no-op so the player can be freely dragged/repositioned.
      // Use double-click (or the action menu) to open the substitution picker.
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

  // Forward setters/callbacks into the timer hook (declared at the top of
  // the component, before these values exist).
  setPlayersRef.current = setPlayers;
  minutesPerHalfRef.current = minutesPerHalf;
  setElapsedGameTimeRef.current = setElapsedGameTime;
  updateNextSubInfoRef_timer.current = updateNextSubInfo;
  checkForDueSubsRef_timer.current = checkForDueSubs;

  // Half change callback - check for halftime subs (including batch)
  const handleHalfChange = useCallback((newHalf: 1 | 2, source: 'live' | 'reconcile' = 'live') => {
    // Guard: if the timer was reconciled on resume/cold-open and we're already
    // well into the 2nd half, the half-change callback can still fire as part
    // of the catch-up. In that case the user has already played past halftime
    // and should not see a stale "Half Time!" dialog they have to dismiss.
    if (newHalf === 2) {
      const elapsedInHalf2 = gameTimerRef.current?.getElapsedSeconds?.() ?? 0;
      if (elapsedInHalf2 > 30 || hasAcknowledgedHalftimePrompt(halftimePromptAckKey)) {
        return;
      }
    }

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
          if (!canShowHalftimePrompt(loadTimerStateForMinutes(teamId), savedState)) return;
          const notificationBody = `Halftime GK swap: ${currentGk.name} ➜ ${secondHalfGk.name}`;
          playSubAlertBeep(notificationBody);
          setPendingAutoSub(gkSwapEvent);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
        return;
      }
    }

    // Case 3: No subs and no GK swap — only show the informational halftime
    // dialog on a LIVE boundary crossing. On reconcile (cold-open / resume),
    // the user has typically already seen the push and there is nothing
    // actionable to confirm, so skip the empty prompt.
    if (newHalf === 2 && source === 'live') {
      setTimeout(() => {
        if (!canShowHalftimePrompt(loadTimerStateForMinutes(teamId), savedState)) return;
        playSubAlertBeep("Half Time!");
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(true);
      }, 500);
    }
  }, [checkHalftimeSubs, halftimePromptAckKey, preferredSecondHalfGkId, players, savedState, setPendingAutoSub, setPendingBatchSubs, setSubConfirmDialogOpen, teamId]);

  // Ball drag/touch handlers now live in usePitchBoardBall (top of component).






  const handleUnlinkEvent = useCallback(async () => {
    setLinkedEventId(null);
    onUnlinkEvent?.();

    savePitchState(teamId, {
      players,
      teamSize,
      selectedFormation,
      ballPosition,
      autoSubPlan,
      autoSubActive,
      autoSubPaused,
      mockMode,
      linkedEventId: null,
      goals,
    });

    if (user?.id && !teamId.startsWith("event-group-")) {
      await supabase
        .from("active_games")
        .update({ is_active: false })
        .eq("team_id", teamId)
        .eq("user_id", user.id)
        .eq("is_active", true);
    }

    queryClient.invalidateQueries({ queryKey: ["team-active-game", teamId] });
    toast({
      title: "Game Unlinked",
      description: "This board is no longer linked to the match.",
    });
  }, [autoSubActive, autoSubPaused, autoSubPlan, ballPosition, goals, mockMode, onUnlinkEvent, players, queryClient, selectedFormation, teamId, teamSize, toast, user?.id]);

  // Reset game - clears all player minutes, timer, and positions.
  // `preserveLineup` keeps the coach's current positions, settings and
  // auto-sub plan (used when re-opening Set up game after full time) and only
  // resets the clock.
  const handleResetGame = useCallback((silent = false, opts?: { preserveLineup?: boolean }) => {
    const preserveLineup = opts?.preserveLineup === true;

    // Stop the timer first
    gameTimerRef.current?.resetTimer();

    if (!preserveLineup) {
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

      // Reset players - remove temporary fill-ins, clear minutes, and re-place
      // regular roster players with the default formation. Fill-ins are per-game
      // only and must not survive Reset Game / Set up game.
      const resetPlayers = players
        .filter(p => !p.isFillIn)
        .map(p => ({
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
    } else {
      // Keep positions and plan, just zero the clock-derived minutes.
      setPlayers(prev => prev.map(p => ({ ...p, minutesPlayed: 0 })));
    }

    // Reset sub mode
    setSubMode(false);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    
    // Reset game in progress flag so Plan button is enabled again
    setGameInProgress(false);
    
    // Force remount all GameTimer instances to pick up clean state
    setTimerResetKey(prev => prev + 1);
    
    if (!preserveLineup) {
      // Clear persisted state
      clearPitchState(teamId);

      // Reset hasLoadedRef so fresh state can be saved
      hasLoadedRef.current = false;
    }
    
    if (!silent) {
      toast({
        title: "Game Reset",
        description: "All player minutes and settings have been reset to defaults.",
      });
    }
  }, [players, autoPlacePlayersOnPitch, teamId, toast]);

  // Helper: if the game is at full time, reset the clock before showing the
  // lineup picker — but never wipe the coach's positions or auto-sub plan, so
  // re-opening Set up game shows the current lineup rather than team defaults.
  const handleSetupGame = useCallback(() => {
    if (gameTimerRef.current?.isGameFinished()) {
      handleResetGame(true, { preserveLineup: true });
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

  // Reset formation only - snaps each player back to THEIR OWN formation slot
  // (never re-assigns players to different positions) and ball to center.
  const handleResetFormation = useCallback(() => {
    const formation = FORMATIONS[teamSize][selectedFormation];
    if (!formation) return;

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    const slots = formation.positions.map((pos) => ({
      pos,
      pitchPos: getPositionFromCoords(pos.y, teamSize),
      taken: false,
    }));

    const onPitch = players.filter(p => p.position !== null);
    const onBench = players.filter(p => p.position === null);

    const result: Player[] = [];
    const unmatched: Player[] = [];

    // Pass 1: each player claims the nearest unused slot matching their own
    // pitch position type (currentPitchPosition, or derived from where they are).
    for (const player of onPitch) {
      const type = player.currentPitchPosition
        ?? getPositionFromCoords(player.position!.y, teamSize);
      const candidates = slots.filter(s => !s.taken && s.pitchPos === type);
      if (candidates.length === 0) {
        unmatched.push(player);
        continue;
      }
      const slot = candidates.reduce((best, s) =>
        dist(player.position!, s.pos) < dist(player.position!, best.pos) ? s : best
      );
      slot.taken = true;
      result.push({ ...player, position: slot.pos, currentPitchPosition: slot.pitchPos });
    }

    // Pass 2: players whose slot type isn't available go to the nearest free
    // slot but KEEP their own position label; if no slots are free they stay
    // exactly where they are.
    for (const player of unmatched) {
      const free = slots.filter(s => !s.taken);
      if (free.length === 0) {
        result.push(player);
        continue;
      }
      const slot = free.reduce((best, s) =>
        dist(player.position!, s.pos) < dist(player.position!, best.pos) ? s : best
      );
      slot.taken = true;
      result.push({ ...player, position: slot.pos });
    }

    // Bench players stay on the bench.
    result.push(...onBench);
    setPlayers(result);

    // Reset ball to center
    setBallPosition({ x: 50, y: 50 });

    toast({
      title: "Formation Reset",
      description: "Players and ball have been moved back to formation positions.",
    });
  }, [players, teamSize, selectedFormation, toast]);

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

  const clampPitchPosition = useCallback((x: number, y: number) => ({
    x: Math.max(5, Math.min(95, x)),
    y: Math.max(5, Math.min(95, y)),
  }), []);

  const capturePlayerDragOffset = useCallback((playerId: string, clientX: number, clientY: number) => {
    if (!containerRef.current) {
      playerDragOffsetRef.current = null;
      return;
    }
    const player = playersRef.current.find(p => p.id === playerId);
    if (!player?.position) {
      playerDragOffsetRef.current = null;
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    playerDragOffsetRef.current = {
      x: ((clientX - rect.left) / rect.width) * 100 - player.position.x,
      y: ((clientY - rect.top) / rect.height) * 100 - player.position.y,
    };
  }, []);

  const getClientPitchPosition = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const offset = playerDragOffsetRef.current;
    const x = ((clientX - rect.left) / rect.width) * 100 - (offset?.x ?? 0);
    const y = ((clientY - rect.top) / rect.height) * 100 - (offset?.y ?? 0);
    return clampPitchPosition(x, y);
  }, [clampPitchPosition]);

  const getClientPointFromPitchPosition = useCallback((position: { x: number; y: number }) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: rect.left + (position.x / 100) * rect.width,
      y: rect.top + (position.y / 100) * rect.height,
    };
  }, []);

  const getPitchPlayerAtPoint = useCallback((clientX: number, clientY: number, excludedPlayerId?: string) => {
    const elements = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean) as Element[];

    for (const element of elements) {
      const tokenEl = (element as HTMLElement).closest?.('[data-player-variant="pitch"][data-player-id]') as HTMLElement | null;
      const playerId = tokenEl?.getAttribute("data-player-id") || null;
      if (playerId && playerId !== excludedPlayerId) return playerId;
    }

    let nearest: { id: string; distance: number } | null = null;
    document.querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]').forEach(tokenEl => {
      const playerId = tokenEl.getAttribute("data-player-id");
      if (!playerId || playerId === excludedPlayerId) return;
      const player = playersRef.current.find(p => p.id === playerId);
      if (!player?.position) return;
      if (miniLeagueTeams && selectedTeamForSettings !== "both" && player.teamSide !== selectedTeamForSettings) return;
      const rect = tokenEl.getBoundingClientRect();
      const hitSlop = 24;
      if (clientX < rect.left - hitSlop || clientX > rect.right + hitSlop || clientY < rect.top - hitSlop || clientY > rect.bottom + hitSlop) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(clientX - centerX, clientY - centerY);
      if (!nearest || distance < nearest.distance) nearest = { id: playerId, distance };
    });

    if (nearest) return nearest.id;

    const pitchRect = containerRef.current?.getBoundingClientRect();
    if (pitchRect) {
      const hitRadius = Math.max(38, Math.min(58, Math.min(pitchRect.width, pitchRect.height) * 0.1));
      playersRef.current.forEach(player => {
        if (!player.position || player.id === excludedPlayerId) return;
        if (miniLeagueTeams && selectedTeamForSettings !== "both" && player.teamSide !== selectedTeamForSettings) return;
        const centerX = pitchRect.left + (player.position.x / 100) * pitchRect.width;
        const centerY = pitchRect.top + (player.position.y / 100) * pitchRect.height;
        const distance = Math.hypot(clientX - centerX, clientY - centerY);
        if (distance <= hitRadius && (!nearest || distance < nearest.distance)) {
          nearest = { id: player.id, distance };
        }
      });
    }

    if (nearest) return nearest.id;

    return null;
  }, [miniLeagueTeams, selectedTeamForSettings]);

  const getPitchPlayerOverlappingDragged = useCallback((draggedPlayerId: string, clientX: number, clientY: number) => {
    const draggedEl = Array.from(document.querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]'))
      .find(el => el.getAttribute("data-player-id") === draggedPlayerId);
    const draggedRect = draggedEl?.getBoundingClientRect();
    if (!draggedRect) return getPitchPlayerAtPoint(clientX, clientY, draggedPlayerId);

    const draggedCenterX = draggedRect.left + draggedRect.width / 2;
    const draggedCenterY = draggedRect.top + draggedRect.height / 2;
    const rectMatchesDropPoint = Math.hypot(clientX - draggedCenterX, clientY - draggedCenterY) <= Math.max(draggedRect.width, draggedRect.height);
    if (!rectMatchesDropPoint) return getPitchPlayerAtPoint(clientX, clientY, draggedPlayerId);

    let best: { id: string; score: number } | null = null;
    document.querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]').forEach(tokenEl => {
      const playerId = tokenEl.getAttribute("data-player-id");
      if (!playerId || playerId === draggedPlayerId) return;
      const player = playersRef.current.find(p => p.id === playerId);
      if (!player?.position) return;
      if (miniLeagueTeams && selectedTeamForSettings !== "both" && player.teamSide !== selectedTeamForSettings) return;

      const rect = tokenEl.getBoundingClientRect();
      const slop = 14;
      const overlapX = Math.max(0, Math.min(draggedRect.right, rect.right + slop) - Math.max(draggedRect.left, rect.left - slop));
      const overlapY = Math.max(0, Math.min(draggedRect.bottom, rect.bottom + slop) - Math.max(draggedRect.top, rect.top - slop));
      const overlapArea = overlapX * overlapY;
      if (overlapArea <= 0) return;

      const targetCenterX = rect.left + rect.width / 2;
      const targetCenterY = rect.top + rect.height / 2;
      const distance = Math.hypot(clientX - targetCenterX, clientY - targetCenterY);
      const score = overlapArea - distance;
      if (!best || score > best.score) best = { id: playerId, score };
    });

    return best?.id ?? getPitchPlayerAtPoint(clientX, clientY, draggedPlayerId);
  }, [getPitchPlayerAtPoint, miniLeagueTeams, selectedTeamForSettings]);

  const getDraggedPlayerPositionType = useCallback((player: Player, position: { x: number; y: number }) => {
    const y = miniLeagueTeams && player.teamSide === "b" ? 100 - position.y : position.y;
    return getPositionFromCoords(y, teamSize);
  }, [miniLeagueTeams, teamSize]);

  const updateDraggedPlayerPosition = useCallback((playerId: string, position: { x: number; y: number }) => {
    setPlayers(prev => prev.map(p =>
      p.id === playerId
        ? { ...p, position, currentPitchPosition: getDraggedPlayerPositionType(p, position) }
        : p
    ));
  }, [getDraggedPlayerPositionType]);

  const swapPitchPlayers = useCallback((sourcePlayerId: string, targetPlayerId: string) => {
    if (sourcePlayerId === targetPlayerId) return false;

    const snapshot = playersRef.current;
    const source = snapshot.find(p => p.id === sourcePlayerId);
    const target = snapshot.find(p => p.id === targetPlayerId);
    const sourceStart = playerDragStartRef.current?.playerId === sourcePlayerId ? playerDragStartRef.current : null;
    const sourcePosition = sourceStart?.position ?? source?.position;

    if (!source || !target?.position || !sourcePosition) return false;
    if (miniLeagueTeams && source.teamSide && target.teamSide && source.teamSide !== target.teamSide) return false;

    const sourcePitchPosition = sourceStart?.currentPitchPosition ?? source.currentPitchPosition;
    const targetPosition = { ...target.position };
    const targetPitchPosition = target.currentPitchPosition;
    const sourceName = source.name;
    const targetName = target.name;

    pushToUndoHistory(`Swap: ${sourceName} ↔ ${targetName}`, snapshot);
    setPlayers(prev => prev.map(p => {
      if (p.id === sourcePlayerId) {
        return { ...p, position: targetPosition, currentPitchPosition: targetPitchPosition };
      }
      if (p.id === targetPlayerId) {
        return { ...p, position: { ...sourcePosition }, currentPitchPosition: sourcePitchPosition };
      }
      return p;
    }));
    flashSwapFeedback(sourcePlayerId, targetPlayerId);
    return true;
  }, [miniLeagueTeams, pushToUndoHistory, flashSwapFeedback]);

  const handlePitchTouchStart = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;

    // Pinch zoom (2 fingers) - zoom without moving pitch
    if (tryPinchStart(e)) return;
  };

  const handlePitchTouchMove = (e: React.TouchEvent) => {
    // Don't handle if drawing tool is active
    if (drawingTool !== "none") return;

    // Pinch zoom (2 fingers) — consumed by the hook
    if (tryPinchMove(e)) return;

    // Player touch-drag (1 finger) — owned by usePitchBoardDragDrop.
    applyPitchTouchMove(e);
  };

  const handlePitchTouchEnd = (e: React.TouchEvent) => {
    // Pinch end first — clears the pinch baseline if fingers lifted.
    tryPinchEnd(e);
    // Then finalise any in-flight player touch-drag (bench→pitch, swap, drop).
    finalizePitchTouchEnd(e);
  };




  // Drag/drop dependency wiring moved below playersOnPitch/playersOnBench
  // definitions (TDZ avoidance). See the assignment after those `useMemo`s.



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

  // Wire the drag/drop hook's deps each render — the hook owns the handlers
  // (declared near the top of this component); we just point it at the
  // freshest helpers/state each render so identities stay stable while
  // closures see live values.
  dragDropDepsRef.current = {
    readOnly,
    players,
    playersOnPitch,
    playersRef,
    containerRef,
    capturePlayerDragOffset,
    getClientPitchPosition,
    getClientPointFromPitchPosition,
    getPitchPlayerOverlappingDragged,
    updateDraggedPlayerPosition,
    swapPitchPlayers,
    setBenchToSubPlayer,
    setBenchToSubOpen,
    setPortraitSheetOpen,
    setToolbarCollapsed,
    setSelectedOnPitch,
    setSubPreviewOpen,
  };

  // Plan repair: signature-based regen + orphan cancel + injury recalculator.
  const { recalcPlanForInjury } = usePitchBoardPlanRepair({
    players,
    playersOnPitch,
    playersRef,
    autoSubActive,
    autoSubPlan,
    setAutoSubPlan,
    regeneratePlanRef,
    handleCancelAutoSubPlan,
    gameTimerRef,
    teamSize,
    rotateGkAtHalftime,
    toast,
  });


  // Filtered on-pitch players for mini-league team selector (hides the other team)
  const filteredPlayersOnPitch = useMemo(() => {
    if (!miniLeagueTeams || selectedTeamForSettings === "both") return playersOnPitch;
    return playersOnPitch.filter(p => p.teamSide === selectedTeamForSettings);
  }, [playersOnPitch, miniLeagueTeams, selectedTeamForSettings]);

  // tacticalOffsets + ballOffset now live in usePitchBoardTactical (declared above).

  // getValidBenchPlayerIds + getValidSwapPlayerIds now live in usePitchBoardSubSelection.



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

    if (newInjuredState) {
      const updatedPlayers = players.map(p =>
        p.id === playerId ? { ...p, isInjured: true } : p
      );
      recalcPlanForInjury(updatedPlayers, playerId);
    }
  }, [readOnly, players, toast, recalcPlanForInjury]);

  // Mark a pitch player as injured: sub them off, bring a bench player on, regenerate plan
  const handleMarkInjuredOnPitch = useCallback((playerId: string, replacementId?: string) => {
    if (readOnly) return;
    const player = players.find(p => p.id === playerId);
    if (!player || player.position === null) return;

    const injuredPosition = player.position;
    const injuredPitchPos = player.currentPitchPosition;

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

    const updatedPlayers = players.map(p => {
      if (p.id === playerId) {
        return { ...p, position: null, currentPitchPosition: undefined, isInjured: true };
      }
      if (replacement && p.id === replacement.id) {
        return { ...p, position: injuredPosition, currentPitchPosition: injuredPitchPos };
      }
      return p;
    });
    recalcPlanForInjury(updatedPlayers, playerId, replacement?.id);
  }, [readOnly, players, toast, pushToUndoHistory, recalcPlanForInjury]);



  // Fill-in player state + handlers (add/remove, remote sync, dialog open, jersey numbers).
  const {
    fillInDialogOpen,
    setFillInDialogOpen,
    handleAddFillInPlayer,
    handleRemoveFillInPlayer,
    existingJerseyNumbers,
  } = usePitchBoardFillIn({
    readOnly,
    teamId,
    players,
    setPlayers,
    autoSubPlan,
    setAutoSubPlan,
    autoSubActive,
    handleCancelAutoSubPlan,
    teamSize,
    rotateGkAtHalftime,
    gameTimerRef,
    toast,
  });

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

  // movablePitchPlayerIds now lives in usePitchBoardSubSelection.

  // handleConfirmManualSub / handleCancelManualSub / handleBenchToSubSelect
  // now live in usePitchBoardManualSub.

  // Calculate which positions on pitch are occupied by the filtered position type
  // (Position zone indicators removed)

  // Landscape layout: pitch full screen on left, controls stacked on right
  // ---- Layout context for landscape/portrait split ----
  const layoutCtx: PitchBoardLayoutContextValue = {
    autoSubActive, autoSubFromPreGame, autoSubPanelOpen, autoSubPaused, autoSubPlan,
    autoSubPlanDialogOpen, autoSubPlanEditMode, ballOffset, ballPosition, benchDragPlayer,
    benchDragPos, benchInjuryConfirmOpen, benchInjuryTarget, benchLongPressTimer,
    benchPositionFilter, benchToSubOpen, benchToSubPlayer, canUseTraining, cancelPlanConfirmOpen,
    canvasRef, clearDrawings, containerRef, disableAutoSubs, disableBatchSubs,
    disablePositionSwaps, draggedPlayer, drawingColor, drawingEnabled, drawingTool,
    elapsedGameTime, fillInDialogOpen, filteredPlayersOnPitch, floatingTimerPosition,
    floatingTimerScale, formationChangeDialogOpen, formationName, gameInProgress, gameTimerRef,
    getPlayerTeamColor, getValidBenchPlayerIds, getValidSwapPlayerIds, goals,
    handleAddFillInPlayer, handleAddGoal, handleApplyTacticalSuggestion, handleBallDrag,
    handleBallDragEnd, handleBallDragStart, handleBallTouchEnd, handleBallTouchMove,
    handleBallTouchStart, handleBenchDrop, handleBenchLongPressEnd, handleBenchLongPressMove,
    handleBenchLongPressStart, handleBenchToSubSelect, handleCancelAutoSubPlan,
    handleCancelManualSub, handleCancelPitchSwap, handleCancelSwapBasedSub, handleConfirmAutoSub,
    handleAcknowledgeHalftimePrompt,
    handleConfirmManualSub, handleConfirmPitchSwap, handleConfirmPitchSwapWithAccommodation,
    handleConfirmSubAfterSwap, handleConfirmSwapBeforeSub, handleDismissTacticalSuggestion,
    handleDragEnd, handleDragOver, handleDragStart, handleExecuteNow, handleFormationChange,
    handleFormationChangeCancel, handleFormationChangeConfirm, handleHalfChange,
    handleLineupConfirm, handleLineupSkip, handleLinkEvent, handleMarkInjuredOnPitch,
    handleMaxSpreadMinutesChange, handleMinutesPerHalfChange, handleMockModeChange,
    handleOpenEditPlan, handlePitchDrop, handlePitchTouchEnd, handlePitchTouchMove,
    handlePitchTouchStart, handlePlayerClick, handlePortraitTimerTouchStart, handleRegeneratePlan,
    handleRemoveFillInPlayer, handleRemoveGoal, handleResetFormation, handleResetGame,
    handleRotationSpeedChange, handleSaveSettings, handleSetupGame,
    handleShowLineupPickerSettingChange, handleSkipAutoSub, handleSkipNextSub,
    handleStartAutoSubPlan, handleSubPreviewSelect, handleSwapAndSubstitute,
    handleTacticalModeChange, handleTeamSizeChange, handleTimerDragStart, handleTimerTouchStart,
    handleTimerUpdate, handleToggleLockPlayer, handleTogglePauseAutoSub, handleTouchStart,
    handleUndo, handleUnlinkEvent, handleUpdateGoal, handleUpdatePositions, handleWheel,
    hideScores, ignoreNextLandscapeBackdropClickRef, ignoreNextLandscapeBenchOpenRef,
    isDraggingBall, isDrawingArrowRef, isLandscape, isSavingSettings, isSubsManager,
    landscapeEventSelectorOpen, lastTapRef, linkedEventDetails, linkedEventId, lockedPlayerIds,
    manualSubConfirmOpen, maxSpreadMinutes, members, miniLeagueTeams, minutesPerHalf, mockMode,
    mode, movablePitchPlayerIds, nextSubInfo, onClose, onUnlinkEvent, openAutoSubPlanDialog,
    opponentName, pendingAutoSub, pendingBatchSubs, pendingFormationChange, pendingManualSub,
    pendingSubBenchPlayer, pendingSwapBasedSub, pinDrawingToolbar, pitchPlayerActionOpen,
    pitchZoomScrollRef,
    pitchPlayerActionTarget, pitchSwapConfirmOpen, players, playersOnBench, playersOnPitch,
    portraitSheetDragRef, portraitSheetHeightPct, portraitSheetOpen, portraitTimerPosition,
    portraitTimerScale, positionEditorOpen, positionSwapDialogOpen, preferredSecondHalfGkId,
    previewSwapPlayers, readOnly, recentlyDraggedRef, requiredPosition, resetGameConfirmOpen,
    rotateGkAtHalftime, rotationSpeed, selectedFormation, selectedOnBench, selectedOnPitch,
    selectedTeamForSettings, setAutoSubPanelOpen, setAutoSubPlanDialogOpen,
    setBenchInjuryConfirmOpen, setBenchInjuryTarget, setBenchPositionFilter, setBenchToSubOpen,
    setBenchToSubPlayer, setBottomSheetTab, setCancelPlanConfirmOpen, setDisableBatchSubs,
    setDisablePositionSwaps, setDrawingColor, setDrawingTool, setFillInDialogOpen,
    setFormationChangeDialogOpen, setHideScores, setLandscapeEventSelectorOpen,
    setManualSubConfirmOpen, setMode, setPendingSubBenchPlayer, setPinDrawingToolbar,
    setPitchPlayerActionOpen, setPitchPlayerActionTarget, setPitchSwapConfirmOpen, setPlayers,
    setPortraitSheetHeightPct, setPortraitSheetOpen, setPositionEditorOpen,
    setPositionSwapDialogOpen, setPreviewSwapPlayers, setRequiredPosition, setResetGameConfirmOpen,
    setRotateGkAtHalftime, setRotationSpeed, setSelectedFormation, setSelectedOnBench,
    setSelectedOnPitch, setSelectedTeamForSettings, setSettingsDialogOpen, setSettingsMenuOpen,
    setSheetHeightPct, setShowFloatingDrawToolbar, setShowLineupPicker, setShowMatchHeader,
    setStatsOpen, setSubConfirmDialogOpen, setSubPreviewOpen, setTeamSize,
    setTimerFormationDropdownOpen, setTimerTacticalDropdownOpen, setToolbarCollapsed,
    setTouchDragPlayer, setTouchOffset, setTrainingMenuOpen, setTrainingSettingsDialogOpen,
    settingsDialogOpen, settingsMenuOpen, sheetDragRef, sheetHeightPct, showFloatingDrawToolbar,
    showFloatingUndo, showLineupPicker, showLineupPickerSetting, showMatchHeader,
    showScoreInPortrait, statsOpen, subAfterSwapDialogOpen, subAnimationPlayers,
    subConfirmDialogOpen, subDuePlayerIds, subMode, subPreviewOpen, swapBeforeSubDialogOpen,
    swapFlashIds, swapMode, swapPlayer1, swapPlayer2, tacticalFormationSuggestion, tacticalMode,
    tacticalOffsets, teamId, teamName, teamSize, timerFormationDropdownOpen, timerResetKey,
    timerTacticalDropdownOpen, togglePlayerInjury, toggleSubMode, toggleSwapMode, toolbarCollapsed,
    touchDragPlayer, touchHandledRef, touchIdRef, trainingMenuOpen, trainingSettingsDialogOpen,
    undoHistory, user, zoom,
  };

  return (
    <PitchBoardLayoutContext.Provider value={layoutCtx}>
      {isLandscape ? <PitchBoardLandscapeLayout /> : <PitchBoardPortraitLayout />}
    </PitchBoardLayoutContext.Provider>
  );
}

/**
 * Durable lineup gate: when the board is opened for a specific fixture we first
 * pull the saved lineup for that event from the database into localStorage, so
 * a lineup planned on another device (or before a cache clear) is restored.
 * The inner board reads localStorage synchronously on mount, so it must not
 * render until hydration has settled.
 */
export default function PitchBoard(props: PitchBoardProps) {
  const { ready } = useEventLineupHydration(
    props.initialLinkedEventId ?? null,
    props.teamId,
    { enabled: !props.readOnly && !props.miniLeagueTeams }
  );

  if (!ready) {
    return <PitchBoardLoading message="Restoring lineup..." />;
  }

  return <PitchBoardInner {...props} />;
}
