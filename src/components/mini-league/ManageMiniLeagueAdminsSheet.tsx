import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Trash2, Shield } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface ManageMiniLeagueAdminsSheetProps {
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ClubMember {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export function ManageMiniLeagueAdminsSheet({
  miniLeagueId,
  miniLeagueName,
  clubId,
  open,
  onOpenChange,
}: ManageMiniLeagueAdminsSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);

  // Current per-league admin grants
  const { data: currentAdmins, isLoading: loadingCurrent } = useQuery({
    queryKey: ["mini-league-admins", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_admins")
        .select("id, user_id, created_at")
        .eq("mini_league_id", miniLeagueId);
      if (error) throw error;

      const userIds = (data || []).map((r) => r.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      return (data || []).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        display_name: profileMap.get(r.user_id)?.display_name ?? null,
        avatar_url: profileMap.get(r.user_id)?.avatar_url ?? null,
      }));
    },
    enabled: open && !!miniLeagueId,
  });

  // Club members eligible to be promoted (anyone with a role in the club)
  const { data: clubMembers } = useQuery({
    queryKey: ["club-members-pickable", clubId],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId);

      const ids = [...new Set((roles || []).map((r) => r.user_id))];
      if (ids.length === 0) return [] as ClubMember[];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", ids);

      return (profiles || []).map((p) => ({
        user_id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
      })) as ClubMember[];
    },
    enabled: open && !!clubId,
  });

  const grantMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.from("mini_league_admins").insert({
        mini_league_id: miniLeagueId,
        user_id: targetUserId,
        granted_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-admins", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["mini-league-members"] });
      toast({ title: "League admin added" });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't add admin",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase
        .from("mini_league_admins")
        .delete()
        .eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-admins", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["mini-league-members"] });
      toast({ title: "League admin removed" });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't remove admin",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  const currentIds = new Set((currentAdmins || []).map((a) => a.user_id));
  const filteredMembers = (clubMembers || [])
    .filter((m) => !currentIds.has(m.user_id))
    .filter((m) => {
      if (!debouncedSearch.trim()) return true;
      const name = (m.display_name || "").toLowerCase();
      return name.includes(debouncedSearch.toLowerCase());
    })
    .slice(0, 50);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] flex flex-col">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            League Admins
          </SheetTitle>
          <SheetDescription>
            Grant admin rights for {miniLeagueName} to specific club members.
            Club admins and club-wide League Admins keep their access automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 mt-2">
          {/* Current admins */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Current
            </p>
            {loadingCurrent ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (currentAdmins || []).length === 0 ? (
              <p className="text-sm text-muted-foreground px-1 py-2">
                No per-league admins yet.
              </p>
            ) : (
              <div className="space-y-1.5">
                {(currentAdmins || []).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-card border"
                  >
                    <Avatar className="h-8 w-8">
                      {a.avatar_url && <AvatarImage src={a.avatar_url} />}
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {(a.display_name || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <p className="flex-1 text-sm font-medium truncate">
                      {a.display_name || "Unknown"}
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => revokeMutation.mutate(a.id)}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Picker */}
          <div className="flex-1 flex flex-col min-h-0 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Add from club
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search club members…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <ScrollArea className="flex-1 -mx-2 px-2">
              <div className="space-y-1.5 pb-4">
                {filteredMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-1 py-4 text-center">
                    No matches.
                  </p>
                ) : (
                  filteredMembers.map((m) => (
                    <div
                      key={m.user_id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50"
                    >
                      <Avatar className="h-8 w-8">
                        {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                        <AvatarFallback className="bg-muted text-foreground text-sm">
                          {(m.display_name || "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="flex-1 text-sm truncate">
                        {m.display_name || "Unknown"}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => grantMutation.mutate(m.user_id)}
                        disabled={grantMutation.isPending}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
