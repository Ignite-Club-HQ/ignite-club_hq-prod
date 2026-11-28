import { useState, useEffect } from "react";
import { adminNameReason } from "@/lib/adminNameReason";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, Search, Shield } from "lucide-react";
import { toast } from "sonner";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { readAdminUserDirectory, updateAdminAccountStatus } from "@/live/adminUserDirectory";
import { eraseIcpAccountAsAdmin } from "@/live/adminAccountDeletion";
import { listLiveAuditLogs } from "@/live/features/insights";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UserAnalyticsTab from "@/components/admin/UserAnalyticsTab";
import { icpListTeams } from "@/lib/icpClubTeamLookup";
import { useAuth } from "@/hooks/useAuth";

const unavailable = async (): Promise<never> => { throw new Error("Internet Identity connection required"); };
export default function IcpManageUsersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAppAdmin, isLoading } = useIsAppAdmin();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("users");
  const [club, setClub] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("team_member");
  const [roleFilter, setRoleFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [clubSearch, setClubSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const inventory = useQuery({ queryKey: ["icp-admin-role-inventory", user?.id], enabled: isAppAdmin, queryFn: async () => {
    const [{ clubDispatch }, { listLiveClubs, listLiveTeams }, { connectLiveClubDomain }, { unwrapCandid }] = await Promise.all([
      import("@/live/groupDispatch"), import("@/live/features/club"), import("@/live/domains"), import("@/live/features/candid")
    ]);
    return clubDispatch.readAcross("membership", "club_domain", async ctx => {
      const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
      const rows = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      for (;;) {
        const page = await listLiveClubs(ctx, cursor, 100);
        for (const c of page) {
          if (seen.has(c.id)) throw new Error("Club inventory repeated a page");
          seen.add(c.id);
          if (c.is_active !== false) rows.push(c);
        }
        if (page.length < 100) break;
        cursor = page[page.length - 1].id;
      }
      const result = [];
      for (let i = 0; i < rows.length; i += 8) {
        result.push(...await Promise.all(rows.slice(i, i + 8).map(async c => {
          const [roles, teams] = await Promise.all([unwrapCandid(actor.read_account_list_role_grants(c.id), "Read club roles"), listLiveTeams(ctx, c.id)]);
          return { id: c.id, name: c.name, roles: roles.filter(g => g.club[0] === c.id), teams };
        })));
      }
      return result;
    }, parts => [...new Map(parts.flat().map(c => [c.id, c])).values()], true);
  } });
  const clubs = { data: inventory.data, error: inventory.error };
  const teams = { data: inventory.data?.find(c => c.id === club)?.teams, error: inventory.error };
  const grants = { data: inventory.data?.filter(c => !club || c.id === club).flatMap(c => c.roles), error: inventory.error, isPending: inventory.isPending, isSuccess: inventory.isSuccess };
  const directory = useInfiniteQuery({
    queryKey: ["icp-admin-users", user?.id], enabled: isAppAdmin,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => withFeatureBackend("admin", { supabase: unavailable, icp: ctx => readAdminUserDirectory(ctx, "", pageParam) }, { shared: "app" }),
    getNextPageParam: page => page.next[0] ?? undefined,
  });
  useEffect(() => {
    if (isAppAdmin && (query.trim() || tab === "roles") && directory.hasNextPage && !directory.isFetching && !directory.isError) void directory.fetchNextPage();
  }, [isAppAdmin, query, tab, club, directory.hasNextPage, directory.isFetching, directory.isError, directory.fetchNextPage]);
  const users0 = directory.data?.pages.flatMap(page => page.items) ?? [];
  const lockedKey = users0.filter(u => u.profile[0]?.display_name?.startsWith("pii-display-name:")).map(u => u.account_id).join(",");
  const unlocked = useQuery({
    queryKey: ["icp-admin-user-names", user?.id, lockedKey], enabled: isAppAdmin && lockedKey !== "", staleTime: 5 * 60_000,
    queryFn: () => withFeatureBackend("admin", { supabase: unavailable, icp: async ctx => {
      const { unlockAdminUserNames } = await import("@/live/adminUserNames");
      const reasons = new Map<string, string>();
      const names = await unlockAdminUserNames(ctx, users0.map(u => ({ account_id: u.account_id, principals: u.principals, display_name: u.profile[0]?.display_name ?? null })), reasons);
      return { names, reasons };
    } }, { shared: "app" }),
  });
  const nameOf = (u: { account_id: string; profile: Array<{ display_name?: string | null }> }) =>
    unlocked.data?.names.get(u.account_id) ?? adminName(u.profile[0]?.display_name, unlocked.isPending && lockedKey !== "");
  // Admin-only diagnosis of a locked name, in plain words (raw text is logged).
  const reasonOf = (u: { account_id: string; profile: Array<{ display_name?: string | null }> }) => {
    if (!u.profile[0]?.display_name?.startsWith("pii-display-name:") || unlocked.isPending || unlocked.data?.names.has(u.account_id)) return null;
    if (unlocked.error) console.warn("[admin-names] unlock failed", unlocked.error);
    return adminNameReason(unlocked.data?.reasons.get(u.account_id) ?? (unlocked.error instanceof Error ? unlocked.error.message : null));
  };
  // Raw diagnostic text is never rendered; an admin can copy it to share with support.
  const rawReasonOf = (u: { account_id: string }) => unlocked.data?.reasons.get(u.account_id) ?? (unlocked.error instanceof Error ? unlocked.error.message : "no reason recorded");
  const copyReason = (u: { account_id: string }) => { void navigator.clipboard?.writeText(`${u.account_id}: ${rawReasonOf(u)}`).then(() => toast.success("Details copied"), () => undefined); };
  const audit = useQuery({ queryKey: ["icp-admin-user-audit", user?.id], enabled: isAppAdmin && tab === "audit",
    queryFn: () => withFeatureBackend("admin", { supabase: unavailable, icp: ctx => listLiveAuditLogs(ctx, { limit: 100 }) }, { shared: "app" }),
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(["icp-admin-users", "icp-admin-clubs", "icp-admin-teams", "icp-admin-club-grants", "icp-admin-role-inventory", "icp-admin-user-audit"].map(key => qc.invalidateQueries({ queryKey: [key] }, { throwOnError: true })));
      await qc.invalidateQueries({ queryKey: ["icp-admin-user-names"] }, { throwOnError: true });
      toast.success("User management refreshed");
    } catch { toast.error("Refresh failed. Please try again."); }
    finally { setRefreshing(false); }
  };
  const change = useMutation({ mutationFn: async (input: { id: string; action: "Active" | "Suspended" | "delete" }) => {
    if (input.action === "delete" && !confirm(`Permanently remove account ${input.id} and its club access? Existing shared club content is retained.`)) return false;
    await withFeatureBackend("admin", { supabase: unavailable, icp: async ctx => {
      if (input.action === "delete") await eraseIcpAccountAsAdmin(ctx.identity, ctx.target, input.id);
      else await updateAdminAccountStatus(ctx, input.id, input.action);
    } }, writeOnce({ shared: "app" }));
    return true;
  }, onSuccess: completed => { if (completed) { refresh(); toast.success("Account action completed"); } }, onError: (e: Error) => { refresh(); toast.error(e.message); } });
  const grant = useMutation({ mutationFn: async (principal: string) => {
    if (!club.trim()) throw new Error("Choose the owning club");
    const { Principal } = await import("@icp-sdk/core/principal");
    await withFeatureBackend("membership", { supabase: unavailable, icp: async ctx => {
      const { addLiveRoleGrant } = await import("@/live/features/membership");
      await addLiveRoleGrant(ctx, Principal.fromText(principal), club.trim(), role, team.trim() || null);
    } }, writeOnce({ clubId: club.trim() }));
  }, onSuccess: () => { refresh(); toast.success("Club role saved"); }, onError: (e: Error) => toast.error(e.message) });
  if (isLoading) return <Skeleton className="h-32 m-4" />;
  if (!isAppAdmin) return <p className="p-6 text-muted-foreground">App admins only.</p>;
  const users = users0.filter(u => !query.trim() || [nameOf(u), u.account_id, ...u.principals.map(p => p.toText())].some(v => v.toLowerCase().includes(query.trim().toLowerCase())));
  const clubRoles = (id: string) => { const u = users0.find(row => row.account_id === id); const aliases = new Set([id, ...(u?.principals ?? []).flatMap(p => [p.toText(), "principal:" + p.toText()])]); return (grants.data ?? []).filter(g => aliases.has(g.account_id)); };
  const roleUsers = users0.filter(u => (!club && roleFilter === "all" && teamFilter === "all") || clubRoles(u.account_id).some(g => (roleFilter === "all" || g.role === roleFilter) && (teamFilter === "all" || g.team[0] === teamFilter)));
  return <div className="max-w-4xl mx-auto p-4 space-y-5">
    <header className="flex items-center gap-3"><Button size="icon" variant="ghost" aria-label="Back" onClick={() => navigate(-1)}><ArrowLeft /></Button><h1 className="text-xl font-semibold">User Management</h1><Button className="ml-auto" size="icon" variant="outline" aria-label="Refresh users" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={refreshing ? "animate-spin" : ""} /></Button></header>
    <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="roles">Club roles</TabsTrigger><TabsTrigger value="analytics">Analytics</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger></TabsList>
    <TabsContent value="analytics">{tab === "analytics" && <UserAnalyticsTab />}</TabsContent>
    <TabsContent value="roles" className="space-y-3">
      <p className="text-sm text-muted-foreground">All club and team roles are shown by default. Select a club to filter or assign access.</p>
      <Input aria-label="Search clubs" placeholder="Search clubs" value={clubSearch} onChange={e => setClubSearch(e.target.value)} />
      <Select value={club || "none"} onValueChange={v => { setClub(v === "none" ? "" : v); setTeam(""); setTeamFilter("all"); setRoleFilter("all"); setTeamSearch(""); }}><SelectTrigger aria-label="Club"><SelectValue placeholder="Select club" /></SelectTrigger><SelectContent><SelectItem value="none">All clubs</SelectItem>{clubs.data?.filter(c => c.id === club || c.name.toLowerCase().includes(clubSearch.toLowerCase())).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
      {clubs.error && <p role="alert" className="text-destructive">{clubs.error.message}</p>}
      {club && <><Input aria-label="Search teams" placeholder="Search teams" value={teamSearch} onChange={e => setTeamSearch(e.target.value)} /><Select value={teamFilter} onValueChange={setTeamFilter}><SelectTrigger aria-label="Filter by team"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All teams</SelectItem>{teams.data?.filter(t => t.id === team || t.id === teamFilter || t.name.toLowerCase().includes(teamSearch.toLowerCase())).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
      <Select value={roleFilter} onValueChange={setRoleFilter}><SelectTrigger aria-label="Filter by role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All roles</SelectItem>{["club_admin","team_admin","coach","team_member","parent"].map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
      <div className="border rounded-lg p-3 space-y-2"><p className="font-medium">Assign a role</p><Select value={team || "none"} onValueChange={v => setTeam(v === "none" ? "" : v)}><SelectTrigger aria-label="Assignment team"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Club-wide</SelectItem>{teams.data?.filter(t => t.id === team || t.id === teamFilter || t.name.toLowerCase().includes(teamSearch.toLowerCase())).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select><Select value={role} onValueChange={setRole}><SelectTrigger aria-label="Role to assign"><SelectValue /></SelectTrigger><SelectContent>{["club_admin","team_admin","coach","team_member","parent"].map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div></>}
      {(teams.error || grants.error) && <p role="alert" className="text-destructive">{(teams.error || grants.error)?.message}</p>}
      {grants.isPending && <Skeleton className="h-24" />}
      <div className="divide-y">{roleUsers.map(u => <div key={u.account_id} className="py-3 flex items-center justify-between gap-2"><div className="min-w-0"><p>{nameOf(u)}</p><p className="text-xs text-muted-foreground break-all">{u.account_id}</p><div className="flex flex-wrap gap-1 mt-1">{u.roles.filter(g => g.role === "app_admin").map((g,i) => <Badge key={i}>App admin</Badge>)}{clubRoles(u.account_id).map((g,i) => <Badge key={i} variant="secondary">{g.role.replace(/_/g, " ")}{" · " + (inventory.data?.find(c => c.id === g.club[0])?.name ?? g.club[0])}{g.team[0] ? " · " + (inventory.data?.find(c => c.id === g.club[0])?.teams.find(t => t.id === g.team[0])?.name ?? g.team[0]) : ""}</Badge>)}</div>{grants.isSuccess && !clubRoles(u.account_id).length && <p className="text-xs text-muted-foreground">No club roles assigned in this view</p>}</div><Button size="sm" variant="outline" disabled={!club || grant.isPending || !u.principals[0] || !grants.isSuccess || clubRoles(u.account_id).some(g => g.role === role && (g.team[0] ?? "") === team)} onClick={() => u.principals[0] && grant.mutate(u.principals[0].toText())}><Shield className="mr-2 h-4 w-4" />Assign role</Button></div>)}</div>
      {directory.isFetchingNextPage && <p role="status">Loading remaining users…</p>}{directory.isError && <p role="alert">User directory incomplete. Refresh to retry.</p>}{!directory.hasNextPage && !directory.isFetching && grants.isSuccess && !roleUsers.length && <p>No matching users.</p>}{directory.hasNextPage && !club && <Button variant="outline" disabled={directory.isFetchingNextPage} onClick={() => directory.fetchNextPage()}>Load more users</Button>}
    </TabsContent>
    <TabsContent value="users" className="space-y-4"><form className="flex gap-2" onSubmit={e => { e.preventDefault(); setQuery(search); }}><Input aria-label="Search users" placeholder="Name or account" value={search} onChange={e => setSearch(e.target.value)} /><Button type="submit" size="icon" aria-label="Search"><Search /></Button></form>{directory.error && <p role="alert" className="text-destructive">{directory.error.message}</p>}{directory.isPending && <Skeleton className="h-32" />}{query && (directory.hasNextPage || directory.isFetching || unlocked.isFetching) && <p role="status">Searching remaining users and encrypted names…</p>}{query && !directory.hasNextPage && !directory.isFetching && !unlocked.isFetching && !users.length && <p>No matching users.</p>}<div className="divide-y">{users.map(user => { const active = "Active" in user.status; return <div key={user.account_id} className="py-4 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="font-medium">{nameOf(user)}</p>{reasonOf(user) && <p className="text-xs text-muted-foreground">{reasonOf(user)} <button type="button" className="underline" onClick={() => copyReason(user)}>Copy details</button></p>}<p className="text-xs text-muted-foreground break-all">{user.account_id}</p>{user.roles.map((g,i) => <Badge key={i} variant="outline" className="mr-1">{g.role.replace(/_/g, " ")}</Badge>)}<Badge variant={active ? "secondary" : "destructive"}>{active ? "Active" : "Suspended"}</Badge></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ id: user.account_id, action: active ? "Suspended" : "Active" })}>{active ? "Suspend" : "Reactivate"}</Button><Button size="icon" variant="ghost" aria-label={`Delete ${user.account_id}`} disabled={change.isPending} onClick={() => change.mutate({ id: user.account_id, action: "delete" })}><Trash2 className="h-4 w-4" /></Button></div></div>; })}</div>{directory.hasNextPage && <Button variant="outline" disabled={directory.isFetchingNextPage} onClick={() => directory.fetchNextPage()}>Load more</Button>}</TabsContent>
    <TabsContent value="audit">{audit.error && <p role="alert" className="text-destructive">{audit.error.message}</p>}{audit.data?.items.map(row => <div key={row.id} className="border-b py-3"><p>{row.action_type}</p><p className="text-xs text-muted-foreground">{new Date(Number(row.created_at_ms)).toLocaleString()}</p></div>)}</TabsContent>
    </Tabs>
  </div>;
}
// Secure-sign-in names are encrypted; app admins unlock them through the app_admin audience.
function adminName(name?: string | null, unlocking = false) {
  if (!name) return "No name set";
  return name.startsWith("pii-display-name:") ? (unlocking ? "Unlocking name…" : "Name unavailable") : name;
}
