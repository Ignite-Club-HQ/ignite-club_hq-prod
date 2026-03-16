import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Trash2, Loader2, Star, CheckSquare, Pencil, Check, X, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import PendingInvitesList from "@/components/PendingInvitesList";
import { toast } from "sonner";

export interface MiniLeaguePlayer {
  id: string;
  name: string;
  ability_rating: number;
  notes: string | null;
  parent_user_id: string | null;
  child_id: string | null;
}

interface ParentProfile {
  id: string;
  display_name: string | null;
}

interface ManagePlayersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
  canManage: boolean;
  onOpenAddPlayers?: () => void;
}

const getAbilityLabel = (rating: number) => {
  const labels = ["", "Beginner", "Developing", "Intermediate", "Advanced", "Expert"];
  return labels[rating] || "";
};

const getAbilityColor = (rating: number) => {
  const colors: Record<number, string> = {
    1: "bg-destructive/20 text-destructive",
    2: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
    3: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
    4: "bg-green-500/20 text-green-600 dark:text-green-400",
    5: "bg-primary/20 text-primary",
  };
  return colors[rating] || "";
};

export function ManagePlayersDialog({
  open,
  onOpenChange,
  miniLeagueId,
  miniLeagueName,
  clubId,
  canManage,
  onOpenAddPlayers,
}: ManagePlayersDialogProps) {
  const queryClient = useQueryClient();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Fetch players
  const { data: players, isLoading: playersLoading } = useQuery({
    queryKey: ["mini-league-players", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("*")
        .eq("mini_league_id", miniLeagueId)
        .order("ability_rating", { ascending: false });
      if (error) throw error;
      return data as MiniLeaguePlayer[];
    },
    enabled: !!miniLeagueId && open,
  });

  // Fetch parent profiles for linked players
  const parentUserIds = [...new Set((players || []).map(p => p.parent_user_id).filter(Boolean) as string[])];
  const { data: parentProfiles } = useQuery({
    queryKey: ["parent-profiles", parentUserIds],
    queryFn: async () => {
      if (parentUserIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", parentUserIds);
      if (error) throw error;
      return data as ParentProfile[];
    },
    enabled: parentUserIds.length > 0 && open,
  });

  const parentMap = new Map((parentProfiles || []).map(p => [p.id, p.display_name || "Unknown"]));

  // Fetch pending invites
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites", null, clubId, miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, role, invited_user_id, invited_label, invited_email, created_at, status, metadata")
        .eq("club_id", clubId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const filtered = (data || []).filter((inv: any) => {
        const metadata = inv.metadata as any;
        return metadata?.mini_league_id === miniLeagueId;
      });
      return filtered.map((inv: any) => ({ ...inv, profiles: null }));
    },
    enabled: !!clubId && !!miniLeagueId && open,
  });

  // Delete player mutation
  const deletePlayerMutation = useMutation({
    mutationFn: async (playerId: string) => {
      const { data: player } = await supabase
        .from("mini_league_players")
        .select("child_id")
        .eq("id", playerId)
        .single();

      const { error } = await supabase.from("mini_league_players").delete().eq("id", playerId);
      if (error) throw error;

      if (player?.child_id) {
        await supabase
          .from("child_mini_league_assignments")
          .delete()
          .eq("child_id", player.child_id)
          .eq("mini_league_id", miniLeagueId);

        const [{ count: leagueCount }, { count: teamCount }] = await Promise.all([
          supabase.from("child_mini_league_assignments").select("id", { count: "exact", head: true }).eq("child_id", player.child_id),
          supabase.from("child_team_assignments").select("id", { count: "exact", head: true }).eq("child_id", player.child_id),
        ]);

        if ((leagueCount || 0) === 0 && (teamCount || 0) === 0) {
          await supabase.from("children").delete().eq("id", player.child_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      toast.success("Player removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Bulk delete players mutation
  const bulkDeletePlayersMutation = useMutation({
    mutationFn: async (playerIds: string[]) => {
      const { data: playersToDelete } = await supabase
        .from("mini_league_players")
        .select("id, child_id")
        .in("id", playerIds);

      const childIds = (playersToDelete || []).map(p => p.child_id).filter(Boolean) as string[];

      const { error } = await supabase.from("mini_league_players").delete().in("id", playerIds);
      if (error) throw error;

      if (childIds.length > 0) {
        await supabase
          .from("child_mini_league_assignments")
          .delete()
          .in("child_id", childIds)
          .eq("mini_league_id", miniLeagueId);

        for (const childId of childIds) {
          const [{ count: leagueCount }, { count: teamCount }] = await Promise.all([
            supabase.from("child_mini_league_assignments").select("id", { count: "exact", head: true }).eq("child_id", childId),
            supabase.from("child_team_assignments").select("id", { count: "exact", head: true }).eq("child_id", childId),
          ]);
          if ((leagueCount || 0) === 0 && (teamCount || 0) === 0) {
            await supabase.from("children").delete().eq("id", childId);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      setSelectedPlayerIds(new Set());
      setSelectionMode(false);
      setBulkDeleteOpen(false);
      toast.success("Players removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Update ability rating mutation
  const updateAbilityMutation = useMutation({
    mutationFn: async ({ playerId, childId, newRating }: { playerId: string; childId: string | null; newRating: number }) => {
      const { error } = await supabase
        .from("mini_league_players")
        .update({ ability_rating: newRating })
        .eq("id", playerId);
      if (error) throw error;

      if (childId) {
        await supabase
          .from("child_mini_league_assignments")
          .update({ ability_rating: newRating })
          .eq("child_id", childId)
          .eq("mini_league_id", miniLeagueId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Update player name mutation
  const updateNameMutation = useMutation({
    mutationFn: async ({ playerId, childId, newName }: { playerId: string; childId: string | null; newName: string }) => {
      const { error } = await supabase
        .from("mini_league_players")
        .update({ name: newName })
        .eq("id", playerId);
      if (error) throw error;

      if (childId) {
        await supabase
          .from("children")
          .update({ name: newName })
          .eq("id", childId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      setEditingPlayerId(null);
      toast.success("Name updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const startEditingName = (player: MiniLeaguePlayer) => {
    setEditingPlayerId(player.id);
    setEditingName(player.name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const saveEditingName = (player: MiniLeaguePlayer) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === player.name) {
      setEditingPlayerId(null);
      return;
    }
    updateNameMutation.mutate({ playerId: player.id, childId: player.child_id, newName: trimmed });
  };

  const togglePlayerSelection = (playerId: string) => {
    const newSet = new Set(selectedPlayerIds);
    if (newSet.has(playerId)) newSet.delete(playerId);
    else newSet.add(playerId);
    setSelectedPlayerIds(newSet);
  };

  const toggleSelectAll = () => {
    if (!players) return;
    if (selectedPlayerIds.size === players.length) setSelectedPlayerIds(new Set());
    else setSelectedPlayerIds(new Set(players.map(p => p.id)));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPlayerIds(new Set());
  };

  const handleAddPlayersClick = () => {
    onOpenChange(false);
    // Small delay to let dialog close before opening sheet
    setTimeout(() => onOpenAddPlayers?.(), 200);
  };

  const filteredPlayers = players?.filter(p =>
    !playerSearch.trim() || p.name.toLowerCase().includes(playerSearch.trim().toLowerCase())
  ) || [];

  const playersByAbility = filteredPlayers.reduce((acc, player) => {
    const key = player.ability_rating;
    if (!acc[key]) acc[key] = [];
    acc[key].push(player);
    return acc;
  }, {} as Record<number, MiniLeaguePlayer[]>);

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => {
      if (!o) {
        setSelectionMode(false);
        setSelectedPlayerIds(new Set());
        setPlayerSearch("");
        setEditingPlayerId(null);
      }
      onOpenChange(o);
    }}>
      <ResponsiveDialogContent className="sm:max-w-lg" fullScreen>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Manage Players
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2 px-1">
          <Input
            placeholder="Search players..."
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            className="h-9 text-sm"
          />

          <div className="flex justify-between items-center gap-2">
            <h2 className="text-base font-semibold">
              Player Pool{playerSearch.trim() && ` (${filteredPlayers.length}/${players?.length || 0})`}
            </h2>
            <div className="flex items-center gap-2">
              {canManage && (
                <>
                  {selectionMode ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={exitSelectionMode}>Cancel</Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={selectedPlayerIds.size === 0}
                        onClick={() => setBulkDeleteOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        Delete ({selectedPlayerIds.size})
                      </Button>
                    </>
                  ) : (
                    <>
                      {(players?.length || 0) > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
                          <CheckSquare className="h-4 w-4 mr-1.5" />
                          Select
                        </Button>
                      )}
                      <Button size="sm" onClick={handleAddPlayersClick}>
                        <Users className="h-4 w-4 mr-1.5" />
                        Add Players
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {selectionMode && players && players.length > 0 && (
            <div className="flex items-center gap-2 py-2 px-1 border-b">
              <Checkbox checked={selectedPlayerIds.size === players.length} onCheckedChange={toggleSelectAll} />
              <span className="text-sm text-muted-foreground">Select all ({players.length} players)</span>
            </div>
          )}

          {playersLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : players?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <Users className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground mb-3">No players added yet</p>
                {canManage && (
                  <Button size="sm" onClick={handleAddPlayersClick}>
                    Add Players
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {[5, 4, 3, 2, 1].map((rating) => {
                const abilityPlayers = playersByAbility[rating];
                if (!abilityPlayers?.length) return null;

                return (
                  <div key={rating} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${getAbilityColor(rating)}`}>
                        {getAbilityLabel(rating)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {abilityPlayers.length} player{abilityPlayers.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {abilityPlayers.map((player) => {
                        const parentName = player.parent_user_id ? parentMap.get(player.parent_user_id) : null;
                        const isEditing = editingPlayerId === player.id;

                        return (
                          <Card
                            key={player.id}
                            className={`overflow-hidden ${selectionMode && selectedPlayerIds.has(player.id) ? "ring-2 ring-primary" : ""}`}
                            onClick={selectionMode ? () => togglePlayerSelection(player.id) : undefined}
                          >
                            <CardContent className="py-2.5 px-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {selectionMode && (
                                    <Checkbox
                                      checked={selectedPlayerIds.has(player.id)}
                                      onCheckedChange={() => togglePlayerSelection(player.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  )}
                                  <div className="flex items-center gap-0 shrink-0">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                      <button
                                        key={i}
                                        type="button"
                                        disabled={!canManage || selectionMode}
                                        className={`p-1 ${canManage && !selectionMode ? "cursor-pointer hover:scale-125 transition-transform" : ""}`}
                                        onClick={
                                          canManage && !selectionMode
                                            ? (e) => {
                                                e.stopPropagation();
                                                const newRating = i + 1;
                                                if (newRating !== player.ability_rating) {
                                                  updateAbilityMutation.mutate({ playerId: player.id, childId: player.child_id, newRating });
                                                }
                                              }
                                            : undefined
                                        }
                                      >
                                        <Star
                                          className={`h-4 w-4 ${i < player.ability_rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
                                        />
                                      </button>
                                    ))}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    {isEditing ? (
                                      <div className="flex items-center gap-1">
                                        <Input
                                          ref={editInputRef}
                                          value={editingName}
                                          onChange={(e) => setEditingName(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") saveEditingName(player);
                                            if (e.key === "Escape") setEditingPlayerId(null);
                                          }}
                                          className="h-7 text-sm py-0 px-1"
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                        <button
                                          type="button"
                                          className="p-1 text-primary hover:text-primary/80"
                                          onClick={(e) => { e.stopPropagation(); saveEditingName(player); }}
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          className="p-1 text-muted-foreground hover:text-foreground"
                                          onClick={(e) => { e.stopPropagation(); setEditingPlayerId(null); }}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <span className="text-sm font-medium truncate">{player.name}</span>
                                        {canManage && !selectionMode && (
                                          <button
                                            type="button"
                                            className="p-1 text-muted-foreground/50 hover:text-muted-foreground shrink-0"
                                            onClick={(e) => { e.stopPropagation(); startEditingName(player); }}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    )}
                                    {parentName && (
                                      <div className="flex items-center gap-1 mt-0.5">
                                        <UserRound className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                        <span className="text-xs text-muted-foreground truncate">{parentName}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {!selectionMode && canManage && !isEditing && (
                                  <AlertDialog>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Trigger the alert dialog by finding and clicking the hidden trigger
                                        const btn = e.currentTarget.nextElementSibling as HTMLElement;
                                        btn?.click();
                                      }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Remove Player?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This will remove {player.name} from the player pool.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => deletePlayerMutation.mutate(player.id)}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          Remove
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </div>
                              {player.notes && !isEditing && (
                                <p className={`text-xs text-muted-foreground mt-1 truncate ${selectionMode ? "pl-[66px]" : "pl-[42px]"}`}>
                                  {player.notes}
                                </p>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pendingInvites.length > 0 && (
            <div className="space-y-2 mt-4">
              <h3 className="text-sm font-medium text-muted-foreground">Pending Parent Invites</h3>
              <PendingInvitesList invites={pendingInvites} clubId={clubId} />
            </div>
          )}

          <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {selectedPlayerIds.size} Players?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove {selectedPlayerIds.size} player{selectedPlayerIds.size !== 1 ? "s" : ""} from the player pool. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => bulkDeletePlayersMutation.mutate(Array.from(selectedPlayerIds))}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={bulkDeletePlayersMutation.isPending}
                >
                  {bulkDeletePlayersMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove All"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Done
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
