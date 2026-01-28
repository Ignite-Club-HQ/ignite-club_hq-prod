import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, UserPlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AddDutySheet } from "@/components/AddDutySheet";
import { AssignDutySheet } from "@/components/AssignDutySheet";

interface GroupDuty {
  id: string;
  name: string;
  assigned_to: string | null;
  status: "pending" | "confirmed" | "completed";
  points: number;
  assignee?: { display_name: string } | null;
}

interface MatchDutiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  miniLeagueId: string;
}

export function MatchDutiesDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
  miniLeagueId,
}: MatchDutiesDialogProps) {
  const queryClient = useQueryClient();
  const [isDutySheetOpen, setIsDutySheetOpen] = useState(false);
  const [assignDutyOpen, setAssignDutyOpen] = useState(false);
  const [selectedDuty, setSelectedDuty] = useState<GroupDuty | null>(null);

  // Fetch group duties
  const { data: duties, isLoading: dutiesLoading } = useQuery({
    queryKey: ["event-group-duties", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_group_duties")
        .select("*, assignee:profiles!event_group_duties_assigned_to_fkey(display_name)")
        .eq("group_id", groupId)
        .order("created_at");
      if (error) throw error;
      return data as GroupDuty[];
    },
    enabled: open && !!groupId,
  });

  // Fetch league members for duty assignment (parents, admins, coaches - not players)
  const { data: leagueMembers } = useQuery({
    queryKey: ["mini-league-duty-assignees", miniLeagueId],
    queryFn: async () => {
      // Get mini league to find the club_id
      const { data: league, error: leagueError } = await supabase
        .from("mini_leagues")
        .select("club_id")
        .eq("id", miniLeagueId)
        .single();
      if (leagueError) throw leagueError;
      
      // Get all parent user IDs from mini league players
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", miniLeagueId)
        .not("parent_user_id", "is", null);
      if (playersError) throw playersError;
      
      const parentIds = [...new Set(playersData?.map(p => p.parent_user_id).filter(Boolean) as string[])];
      
      // Get club admins and league admins (coaches) from user_roles
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", league.club_id)
        .in("role", ["club_admin", "league_admin"]);
      if (rolesError) throw rolesError;
      
      const adminIds = adminRoles?.map(r => r.user_id) || [];
      
      // Combine all unique IDs
      const allUserIds = [...new Set([...parentIds, ...adminIds])];
      if (!allUserIds.length) return [];
      
      // Fetch profiles for all these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", allUserIds)
        .order("display_name");
      if (profilesError) throw profilesError;
      
      return profiles || [];
    },
    enabled: open && !!miniLeagueId,
  });

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("event_group_duties").insert({
        group_id: groupId,
        name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      setIsDutySheetOpen(false);
      toast.success("Duty added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Assign duty mutation
  const assignDutyMutation = useMutation({
    mutationFn: async ({ dutyId, assignedTo }: { dutyId: string; assignedTo: string | null }) => {
      const { error } = await supabase
        .from("event_group_duties")
        .update({ assigned_to: assignedTo, status: assignedTo ? "confirmed" : "pending" })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      toast.success("Duty updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete duty mutation
  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase.from("event_group_duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      toast.success("Duty removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{groupName} Duties</DialogTitle>
            <DialogDescription>
              Manage duties for this match
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-2">
            {dutiesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : duties?.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-4">No duties assigned yet</p>
                <Button variant="outline" onClick={() => setIsDutySheetOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Duty
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {duties?.map((duty) => (
                  <div 
                    key={duty.id} 
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        duty.status === "completed" ? "bg-green-500" :
                        duty.status === "confirmed" ? "bg-primary" : "bg-muted-foreground"
                      }`} />
                      <div>
                        <p className="font-medium text-sm">{duty.name}</p>
                        {duty.assignee?.display_name && (
                          <p className="text-xs text-muted-foreground">
                            {duty.assignee.display_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setSelectedDuty(duty);
                          setAssignDutyOpen(true);
                        }}
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteDutyMutation.mutate(duty.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(duties?.length ?? 0) > 0 && (
            <div className="pt-2 border-t">
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setIsDutySheetOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Duty
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Duty Sheet */}
      <AddDutySheet
        open={isDutySheetOpen}
        onOpenChange={setIsDutySheetOpen}
        onAddDuty={(dutyName) => addDutyMutation.mutate(dutyName)}
        isPending={addDutyMutation.isPending}
        isMiniLeague={true}
        context="match"
      />

      {/* Assign Duty Sheet */}
      {selectedDuty && (
        <AssignDutySheet
          open={assignDutyOpen}
          onOpenChange={(open) => {
            setAssignDutyOpen(open);
            if (!open) setSelectedDuty(null);
          }}
          dutyName={selectedDuty.name}
          currentAssignee={selectedDuty.assigned_to}
          members={(leagueMembers || []).map(m => ({
            id: m.id,
            display_name: m.display_name,
            avatar_url: m.avatar_url,
          }))}
          onAssign={(userId) => {
            assignDutyMutation.mutate({
              dutyId: selectedDuty.id,
              assignedTo: userId,
            });
            setAssignDutyOpen(false);
            setSelectedDuty(null);
          }}
          isPending={assignDutyMutation.isPending}
        />
      )}
    </>
  );
}
