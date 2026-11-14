import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, UserPlus, Loader2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { FeatureBackendContext } from "@/live/featureRouter";
import {
  assertChildSourceMatchesTeam,
  assertMayCreateChild,
  childSourceKey,
  collectVerifiedChildren,
  requireSourceClubCanisterId,
  runForVerifiedOwnedChild,
} from "@/features/membership/icpChildrenGroupSafety";
import { createIcpInviteChild } from "@/features/membership/createIcpInviteChild";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { withReadDeadline } from "@/live/readDeadline";

/**
 * Children page for secure sign-in (ICP) users. Child records live on
 * club_domain (no names); names are encrypted on pii_access_control
 * (pii_id = child id, field "name"). All ICP modules load lazily.
 */

interface IcpChild {
  id: string;
  name: string;
  teams: string[];
  isPrimary: boolean;
  sourceClubCanisterId: string;
}
interface TeamOpt { id: string; name: string; club_id: string; club_name: string; sourceClubCanisterId: string }
interface Guardian { principal: string; name: string; isPrimary: boolean; isMe: boolean }

async function load() {
  const [{ icpCtx }, club] = await Promise.all([
    import("@/lib/icpClubTeamLookup"),
    import("@/live/features/club"),
  ]);
  return { ctx: await icpCtx(), club };
}

/** Reading all groups is essential even for unassigned children. A child
 * starts with club_id=null, so a clubId lookup cannot recover its source.
 * Require a complete member/shared inventory instead of showing a false empty
 * list when one of the groups is unavailable.
 */
async function readAllMyChildren(): Promise<IcpChild[]> {
  const [{ withFeatureBackend }, club] = await Promise.all([
    import("@/live/featureRouter"), import("@/live/features/club"),
  ]);
  return withFeatureBackend<IcpChild[]>("membership", {
    supabase: async () => { throw new Error("Internet Identity required to retrieve ICP children"); },
    icp: async scoped => {
      const sourceClubCanisterId = requireSourceClubCanisterId(scoped.target);
      const me = scoped.identity.getPrincipal().toText();
      const rows = await withReadDeadline(club.listMyLiveOwnChildren(scoped), "Children in club group", 20_000);
      return rows.map(r => ({
        id: r.id, name: "", teams: [...r.teams],
        isPrimary: r.parent?.[0]?.toText() === me,
        sourceClubCanisterId,
      }));
    },
  }, { everyGroup: true, requireComplete: true, merge: parts => collectVerifiedChildren(parts as IcpChild[][]) });
}

/** A later action must re-locate the child's *original* group, recheck the
 * caller's child relationship there, and only then write. Never select the
 * destination based on a team ID or default ICP target.
 */
async function withVerifiedChildGroup<T>(
  child: IcpChild,
  run: (ctx: FeatureBackendContext) => Promise<T>,
): Promise<T> {
  const [{ withFeatureBackend }, club] = await Promise.all([
    import("@/live/featureRouter"), import("@/live/features/club"),
  ]);
  const contexts = await withFeatureBackend<FeatureBackendContext[]>("membership", {
    supabase: async () => { throw new Error("Internet Identity required for child changes"); },
    icp: async scoped =>
      requireSourceClubCanisterId(scoped.target) === child.sourceClubCanisterId ? [scoped] : [],
  }, { everyGroup: true, requireComplete: true, merge: parts => parts.flat() });
  return runForVerifiedOwnedChild(
    child, contexts, ctx => requireSourceClubCanisterId(ctx.target),
    async (ctx, childId) => (await club.listMyLiveOwnChildren(ctx)).some(c => c.id === childId),
    run,
  );
}

