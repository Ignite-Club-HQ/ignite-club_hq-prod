import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useToast } from "@/hooks/use-toast";
import { trimCompetitionRounds } from "./matchWorkflows";
import { competitionFixtureKeys } from "./queryKeys";

export function SetMaxRoundsButton({
  competitionId,
  currentMax,
  roundNums,
}: {
  competitionId: string;
  currentMax: number;
  roundNums: number[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(String(currentMax));
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setValue(String(currentMax)); }, [open, currentMax]);

  const target = Math.max(1, Number(value) || 0);
  const willDelete = roundNums.filter((n) => n > target).sort((a, b) => a - b);
  const willAdd = target > currentMax ? target - currentMax : 0;

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      if (willDelete.length > 0) {
        const { error } = await trimCompetitionRounds(competitionId, target);
        if (error) throw error;
        toast({ title: `Trimmed to ${target} round${target === 1 ? "" : "s"}` });
      } else if (willAdd > 0) {
        toast({
          title: "Use Generate or Add match",
          description: `To add ${willAdd} more round${willAdd === 1 ? "" : "s"}, regenerate the fixture or add matches manually.`,
        });
      } else {
        toast({ title: "No changes" });
      }
      qc.invalidateQueries({ queryKey: competitionFixtureKeys.matches(competitionId) });
      setOpen(false);
    } catch (error: unknown) {
      const description = typeof error === "object" && error && "message" in error
        ? String(error.message)
        : undefined;
      toast({ title: "Couldn't update", description, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setOpen(true)}>
        Set max
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Set max number of rounds</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Current max is round {currentMax}. Lowering this will delete any matches in rounds beyond the new max.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Max rounds</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            {willDelete.length > 0 && (
              <p className="text-xs text-destructive">
                Will delete round{willDelete.length === 1 ? "" : "s"} {willDelete.join(", ")} and all matches in {willDelete.length === 1 ? "it" : "them"}.
              </p>
            )}
            {willAdd > 0 && (
              <p className="text-xs text-muted-foreground">
                To add more rounds, use Generate round-robin or Add match.
              </p>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={saving || willDelete.length === 0}
              variant={willDelete.length > 0 ? "destructive" : "default"}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {willDelete.length > 0 ? `Trim to ${target} rounds` : "Save"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
