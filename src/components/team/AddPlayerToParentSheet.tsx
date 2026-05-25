import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, UserPlus, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ParentCandidate {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
  /** Members of the team (from user_roles join) used to populate parent picker. */
  rawMembers: Array<{
    user_id: string;
    role: string;
    profiles: { id: string; display_name: string | null; avatar_url: string | null } | null;
  }>;
  /** Pre-selected parent (e.g. when opened from a parent detail context). */
  defaultParentUserId?: string;
}

const PARENT_ROLES = new Set(["parent", "team_admin", "coach"]);

export default function AddPlayerToParentSheet({
  open,
  onOpenChange,
  teamId,
  teamName,
  rawMembers,
  defaultParentUserId,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedParentId, setSelectedParentId] = useState<string | null>(defaultParentUserId ?? null);
  const [search, setSearch] = useState("");
  const [childName, setChildName] = useState("");
  const [yearOfBirth, setYearOfBirth] = useState("");

  const parentCandidates: ParentCandidate[] = useMemo(() => {
    const map = new Map<string, ParentCandidate>();
    for (const m of rawMembers) {
      if (!m.user_id || !PARENT_ROLES.has(m.role)) continue;
      const existing = map.get(m.user_id);
      if (existing) {
        // Prefer "parent" role label over coach/team_admin if both present
        if (m.role === "parent") existing.role = "parent";
        continue;
      }
      map.set(m.user_id, {
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? null,
        avatar_url: m.profiles?.avatar_url ?? null,
        role: m.role,
      });
    }
    return [...map.values()].sort((a, b) =>
      (a.display_name ?? "").localeCompare(b.display_name ?? "")
    );
  }, [rawMembers]);

  const filteredParents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parentCandidates;
    return parentCandidates.filter((p) =>
      (p.display_name ?? "").toLowerCase().includes(q)
    );
  }, [parentCandidates, search]);

  const selectedParent = parentCandidates.find((p) => p.user_id === selectedParentId) ?? null;

  const reset = () => {
    setSelectedParentId(defaultParentUserId ?? null);
    setSearch("");
    setChildName("");
    setYearOfBirth("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const addPlayer = useMutation({
    mutationFn: async () => {
      if (!selectedParentId) throw new Error("Please pick a parent");
      const trimmed = childName.trim();
      if (!trimmed) throw new Error("Please enter the player's name");
      const yob = yearOfBirth.trim() ? parseInt(yearOfBirth.trim(), 10) : null;
      if (yob !== null && (Number.isNaN(yob) || yob < 1990 || yob > new Date().getFullYear())) {
        throw new Error("Please enter a valid year of birth");
      }
      const { data, error } = await supabase.rpc("create_child_for_parent_on_team", {
        p_parent_user_id: selectedParentId,
        p_team_id: teamId,
        p_name: trimmed,
        p_year_of_birth: yob,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({
        title: "Player added",
        description: `${childName.trim()} added to ${teamName}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["team-children", teamId] });
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      handleOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't add player",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit = !!selectedParentId && childName.trim().length > 0 && !addPlayer.isPending;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Add player</SheetTitle>
          <SheetDescription>
            Add a new player to an existing parent on {teamName} — no invite needed.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Parent on this team
            </Label>
            {selectedParent ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={selectedParent.avatar_url ?? undefined} />
                    <AvatarFallback>
                      {(selectedParent.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {selectedParent.display_name ?? "Unnamed user"}
                    </p>
                    <Badge variant="secondary" className="mt-0.5 text-[10px]">
                      {selectedParent.role.replace("_", " ")}
                    </Badge>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedParentId(null)}
                  disabled={addPlayer.isPending}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search parents on this team…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto rounded-lg border divide-y">
                  {filteredParents.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No parents found on this team.
                    </div>
                  ) : (
                    filteredParents.map((p) => (
                      <button
                        key={p.user_id}
                        type="button"
                        onClick={() => setSelectedParentId(p.user_id)}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/60 transition-colors"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={p.avatar_url ?? undefined} />
                          <AvatarFallback>
                            {(p.display_name ?? "?").slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {p.display_name ?? "Unnamed user"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {p.role.replace("_", " ")}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="child-name">Player name</Label>
            <Input
              id="child-name"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder="e.g. Emmy Collings"
              disabled={addPlayer.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="child-yob">Year of birth (optional)</Label>
            <Input
              id="child-yob"
              type="number"
              inputMode="numeric"
              value={yearOfBirth}
              onChange={(e) => setYearOfBirth(e.target.value)}
              placeholder="e.g. 2017"
              disabled={addPlayer.isPending}
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            The player will be linked to the selected parent and added to the {teamName}{" "}
            roster immediately. No email invite is sent.
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
              disabled={addPlayer.isPending}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => addPlayer.mutate()}
              disabled={!canSubmit}
            >
              {addPlayer.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add player
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
