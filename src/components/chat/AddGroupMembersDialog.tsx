import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, Check, X, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface Candidate {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  shared_clubs: string[];
}

interface AddGroupMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  existingMemberIds: string[];
}

/**
 * Lets any current member of a personal group chat add additional people.
 * Candidates are members of the same Pro club(s) the current user belongs to,
 * excluding people already in the group.
 */
export function AddGroupMembersDialog({
  open,
  onOpenChange,
  groupId,
  existingMemberIds,
}: AddGroupMembersDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Candidate[]>([]);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["add-group-members-candidates", user?.id, groupId, existingMemberIds.length],
    queryFn: async (): Promise<Candidate[]> => {
      if (!user) return [];

      // Find the Pro clubs current user belongs to
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .not("club_id", "is", null);

      const clubIds = [...new Set((roles || []).map(r => r.club_id).filter(Boolean))] as string[];
      if (clubIds.length === 0) return [];

      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or(
          "is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true"
        );

      const proClubIds = (proClubs || []).map(c => c.club_id);
      if (proClubIds.length === 0) return [];

      // Members of those Pro clubs (excluding current user)
      const [memberRolesResult, clubsResult, appAdminsResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, club_id")
          .in("club_id", proClubIds)
          .neq("user_id", user.id),
        supabase.from("clubs").select("id, name").in("id", proClubIds),
        supabase.from("user_roles").select("user_id").eq("role", "app_admin"),
      ]);

      const clubNameMap = new Map((clubsResult.data || []).map(c => [c.id, c.name]));
      const appAdminIds = new Set((appAdminsResult.data || []).map(a => a.user_id));
      const excludeIds = new Set(existingMemberIds);

      const userClubs = new Map<string, Set<string>>();
      for (const row of memberRolesResult.data || []) {
        if (appAdminIds.has(row.user_id)) continue;
        if (excludeIds.has(row.user_id)) continue;
        if (!userClubs.has(row.user_id)) userClubs.set(row.user_id, new Set());
        if (row.club_id) {
          const name = clubNameMap.get(row.club_id);
          if (name) userClubs.get(row.user_id)!.add(name);
        }
      }

      const userIds = [...userClubs.keys()];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      return (profiles || []).map(p => ({
        id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        shared_clubs: [...(userClubs.get(p.id) || [])],
      }));
    },
    enabled: open && !!user,
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return candidates;
    const q = searchQuery.toLowerCase();
    return candidates.filter(
      c =>
        c.display_name?.toLowerCase().includes(q) ||
        c.shared_clubs.some(s => s.toLowerCase().includes(q))
    );
  }, [candidates, searchQuery]);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!user || selected.length === 0) return;
      const inserts = selected.map(s => ({
        group_id: groupId,
        user_id: s.id,
        added_by: user.id,
      }));
      const { error } = await supabase.from("group_members").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        selected.length === 1
          ? `${selected[0].display_name || "Member"} added`
          : `${selected.length} people added`
      );
      queryClient.invalidateQueries({ queryKey: ["chat-members"] });
      setSelected([]);
      setSearchQuery("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error("Failed to add members: " + (err?.message || "Unknown error"));
    },
  });

  const toggle = (c: Candidate) => {
    setSelected(prev =>
      prev.some(s => s.id === c.id) ? prev.filter(s => s.id !== c.id) : [...prev, c]
    );
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={o => {
        onOpenChange(o);
        if (!o) {
          setSelected([]);
          setSearchQuery("");
        }
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md" fullScreen>
        <ResponsiveDialogHeader className="px-4 pt-2 pb-3 border-b border-border/60">
          <ResponsiveDialogTitle className="text-base font-semibold text-center sm:text-left">
            Add people
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-xs text-muted-foreground text-center sm:text-left">
            Choose members from your club to add to this group chat
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-3 space-y-3">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2 bg-muted/40 rounded-xl border border-border/50">
              {selected.map(s => (
                <Badge key={s.id} variant="secondary" className="gap-1 pr-1 rounded-full">
                  {s.display_name?.split(" ")[0] || "User"}
                  <button
                    onClick={() => toggle(s)}
                    className="ml-0.5 rounded-full hover:bg-background/60 p-0.5"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-10 rounded-xl"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {searchQuery ? "No members found" : "No more people to add"}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(c => {
                const isSelected = selected.some(s => s.id === c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left touch-manipulation active:scale-[0.99] ${
                      isSelected
                        ? "bg-primary/10 border border-primary/30"
                        : "border border-transparent hover:bg-muted/60"
                    }`}
                  >
                    <Avatar className={`h-10 w-10 ring-2 transition-all ${isSelected ? "ring-primary" : "ring-transparent"}`}>
                      <AvatarImage src={c.avatar_url || undefined} />
                      <AvatarFallback>
                        {c.display_name?.charAt(0).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-sm">
                        {c.display_name || "Unknown User"}
                      </p>
                      {c.shared_clubs.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate">
                          {c.shared_clubs.join(", ")}
                        </p>
                      )}
                    </div>
                    <div
                      aria-hidden
                      className={`h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky, elevated footer — anchored to the sheet, not floating */}
        <div className="shrink-0 border-t border-border bg-card/95 backdrop-blur-sm px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-[0_-4px_12px_-8px_hsl(var(--foreground)/0.2)]">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground hover:text-foreground px-4"
            >
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={selected.length === 0 || addMutation.isPending}
              className="flex-1 gap-2 h-11 rounded-xl font-semibold transition-all"
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {selected.length === 0
                ? "Add members"
                : `Add ${selected.length} ${selected.length === 1 ? "member" : "members"}`}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
