import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";

export default function CompetitionSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  usePageTitle("Competition settings");

  const { data: competition, isLoading, refetch } = useQuery({
    queryKey: ["competition", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: isAdmin = false, isLoading: adminLoading } = useQuery({
    queryKey: ["competition-isadmin", id, user?.id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("is_competition_admin", {
        _user_id: user!.id,
        _competition_id: id!,
      });
      return !!data;
    },
  });

  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [description, setDescription] = useState("");
  const [pointsWin, setPointsWin] = useState("3");
  const [pointsDraw, setPointsDraw] = useState("1");
  const [pointsLoss, setPointsLoss] = useState("0");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  if (competition && !hydrated) {
    setName(competition.name);
    setStatus(competition.status);
    setVisibility(competition.visibility);
    setDescription(competition.description ?? "");
    setPointsWin(String(competition.points_win ?? 3));
    setPointsDraw(String(competition.points_draw ?? 1));
    setPointsLoss(String(competition.points_loss ?? 0));
    setHydrated(true);
  }

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("competitions")
      .update({
        name: name.trim(),
        status,
        visibility,
        description: description.trim() || null,
        points_win: Number.parseInt(pointsWin, 10) || 0,
        points_draw: Number.parseInt(pointsDraw, 10) || 0,
        points_loss: Number.parseInt(pointsLoss, 10) || 0,
      })
      .eq("id", competition!.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    refetch();
  };

  if (isLoading || adminLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!competition) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Competition not found.</div>;
  }
  if (!isAdmin) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Button asChild variant="ghost" size="icon" className="-ml-2 h-11 w-11" aria-label={`Back to ${competition.name}`}>
          <Link to={`/competitions/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <p className="text-sm text-muted-foreground">You don't have permission to manage this competition.</p>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Button asChild variant="ghost" size="icon" className="-ml-2 h-11 w-11" aria-label={`Back to ${competition.name}`}>
        <Link to={`/competitions/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage details and ladder scoring.</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["draft","open","active","completed","archived"].map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="pt-2 border-t">
            <Label className="text-sm font-medium">Ladder points</Label>
            <p className="text-xs text-muted-foreground mb-2">How many points each result is worth on the ladder.</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Win</Label>
                <Input type="number" inputMode="numeric" value={pointsWin} onChange={(e) => setPointsWin(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Draw</Label>
                <Input type="number" inputMode="numeric" value={pointsDraw} onChange={(e) => setPointsDraw(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Loss</Label>
                <Input type="number" inputMode="numeric" value={pointsLoss} onChange={(e) => setPointsLoss(e.target.value)} />
              </div>
            </div>
          </div>
          <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save changes
          </Button>
        </CardContent>
      </Card>

      <DivisionLadderVisibility competitionId={id!} />
    </div>
  );
}

function DivisionLadderVisibility({ competitionId }: { competitionId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: divisions = [], isLoading } = useQuery({
    queryKey: ["competition-divisions", competitionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_divisions")
        .select("*")
        .eq("competition_id", competitionId)
        .order("sort_order");
      return data ?? [];
    },
  });

  const toggle = async (divisionId: string, hide: boolean) => {
    const { error } = await supabase
      .from("competition_divisions")
      .update({ hide_ladder: hide })
      .eq("id", divisionId);
    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["competition-divisions", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <Label className="text-sm font-medium">Ladder visibility by division / grade</Label>
          <p className="text-xs text-muted-foreground">Hide the ladder for non-competitive divisions or grades. Fixtures and results stay visible.</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : divisions.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No divisions yet.</p>
        ) : (
          <div className="divide-y border rounded-md">
            {divisions.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.name}</div>
                  {[d.age_group, d.gender, d.skill_level].filter(Boolean).length > 0 && (
                    <div className="text-xs text-muted-foreground truncate">
                      {[d.age_group, d.gender, d.skill_level].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">Hide ladder</span>
                  <Switch
                    checked={!!d.hide_ladder}
                    onCheckedChange={(v) => toggle(d.id, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
