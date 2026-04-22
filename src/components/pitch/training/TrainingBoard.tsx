import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Save,
  FolderOpen,
  FilePlus2,
  Plus,
  Check,
  ArrowLeft,
  Eye,
  Pencil,
  Settings,
  Play as PlayIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Annotation, Drill, DrillFrame, DrillMetadata, DrillObject, TrainingTool } from "./types";
import { TrainingObjectLayer } from "./TrainingObjectLayer";
import {
  cloneAnnotation,
  cloneObject,
  createAnnotation,
  createEmptyFrame,
  createObject,
} from "./objectFactories";
import { TrainingToolbar } from "./TrainingToolbar";
import { FrameStrip } from "./FrameStrip";
import { PlaybackController } from "./PlaybackController";
import { useDrillPlayback } from "@/hooks/useDrillPlayback";
import { SaveDrillDialog } from "./SaveDrillDialog";
import { DrillLibrarySheet } from "./DrillLibrarySheet";
import { SessionPlanStrip } from "./SessionPlanStrip";
import { RecentDrillsList } from "./RecentDrillsList";
import { useAddToSession, useSessionDrills } from "@/hooks/useDrillLibrary";
import { applyTeamPlayersToObjects, membersToTeamPlayers, substitutePlayerNamesInNotes } from "./teamPlayerSubstitution";
import { useTrainingSettings } from "@/hooks/useTrainingSettings";
import { DrillStepOverlay } from "./DrillStepOverlay";
import { TrainingSettingsDialog } from "./TrainingSettingsDialog";
import { useEventGoingAttendees } from "@/hooks/useEventGoingAttendees";

const PresentationMode = lazy(() => import("./PresentationMode"));

interface TrainingBoardProps {
  /** Optional: focus the toolbar in landscape (board fills full screen) */
  isLandscape?: boolean;
  readOnly?: boolean;
  /** Current team context — enables saving/sharing drills with the team */
  teamId?: string | null;
  teamName?: string;
  /** Current club context — enables sharing with the whole club */
  clubId?: string | null;
  clubName?: string;
  /** Squad members — used to substitute real player names into drills during playback */
  members?: Array<{
    id: string;
    user_id: string;
    role: string;
    profiles: { display_name: string | null; avatar_url: string | null } | null;
  }>;
  /**
   * Optional linked event ID. When set (typically when the pitch board was
   * launched from a training event), drill name substitution is restricted to
   * squad members who RSVP'd "going" so coaches only see players who are
   * actually expected to be on the pitch tonight.
   */
  linkedEventId?: string | null;
}

function clamp(v: number) {
  return Math.max(0, Math.min(100, v));
}

function PitchMarkings() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="9" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="0.7" fill="white" fillOpacity="0.7" />
      <rect x="22" y="2" width="56" height="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="36" y="2" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="22" y="84" width="56" height="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      <rect x="36" y="92" width="28" height="6" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
    </svg>
  );
}

/**
 * TrainingBoard — Phase 3.
 * Multi-frame drill editor with rAF playback, presentation mode,
 * and Supabase persistence (save / open / share).
 */
