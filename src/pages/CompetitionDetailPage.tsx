import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trophy, Plus, Loader2, Check, X, Shield, Megaphone, Send, Settings, Link as LinkIcon, CircleCheck, Circle, ChevronDown, Users, Sparkles, CloudRain, CalendarClock, Bell, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CompetitionFixturesPanel, CompetitionLadderPanel } from "@/components/CompetitionFixturesPanel";
import { CompetitionShareJoinLink } from "@/components/CompetitionShareJoinLink";

export default function CompetitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteFromUrl = searchParams.get("invite") === "1";
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  usePageTitle("Competition");
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/competitions");
  };

  // Clear the ?invite=1 param after we read it so refresh / back doesn't reopen the form.
  useEffect(() => {
    if (inviteFromUrl) {
      const next = new URLSearchParams(searchParams);
      next.delete("invite");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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

  const { data: isAdmin = false, isLoading: isAdminLoading } = useQuery({
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

  const { data: divisions = [], isLoading: divisionsLoading } = useQuery({
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
        .select("*, teams:team_id(id, name, club_id, is_shell, shell_contact_name, shell_contact_email, clubs:club_id(name)), competition_divisions:division_id(name)")
        .eq("competition_id", id!)
        .order("created_at");
      return data ?? [];
    },
  });

  // Summary metrics for header
  const { data: summary } = useQuery({
    queryKey: ["competition-summary", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ count: matchCount }, { data: firstMatch }] = await Promise.all([
        supabase.from("competition_matches").select("id", { count: "exact", head: true }).eq("competition_id", id!),
        supabase.from("competition_matches").select("scheduled_at").eq("competition_id", id!).not("scheduled_at", "is", null).order("scheduled_at", { ascending: true }).limit(1).maybeSingle(),
      ]);
      return { matchCount: matchCount ?? 0, firstScheduledAt: firstMatch?.scheduled_at ?? null };
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
  if (competition.status === "draft" && !isAdmin) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground space-y-3">
        <p>This competition hasn't been published yet.</p>
        <Button variant="outline" size="sm" onClick={goBack}>Go back</Button>
      </div>
    );
  }

  const ladderVisibilityLoading = (!!user && isAdminLoading) || divisionsLoading;
  const hasHiddenDivisionLadder = divisions.some((d: any) => !!d.hide_ladder);
  const canViewLadder = !ladderVisibilityLoading && (isAdmin || !hasHiddenDivisionLadder);

  return (
    <div className="container max-w-3xl mx-auto px-4 py-4 space-y-4">
      <header className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9 shrink-0" aria-label="Go back" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg sm:text-xl font-bold break-words flex-1 min-w-0 leading-tight">{competition.name}</h1>
          {isAdmin && (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Send broadcast" title="Send broadcast">
                  <Megaphone className="h-[18px] w-[18px]" />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Broadcasts</SheetTitle>
                </SheetHeader>
                <div className="pt-4">
                  <BroadcastsPanel
                    competitionId={id!}
                    divisions={divisions}
                    acceptedTeamCount={entries.filter((e: any) => e.status === "accepted").length}
                  />
                </div>
              </SheetContent>
            </Sheet>
          )}
          {isAdmin && (
            <Button asChild variant="ghost" size="icon" className="h-9 w-9" aria-label="Competition settings" title="Competition settings">
              <Link to={`/competitions/${id}/settings`}><Settings className="h-[18px] w-[18px]" /></Link>
            </Button>
          )}
        </div>
        {(() => {
          const acceptedTeams = entries.filter((e: any) => e.status === "accepted").length;
          const matchCount = summary?.matchCount ?? 0;
          const start = summary?.firstScheduledAt ? new Date(summary.firstScheduledAt) : null;
          const parts: string[] = [];
          if (acceptedTeams) parts.push(`${acceptedTeams} ${acceptedTeams === 1 ? "Team" : "Teams"}`);
          if (matchCount) parts.push(`${matchCount} ${matchCount === 1 ? "Match" : "Matches"}`);
          if (start) parts.push(`Starts ${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`);
          if (competition.status === "draft") parts.push("Draft");
          else if (competition.visibility !== "public") parts.push("Private");
          return parts.length ? (
            <p className="text-[13px] text-muted-foreground tabular-nums leading-snug pl-1">{parts.join(" • ")}</p>
          ) : null;
        })()}
      </header>

      {isAdmin && competition.status === "draft" && (
        <DraftSetupProgress
          competitionId={id!}
          divisionsCount={divisions.length}
          acceptedCount={entries.filter((e: any) => e.status === "accepted").length}
          invitedCount={entries.filter((e: any) => e.status === "invited").length}
        />
      )}

      <Tabs defaultValue={
        inviteFromUrl && isAdmin
          ? "teams"
          : entries.some((e: any) => e.status === "invited" && myAdminTeamIds.includes(e.team_id))
            ? "teams"
            : competition.status === "draft" && isAdmin ? "teams" : "fixtures"
      }>
        <TabsList className="w-full">
          <TabsTrigger value="fixtures" className="flex-1">Fixtures</TabsTrigger>
          {canViewLadder && <TabsTrigger value="ladder" className="flex-1">Ladder</TabsTrigger>}
          {isAdmin && (
            <TabsTrigger value="teams" className="flex-1">
              Teams{entries.length > 0 ? ` (${entries.length})` : ""}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="fixtures" className="space-y-2">
          <CompetitionFixturesPanel competitionId={id!} isAdmin={isAdmin} divisions={divisions} entries={entries} />
        </TabsContent>

        {canViewLadder && (
          <TabsContent value="ladder" className="space-y-2">
            <CompetitionLadderPanel competitionId={id!} divisions={divisions} isAdmin={isAdmin} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="teams" className="space-y-2 mt-2">
            {/* Primary actions — equal-weight recruitment CTAs */}
            <div className="flex gap-2">
              <div className="flex-1">
                <InviteTeamForm
                  competitionId={id!}
                  divisions={divisions}
                  defaultOpen={inviteFromUrl}
                  onDone={() => qc.invalidateQueries({ queryKey: ["competition-entries", id] })}
                />
              </div>
              <div className="flex-1">
                <CompetitionShareJoinLink
                  competitionId={id!}
                  competitionName={competition.name}
                  triggerVariant="default"
                  triggerClassName="w-full"
                />
              </div>
            </div>
            {/* Secondary action — competition setup */}
            <div className="flex">
              <AddDivisionForm
                competitionId={id!}
                onDone={() => qc.invalidateQueries({ queryKey: ["competition-divisions", id] })}
              />
            </div>

            <TeamsByDivision
              competitionId={id!}
              divisions={divisions}
              entries={entries}
              myAdminTeamIds={myAdminTeamIds}
              onRespond={respondToInvite}
              isAdmin={isAdmin}
            />
          </TabsContent>
        )}

      </Tabs>
    </div>
  );
}

function DraftSetupProgress({
  competitionId,
  divisionsCount,
  acceptedCount,
  invitedCount,
}: {
  competitionId: string;
  divisionsCount: number;
  acceptedCount: number;
  invitedCount: number;
}) {
  const skipKey = `ignite_comp_skip_divisions_${competitionId}`;
  const [divisionsSkipped, setDivisionsSkipped] = useState<boolean>(() => {
    try { return localStorage.getItem(skipKey) === "1"; } catch { return false; }
  });
  const skipDivisions = () => {
    try { localStorage.setItem(skipKey, "1"); } catch {}
    setDivisionsSkipped(true);
  };

  const { data: matchesCount = 0 } = useQuery({
    queryKey: ["competition-matches-count", competitionId],
    queryFn: async () => {
      const { count } = await supabase
        .from("competition_matches")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId);
      return count ?? 0;
    },
  });

  const steps = [
    {
      key: "invite",
      label: "Invite teams",
      done: invitedCount + acceptedCount > 0,
      hint:
        invitedCount + acceptedCount === 0
          ? "Send invites to the teams you want in this competition."
          : `${invitedCount + acceptedCount} invited · ${acceptedCount} accepted`,
      dismissible: false,
    },
    {
      key: "divisions",
      label: "Add divisions",
      done: divisionsCount > 0,
      hint:
        divisionsCount === 0
          ? "Optional — group teams by age, gender or skill."
          : `${divisionsCount} division${divisionsCount === 1 ? "" : "s"}`,
      dismissible: divisionsCount === 0,
    },
    {
      key: "fixtures",
      label: "Generate fixtures",
      done: matchesCount > 0,
      hint:
        acceptedCount < 2
          ? "Needs at least 2 accepted teams."
          : matchesCount > 0
            ? `${matchesCount} match${matchesCount === 1 ? "" : "es"} scheduled`
            : "Use 'Generate round-robin' on the Fixtures tab.",
      dismissible: false,
    },
    {
      key: "publish",
      label: "Publish competition",
      done: false,
      hint: "Open Settings and switch from Draft to Published.",
      dismissible: false,
    },
  ].filter((s) => !(s.key === "divisions" && divisionsSkipped));

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Set up your competition</h2>
          <Badge variant="outline" className="ml-auto text-[11px]">Draft</Badge>
        </div>
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              {s.done ? (
                <CircleCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className={s.done ? "font-medium line-through text-muted-foreground" : "font-medium"}>
                  {s.label}
                </div>
                <div className="text-xs text-muted-foreground">{s.hint}</div>
              </div>
              {s.dismissible && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 -mt-1 -mr-1 text-muted-foreground hover:text-foreground"
                  onClick={s.key === "divisions" ? skipDivisions : undefined}
                  aria-label={`Dismiss ${s.label}`}
                  title="Skip this step"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function TeamsByDivision({
  competitionId,
  divisions,
  entries,
  myAdminTeamIds,
  onRespond,
  isAdmin,
}: {
  competitionId: string;
  divisions: any[];
  entries: any[];
  myAdminTeamIds: string[];
  onRespond: (entryId: string, status: "accepted" | "declined") => void;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);

  const assignDivision = async (entryId: string, divisionId: string | null) => {
    setSavingId(entryId);
    const { error } = await supabase
      .from("competition_entries")
      .update({ division_id: divisionId })
      .eq("id", entryId);
    setSavingId(null);
    if (error) {
      toast({ title: "Could not move team", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["competition-entries", competitionId] });
  };
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No teams yet.</p>;
  }

  const groups: { id: string | null; name: string; meta?: string; entries: any[] }[] = [];
  for (const d of divisions) {
    groups.push({
      id: d.id,
      name: d.name,
      meta: [d.age_group, d.gender, d.skill_level].filter(Boolean).join(" · "),
      entries: entries.filter((e: any) => e.division_id === d.id),
    });
  }
  const unassigned = entries.filter((e: any) => !e.division_id);
  if (unassigned.length > 0 && divisions.length > 0) {
    groups.push({ id: null, name: "Unassigned", entries: unassigned });
  } else if (divisions.length === 0 && unassigned.length > 0) {
    groups.push({ id: null, name: "", entries: unassigned });
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id ?? "unassigned"} className="space-y-1.5">

          {(g.name || g.entries.length > 0) && (
            <div className="flex items-baseline justify-between">
              <div>
                {g.name && <h3 className="text-sm font-semibold">{g.name}</h3>}
                {g.meta && <p className="text-xs text-muted-foreground">{g.meta}</p>}
              </div>
              {g.name && (
                <span className="text-xs text-muted-foreground">
                  {g.entries.length} team{g.entries.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
          {g.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No teams in this division yet.</p>
          ) : (
            g.entries.map((e: any) => {
              const canRespond = e.status === "invited" && myAdminTeamIds.includes(e.team_id);
              const statusBadge = e.teams?.is_shell ? (
                <Badge variant="outline">Awaiting signup</Badge>
              ) : e.status === "accepted" ? (
                <Badge variant="default">Accepted</Badge>
              ) : e.status === "invited" ? (
                <Badge variant="secondary">Invite sent</Badge>
              ) : (
                <Badge variant="outline" className="capitalize">{e.status}</Badge>
              );
              return (
                <Card key={e.id}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate leading-tight">{e.teams?.name}</div>
                        <div className="text-xs text-muted-foreground truncate leading-tight">
                          {e.teams?.clubs?.name || "—"}
                        </div>
                        {e.teams?.is_shell && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            Invited: {e.teams?.shell_contact_name ? `${e.teams.shell_contact_name} · ` : ""}{e.teams?.shell_contact_email}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">{statusBadge}</div>
                    </div>

                    {(canRespond || (isAdmin && divisions.length > 0 && e.status !== "declined")) && (
                      <div className="flex items-center gap-2">
                        {canRespond && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => onRespond(e.id, "accepted")} aria-label="Accept invite">
                              <Check className="h-4 w-4 mr-1" />
                              Accept
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onRespond(e.id, "declined")} aria-label="Decline invite">
                              <X className="h-4 w-4 mr-1" />
                              Decline
                            </Button>
                          </div>
                        )}
                        {isAdmin && divisions.length > 0 && e.status !== "declined" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 ml-auto text-xs font-normal"
                                disabled={savingId === e.id}
                              >
                                {divisions.find((d: any) => d.id === e.division_id)?.name ?? "Unassigned"}
                                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => assignDivision(e.id, null)}>
                                Unassigned
                              </DropdownMenuItem>
                              {divisions.map((d: any) => (
                                <DropdownMenuItem key={d.id} onClick={() => assignDivision(e.id, d.id)}>
                                  {d.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })

          )}
        </div>
      ))}
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
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          <span className="font-medium">Send broadcast</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Posts as a competition announcement in the team chat of every accepted team
          {selectedDivisionIds.size > 0 ? " in the selected divisions" : ""}. Only teams entered in
          this competition receive it.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="broadcast-msg">Message</Label>
          <Textarea
            id="broadcast-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="e.g. Round 4 fixtures are up — check the schedule."
          />
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
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {acceptedTeamCount} accepted team{acceptedTeamCount === 1 ? "" : "s"} in competition
          </span>
          <Button size="sm" onClick={send} disabled={!message.trim() || sending || acceptedTeamCount === 0}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Send
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="text-sm font-medium">Recent broadcasts</div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No broadcasts yet.</p>
        ) : (
          history.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="p-3 space-y-1">
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

function InviteTeamForm({ competitionId, divisions, defaultOpen, onDone }: { competitionId: string; divisions: any[]; defaultOpen?: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(!!defaultOpen);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [teamId, setTeamId] = useState("");
  const [divisionId, setDivisionId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [clubFilterId, setClubFilterId] = useState<string>("");
  const [clubSearch, setClubSearch] = useState("");

  // "Not on Ignite yet" fields
  const [newTeamName, setNewTeamName] = useState("");
  const [newClubName, setNewClubName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const { data: clubs = [] } = useQuery({
    queryKey: ["clubs-for-team-invite", clubSearch],
    enabled: open && mode === "existing",
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
    enabled: open && mode === "existing",
    queryFn: async () => {
      let q = supabase.from("teams").select("id, name, clubs:club_id(name)").order("name").limit(50);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      if (clubFilterId) q = q.eq("club_id", clubFilterId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const submitExisting = async () => {
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

  const submitNew = async () => {
    const tName = newTeamName.trim();
    const email = contactEmail.trim().toLowerCase();
    if (!tName) { toast({ title: "Team name required", variant: "destructive" }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Valid contact email required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("invite_shell_team_to_competition", {
      p_competition_id: competitionId,
      p_team_name: tName,
      p_club_name: newClubName.trim() || null,
      p_contact_name: contactName.trim() || null,
      p_contact_email: email,
      p_division_id: divisionId || null,
    });
    if (error || !data || !(data as any[]).length) {
      setSaving(false);
      toast({ title: "Could not send invite", description: error?.message || "Unknown error", variant: "destructive" });
      return;
    }
    const row: any = (data as any[])[0];
    const claimLink = `${window.location.origin}/claim-team?token=${row.token}`;
    try {
      await supabase.functions.invoke("send-email", {
        body: {
          to: email,
          subject: `You're invited to join a competition on Ignite`,
          template: "team-invite",
          templateData: {
            recipientName: contactName.trim() || email.split("@")[0],
            invitedEmail: email,
            teamName: tName,
            clubName: newClubName.trim() || tName,
            roleName: "Team Admin",
            inviteLink: claimLink,
          },
        },
      });
    } catch (err) {
      console.error("send-email failed", err);
    }
    setSaving(false);
    toast({ title: "Invite sent", description: `Magic link emailed to ${email}` });
    setNewTeamName(""); setNewClubName(""); setContactName(""); setContactEmail(""); setDivisionId("");
    setOpen(false); onDone();
  };

  const selectedTeam = teams.find((t: any) => t.id === teamId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" className="w-full">
          <Plus className="h-4 w-4 mr-1" /> Invite team
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl p-0"
      >
        <SheetHeader className="px-4 pt-5 pb-3 border-b">
          <SheetTitle className="text-base">Invite a team</SheetTitle>
        </SheetHeader>
        <div className="px-4 py-4 space-y-3">
          <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`flex-1 rounded px-2 py-1.5 ${mode === "existing" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
            >
              On Ignite
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={`flex-1 rounded px-2 py-1.5 ${mode === "new" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
            >
              Not on Ignite yet
            </button>
          </div>

          {mode === "existing" ? (
            <>
              <p className="text-xs text-muted-foreground">Search for an existing team — optionally filter by club to narrow it down.</p>
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <Label htmlFor="competition-invite-team-search">Find team</Label>
                {selectedTeam ? (
                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div className="text-sm">
                      <span className="font-medium">{selectedTeam.name}</span>
                      {selectedTeam.clubs?.name ? <span className="text-muted-foreground"> — {selectedTeam.clubs.name}</span> : null}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => { setTeamId(""); setSearch(""); }}>Change</Button>
                  </div>
                ) : (
                  <>
                    <Input
                      id="competition-invite-team-search"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setTeamId(""); }}
                      placeholder="Search by team name"
                    />
                    {(search.trim().length > 0 || clubFilterId) && (
                      <div className="mt-2 max-h-56 overflow-y-auto rounded-md border divide-y">
                        {teams.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No teams found.</div>
                        ) : teams.map((t: any) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => { setTeamId(t.id); setSearch(""); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                          >
                            <div className="font-medium">{t.name}</div>
                            {t.clubs?.name && <div className="text-xs text-muted-foreground">{t.clubs.name}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">We'll create a placeholder team and email a magic link so the contact can claim it. Fixtures and ladder work immediately.</p>
              <div className="space-y-1.5">
                <Label>Team name *</Label>
                <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. Basket Range U14 Red" />
              </div>
              <div className="space-y-1.5">
                <Label>Club name (optional)</Label>
                <Input value={newClubName} onChange={(e) => setNewClubName(e.target.value)} placeholder="e.g. Basket Range Cricket Club" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact name (optional)</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="e.g. Sam Smith" />
              </div>
              <div className="space-y-1.5">
                <Label>Contact email *</Label>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="contact@example.com" />
                <p className="text-[11px] text-muted-foreground">This person will receive the invite and become the first team admin when they claim it.</p>
              </div>
            </>
          )}

          {divisions.length > 0 && (
            <div className="space-y-1.5">
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
        </div>
        <div className="sticky bottom-0 left-0 right-0 flex gap-2 border-t bg-background px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
          {mode === "existing" ? (
            <Button className="flex-1" onClick={submitExisting} disabled={!teamId || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
            </Button>
          ) : (
            <Button className="flex-1" onClick={submitNew} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invite"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddDivisionForm({ competitionId, onDone }: { competitionId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [gender, setGender] = useState("");
  const [playWeekdays, setPlayWeekdays] = useState<number[]>([]);
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("16:00");
  const [saving, setSaving] = useState(false);

  const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toggleWeekday = (d: number) => {
    setPlayWeekdays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  };

  const submit = async () => {
    if (!name.trim()) return;
    if (dayEnd <= dayStart) {
      toast({ title: "Day window invalid", description: "Latest kickoff must be after earliest.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("competition_divisions").insert({
      competition_id: competitionId,
      name: name.trim(),
      age_group: ageGroup.trim() || null,
      gender: gender || null,
      play_weekdays: playWeekdays.length ? playWeekdays : null,
      day_start_time: dayStart,
      day_end_time: dayEnd,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add division", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Division added" });
    setName(""); setAgeGroup(""); setGender("");
    setPlayWeekdays([]); setDayStart("09:00"); setDayEnd("16:00");
    setOpen(false); onDone();
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add division
      </Button>
    );
  }


  return (
    <Card className="w-full">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Add a new division</h3>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </div>
        <p className="text-xs text-muted-foreground">Divisions group teams (e.g. by age or skill) so fixtures and ladders are organised.</p>
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
            <Label>Category</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mixed">Mixed</SelectItem>
                <SelectItem value="boys">Boys</SelectItem>
                <SelectItem value="girls">Girls</SelectItem>
                <SelectItem value="mens">Men's</SelectItem>
                <SelectItem value="womens">Women's</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="pt-2 border-t">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Scheduling defaults</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-2">
            Used when generating fixtures for this division. Leave weekdays empty for "any day".
          </p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {WEEKDAY_SHORT.map((label, i) => {
              const active = playWeekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Earliest kickoff</Label>
              <Input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
            </div>
            <div>
              <Label>Latest kickoff</Label>
              <Input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
            </div>
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

