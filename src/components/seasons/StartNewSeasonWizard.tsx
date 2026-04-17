import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, ArrowLeft, CheckCircle2, Rocket, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Season } from "@/hooks/useClubSeasons";
import { ReturningMembersStep } from "./ReturningMembersStep";

interface Props {
  clubId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentSeason: Season | undefined;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

export function StartNewSeasonWizard({ clubId, open, onOpenChange, currentSeason, onComplete }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [archiveCurrent, setArchiveCurrent] = useState(true);
  const [seasonName, setSeasonName] = useState("");
  const [duplicateStructure, setDuplicateStructure] = useState(true);
  const [copyStaff, setCopyStaff] = useState(true);
  const [createdSeasonId, setCreatedSeasonId] = useState<string | null>(null);
  const qc = useQueryClient();

  const reset = () => {
    setStep(1);
    setArchiveCurrent(true);
    setSeasonName("");
    setDuplicateStructure(true);
    setCopyStaff(true);
    setCreatedSeasonId(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const archiveMut = useMutation({
    mutationFn: async () => {
      if (!currentSeason || !archiveCurrent) return;
      const { error } = await supabase.rpc("archive_season", { _season_id: currentSeason.id });
      if (error) throw error;
    },
  });

  const createMut = useMutation({
    mutationFn: async (): Promise<string> => {
      if (duplicateStructure && currentSeason) {
        const { data, error } = await supabase.rpc("duplicate_season_structure", {
          _source_season_id: currentSeason.id,
          _new_season_name: seasonName.trim(),
          _copy_staff: copyStaff,
        });
        if (error) throw error;
        return data as string;
      }
      const { data, error } = await supabase
        .from("seasons")
        .insert({ club_id: clubId, name: seasonName.trim(), status: "draft" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
  });

  const publishMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("publish_season", { _season_id: id });
      if (error) throw error;
    },
  });

  const goNext = async () => {
    try {
      if (step === 1) {
        if (archiveCurrent && currentSeason) {
          await archiveMut.mutateAsync();
          toast.success(`${currentSeason.name} archived`);
        }
        setStep(2);
      } else if (step === 2) {
        if (!seasonName.trim()) {
          toast.error("Enter a season name");
          return;
        }
        const id = await createMut.mutateAsync();
        setCreatedSeasonId(id);
        toast.success("Draft season created");
        setStep(3);
      } else if (step === 3) {
        setStep(4);
      } else if (step === 4 && createdSeasonId) {
        await publishMut.mutateAsync(createdSeasonId);
        toast.success("New season is live!");
        qc.invalidateQueries({ queryKey: ["club-seasons", clubId] });
        qc.invalidateQueries({ queryKey: ["current-season", clubId] });
        onComplete();
        reset();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const goBack = () => {
    if (step > 1 && !createdSeasonId) setStep((step - 1) as Step);
  };

  const busy = archiveMut.isPending || createMut.isPending || publishMut.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Start new season
          </DialogTitle>
          <DialogDescription>Step {step} of 4</DialogDescription>
        </DialogHeader>

        <Progress value={(step / 4) * 100} className="h-1" />

        <div className="py-4 space-y-4">
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Archive className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <h3 className="font-semibold">Archive current season</h3>
                  <p className="text-sm text-muted-foreground">
                    {currentSeason
                      ? `Sets all teams in "${currentSeason.name}" to read-only. Chats, events and history stay intact.`
                      : "No active season to archive."}
                  </p>
                </div>
              </div>
              {currentSeason && (
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <Label htmlFor="archive-toggle" className="cursor-pointer">
                    Archive {currentSeason.name}
                  </Label>
                  <Switch id="archive-toggle" checked={archiveCurrent} onCheckedChange={setArchiveCurrent} />
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="season-name">Season name</Label>
                <Input
                  id="season-name"
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.target.value)}
                  placeholder="e.g. Winter 2027"
                  autoFocus
                />
              </div>
              {currentSeason && (
                <>
                  <div className="flex items-start gap-3 p-3 rounded-lg border">
                    <Checkbox
                      id="dup"
                      checked={duplicateStructure}
                      onCheckedChange={(v) => setDuplicateStructure(!!v)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <Label htmlFor="dup" className="cursor-pointer">Duplicate structure from {currentSeason.name}</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Copies team names. Players are NOT carried over.
                      </p>
                    </div>
                  </div>
                  {duplicateStructure && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border ml-6">
                      <Checkbox
                        id="staff"
                        checked={copyStaff}
                        onCheckedChange={(v) => setCopyStaff(!!v)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="staff" className="cursor-pointer">Also copy coaches & team admins</Label>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h3 className="font-semibold">Draft season created</h3>
                  <p className="text-sm text-muted-foreground">
                    Your new season is in <strong>draft</strong> mode. You can review and adjust teams before going live.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Name:</span> <strong>{seasonName}</strong></p>
                <p><span className="text-muted-foreground">Status:</span> Draft</p>
                {duplicateStructure && currentSeason && (
                  <p><span className="text-muted-foreground">Structure:</span> Cloned from {currentSeason.name}{copyStaff ? " (with staff)" : ""}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: After publishing, you can assign players to teams from each team page.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Rocket className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h3 className="font-semibold">Publish {seasonName}?</h3>
                  <p className="text-sm text-muted-foreground">
                    This makes the new season active across the club. Members will see the new teams immediately.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 1 || busy || !!createdSeasonId}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={goNext} disabled={busy}>
            {step === 4 ? <><Rocket className="h-4 w-4 mr-1" /> Publish</> : <>Next <ArrowRight className="h-4 w-4 ml-1" /></>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
