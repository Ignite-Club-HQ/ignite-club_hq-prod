import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, UserPlus, Loader2, Check, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface Child {
  id: string;
  name: string;
  year_of_birth: number | null;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  club_id: string;
  clubs: { name: string } | null;
}

interface ChildAssignment {
  id: string;
  team_id: string;
  teams: { id: string; name: string; clubs: { name: string } | null } | null;
}

export default function ChildrenPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [deleteChildId, setDeleteChildId] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [newChildName, setNewChildName] = useState("");
  const [newChildYear, setNewChildYear] = useState("");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [filterClubId, setFilterClubId] = useState<string>("");

  // Fetch children
  const { data: children, isLoading: loadingChildren } = useQuery({
    queryKey: ["children", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("children")
        .select("*")
        .eq("parent_id", user!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Child[];
    },
    enabled: !!user,
  });

  // Fetch team assignments for all children
  const { data: assignments } = useQuery({
    queryKey: ["child_assignments", user?.id],
    queryFn: async () => {
      if (!children?.length) return [];
      const { data, error } = await supabase
        .from("child_team_assignments")
        .select("*, teams(id, name, clubs(name))")
        .in("child_id", children.map(c => c.id));
      if (error) throw error;
      return data as (ChildAssignment & { child_id: string })[];
    },
    enabled: !!children?.length,
  });

  // Fetch available teams (teams user is a member of)
  const { data: availableTeams } = useQuery({
    queryKey: ["user_teams_for_children", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("team_id, teams(id, name, club_id, clubs(name))")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);
      if (error) throw error;
      const teams = data
        .filter(r => r.teams)
        .map(r => r.teams as Team & { clubs: { name: string } | null });
      // Deduplicate
      const uniqueTeams = Array.from(new Map(teams.map(t => [t.id, t])).values());
      return uniqueTeams;
    },
    enabled: !!user,
  });

  // Derive available clubs from available teams
  const availableClubs = availableTeams
    ? Array.from(
        new Map(
          availableTeams
            .filter(t => t.club_id && t.clubs)
            .map(t => [t.club_id, { id: t.club_id, name: t.clubs!.name }])
        ).values()
      )
    : [];

  // Add child mutation
  const addChild = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("children").insert({
        parent_id: user!.id,
        name: newChildName.trim(),
        year_of_birth: newChildYear ? parseInt(newChildYear) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["children"] });
      setAddDialogOpen(false);
      setNewChildName("");
      setNewChildYear("");
      toast({ title: "Child added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add child", variant: "destructive" });
    },
  });

  // Delete child mutation
  const deleteChild = useMutation({
    mutationFn: async (childId: string) => {
      const { error } = await supabase
        .from("children")
        .delete()
        .eq("id", childId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["children"] });
      queryClient.invalidateQueries({ queryKey: ["child_assignments"] });
      setDeleteChildId(null);
      toast({ title: "Child removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove child", variant: "destructive" });
    },
  });

  // Assign to teams mutation (supports multiple teams)
  const assignToTeams = useMutation({
    mutationFn: async () => {
      if (!selectedChild || selectedTeamIds.length === 0) return;
      const insertData = selectedTeamIds.map(teamId => ({
        child_id: selectedChild.id,
        team_id: teamId,
      }));
      const { error } = await supabase.from("child_team_assignments").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_assignments"] });
      setAssignDialogOpen(false);
      setSelectedChild(null);
      setSelectedTeamIds([]);
      setFilterClubId("");
      const count = selectedTeamIds.length;
      toast({ title: `Child assigned to ${count} team${count > 1 ? 's' : ''}` });
    },
    onError: () => {
      toast({ title: "Failed to assign child", variant: "destructive" });
    },
  });

  // Remove from team mutation
  const removeFromTeam = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from("child_team_assignments")
        .delete()
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_assignments"] });
      toast({ title: "Removed from team" });
    },
    onError: () => {
      toast({ title: "Failed to remove from team", variant: "destructive" });
    },
  });

  const getChildAssignments = (childId: string) => {
    return assignments?.filter(a => a.child_id === childId) || [];
  };

  const getUnassignedTeams = (childId: string) => {
    const assigned = getChildAssignments(childId).map(a => a.team_id);
    let teams = availableTeams?.filter(t => !assigned.includes(t.id)) || [];
    // Filter by club if a filter is selected
    if (filterClubId) {
      teams = teams.filter(t => t.club_id === filterClubId);
    }
    return teams;
  };

  if (loadingChildren) {
    return (
      <div className="py-6 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading children...</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold flex-1">My Children</h1>
        <Button size="sm" onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Child
        </Button>
        <ResponsiveDialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Add Child</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={newChildName}
                  onChange={(e) => setNewChildName(e.target.value)}
                  placeholder="Enter child's name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="year">Year of Birth (optional)</Label>
                <Input
                  id="year"
                  type="number"
                  value={newChildYear}
                  onChange={(e) => setNewChildYear(e.target.value)}
                  placeholder="e.g. 2015"
                  min="2000"
                  max={new Date().getFullYear()}
                />
              </div>
            </div>
            <ResponsiveDialogFooter className="mt-4">
              <Button
                className="w-full"
                onClick={() => addChild.mutate()}
                disabled={!newChildName.trim() || addChild.isPending}
              >
                {addChild.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Add Child
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>

      {!children?.length ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No children added yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add your children to RSVP on their behalf and assign them to teams.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {children.map((child) => {
            const childAssignments = getChildAssignments(child.id);
            const unassignedTeams = availableTeams?.filter(t => !childAssignments.some(a => a.team_id === t.id)) || [];

            return (
              <Card key={child.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{child.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {unassignedTeams.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedChild(child);
                            setAssignDialogOpen(true);
                          }}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteChildId(child.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {child.year_of_birth && (
                    <p className="text-sm text-muted-foreground">
                      Born {child.year_of_birth}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  {childAssignments.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Teams:</p>
                      <div className="flex flex-wrap gap-2">
                        {childAssignments.map((assignment) => (
                          <Badge
                            key={assignment.id}
                            variant="secondary"
                            className="flex items-center gap-1"
                          >
                            {assignment.teams?.name}
                            <button
                              onClick={() => removeFromTeam.mutate(assignment.id)}
                              className="ml-1 hover:text-destructive"
                            >
                              ×
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Not assigned to any teams
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Assign to Teams Dialog */}
      <ResponsiveDialog 
        open={assignDialogOpen} 
        onOpenChange={(open) => {
          setAssignDialogOpen(open);
          if (!open) {
            setFilterClubId("");
            setSelectedTeamIds([]);
          }
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Assign {selectedChild?.name} to Team</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-2">
            {/* Club Filter */}
            {availableClubs.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm">Filter by Club</Label>
                <Select
                  value={filterClubId || "__all__"}
                  onValueChange={(value) => {
                    setFilterClubId(value === "__all__" ? "" : value);
                    setSelectedTeamIds([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All clubs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All clubs</SelectItem>
                    {availableClubs.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Select teams to assign your child:</Label>
              {selectedTeamIds.length > 0 && (
                <span className="text-sm text-primary font-medium">{selectedTeamIds.length} selected</span>
              )}
            </div>
            <ScrollArea className="max-h-[40vh]">
              <div className="space-y-2 pr-2">
                {selectedChild &&
                  getUnassignedTeams(selectedChild.id).map((team) => {
                    const isSelected = selectedTeamIds.includes(team.id);
                    return (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => {
                          setSelectedTeamIds(prev => 
                            isSelected 
                              ? prev.filter(id => id !== team.id)
                              : [...prev, team.id]
                          );
                        }}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50 hover:bg-accent"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{team.name}</p>
                            <p className="text-sm text-muted-foreground truncate">
                              {team.clubs?.name || "Unknown Club"}
                            </p>
                          </div>
                          {isSelected ? (
                            <CheckSquare className="h-5 w-5 text-primary flex-shrink-0 ml-2" />
                          ) : (
                            <Square className="h-5 w-5 text-muted-foreground flex-shrink-0 ml-2" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                {selectedChild && getUnassignedTeams(selectedChild.id).length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No available teams to assign.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
          <ResponsiveDialogFooter className="mt-4">
            <Button
              className="w-full"
              onClick={() => assignToTeams.mutate()}
              disabled={selectedTeamIds.length === 0 || assignToTeams.isPending}
            >
              {assignToTeams.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Assign to {selectedTeamIds.length > 1 ? `${selectedTeamIds.length} Teams` : "Team"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteChildId} onOpenChange={() => setDeleteChildId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Child?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the child and all their team assignments. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteChildId && deleteChild.mutate(deleteChildId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
