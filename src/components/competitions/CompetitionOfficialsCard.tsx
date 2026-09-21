import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, UserMinus, Whistle, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

type OfficialRole = "referee" | "committee";

const ROLE_LABEL: Record<OfficialRole, string> = {
  referee: "Referee",
  committee: "Committee member",
};

interface Props {
  competitionId: string;
  competitionName: string;
  organizerClubId: string | null;
}

interface RoleRow {
  id: string;
  user_id: string;
  role: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

/**
 * Referee and committee assignment for a single competition.
 *
 * Rows live in `competition_roles`; RLS restricts writes to competition
 * owners/admins, so this component is UI gating only. Assigning someone also
 * creates/updates the matching automatic chat thread server-side (see
 * `ensure_competition_role_chat`).
 */
export function CompetitionOfficialsCard({
  competitionId,
  competitionName,
  organizerClubId,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingRole, setPendingRole] = useState<OfficialRole>("referee");
  const debouncedSearch = useDebounce(search, 300);

  const rolesQueryKey = ["competition-roles", competitionId];

  const { data: roles = [], isLoading } = useQuery({
    queryKey: rolesQueryKey,
    enabled: !!competitionId,
    queryFn: async () => {
      const { data: roleRows, error } = await supabase
        .from("competition_roles")
        .select("id, user_id, role")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = roleRows ?? [];
      if (rows.length === 0) return [] as RoleRow[];

      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role,
        profile: profileMap.get(r.user_id) ?? null,
      })) as RoleRow[];
    },
  });

  const officials = useMemo(
    () => roles.filter((r) => r.role === "referee" || r.role === "committee"),
    [roles],
  );

  // Someone already holding the role we're about to assign shouldn't appear.
  const existingForRole = useMemo(
    () => new Set(roles.filter((r) => r.role === pendingRole).map((r) => r.user_id)),
    [roles, pendingRole],
  );

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["competition-official-search", competitionId, debouncedSearch],
    enabled: debouncedSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSearch.trim(),
        _limit: 8,
        _club_id: organizerClubId ?? null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const visibleResults = useMemo(
    () => searchResults.filter((p: { id: string }) => !existingForRole.has(p.id)),
    [searchResults, existingForRole],
  );

  const addMutation = useMutation({
    mutationFn: async (target: { id: string; display_name: string | null }) => {
      const role = pendingRole;
      const { error } = await supabase.from("competition_roles").insert({
        competition_id: competitionId,
        user_id: target.id,
        role,
      });
      if (error) throw error;

      await supabase.from("notifications").insert({
        user_id: target.id,
        type: "membership",
        message: `You have been added as a ${ROLE_LABEL[role].toLowerCase()} for ${competitionName}`,
        related_id: competitionId,
      });
      return { target, role };
    },
    onSuccess: ({ target, role }) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      setSearch("");
      toast({
        title: `${ROLE_LABEL[role]} added`,
        description: `${target.display_name ?? "They"} now has access to the ${
          role === "referee" ? "referees" : "committee"
        } chat for ${competitionName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (row: RoleRow) => {
      const { error } = await supabase.from("competition_roles").delete().eq("id", row.id);
      if (error) throw error;
      return row;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
      toast({
        title: "Removed",
        description: `${row.profile?.display_name ?? "They"} no longer has that role in ${competitionName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Referees &amp; committee</CardTitle>
        <CardDescription>
          Referees get their own private chat for this competition, and committee members get
          theirs. Each chat appears as soon as the first person is added, and always includes the
          competition organisers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="divide-y border rounded-md">
            {officials.map((r) => {
              const isSelf = r.user_id === user?.id;
              return (
                <div key={r.id} className="flex items-center gap-3 p-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={r.profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {r.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.profile?.display_name ?? "Unknown user"}
                      {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABEL[r.role as OfficialRole] ?? r.role}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${r.profile?.display_name ?? "user"}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(r)}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            {officials.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No referees or committee members yet.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            {(["referee", "committee"] as OfficialRole[]).map((role) => (
              <Button
                key={role}
                type="button"
                size="sm"
                variant={pendingRole === role ? "default" : "outline"}
                onClick={() => setPendingRole(role)}
              >
                {ROLE_LABEL[role]}
              </Button>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search people to add as ${ROLE_LABEL[pendingRole].toLowerCase()}…`}
              className="pl-9 pr-9"
              aria-label={`Search people to add as ${ROLE_LABEL[pendingRole].toLowerCase()}`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {debouncedSearch.trim().length >= 2 && (
            <div className="border rounded-md divide-y">
              {isSearching ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : visibleResults.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No matches.</p>
              ) : (
                visibleResults.map((p: { id: string; display_name: string | null; avatar_url: string | null }) => (
                  <div key={p.id} className="flex items-center gap-3 p-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={p.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-muted text-xs">
                        {p.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <p className="flex-1 min-w-0 text-sm truncate">
                      {p.display_name ?? "Unknown user"}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={addMutation.isPending}
                      onClick={() => addMutation.mutate(p)}
                    >
                      Add
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
