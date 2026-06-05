import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Check, UserPlus, X, Crown, Shield } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

  // Derived dirty state — Save is a page-level action
  const initial = useMemo(() => competition ? ({
    name: competition.name ?? "",
    status: competition.status ?? "draft",
    visibility: competition.visibility ?? "private",
    description: competition.description ?? "",
    pointsWin: String(competition.points_win ?? 3),
    pointsDraw: String(competition.points_draw ?? 1),
    pointsLoss: String(competition.points_loss ?? 0),
  }) : null, [competition]);

  const current = { name, status, visibility, description, pointsWin, pointsDraw, pointsLoss };
  const isDirty = !!initial && (
    initial.name !== name ||
    initial.status !== status ||
    initial.visibility !== visibility ||
    initial.description !== description ||
    initial.pointsWin !== pointsWin ||
    initial.pointsDraw !== pointsDraw ||
    initial.pointsLoss !== pointsLoss
  );

  const [justSaved, setJustSaved] = useState(false);

  const clampPoint = (v: string) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n) || n < 0) return "0";
    return String(n);
  };

  const save = async () => {
    if (!isDirty) return;
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
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
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

  // Map DB status values to simplified UI options
  const statusOptions: { value: string; label: string }[] = [
    { value: "draft", label: "Draft" },
    { value: "active", label: "Published" },
    { value: "archived", label: "Archived" },
  ];
  // Preserve any legacy value (open, completed) so it isn't silently dropped
  if (!statusOptions.find((o) => o.value === status) && status) {
    statusOptions.splice(2, 0, { value: status, label: status.charAt(0).toUpperCase() + status.slice(1) });
  }

  const publicLinkOn = visibility === "public";

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 pb-32 space-y-5">
      <div className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="-ml-2 h-11 w-11 shrink-0" aria-label={`Back to ${competition.name}`}>
          <Link to={`/competitions/${id}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="space-y-1 pt-1.5">
          <h1 className="text-2xl font-bold leading-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage competition details, visibility and scoring.</p>
        </div>
      </div>

      {/* 1. Competition details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Competition details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="comp-name">Name</Label>
            <Input id="comp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="comp-desc">Description</Label>
            <Textarea
              id="comp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add competition details, rules or notes"
              rows={4}
              className="resize-y min-h-[96px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Publishing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Publishing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="comp-status">Competition status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="comp-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statusOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="comp-public" className="cursor-pointer">Public link</Label>
              <p className="text-xs text-muted-foreground">
                Draft competitions are only visible to organisers. Turn on public link when you are ready to share.
              </p>
            </div>
            <Switch
              id="comp-public"
              checked={publicLinkOn}
              onCheckedChange={(v) => setVisibility(v ? "public" : "private")}
            />
          </div>
        </CardContent>
      </Card>

      {/* 3. Ladder scoring */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ladder scoring</CardTitle>
          <CardDescription>Set the points awarded for each result.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pts-win" className="text-xs">Win</Label>
              <Input
                id="pts-win"
                type="number"
                inputMode="numeric"
                min={0}
                value={pointsWin}
                onChange={(e) => setPointsWin(e.target.value)}
                onBlur={(e) => setPointsWin(clampPoint(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pts-draw" className="text-xs">Draw</Label>
              <Input
                id="pts-draw"
                type="number"
                inputMode="numeric"
                min={0}
                value={pointsDraw}
                onChange={(e) => setPointsDraw(e.target.value)}
                onBlur={(e) => setPointsDraw(clampPoint(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pts-loss" className="text-xs">Loss</Label>
              <Input
                id="pts-loss"
                type="number"
                inputMode="numeric"
                min={0}
                value={pointsLoss}
                onChange={(e) => setPointsLoss(e.target.value)}
                onBlur={(e) => setPointsLoss(clampPoint(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. Ladder visibility */}
      <DivisionLadderVisibility competitionId={id!} />

      {/* 5. Coordinators */}
      <CoordinatorsPanel competitionId={id!} />


      {/* Sticky save bar — page-level action */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background shadow-lg transition-transform",
          isDirty || justSaved ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="container max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {justSaved ? "Changes saved" : isDirty ? "You have unsaved changes" : ""}
          </p>
          <Button onClick={save} disabled={!isDirty || saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : justSaved ? <Check className="h-4 w-4 mr-2" /> : null}
            {justSaved ? "Saved" : "Save changes"}
          </Button>
        </div>
      </div>
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
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ladder visibility</CardTitle>
        <CardDescription>Choose which divisions or grades show a ladder. Fixtures and results stay visible.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : divisions.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">No divisions yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Add divisions from the Teams tab to manage ladder visibility.</p>
          </div>
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

function CoordinatorsPanel({ competitionId }: { competitionId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: coordinators = [], isLoading } = useQuery({
    queryKey: ["competition-coordinators", competitionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_competition_coordinators", {
        _competition_id: competitionId,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        user_id: string;
        role: string;
        display_name: string | null;
        avatar_url: string | null;
        created_at: string;
      }>;
    },
  });

  const { data: candidates = [], isFetching: searching } = useQuery({
    queryKey: ["competition-coordinator-candidates", competitionId, search],
    enabled: search.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_competition_coordinator_candidates", {
        _competition_id: competitionId,
        _query: search.trim(),
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
        source: string;
      }>;
    },
  });

  const existingIds = new Set(coordinators.map((c) => c.user_id));

  const addCoordinator = async (userId: string) => {
    setAdding(true);
    const { error } = await supabase.from("competition_roles").insert({
      competition_id: competitionId,
      user_id: userId,
      role: "admin",
    });
    setAdding(false);
    if (error) {
      toast({ title: "Could not add coordinator", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Coordinator added" });
    setSearch("");
    qc.invalidateQueries({ queryKey: ["competition-coordinators", competitionId] });
  };

  const removeCoordinator = async (userId: string, role: string) => {
    if (role === "owner") return;
    const isSelf = userId === user?.id;
    if (isSelf && !window.confirm("Leave as coordinator for this competition? You'll lose access to coordinator tools and the coordinator chat group.")) {
      return;
    }
    const { error } = await supabase
      .from("competition_roles")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", userId);
    if (error) {
      toast({ title: isSelf ? "Could not leave" : "Could not remove coordinator", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: isSelf ? "You've left as coordinator" : "Coordinator removed" });
    qc.invalidateQueries({ queryKey: ["competition-coordinators", competitionId] });
    if (isSelf) {
      navigate("/competitions");
    }
  };

  const initials = (name: string | null) =>
    (name ?? "?")
      .split(" ")
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Coordinators</CardTitle>
        <CardDescription>
          People who can manage this competition and are auto-added to the coordinator chat group.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : (
          <ul className="divide-y border rounded-md">
            {coordinators.map((c) => (
              <li key={c.user_id} className="flex items-center gap-3 p-3">
                <Avatar className="h-9 w-9">
                  {c.avatar_url && <AvatarImage src={c.avatar_url} alt={c.display_name ?? ""} />}
                  <AvatarFallback>{initials(c.display_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{c.display_name ?? "Unknown user"}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 capitalize">
                    {c.role === "owner" ? (
                      <><Crown className="h-3 w-3" /> Owner</>
                    ) : (
                      <><Shield className="h-3 w-3" /> Admin</>
                    )}
                  </div>
                </div>
                {c.role !== "owner" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${c.display_name ?? "coordinator"}`}
                    onClick={() => removeCoordinator(c.user_id, c.role)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
            {coordinators.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground text-center">No coordinators yet.</li>
            )}
          </ul>
        )}

        <div className="space-y-1.5 pt-2 border-t">
          <Label htmlFor="coord-search">Add a coordinator</Label>
          <Input
            id="coord-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search club admins, committee or association admins"
          />
          <p className="text-xs text-muted-foreground">
            Only admins from the organising club or its association can be added.
          </p>
          {search.trim().length > 0 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border divide-y">
              {searching ? (
                <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
              ) : candidates.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No matching admins found.</div>
              ) : (
                candidates.map((p) => {
                  const already = existingIds.has(p.user_id);
                  return (
                    <button
                      key={p.user_id}
                      type="button"
                      disabled={already || adding}
                      onClick={() => addCoordinator(p.user_id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                    >
                      <Avatar className="h-7 w-7">
                        {p.avatar_url && <AvatarImage src={p.avatar_url} alt={p.display_name ?? ""} />}
                        <AvatarFallback>{initials(p.display_name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{p.display_name ?? "Unknown"}</div>
                        <div className="text-xs text-muted-foreground capitalize">{p.source}</div>
                      </div>
                      {already ? (
                        <span className="text-xs text-muted-foreground">Already added</span>
                      ) : (
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