export default function TrainingBoard({
  isLandscape,
  readOnly,
  teamId,
  teamName,
  clubId,
  clubName,
  members,
  linkedEventId,
}: TrainingBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useTrainingSettings();
  const [frames, setFrames] = useState<DrillFrame[]>(() => [createEmptyFrame(0)]);
  const [activeTool, setActiveTool] = useState<TrainingTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepCounter, setStepCounter] = useState(1);
  const [playerCounter, setPlayerCounter] = useState(1);
  const [isPresenting, setIsPresenting] = useState(false);
  // Preview mode — locks editing and shows interpolated playback so coaches
  // can verify arrows, queue positions, and cone layouts before saving.
  const [previewMode, setPreviewMode] = useState(false);
  // Run Drill mode — coach is actively running the session. Hides ALL editing
  // chrome (toolbar, frame strip, action bar, session strip) so the pitch
  // dominates the screen. Coach only needs Next Step + Play.
  const [runMode, setRunMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Persistence state
  const [savedDrillId, setSavedDrillId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string>("");
  const [savedMetadata, setSavedMetadata] = useState<DrillMetadata | undefined>(undefined);
  const [savedVisibility, setSavedVisibility] = useState<"private" | "team" | "club">("private");
  const [saveOpen, setSaveOpen] = useState(false);
  // Editor is hidden until coach opens a drill or explicitly creates one.
  // Default lands on the library prompt + today's session list.
  const [editorMode, setEditorMode] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const hasAutoOpenedRef = useRef(false);

  const openLibrary = useCallback(() => {
    // Defer open to the next tick so the same tap doesn't get interpreted
    // as an immediate outside-click dismissal by the Sheet.
    window.setTimeout(() => setLibraryOpen(true), 0);
  }, []);

  // Session-plan integration
  const { data: sessionDrills } = useSessionDrills();
  const addToSessionMut = useAddToSession();
  const inSession = !!savedDrillId && (sessionDrills ?? []).some((s) => s.drillId === savedDrillId);

  const {
    currentIndex,
    view,
    isPlaying,
    speed,
    play: playPlayback,
    toggle: togglePlayback,
    next: nextFrame,
    prev: prevFrame,
    goTo,
    setSpeed,
  } = useDrillPlayback({ frames, loop: settings.loopPlayback });

  // Apply user's default playback speed once on mount and whenever it changes
  // in settings — coaches can still override per-session via the speed pill.
  useEffect(() => {
    setSpeed(settings.defaultPlaybackSpeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.defaultPlaybackSpeed]);

  const currentFrame = frames[currentIndex] ?? frames[0];
  const isAnimating = isPlaying;
  const editable = !readOnly && !isAnimating && !previewMode && !runMode;
  const hasSelection = !!selectedId;

  // Auto-open library on first mount — coaches start by picking a drill
  useEffect(() => {
    if (readOnly || hasAutoOpenedRef.current) return;
    hasAutoOpenedRef.current = true;
    if (!editorMode) {
      openLibrary();
    }
  }, [openLibrary, readOnly, editorMode]);

  const handleAddCurrentToSession = useCallback(() => {
    if (!savedDrillId) {
      toast.info("Save the drill first, then add it to today's session");
      return;
    }
    if (inSession) {
      toast.info("Already in today's session");
      return;
    }
    addToSessionMut.mutate(savedDrillId, {
      onSuccess: () => toast.success("Added to today's session"),
      onError: (err: any) => toast.error(err?.message ?? "Failed to add"),
    });
  }, [savedDrillId, inSession, addToSessionMut]);

  // ---- Frame ops ----
  const addFrame = useCallback(() => {
    setFrames((fs) => {
      // Carry forward objects from the current frame so coaches animate from the same setup
      const base = fs[currentIndex];
      const next: DrillFrame = base
        ? {
            ...createEmptyFrame(fs.length, settings.defaultFrameDurationMs),
            objects: base.objects.map((o) => ({ ...o })),
          }
        : createEmptyFrame(fs.length, settings.defaultFrameDurationMs);
      const inserted = [...fs.slice(0, currentIndex + 1), next, ...fs.slice(currentIndex + 1)];
      return inserted.map((f, i) => ({ ...f, position: i }));
    });
    setSelectedId(null);
    // Move selection to the newly inserted frame
    setTimeout(() => goTo(currentIndex + 1), 0);
  }, [currentIndex, goTo, settings.defaultFrameDurationMs]);

  const duplicateFrame = useCallback(
    (idx: number) => {
      setFrames((fs) => {
        const src = fs[idx];
        if (!src) return fs;
        const dup: DrillFrame = {
          ...createEmptyFrame(idx + 1),
          notes: src.notes,
          durationMs: src.durationMs,
          objects: src.objects.map((o) => ({ ...o })),
          annotations: src.annotations.map((a) => ({ ...a })),
        };
        const inserted = [...fs.slice(0, idx + 1), dup, ...fs.slice(idx + 1)];
        return inserted.map((f, i) => ({ ...f, position: i }));
      });
      setSelectedId(null);
      setTimeout(() => goTo(idx + 1), 0);
    },
    [goTo]
  );

  const deleteFrame = useCallback(
    (idx: number) => {
      setFrames((fs) => {
        if (fs.length <= 1) return fs;
        const filtered = fs.filter((_, i) => i !== idx);
        return filtered.map((f, i) => ({ ...f, position: i }));
      });
      setSelectedId(null);
      setTimeout(() => goTo(Math.max(0, idx - 1)), 0);
    },
    [goTo]
  );

  const reorderFrame = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= frames.length || from === to) return;
      setFrames((fs) => {
        const copy = [...fs];
        const [moved] = copy.splice(from, 1);
        copy.splice(to, 0, moved);
        return copy.map((f, i) => ({ ...f, position: i }));
      });
      setTimeout(() => goTo(to), 0);
    },
    [frames.length, goTo]
  );

  // ---- Object / annotation mutators (operate on currentFrame) ----
  const updateCurrentFrame = useCallback(
    (updater: (f: DrillFrame) => DrillFrame) => {
      setFrames((fs) => fs.map((f, i) => (i === currentIndex ? updater(f) : f)));
    },
    [currentIndex]
  );

  const addObject = useCallback(
    (obj: DrillObject) => {
      updateCurrentFrame((f) => ({ ...f, objects: [...f.objects, obj] }));
      setSelectedId(obj.id);
    },
    [updateCurrentFrame]
  );

  const addAnnotation = useCallback(
    (ann: Annotation) => {
      updateCurrentFrame((f) => ({ ...f, annotations: [...f.annotations, ann] }));
      setSelectedId(ann.id);
    },
    [updateCurrentFrame]
  );

  const moveObject = useCallback(
    (id: string, x: number, y: number) => {
      updateCurrentFrame((f) => ({
        ...f,
        objects: f.objects.map((o) =>
          o.id === id ? { ...o, x: clamp(x), y: clamp(y) } : o
        ),
      }));
    },
    [updateCurrentFrame]
  );

  const moveAnnotation = useCallback(
    (id: string, x: number, y: number) => {
      updateCurrentFrame((f) => ({
        ...f,
        annotations: f.annotations.map((a) => {
          if (a.id !== id) return a;
          const cx = clamp(x);
          const cy = clamp(y);
          switch (a.type) {
            case "arrow-solid":
            case "arrow-dashed": {
              const g = a.geometry as { from: { x: number; y: number }; to: { x: number; y: number } };
              const dx = cx - g.from.x;
              const dy = cy - g.from.y;
              return {
                ...a,
                geometry: {
                  from: { x: cx, y: cy },
                  to: { x: clamp(g.to.x + dx), y: clamp(g.to.y + dy) },
                },
              };
            }
            case "zone":
              return { ...a, geometry: { ...(a.geometry as any), x: cx, y: cy } };
            case "text":
              return { ...a, geometry: { ...(a.geometry as any), x: cx, y: cy } };
            case "step-marker":
              return { ...a, geometry: { ...(a.geometry as any), x: cx, y: cy } };
          }
        }),
      }));
    },
    [updateCurrentFrame]
  );

  // ---- Pitch tap handler — places the active tool ----
  const handlePitchPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!editable) return;
      if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute("data-pitch-surface")) {
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      if (activeTool === "select") {
        setSelectedId(null);
        return;
      }

      if (
        activeTool === "player" ||
        activeTool === "ball" ||
        activeTool === "cone" ||
        activeTool === "mini-goal" ||
        activeTool === "full-goal"
      ) {
        const overrides: Partial<DrillObject> =
          activeTool === "player" ? { label: String(playerCounter) } : {};
        if (activeTool === "player") setPlayerCounter((n) => n + 1);
        addObject(createObject(activeTool, x, y, overrides));
        return;
      }

      if (activeTool === "step-marker") {
        addAnnotation(createAnnotation("step-marker", x, y, { stepNumber: stepCounter }));
        setStepCounter((n) => n + 1);
        return;
      }
      if (activeTool === "text") {
        const text = window.prompt("Label text:", "Note");
        if (!text) return;
        addAnnotation(createAnnotation("text", x, y, { text }));
        return;
      }
      addAnnotation(createAnnotation(activeTool, x, y));
    },
    [activeTool, addAnnotation, addObject, editable, playerCounter, stepCounter]
  );

  // ---- Toolbar actions ----
  const handleDuplicate = useCallback(() => {
    if (!selectedId) return;
    updateCurrentFrame((f) => {
      const obj = f.objects.find((o) => o.id === selectedId);
      if (obj) {
        const next = cloneObject(obj);
        return { ...f, objects: [...f.objects, next] };
      }
      const ann = f.annotations.find((a) => a.id === selectedId);
      if (ann) {
        const next = cloneAnnotation(ann);
        return { ...f, annotations: [...f.annotations, next] };
      }
      return f;
    });
  }, [selectedId, updateCurrentFrame]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    updateCurrentFrame((f) => ({
      ...f,
      objects: f.objects.filter((o) => o.id !== selectedId),
      annotations: f.annotations.filter((a) => a.id !== selectedId),
    }));
    setSelectedId(null);
  }, [selectedId, updateCurrentFrame]);

  const handleClear = useCallback(() => {
    if (!currentFrame) return;
    if (currentFrame.objects.length === 0 && currentFrame.annotations.length === 0) return;
    if (!window.confirm("Clear this frame?")) return;
    updateCurrentFrame((f) => ({ ...f, objects: [], annotations: [] }));
    setSelectedId(null);
  }, [currentFrame, updateCurrentFrame]);

  // ---- Drill open / new ----
  const handleNewDrill = useCallback(() => {
    if (frames.some((f) => f.objects.length || f.annotations.length)) {
      if (!window.confirm("Start a new drill? Unsaved changes will be lost.")) return;
    }
    setFrames([createEmptyFrame(0)]);
    setSelectedId(null);
    setStepCounter(1);
    setPlayerCounter(1);
    setSavedDrillId(null);
    setSavedName("");
    setSavedMetadata(undefined);
    setSavedVisibility("private");
    goTo(0);
    setEditorMode(true);
    setPreviewMode(false);
  }, [frames, goTo]);

  const handleOpenDrill = useCallback(
    (drill: Drill) => {
      const loaded = drill.frames.length > 0 ? drill.frames : [createEmptyFrame(0)];
      setFrames(loaded);
      setSelectedId(null);
      setSavedDrillId(drill.id);
      setSavedName(drill.name);
      setSavedMetadata(drill.metadata);
      setSavedVisibility(drill.visibility);
      // Reset counters above any existing labels
      const maxStep = Math.max(
        0,
        ...loaded.flatMap((f) =>
          f.annotations
            .filter((a) => a.type === "step-marker")
            .map((a) => (a.geometry as { number: number }).number)
        )
      );
      setStepCounter(maxStep + 1);
      setPlayerCounter(1);
      goTo(0);
      setEditorMode(true);
      // Open in preview (read-only) mode by default so the toolbar stays
      // hidden until the coach explicitly taps Edit. Coaches who prefer to
      // jump straight to editing can disable this in Training Settings.
      // Auto-start playback for multi-frame drills so they immediately
      // animate when opened.
      const startInPreview = settings.autoOpenInPreview;
      setPreviewMode(startInPreview);
      setActiveTool("select");
      if (startInPreview && loaded.length > 1) {
        // Defer to next tick so the playback hook sees the new frames first
        window.setTimeout(() => playPlayback(), 0);
      }
      toast.success(`Opened "${drill.name}"`);
    },
    [goTo, playPlayback, settings.autoOpenInPreview]
  );

  const handleExitEditor = useCallback(() => {
    const dirty = frames.some((f) => f.objects.length || f.annotations.length);
    if (dirty && !savedDrillId) {
      if (!window.confirm("Close this drill? Unsaved changes will be lost.")) return;
    }
    setFrames([createEmptyFrame(0)]);
    setSelectedId(null);
    setStepCounter(1);
    setPlayerCounter(1);
    setSavedDrillId(null);
    setSavedName("");
    setSavedMetadata(undefined);
    setSavedVisibility("private");
    goTo(0);
    setEditorMode(false);
    setPreviewMode(false);
    setRunMode(false);
    // After leaving a drill the coach almost always wants to pick another one.
    // Re-open the library immediately so they don't land on an empty screen.
    openLibrary();
  }, [frames, savedDrillId, goTo, openLibrary]);

  const cursorClass = useMemo(() => {
    if (!editable) return "cursor-default";
    if (activeTool === "select") return "cursor-default";
    return "cursor-crosshair";
  }, [activeTool, editable]);

  // Substitute generic drill labels ("A", "B", "1"...) with real squad names
  // so coaches see actual players on the pitch in both editor + playback views.
  // Honours the user's "Use real squad names" preference.
  const teamPlayers = useMemo(
    () => (settings.substituteRealNames ? membersToTeamPlayers(members) : []),
    [members, settings.substituteRealNames]
  );

  // The view we render: live interpolation while playing, raw current frame while editing
  const rawObjects = isAnimating ? view.objects : currentFrame?.objects ?? [];
  const renderedObjects = useMemo(
    () => (teamPlayers.length ? applyTeamPlayersToObjects(rawObjects, teamPlayers) : rawObjects),
    [rawObjects, teamPlayers]
  );
  const renderedAnnotations = isAnimating ? view.annotations : currentFrame?.annotations ?? [];

  // ---- Landing view (no editor) — shown until coach opens or creates a drill ----
  if (!editorMode && !readOnly) {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-background">
        {/* Session strip kept (it auto-hides when empty) so coaches can resume
            today's plan without an extra trip into the library. */}
        <SessionPlanStrip
          loadedDrillId={savedDrillId}
          onOpenDrill={handleOpenDrill}
        />

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-sm w-full mx-auto px-6 pt-10 pb-8 flex flex-col items-center gap-6">
            {/* Title block — short, decision-oriented (not a loading state). */}
            <div className="text-center space-y-1.5">
              <h2 className="text-lg font-semibold text-foreground">Plan your session</h2>
              <p className="text-sm text-muted-foreground">
                Choose a drill from the library or create your own.
              </p>
            </div>

            {/* Primary actions — single clear hierarchy. */}
            <div className="w-full flex flex-col gap-3">
              <Button
                type="button"
                size="lg"
                onClick={openLibrary}
                className="w-full font-semibold"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Browse Drill Library
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={handleNewDrill}
                className="w-full"
              >
                <FilePlus2 className="h-4 w-4 mr-2" />
                Create New Drill
              </Button>
            </div>

            {/* Recent drills — only renders when the coach has used drills before.
                Keeps the screen quiet for first-time users (no empty state). */}
            <RecentDrillsList teamId={teamId} onOpenDrill={handleOpenDrill} />
          </div>
        </div>

        {/* Library sheet */}
        <DrillLibrarySheet
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          teamId={teamId}
          onOpenDrill={handleOpenDrill}
          onNewDrill={handleNewDrill}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-pitch-green">
      {/* TOP BAR — back / title / settings. Compact (~30% shorter than before). */}
      <div className="shrink-0 flex items-center gap-1 px-2 h-11 border-b border-border bg-background">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleExitEditor}
          className="h-9 w-9 shrink-0"
          aria-label="Back to drill library"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate text-center px-1">
          {savedName || (savedDrillId ? "Drill" : "New drill")}
          {(previewMode || runMode) && (
            <span className="ml-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              · {runMode ? "Run" : "Preview"}
            </span>
          )}
        </div>
        {!readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            className="h-9 w-9 shrink-0"
            aria-label="Drill settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        ) : (
          <div className="w-9 shrink-0" aria-hidden />
        )}
      </div>

      {/* SECONDARY ACTION BAR — compact, icon + short label. Hidden in Run mode. */}
      {!readOnly && !runMode && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 h-10 border-b border-border bg-background">
          {savedDrillId && (
            <Button
              type="button"
              size="sm"
              variant={inSession ? "secondary" : "ghost"}
              onClick={handleAddCurrentToSession}
              disabled={inSession || addToSessionMut.isPending}
              className="h-8 px-2 text-xs"
            >
              {inSession ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  In session
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Session
                </>
              )}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={previewMode ? "default" : "ghost"}
            onClick={() => {
              setPreviewMode((p) => {
                const next = !p;
                if (next) {
                  setSelectedId(null);
                  setActiveTool("select");
                }
                return next;
              });
            }}
            className="h-8 px-2 text-xs"
            aria-pressed={previewMode}
          >
            {previewMode ? (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 mr-1" />
                Preview
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSaveOpen(true)}
            className="h-8 px-2 text-xs"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>

          <div className="ml-auto">
            <Button
              type="button"
              size="sm"
              variant={runMode ? "default" : "outline"}
              onClick={() => {
                setRunMode(true);
                setPreviewMode(true);
                setSelectedId(null);
                setActiveTool("select");
                if (frames.length > 1) {
                  window.setTimeout(() => playPlayback(), 0);
                }
              }}
              className="h-8 px-2.5 text-xs font-semibold"
              aria-label="Run drill — full-screen coach mode"
            >
              <PlayIcon className="h-3.5 w-3.5 mr-1" />
              Run drill
            </Button>
          </div>
        </div>
      )}

      {/* Run-mode mini bar — only Exit Run, so coach can return to editing. */}
      {runMode && (
        <div className="shrink-0 flex items-center justify-end px-2 h-9 border-b border-border bg-background">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRunMode(false)}
            className="h-7 px-2 text-xs"
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Exit run
          </Button>
        </div>
      )}

      {/* Today's session strip — hidden during Run mode to maximise pitch */}
      {!readOnly && !runMode && (
        <SessionPlanStrip
          loadedDrillId={savedDrillId}
          onOpenDrill={handleOpenDrill}
        />
      )}

      {/* PITCH SURFACE — the hero. Full width, minimal padding, no border. */}
      <div className={cn(
        "flex-1 min-h-0 flex items-stretch justify-center",
        runMode ? "p-1" : "px-2 py-2"
      )}>
        <div
          ref={containerRef}
          data-pitch-surface
          onPointerDown={handlePitchPointerDown}
          className={cn(
            "relative rounded-md overflow-hidden select-none",
            cursorClass,
            isLandscape ? "w-full h-full" : "w-full max-w-[820px] aspect-[2/3] mx-auto",
            !runMode && "shadow-md"
          )}
          style={{
            backgroundColor: "hsl(var(--pitch-green))",
            backgroundImage:
              "repeating-linear-gradient(0deg, hsla(0,0%,100%,0.03) 0 8%, transparent 8% 16%)",
          }}
        >
          {settings.showPitchMarkings && <PitchMarkings />}

          {/* Floating coaching-points card — only when previewing a saved drill
              and the user opted in. Constrained width, never blocks centre. */}
          {previewMode &&
            !runMode &&
            settings.showCoachingPointsInPreview &&
            (savedMetadata?.coachingPoints?.length ?? 0) > 0 && (
              <div className="absolute top-2 right-2 z-[55] max-w-[60%] bg-black/60 backdrop-blur-md border border-white/15 rounded-lg p-2 text-[11px] shadow-lg pointer-events-none text-white">
                <div className="font-semibold mb-0.5">Coaching points</div>
                <ul className="space-y-0.5 list-disc list-inside text-white/85">
                  {savedMetadata!.coachingPoints!.slice(0, 3).map((cp, i) => (
                    <li key={i}>{cp}</li>
                  ))}
                </ul>
              </div>
            )}

          {/* FLOATING DRILL STEP CARD — replaces the old full-width caption bar.
              Notes have placeholder tokens (A1, D2, GK1...) replaced with the
              actual squad names so coaches read "Mia drives at Jacob" instead
              of "A1 drives at D1". Falls back to the raw note when no squad
              is loaded or the substitution preference is off. */}
          <DrillStepOverlay
            frameNumber={currentIndex + 1}
            totalFrames={frames.length}
            notes={substitutePlayerNamesInNotes(
              (isAnimating ? view.notes : currentFrame?.notes) ?? "",
              rawObjects,
              teamPlayers
            )}
            anchor={runMode ? "bottom" : "top"}
          />

          <TrainingObjectLayer
            objects={renderedObjects}
            annotations={renderedAnnotations}
            selectedId={editable ? selectedId : null}
            onSelect={setSelectedId}
            onObjectMove={moveObject}
            onAnnotationMove={moveAnnotation}
            containerRef={containerRef}
            readOnly={!editable}
          />
        </div>
      </div>

      {/* RUN MODE controls — minimal Play / Prev / Next bar. */}
      {runMode && !readOnly && (
        <div className="shrink-0 flex items-center justify-center gap-3 px-3 py-2 bg-background/95 backdrop-blur border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={prevFrame}
            disabled={currentIndex === 0}
            className="h-10 px-3"
          >
            Prev
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (frames.length < 2) {
                toast.info("This drill has only one step.");
                return;
              }
              togglePlayback();
            }}
            className="h-11 px-5 rounded-full font-semibold"
          >
            {isPlaying ? "Pause" : "Play"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={nextFrame}
            disabled={currentIndex >= frames.length - 1}
            className="h-10 px-3"
          >
            Next step
          </Button>
        </div>
      )}

      {/* EDIT/PREVIEW MODE — full playback controls, frame strip, toolbar */}
      {!readOnly && !runMode && (
        <PlaybackController
          isPlaying={isPlaying}
          speed={speed}
          currentIndex={currentIndex}
          frameCount={frames.length}
          onToggle={() => {
            if (frames.length < 2) {
              toast.info("Add a second frame to animate — tap +Add below or duplicate this frame, then move players/arrows.");
              return;
            }
            togglePlayback();
          }}
          onPrev={prevFrame}
          onNext={nextFrame}
          onSpeedChange={setSpeed}
          onPresent={() => setIsPresenting(true)}
        />
      )}

      {/* Frame strip — only in edit mode (not preview, not run) */}
      {!readOnly && !previewMode && !runMode && (
        <FrameStrip
          frames={frames}
          currentIndex={currentIndex}
          onSelect={(i) => {
            setSelectedId(null);
            goTo(i);
          }}
          onAdd={addFrame}
          onDuplicate={duplicateFrame}
          onDelete={deleteFrame}
          onReorder={reorderFrame}
          disabled={isAnimating}
        />
      )}

      {/* Toolbar — only in edit mode */}
      {!readOnly && !previewMode && !runMode && (
        <TrainingToolbar
          activeTool={activeTool}
          onToolChange={(t) => {
            setActiveTool(t);
            if (t !== "select") setSelectedId(null);
          }}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onClear={handleClear}
          hasSelection={hasSelection}
        />
      )}


      {/* Presentation overlay */}
      {isPresenting && (
        <Suspense fallback={null}>
          <PresentationMode
            frames={frames}
            initialIndex={currentIndex}
            onClose={() => setIsPresenting(false)}
            teamPlayers={membersToTeamPlayers(members)}
          />
        </Suspense>
      )}

      {/* Save / update dialog */}
      <SaveDrillDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        drillId={savedDrillId ?? undefined}
        initialName={savedName}
        initialMetadata={savedMetadata}
        initialVisibility={savedVisibility}
        frames={frames}
        teamId={teamId}
        teamName={teamName}
        clubId={clubId}
        clubName={clubName}
        onSaved={(id) => {
          setSavedDrillId(id);
        }}
      />

      {/* Library sheet */}
      <DrillLibrarySheet
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        teamId={teamId}
        onOpenDrill={handleOpenDrill}
        onNewDrill={handleNewDrill}
      />

      {/* Drill settings */}
      <TrainingSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