export default function IcpChildrenPage() {
  const { user } = useAuth();
  const KEY = ["icp-own-children-all-groups", user?.id];
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [newChildTeamKey, setNewChildTeamKey] = useState("");
  // create_own_child has no request-ID dedupe; lock after an ambiguous outcome.
  const createAttempted = useRef(false);
  const [teamFor, setTeamFor] = useState<IcpChild | null>(null);
  const [guardiansFor, setGuardiansFor] = useState<IcpChild | null>(null);
  const [deleteId, setDeleteId] = useState<IcpChild | null>(null);

  const { data: childRows, isLoading, isError, refetch } = useQuery({
    queryKey: KEY,
    enabled: !!user,
    retry: false,
    queryFn: readAllMyChildren,
    // Children change rarely; keep the last list for a minute so revisiting
    // the page (or returning after Add child) is instant while a background
    // refetch refreshes it.
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // Authorized child records reveal independently of private-name unlocking.
  // This separate account-scoped query never changes guardianship or teams.
  const sourceKeys = (childRows ?? []).map(childSourceKey).sort();
  const namesQuery = useQuery({
    queryKey: ['icp-own-child-names-all-groups', user?.id, sourceKeys],
    enabled: !!user && sourceKeys.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const [{ withFeatureBackend }, vault] = await Promise.all([
        import("@/live/featureRouter"), import("@/live/features/vault"),
      ]);
      return withFeatureBackend<Record<string, string>>("membership", {
        supabase: async () => { throw new Error("Internet Identity required for private child names"); },
        icp: async scoped => {
          const sourceClubCanisterId = requireSourceClubCanisterId(scoped.target);
          const ids = (childRows ?? [])
            .filter(child => child.sourceClubCanisterId === sourceClubCanisterId)
            .map(child => child.id);
          if (ids.length === 0) return {};
          const names = await withReadDeadline(
            vault.resolveLivePiiTextBatch(scoped, ids, 'name', 'read', 'children_page'),
            "Private child names", 20_000,
          );
          return Object.fromEntries([...names.entries()].map(([id, name]) =>
            [childSourceKey({ id, sourceClubCanisterId }), name]));
        },
      }, { everyGroup: true, requireComplete: true, merge: parts => Object.assign({}, ...parts) });
    },
  });
  const children = childRows?.map(child => ({
    ...child,
    name: namesQuery.data?.[childSourceKey(child)] ?? child.name,
  }));
  const existingNamesResolved = !!childRows && (
    childRows.length === 0 || (
      namesQuery.isSuccess && !!children?.every(child => !child.isPrimary || !!child.name.trim())
    )
  );

  const { data: teams } = useQuery({
    queryKey: ["icp-children-teams", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<TeamOpt[]> => {
      const { ctx, club } = await load();
      const { readMembershipInScope } = await import('@/live/membershipRouting');
      const membership = await import("@/live/features/membership");
      const grants = (await withReadDeadline(membership.getLiveMyRoleGrants(ctx), 'Children memberships', 20_000)) as any[];
      const myClubIds = new Set(grants.map((g) => g.club?.[0]).filter(Boolean));
      const lists = await Promise.all(
        [...myClubIds].map(async (id) => {
          const clubId = String(id);
          return withReadDeadline(readMembershipInScope(ctx, { clubId }, async scoped => {
            const [profile, teams] = await Promise.all([club.getLiveClubProfile(scoped, clubId), club.listLiveTeams(scoped, clubId)]);
            const sourceClubCanisterId = requireSourceClubCanisterId(scoped.target);
            return teams.filter(t => !t.deleted_at_ms?.length).map(t => ({
              id: t.id, name: t.name, club_id: clubId,
              club_name: profile[0]?.name ?? 'Club', sourceClubCanisterId,
            }));
          }), 'Children teams', 20_000);
        }),
      );
      return lists.flat();
    },
  });
  const teamBySource = new Map((teams ?? []).map(t => [childSourceKey({
    id: t.id, sourceClubCanisterId: t.sourceClubCanisterId,
  }), t]));
  const availableNewChildTeam = (teams ?? []).find(t =>
    childSourceKey({ id: t.id, sourceClubCanisterId: t.sourceClubCanisterId }) === newChildTeamKey);


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ['icp-own-child-names-all-groups', user?.id] });
    qc.invalidateQueries({ queryKey: ["children"] });
    qc.invalidateQueries({ queryKey: ["own_children"] });
    qc.invalidateQueries({ queryKey: ["icp-children-teams", user?.id] });
  };

  const addChild = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      assertMayCreateChild(trimmed, children, !!existingNamesResolved);
      if (!availableNewChildTeam) throw new Error("Choose an eligible club team before adding a child.");
      if (createAttempted.current) {
        throw new Error("A previous child creation may have succeeded. Check My Children before creating another child.");
      }
      const team = availableNewChildTeam;
      const [{ withFeatureBackend, writeOnce }, club, vault] = await Promise.all([
        import("@/live/featureRouter"),
        import("@/live/features/club"),
        import("@/live/features/vault"),
      ]);
      return withFeatureBackend("membership", {
        supabase: async () => { throw new Error("Internet Identity child creation cannot use Supabase."); },
        icp: async ctx => {
          const sourceClubCanisterId = requireSourceClubCanisterId(ctx.target);
          if (sourceClubCanisterId !== team.sourceClubCanisterId)
            throw new Error("Club placement changed; no child was created.");
          if (!(await club.isMyLiveClubMember(ctx, team.club_id)))
            throw new Error("You are no longer a member of this club. No child was created.");
          const result = await createIcpInviteChild({
            clubId: team.club_id, teamId: team.id, name: trimmed,
          }, {
            readTeam: async () => (await club.getLiveTeam(ctx, team.id))[0] ?? null,
            createOwnChild: () => {
              if (createAttempted.current) throw new Error("Child creation was already attempted; check My Children.");
              createAttempted.current = true;
              return club.createMyLiveChild(ctx);
            },
            saveName: id => vault.registerLiveChildNamePii(ctx, id, trimmed, ctx.identity.getPrincipal(), team.club_id),
            assignOwnChildToTeam: id => club.setMyLiveChildTeam(ctx, id, team.id, true),
          });
          if (result.status === "linked") createAttempted.current = false;
          return {
            id: result.childId, name: trimmed,
            teams: result.status === "linked" ? [team.id] : [],
            isPrimary: true, sourceClubCanisterId,
            status: result.status,
          };
        },
      }, writeOnce({ clubId: team.club_id }));
    },
    onSuccess: (created) => {
      // Show only the confirmed source. Canonical cross-group reads replace
      // this optimistic row and cannot accidentally pick up a Group 1 child.
      qc.setQueryData<IcpChild[]>(KEY, prev => prev && !prev.some(c =>
        childSourceKey(c) === childSourceKey(created)) ? [...prev, created] : prev);
      invalidate();
      setAddOpen(false);
      setName("");
      setNewChildTeamKey("");
      toast(created.status === "linked" ? { title: "Child added to team" } : {
        title: "Child created, team link incomplete",
        description: "The child exists, but was not assigned to the selected team. Check My Children before another attempt.",
        variant: "destructive",
      });
    },
    onError: (e: any) => toast({
      title: "Couldn't finish adding child",
      description: createAttempted.current
        ? "The child may already exist. Check all groups in My Children before trying again."
        : e?.message,
      variant: "destructive",
    }),
  });

  const deleteChild = useMutation({
    mutationFn: async (child: IcpChild) => {
      if (!child.isPrimary) throw new Error("Only the primary parent can remove this child.");
      const club = await import("@/live/features/club");
      await withVerifiedChildGroup(child, ctx => club.deleteMyLiveChild(ctx, child.id));
    },
    onMutate: async (child: IcpChild) => {
      setDeleteId(null);
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<IcpChild[]>(KEY);
      qc.setQueryData<IcpChild[]>(KEY, prev => prev?.filter(c =>
        childSourceKey(c) !== childSourceKey(child)));
      return { previous };
    },
    onSuccess: () => { invalidate(); toast({ title: "Child removed" }); },
    onError: (e: any, _child, context) => {
      if (context?.previous) qc.setQueryData(KEY, context.previous);
      toast({ title: "Failed to remove child", description: e?.message, variant: "destructive" });
    },
  });

  const setTeam = useMutation({
    mutationFn: async ({ child, team, assigned }: {
      child: IcpChild; team: TeamOpt; assigned: boolean;
    }) => {
      assertChildSourceMatchesTeam(child, team);
      if (assigned && child.teams.includes(team.id)) return;
      if (!assigned && !child.teams.includes(team.id))
        throw new Error("Child is not on this team; nothing was changed.");
      const [club, vault] = await Promise.all([
        import("@/live/features/club"), import("@/live/features/vault"),
      ]);
      await withVerifiedChildGroup(child, async ctx => {
        const actual = (await club.getLiveTeam(ctx, team.id))[0];
        if (!actual || actual.club_id !== team.club_id)
          throw new Error("Team or club placement changed; no assignment was made.");
        await club.setMyLiveChildTeam(ctx, child.id, team.id, assigned);
        if (assigned) {
          // The name must be unlocked by the same source group as the child.
          if (child.teams.length === 0 && child.isPrimary && child.name.trim()) {
            await vault.registerLiveChildNamePii(ctx, child.id, child.name.trim(), ctx.identity.getPrincipal(), team.club_id);
          } else {
            await vault.grantLiveClubChildNameRead(ctx, child.id, team.club_id).catch(() => {});
          }
        }
      });
    },
    onSuccess: (_d, v) => { invalidate(); toast({ title: v.assigned ? "Added to team" : "Removed from team" }); },
    onError: (e: any) => toast({ title: "Couldn't update team", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">Children</h1>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add child
        </Button>
      </div>

      {isLoading ? (
        <div className="py-10 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading children...</p>
        </div>
      ) : isError && !children ? (
        <div className="space-y-3"><p className="text-muted-foreground">Your children’s details could not be retrieved.</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></div>
      ) : !children?.length ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Users className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">No children added yet.</p>
            <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add your first child</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {children.map((c) => (
            <Card key={childSourceKey(c)}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {c.name ? <p className="font-semibold">{c.name}</p> : namesQuery.isLoading ? <div className="h-5 w-32 rounded bg-muted animate-pulse" aria-label="Retrieving child name" /> : <p className="font-semibold">Child</p>}
                    {!c.isPrimary && <p className="text-xs text-muted-foreground">You're a guardian</p>}
                    <p className="text-xs text-muted-foreground">Stored on ICP group {c.sourceClubCanisterId.slice(0, 10)}…</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label="Guardians" onClick={() => setGuardiansFor(c)}>
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    {c.isPrimary && (
                      <Button variant="ghost" size="icon" aria-label="Remove child" onClick={() => setDeleteId(c)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.teams.map((tid) => {
                    const t = teamBySource.get(childSourceKey({ id: tid, sourceClubCanisterId: c.sourceClubCanisterId }));
                    return (
                      <Badge key={tid} variant="secondary" className="gap-1">
                        {t ? `${t.name} · ${t.club_name}` : "Team"}
                        <button
                          aria-label="Remove from team"
                          disabled={!t}
                          onClick={() => t && setTeam.mutate({ child: c, team: t, assigned: false })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                  <Button variant="outline" size="sm" onClick={() => setTeamFor(c)}>
                    <Plus className="h-3 w-3 mr-1" /> Add to team
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {namesQuery.isError && <Button variant="outline" onClick={() => void namesQuery.refetch()}>Retry child names</Button>}
      <ResponsiveDialog open={addOpen} onOpenChange={setAddOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Add child</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="icp-child-name">Name</Label>
            <Input id="icp-child-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Child's name" />
            <p className="text-xs text-muted-foreground">The name is stored privately and only shown to you, other guardians and their clubs.</p>
            <Label htmlFor="icp-new-child-team">Team (required to choose the correct group)</Label>
            <Select value={newChildTeamKey} onValueChange={setNewChildTeamKey}>
              <SelectTrigger id="icp-new-child-team"><SelectValue placeholder="Select your club team" /></SelectTrigger>
              <SelectContent>
                {(teams ?? []).map(t => (
                  <SelectItem key={childSourceKey({ id: t.id, sourceClubCanisterId: t.sourceClubCanisterId })}
                    value={childSourceKey({ id: t.id, sourceClubCanisterId: t.sourceClubCanisterId })}>
                    {t.name} · {t.club_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {children?.some(c => c.isPrimary) && <p className="text-xs text-muted-foreground">
              Existing children in another ICP group cannot be copied or re-created here.
              Confirm their names and group before requesting a transfer.
            </p>}
            {!teams?.length && <p className="text-xs text-muted-foreground">No eligible team found. Join a club team first.</p>}
          </div>
          <ResponsiveDialogFooter>
            <Button onClick={() => addChild.mutate()} disabled={!name.trim() || !availableNewChildTeam || !existingNamesResolved || createAttempted.current || addChild.isPending}>
              {addChild.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add child
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={!!teamFor} onOpenChange={(o) => !o && setTeamFor(null)}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Add {teamFor?.name} to a team</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
            {(teams ?? []).filter(t =>
              t.sourceClubCanisterId === teamFor?.sourceClubCanisterId && !teamFor?.teams.includes(t.id)
            ).map((t) => (
              <Button
                key={childSourceKey({ id: t.id, sourceClubCanisterId: t.sourceClubCanisterId })}
                variant="outline"
                className="w-full justify-start"
                disabled={setTeam.isPending}
                onClick={() => { setTeam.mutate({ child: teamFor!, team: t, assigned: true }); setTeamFor(null); }}
              >
                {t.name} <span className="ml-2 text-xs text-muted-foreground">{t.club_name}</span>
              </Button>
            ))}
            {teams && teams.filter(t =>
              t.sourceClubCanisterId === teamFor?.sourceClubCanisterId && !teamFor?.teams.includes(t.id)
            ).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No available team in this child's original canister group.
                A child cannot be moved to another group by selecting a team.
              </p>
            )}
            {!teams && <Loader2 className="h-5 w-5 animate-spin mx-auto" />}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {guardiansFor && (
        <GuardiansDialog child={guardiansFor} teamIds={guardiansFor.teams} onClose={() => setGuardiansFor(null)} onChanged={invalidate} />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove child?</AlertDialogTitle>
            <AlertDialogDescription>This removes the child from your account, their teams and other guardians.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteChild.mutate(deleteId)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GuardiansDialog({ child, teamIds, onClose, onChanged }: { child: IcpChild; teamIds: string[]; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["icp-child-guardians", childSourceKey(child)];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const club = await import("@/live/features/club");
      const { listLiveProfilesByIds, accountIdForPrincipal } = await import("@/live/features/identityAccessClient");
      const { listLiveTeamRoleGrants } = await import("@/live/features/membership");
      return withVerifiedChildGroup(child, async ctx => {
      const me = ctx.identity.getPrincipal().toText();
      const principals = ((await club.listLiveChildGuardians(ctx, child.id)) as any[]).map((p) => p.toText());
      // Candidates: members of the child's teams.
      const grants = (await Promise.all(teamIds.map((t) => listLiveTeamRoleGrants(ctx, t).catch(() => [])))).flat() as any[];
      const candidates = Array.from(new Set(grants.map((g) => g.user?.toText?.()).filter(Boolean))) as string[];
      const all = Array.from(new Set([...principals, ...candidates]));
      const accIds = await Promise.all(all.map((p) => accountIdForPrincipal(p)));
      const profiles = (await listLiveProfilesByIds(ctx, accIds.filter(Boolean) as string[]).catch(() => [])) as any[];
      const nameByAcc = new Map(profiles.map((p) => [p.account_id, p.display_name]));
      const nameOf = (p: string) => {
        if (p === me) return "You";
        const a = accIds[all.indexOf(p)];
        return (a && nameByAcc.get(a)) || "Member";
      };
      const guardians: Guardian[] = principals.map((p) => ({
        principal: p,
        name: nameOf(p),
        isPrimary: p === me ? child.isPrimary : false,
        isMe: p === me,
      }));
      const addable = candidates.filter((p) => !principals.includes(p) && p !== me).map((p) => ({ principal: p, name: nameOf(p) }));
      return { guardians, addable };
      });
    },
  });

  const change = useMutation({
    mutationFn: async ({ principal, linked }: { principal: string; linked: boolean }) => {
      const [club, vault, { Principal }] = await Promise.all([
        import("@/live/features/club"), import("@/live/features/vault"), import("@icp-sdk/core/principal"),
      ]);
      const p = Principal.fromText(principal);
      await withVerifiedChildGroup(child, async ctx => {
        await club.setMyLiveChildGuardian(ctx, child.id, p, linked);
        if (linked) await vault.grantLiveGuardianChildNameRead(ctx, child.id, p);
        else await vault.revokeLivePiiRead(ctx, child.id, "name", p).catch(() => {});
      });
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: key });
      onChanged();
      toast({ title: v.linked ? "Guardian added" : "Guardian removed" });
      if (!v.linked && data?.guardians.find((g) => g.principal === v.principal)?.isMe) onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't update guardians", description: e?.message, variant: "destructive" }),
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Guardians for {child.name}</ResponsiveDialogTitle></ResponsiveDialogHeader>
        {isLoading || !data ? (
          <Loader2 className="h-5 w-5 animate-spin mx-auto my-6" />
        ) : (
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              {data.guardians.map((g) => (
                <div key={g.principal} className="flex items-center justify-between rounded-md border p-2">
                  <span className="text-sm">{g.name}{g.isPrimary && <span className="ml-2 text-xs text-muted-foreground">Primary parent</span>}</span>
                  {((child.isPrimary && !g.isMe) || (!child.isPrimary && g.isMe)) && (
                    <Button variant="ghost" size="sm" disabled={change.isPending} onClick={() => change.mutate({ principal: g.principal, linked: false })}>
                      {g.isMe ? "Leave" : "Remove"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {child.isPrimary && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Add a guardian from {child.name}'s teams</p>
                {data.addable.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {teamIds.length ? "No other team members to add." : "Add the child to a team first, then pick the other parent from that team."}
                  </p>
                ) : (
                  data.addable.map((m) => (
                    <div key={m.principal} className="flex items-center justify-between rounded-md border p-2">
                      <span className="text-sm">{m.name}</span>
                      <Button size="sm" variant="outline" disabled={change.isPending} onClick={() => change.mutate({ principal: m.principal, linked: true })}>
                        Add
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
