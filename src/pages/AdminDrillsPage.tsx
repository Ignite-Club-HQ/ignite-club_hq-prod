import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { TrainingObjectLayer } from "@/components/pitch/training/TrainingObjectLayer";
import { generateFrame2 } from "@/components/pitch/training/autoFrame2";
import { interpolateFrames } from "@/components/pitch/training/interpolation";
import type { Annotation, DrillFrame, DrillObject } from "@/components/pitch/training/types";

interface SingleFrameDrill {
  id: string;
  name: string;
  is_official: boolean;
  visibility: string;
  frame: DrillFrame; // the only frame
  arrowCount: number;
}

export default function AdminDrillsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: isAppAdmin, isLoading: checkingAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  const {
    data: singleFrameDrills,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-single-frame-drills"],
    enabled: !!isAppAdmin,
    queryFn: async (): Promise<SingleFrameDrill[]> => {
      // Pull every drill, count its frames in code (simpler than a SQL view).
      const { data: drills, error: dErr } = await supabase
        .from("drills")
        .select("id, name, is_official, visibility")
        .order("name");
      if (dErr) throw dErr;
      if (!drills?.length) return [];

      const ids = drills.map((d) => d.id);
      const { data: frames, error: fErr } = await supabase
        .from("drill_frames")
        .select("id, drill_id, position, duration_ms, notes, objects, annotations")
        .in("drill_id", ids)
        .order("position");
      if (fErr) throw fErr;

      const byDrill = new Map<string, typeof frames>();
      for (const f of frames ?? []) {
        const list = byDrill.get(f.drill_id) ?? [];
        list.push(f);
        byDrill.set(f.drill_id, list);
      }

      const result: SingleFrameDrill[] = [];
      for (const d of drills) {
        const fs = byDrill.get(d.id) ?? [];
        if (fs.length !== 1) continue;
        const raw = fs[0];
        const frame: DrillFrame = {
          id: raw.id,
          position: raw.position,
          durationMs: raw.duration_ms,
          notes: raw.notes ?? undefined,
          objects: (Array.isArray(raw.objects) ? raw.objects : []) as unknown as DrillObject[],
          annotations: (Array.isArray(raw.annotations) ? raw.annotations : []) as unknown as Annotation[],
        };
        const arrowCount = frame.annotations.filter(
          (a) => a.type === "arrow-solid" || a.type === "arrow-dashed"
        ).length;
        result.push({
          id: d.id,
          name: d.name,
          is_official: !!d.is_official,
          visibility: d.visibility,
          frame,
          arrowCount,
        });
      }
      return result;
    },
  });

  if (checkingAdmin || isLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <Header onBack={() => navigate(-1)} />
        <p className="text-muted-foreground text-center">Access denied. App admin role required.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6 max-w-3xl mx-auto px-4">
      <Header onBack={() => navigate(-1)} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            Auto-generate frame 2
          </CardTitle>
          <CardDescription>
            Drills with only one frame can't animate when coaches press Play. This tool reads the
            arrow annotations on the existing frame and creates a second frame that moves each
            anchored player/ball to the arrow's destination — then previews the motion before you
            save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(singleFrameDrills?.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              All drills already have at least 2 frames. Nothing to do.
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {singleFrameDrills!.length} drill{singleFrameDrills!.length === 1 ? "" : "s"} need
              attention.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {singleFrameDrills?.map((d) => (
          <DrillRow
            key={d.id}
            drill={d}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["admin-single-frame-drills"] });
              refetch();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Drill Frame Audit</h1>
        <p className="text-sm text-muted-foreground">
          Find single-frame drills and auto-generate motion
        </p>
      </div>
    </div>
  );
}

function DrillRow({
  drill,
  onSaved,
}: {
  drill: SingleFrameDrill;
  onSaved: () => void;
}) {
  const [generated, setGenerated] = useState<DrillFrame | null>(null);
  const [movedCount, setMovedCount] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleGenerate = () => {
    try {
      const result = generateFrame2(drill.frame, 1500);
      setGenerated(result.frame);
      setMovedCount(result.movedCount);
      if (result.movedCount === 0) {
        toast.warning(
          "Generated a duplicate frame — no arrows were anchored to a player or ball. Add arrows on top of objects to drive motion."
        );
      } else {
        toast.success(`Moved ${result.movedCount} object${result.movedCount === 1 ? "" : "s"}.`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to generate frame.");
    }
  };

  const handleSave = async () => {
    if (!generated) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("drill_frames").insert({
        drill_id: drill.id,
        position: 1,
        duration_ms: generated.durationMs,
        notes: generated.notes ?? null,
        objects: generated.objects as unknown as never,
        annotations: generated.annotations as unknown as never,
      });
      if (error) throw error;
      toast.success(`"${drill.name}" now animates.`);
      onSaved();
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{drill.name}</CardTitle>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {drill.is_official && (
                <Badge variant="secondary" className="text-xs">Official</Badge>
              )}
              <Badge variant="outline" className="text-xs">{drill.visibility}</Badge>
              <Badge variant="outline" className="text-xs">
                {drill.arrowCount} arrow{drill.arrowCount === 1 ? "" : "s"}
              </Badge>
              {drill.arrowCount === 0 && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  No arrows
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {generated ? (
          <PreviewBoard frame1={drill.frame} frame2={generated} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Click "Generate" to preview the motion derived from this drill's arrows.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant={generated ? "outline" : "default"}
            size="sm"
            onClick={handleGenerate}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            {generated ? "Re-generate" : "Generate frame 2"}
          </Button>
          {generated && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
              )}
              Save frame 2 ({movedCount} moved)
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Loops a 1.5s playback of frame1 → frame2 so the admin can verify the motion
 * before committing. Uses the same TrainingObjectLayer the editor uses, so the
 * preview is pixel-identical to what coaches will see.
 */
function PreviewBoard({ frame1, frame2 }: { frame1: DrillFrame; frame2: DrillFrame }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const durationMs = frame2.durationMs ?? 1500;

  useEffect(() => {
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const elapsed = now - startRef.current;
      const cycle = (elapsed % (durationMs + 600)) / durationMs; // 600ms hold at end
      setT(Math.min(1, cycle));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startRef.current = null;
    };
  }, [durationMs, frame1, frame2]);

  const view = useMemo(() => interpolateFrames(frame1, frame2, t), [frame1, frame2, t]);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[2/3] max-h-[320px] mx-auto rounded-md overflow-hidden shadow-inner"
      style={{
        backgroundColor: "hsl(var(--pitch-green))",
        backgroundImage:
          "repeating-linear-gradient(0deg, hsla(0,0%,100%,0.03) 0 8%, transparent 8% 16%)",
      }}
    >
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
        <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
        <circle cx="50" cy="50" r="9" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" />
      </svg>
      <TrainingObjectLayer
        objects={view.objects}
        annotations={view.annotations}
        selectedId={null}
        onSelect={() => {}}
        onObjectMove={() => {}}
        onAnnotationMove={() => {}}
        containerRef={containerRef}
        readOnly
      />
    </div>
  );
}
