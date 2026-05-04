import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Hand, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  eventId: string;
  teamId?: string | null;
  isAdmin: boolean;
  rsvps: any[];
}

export default function MatchGoalkeepersSelector({ eventId, teamId, isAdmin, rsvps }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: keepers = [], isLoading } = useQuery({
    queryKey: ["match-goalkeepers", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_goalkeepers" as any)
        .select(`*, children:child_id (id, name)`)
        .eq("event_id", eventId);
      if (error) throw error;
      const rows: any[] = data || [];
      const userIds = rows.map((r) => r.user_id).filter(Boolean);
      let profileMap = new Map<string, any>();
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        (profs || []).forEach((p: any) => profileMap.set(p.id, p));
      }
      return rows.map((r) => ({ ...r, profiles: r.user_id ? profileMap.get(r.user_id) : null }));
    },
  });

  const { data: playerUserIds = [] } = useQuery({
    queryKey: ["team-player-user-ids", teamId],
    queryFn: async () => {
      if (!teamId) return [] as string[];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId)
        .eq("role", "player");
      if (error) throw error;
      return (data || []).map((r: any) => r.user_id);
    },
    enabled: !!teamId,
  });

  const addMutation = useMutation({
    mutationFn: async ({ userId, childId }: { userId?: string; childId?: string }) => {
      const { error } = await supabase.from("match_goalkeepers" as any).insert({
        event_id: eventId,
        user_id: userId || null,
        child_id: childId || null,
        assigned_by: user!.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-goalkeepers", eventId] });
      toast({ title: "Goalkeeper added 🧤" });
    },
    onError: (e: Error) => {
      toast({ title: e.message || "Failed to add goalkeeper", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("match_goalkeepers" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-goalkeepers", eventId] });
      toast({ title: "Goalkeeper removed" });
    },
  });

  const goingPlayers = (rsvps || []).filter((r) => r.status === "going");
  const goingChildren = goingPlayers.filter((r) => r.child_id);
  const goingMembers = goingPlayers.filter(
    (r) => !r.child_id && r.user_id && playerUserIds.includes(r.user_id)
  );

  const assignedUserIds = new Set(keepers.filter((k: any) => k.user_id).map((k: any) => k.user_id));
  const assignedChildIds = new Set(keepers.filter((k: any) => k.child_id).map((k: any) => k.child_id));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hand className="h-5 w-5 text-emerald-500" />
            Goalkeeper{keepers.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {keepers.length > 0 ? (
            <div className="space-y-2">
              {keepers.map((k: any) => (
                <div key={k.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 ring-2 ring-emerald-500">
                      {k.profiles?.avatar_url && <AvatarImage src={k.profiles.avatar_url} />}
                      <AvatarFallback className="bg-emerald-500/20 text-emerald-700">
                        {(k.profiles?.display_name || k.children?.name || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">
                        {k.profiles?.display_name || k.children?.name}
                      </span>
                      {k.child_id && <Badge variant="outline" className="text-xs">Child</Badge>}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive h-8 w-8"
                      onClick={() => removeMutation.mutate(k.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !isAdmin && (
              <p className="text-sm text-muted-foreground">No goalkeeper recorded</p>
            )
          )}
          {isAdmin && (
            <Button
              variant="outline"
              className="w-full border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10"
              onClick={() => setOpen(true)}
              disabled={goingPlayers.length === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {keepers.length > 0 ? "Add another goalkeeper" : "Mark goalkeeper"}
            </Button>
          )}
        </CardContent>
      </Card>

      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader className="text-left border-b pb-4">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Hand className="h-5 w-5 text-emerald-500" />
              Mark goalkeeper
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            <div className="p-4 space-y-2">
              <p className="text-sm text-muted-foreground mb-2">
                Pick the player(s) who played in goal during this match.
              </p>

              {goingMembers.map((rsvp: any) => {
                const already = assignedUserIds.has(rsvp.user_id);
                return (
                  <Button
                    key={rsvp.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={already || addMutation.isPending}
                    onClick={async () => {
                      await addMutation.mutateAsync({ userId: rsvp.user_id });
                    }}
                  >
                    <Avatar className="h-9 w-9 mr-3">
                      <AvatarImage src={rsvp.profiles?.avatar_url} />
                      <AvatarFallback>
                        {rsvp.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{rsvp.profiles?.display_name || "Unknown"}</span>
                    {already && <Badge className="ml-auto" variant="secondary">Added</Badge>}
                  </Button>
                );
              })}

              {goingChildren.map((rsvp: any) => {
                const already = assignedChildIds.has(rsvp.child_id);
                return (
                  <Button
                    key={rsvp.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={already || addMutation.isPending}
                    onClick={async () => {
                      await addMutation.mutateAsync({ childId: rsvp.child_id });
                    }}
                  >
                    <Avatar className="h-9 w-9 mr-3">
                      <AvatarFallback className="bg-secondary">
                        {rsvp.children?.name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{rsvp.children?.name || "Unknown"}</span>
                    <Badge variant="outline" className="ml-2 text-xs">Child</Badge>
                    {already && <Badge className="ml-auto" variant="secondary">Added</Badge>}
                  </Button>
                );
              })}

              {goingMembers.length === 0 && goingChildren.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No players RSVP'd as "Going" yet.
                </p>
              )}
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
