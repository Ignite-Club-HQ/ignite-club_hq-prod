import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  HelpCircle,
  MessageCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface OpenGroup {
  id: string;
  name: string;
  category: string | null;
  club_id: string;
  clubs?: { name: string | null } | null;
  joined: boolean;
}

interface DiscoverGroupsListProps {
  /** When set, restrict to this club only (matches the inbox club filter). */
  activeClubFilter?: string | null;
}

/**
 * Lists club chat groups in the Operations / Volunteers categories that are
 * open for any club member to self-join (WhatsApp-style). Already-joined
 * groups are shown with a "Joined" badge so users understand why the list
 * may be empty.
 *
 * Discoverability is gated server-side by the
 * `Club members can discover open groups` RLS policy on `chat_groups`. The
 * actual join goes through the `join_open_chat_group` SECURITY DEFINER RPC.
 */
export default function DiscoverGroupsList({ activeClubFilter }: DiscoverGroupsListProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: groups = [] } = useQuery({
    queryKey: ["discover-open-groups", user?.id, activeClubFilter ?? null],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<OpenGroup[]> => {
      let q = supabase
        .from("chat_groups")
        .select("id, name, category, club_id, clubs:club_id(name)")
        .eq("join_policy", "open_to_club")
        .is("deleted_at", null)
        .not("club_id", "is", null)
        .is("team_id", null)
        .is("mini_league_id", null);
      if (activeClubFilter) q = q.eq("club_id", activeClubFilter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as Omit<OpenGroup, "joined">[];
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const { data: mine } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", user!.id)
        .in("group_id", ids);
      const joined = new Set((mine ?? []).map((m: any) => m.group_id));
      return rows.map((r) => ({ ...r, joined: joined.has(r.id) }));
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { data, error } = await (supabase as any).rpc("join_open_chat_group", {
        _group_id: groupId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, groupId) => {
      toast.success("You joined the group");
      queryClient.invalidateQueries({ queryKey: ["discover-open-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      navigate(`/groups/${groupId}`);
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Could not join group");
    },
    onSettled: () => setJoiningId(null),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.category ?? "").toLowerCase().includes(q) ||
        (g.clubs?.name ?? "").toLowerCase().includes(q),
    );
  }, [groups, search]);

  const joinableCount = groups.filter((g) => !g.joined).length;

  return (
    <Card className="border-dashed">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">Discover groups</span>
          <Badge variant="secondary" className="shrink-0">{joinableCount}</Badge>
          <Popover>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label="How discover works"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 text-xs leading-relaxed"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-medium text-sm mb-1">How this works</p>
              <p className="text-muted-foreground">
                Any club admin can mark an <strong>Operations</strong> or <strong>Volunteers</strong> group as
                "open to club" (in the group's edit page). Those groups show up here
                and any club member can tap <strong>Join</strong> to enter instantly — no approval needed.
              </p>
              <p className="text-muted-foreground mt-2">
                Groups you've already joined show a "Joined" badge so you know they exist.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-3 space-y-2">
          <p className="text-xs text-muted-foreground -mt-1 mb-2">
            Open Operations &amp; Volunteers groups in your club. Join any without needing an admin.
          </p>

          {groups.length > 3 && (
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search open groups…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}

          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">
              No open groups to discover right now. Ask a club admin to mark an Operations or Volunteers group as open to the club.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">
              No groups match "{search}".
            </p>
          ) : (
            filtered.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 p-2 rounded-md bg-muted/30"
              >
                <div className="p-2 rounded-full bg-primary/10 shrink-0">
                  <MessageCircle className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{g.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {[g.clubs?.name, g.category].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {g.joined ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/groups/${g.id}`)}
                  >
                    <Badge variant="outline" className="mr-1">Joined</Badge>
                    Open
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={joiningId === g.id}
                    onClick={() => {
                      setJoiningId(g.id);
                      joinMutation.mutate(g.id);
                    }}
                  >
                    {joiningId === g.id ? "Joining…" : "Join"}
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
}
