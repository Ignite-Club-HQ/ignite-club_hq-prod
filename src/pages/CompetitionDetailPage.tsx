import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trophy, Plus, Loader2, Check, X, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function CompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  usePageTitle("Competition");

  const { data: competition, isLoading } = useQuery({
    queryKey: ["competition", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("*, clubs:organizer_club_id(id, name)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: isAdmin = false } = useQuery({
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

  const { data: divisions = [] } = useQuery({
    queryKey: ["competition-divisions", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_divisions")
        .select("*")
        .eq("competition_id", id!)
        .order("sort_order");
      return data ?? [];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["competition-entries", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_entries")
        .select("*, teams:team_id(id, name, club_id, clubs:club_id(name)), competition_divisions:division_id(name)")
        .eq("competition_id", id!)
        .order("created_at");
      return data ?? [];
    },
  });

  // Teams the current user can manage (for accept/decline)
  const { data: myAdminTeamIds = [] } = useQuery({
    queryKey: ["my-admin-team-ids", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin"]);
      return Array.from(new Set((data ?? []).map((r: any) => r.team_id).filter(Boolean)));
    },
  });

  const respondToInvite = async (entryId: string, status: "accepted" | "declined") => {
    const { error } = await supabase
      .from("competition_entries")
      .update({ status, responded_by: user!.id, responded_at: new Date().toISOString() })
      .eq("id", entryId);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "accepted" ? "Invite accepted" : "Invite declined" });
    qc.invalidateQueries({ queryKey: ["competition-entries", id] });
    qc.invalidateQueries({ queryKey: ["competition-pending-invites"] });
  };

  if (isLoading) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!competition) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Competition not found.</div>;
  }

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/competitions"><ArrowLeft className="h-4 w-4 mr-1" /> Competitions</Link>
      </Button>

      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3">
          <Trophy className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{competition.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[competition.sport, competition.season, competition.clubs?.name].filter(Boolean).join(" · ")}
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className="capitalize">{competition.status}</Badge>
            <Badge variant="outline" className="capitalize">{competition.visibility}</Badge>
            {isAdmin && <Badge><Shield className="h-3 w-3 mr-1" /> Admin</Badge>}
          </div>
        </div>
      </header>

      {competition.description && (
        <p className="text-sm whitespace-pre-wrap">{competition.description}</p>
      )}

      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Teams</TabsTrigger>
          <TabsTrigger value="divisions">Divisions</TabsTrigger>
          {isAdmin && <TabsTrigger value="manage">Manage</TabsTrigger>}
        </TabsList>

        <TabsContent value="entries" className="space-y-2">
          {isAdmin && <InviteTeamForm competitionId={id!} divisions={divisions} onDone={() => qc.invalidateQueries({ queryKey: ["competition-entries", id] })} />}
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teams yet.</p>
          ) : (
            entries.map((e: any) => {
              const canRespond = e.status === "invited" && myAdminTeamIds.includes(e.team_id);
              return (
                <Card key={e.id}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{e.teams?.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[e.teams?.clubs?.name, e.competition_divisions?.name].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <Badge variant={e.status === "accepted" ? "default" : "secondary"} className="capitalize">{e.status}</Badge>
                    {canRespond && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => respondToInvite(e.id, "accepted")}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => respondToInvite(e.id, "declined")}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="divisions" className="space-y-2">
          {isAdmin && <AddDivisionForm competitionId={id!} onDone={() => qc.invalidateQueries({ queryKey: ["competition-divisions", id] })} />}
          {divisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No divisions yet.</p>
          ) : (
            divisions.map((d: any) => (
              <Card key={d.id}>
                <CardContent className="p-4">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[d.age_group, d.gender, d.skill_level].filter(Boolean).join(" · ") || "—"}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="manage" className="space-y-3">
            <EditCompetitionForm competition={competition} onDone={() => qc.invalidateQueries({ queryKey: ["competition", id] })} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function InviteTeamForm({ competitionId, divisions, onDone }: { competitionId: string; divisions: any[]; onDone: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [divisionId, setDivisionId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const { data: teams = [] } = useQuery({
    queryKey: ["all-teams-for-invite", search],
    enabled: open,
    queryFn: async () => {
      let q = supabase.from("teams").select("id, name, clubs:club_id(name)").order("name").limit(50);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const submit = async () => {
    if (!teamId) return;
    setSaving(true);
    const { error } = await supabase.from("competition_entries").insert({
      competition_id: competitionId,
      team_id: teamId,
      division_id: divisionId || null,
      invited_by: user!.id,
      status: "invited",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not invite team", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Team invited" });
    setTeamId(""); setDivisionId(""); setOpen(false); onDone();
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Invite team
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <Label>Find team</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
        </div>
        <div>
          <Label>Team</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
            <SelectContent>
              {teams.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}{t.clubs?.name ? ` — ${t.clubs.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {divisions.length > 0 && (
          <div>
            <Label>Division (optional)</Label>
            <Select value={divisionId} onValueChange={setDivisionId}>
              <SelectTrigger><SelectValue placeholder="No division" /></SelectTrigger>
              <SelectContent>
                {divisions.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={!teamId || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddDivisionForm({ competitionId, onDone }: { competitionId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("competition_divisions").insert({
      competition_id: competitionId,
      name: name.trim(),
      age_group: ageGroup.trim() || null,
      gender: gender || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add division", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Division added" });
    setName(""); setAgeGroup(""); setGender(""); setOpen(false); onDone();
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add division
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. U12 Mixed Div 1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Age group</Label>
            <Input value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} placeholder="e.g. U12" />
          </div>
          <div>
            <Label>Gender</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mixed">Mixed</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EditCompetitionForm({ competition, onDone }: { competition: any; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(competition.name);
  const [status, setStatus] = useState(competition.status);
  const [visibility, setVisibility] = useState(competition.visibility);
  const [description, setDescription] = useState(competition.description ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("competitions")
      .update({ name: name.trim(), status, visibility, description: description.trim() || null })
      .eq("id", competition.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    onDone();
  };

  return (
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
        <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}
