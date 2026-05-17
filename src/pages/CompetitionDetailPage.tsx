import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trophy, Plus, Loader2, Check, X, Shield, Megaphone, Send, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CompetitionFixturesPanel, CompetitionLadderPanel } from "@/components/CompetitionFixturesPanel";

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
        {isAdmin && (
          <Button asChild variant="ghost" size="icon" aria-label="Settings">
            <Link to={`/competitions/${id}/settings`}><Settings className="h-5 w-5" /></Link>
          </Button>
        )}
      </header>

      {competition.description && (
        <p className="text-sm whitespace-pre-wrap">{competition.description}</p>
      )}

      <Tabs defaultValue="entries">
        <TabsList className="w-full max-w-full overflow-x-auto justify-start [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <TabsTrigger value="entries">Teams</TabsTrigger>
          <TabsTrigger value="divisions">Divisions</TabsTrigger>
          <TabsTrigger value="fixtures">Fixtures</TabsTrigger>
          <TabsTrigger value="ladder">Ladder</TabsTrigger>
          {isAdmin && <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>}
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

        <TabsContent value="fixtures" className="space-y-2">
          <CompetitionFixturesPanel competitionId={id!} isAdmin={isAdmin} divisions={divisions} entries={entries} />
        </TabsContent>

        <TabsContent value="ladder" className="space-y-2">
          {competition.visibility === "public" && (
            <p className="text-xs text-muted-foreground">
              Public link: <a href={`/c/${id}`} className="underline" target="_blank" rel="noreferrer">/c/{id}</a>
            </p>
          )}
          <CompetitionLadderPanel competitionId={id!} divisions={divisions} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="broadcasts" className="space-y-3">
            <BroadcastsPanel competitionId={id!} divisions={divisions} acceptedTeamCount={entries.filter((e: any) => e.status === "accepted").length} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="manage" className="space-y-3">
            <EditCompetitionForm competition={competition} onDone={() => qc.invalidateQueries({ queryKey: ["competition", id] })} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function BroadcastsPanel({ competitionId, divisions, acceptedTeamCount }: { competitionId: string; divisions: any[]; acceptedTeamCount: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const { data: history = [] } = useQuery({
    queryKey: ["competition-broadcasts", competitionId],
    queryFn: async () => {
      const { data } = await supabase
        .from("competition_broadcasts")
        .select("*")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const toggleDivision = (divId: string) => {
    setSelectedDivisionIds((prev) => {
      const next = new Set(prev);
      if (next.has(divId)) next.delete(divId); else next.add(divId);
      return next;
    });
  };

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke("send-competition-broadcast", {
      body: {
        competition_id: competitionId,
        message: message.trim(),
        division_ids: selectedDivisionIds.size > 0 ? Array.from(selectedDivisionIds) : null,
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast({ title: "Could not send broadcast", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    toast({ title: `Broadcast sent to ${(data as any).recipient_team_count} team${(data as any).recipient_team_count === 1 ? "" : "s"}` });
    setMessage("");
    setSelectedDivisionIds(new Set());
    qc.invalidateQueries({ queryKey: ["competition-broadcasts", competitionId] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            <span className="font-medium">Send broadcast</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Posts as a competition announcement in the team chat of every accepted team
            {selectedDivisionIds.size > 0 ? " in the selected divisions" : ""}.
          </p>
          <div>
            <Label>Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="e.g. Round 4 fixtures are up — check the schedule." />
          </div>
          {divisions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Limit to divisions (optional)</Label>
              <div className="border rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
                {divisions.map((d: any) => (
                  <label key={d.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                    <Checkbox checked={selectedDivisionIds.has(d.id)} onCheckedChange={() => toggleDivision(d.id)} />
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{acceptedTeamCount} accepted team{acceptedTeamCount === 1 ? "" : "s"} total</span>
            <Button size="sm" onClick={send} disabled={!message.trim() || sending || acceptedTeamCount === 0}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-sm font-medium">Recent broadcasts</div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
        ) : (
          history.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="p-4 space-y-1">
                <div className="text-sm whitespace-pre-wrap">{b.message}</div>
                <div className="text-xs text-muted-foreground">
                  {b.recipient_team_count} team{b.recipient_team_count === 1 ? "" : "s"} · {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
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
  const [clubFilterId, setClubFilterId] = useState<string>("");
  const [clubSearch, setClubSearch] = useState("");

  const { data: clubs = [] } = useQuery({
    queryKey: ["clubs-for-team-invite", clubSearch],
    enabled: open,
    queryFn: async () => {
      let q = supabase.from("clubs").select("id, name").order("name").limit(50);
      if (clubSearch.trim()) q = q.ilike("name", `%${clubSearch.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const selectedClub = clubs.find((c: any) => c.id === clubFilterId);

  const { data: teams = [] } = useQuery({
    queryKey: ["all-teams-for-invite", search, clubFilterId],
    enabled: open,
    queryFn: async () => {
      let q = supabase.from("teams").select("id, name, clubs:club_id(name)").order("name").limit(50);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      if (clubFilterId) q = q.eq("club_id", clubFilterId);
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

  const selectedTeam = teams.find((t: any) => t.id === teamId);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <Label>Filter by club (optional)</Label>
          {selectedClub ? (
            <div className="mt-1 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-sm font-medium">{selectedClub.name}</div>
              <Button size="sm" variant="ghost" onClick={() => { setClubFilterId(""); setClubSearch(""); setTeamId(""); }}>Clear</Button>
            </div>
          ) : (
            <>
              <Input
                value={clubSearch}
                onChange={(e) => setClubSearch(e.target.value)}
                placeholder="Search clubs"
              />
              {clubSearch.trim().length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-md border divide-y">
                  {clubs.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No clubs found.</div>
                  ) : clubs.map((c: any) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setClubFilterId(c.id); setClubSearch(""); setTeamId(""); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <Label>Find team</Label>
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setTeamId(""); }}
            placeholder="Search by team name"
            autoFocus
          />
          {selectedTeam ? (
            <div className="mt-2 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-sm">
                <span className="font-medium">{selectedTeam.name}</span>
                {selectedTeam.clubs?.name ? <span className="text-muted-foreground"> — {selectedTeam.clubs.name}</span> : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTeamId("")}>Change</Button>
            </div>
          ) : (search.trim().length > 0 || clubFilterId) && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border divide-y">
              {teams.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No teams found.</div>
              ) : teams.map((t: any) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeamId(t.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                >
                  <div className="font-medium">{t.name}</div>
                  {t.clubs?.name && <div className="text-xs text-muted-foreground">{t.clubs.name}</div>}
                </button>
              ))}
            </div>
          )}
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
  const [pointsWin, setPointsWin] = useState<string>(String(competition.points_win ?? 3));
  const [pointsDraw, setPointsDraw] = useState<string>(String(competition.points_draw ?? 1));
  const [pointsLoss, setPointsLoss] = useState<string>(String(competition.points_loss ?? 0));
  const [saving, setSaving] = useState(false);

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
  );
}
