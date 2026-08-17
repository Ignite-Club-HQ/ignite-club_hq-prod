import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserPlus, Trash2, Shield, Check, X, RotateCcw, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

type AppRole = "basic_user" | "club_admin" | "team_admin" | "coach" | "player" | "parent" | "app_admin";

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
};

const roleColors: Record<AppRole, string> = {
  basic_user: "bg-muted text-muted-foreground",
  club_admin: "bg-primary/20 text-primary",
  team_admin: "bg-primary/20 text-primary",
  coach: "bg-blue-500/20 text-blue-500",
  player: "bg-green-500/20 text-green-500",
  parent: "bg-yellow-500/20 text-yellow-500",
  app_admin: "bg-destructive/20 text-destructive",
};

export default function ManageTeamRolesPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: team, isLoading: loadingTeam, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (name, bot_user_id)")
        .eq("id", teamId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: roles, isLoading: loadingRoles } = useQuery({
    queryKey: ["team-roles", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*, profiles (id, display_name, avatar_url)")
        .eq("team_id", teamId!);
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: requests } = useQuery({
    queryKey: ["team-role-requests", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_requests")
        .select("*")
        .eq("team_id", teamId!)
        .eq("status", "pending");
      if (error) throw error;
      
      // Fetch profiles separately
      if (!data || data.length === 0) return [];
      const userIds = data.map(r => r.user_id);
      const { data: profiles } = await selectCachedProfilesByIds(userIds);
      
      return data.map(req => ({
        ...req,
        requester: profiles?.find(p => p.id === req.user_id) || null
      }));
    },
    enabled: !!teamId,
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async ({ roleId, userId, roleName, userName }: { roleId: string; userId: string; roleName: string; userName: string }) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;
      
      // Send notification to the user about role removal
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: `Your ${roleName} role has been removed from ${team?.name || "the team"}`,
        related_id: teamId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      toast({ title: "Role removed" });
    },
  });

  const resetPointsMutation = useMutation({
    mutationFn: async (userId: string) => {
      // Per-club balance: only reset points for THIS team's club.
      const { data: t } = await supabase
        .from("teams").select("club_id").eq("id", teamId!).maybeSingle();
      const clubId = (t as any)?.club_id;
      if (!clubId) throw new Error("Team has no club");
      const { data: row } = await supabase
        .from("user_club_points")
        .select("points").eq("user_id", userId).eq("club_id", clubId).maybeSingle();
      const currentPoints = row?.points || 0;
      if (currentPoints > 0) {
        const { error } = await (supabase.rpc as any)('increment_ignite_points', {
          _user_id: userId,
          _amount: -currentPoints,
          _club_id: clubId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      toast({ title: "Points reset to 0" });
    },
  });

  const handleRequestMutation = useMutation({
    mutationFn: async ({ requestId, approved }: { requestId: string; approved: boolean; request: any }) => {
      const rpcName = approved ? "approve_role_request" : "deny_role_request";
      const { error } = await supabase.rpc(rpcName, { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-role-requests", teamId] });
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      toast({ title: "Request processed" });
    },
    onError: (error: Error) => {
      const msg = error.message?.toLowerCase() || "";
      if (msg.includes("not authorized")) {
        toast({ title: "Permission denied", description: "You don't have permission to manage join requests. Only team admins, coaches, and club admins can approve or deny requests.", variant: "destructive" });
      } else {
        toast({ title: "Something went wrong", description: "Failed to process the request. Please try again.", variant: "destructive" });
      }
    },
  });

  if (loadingTeam || (teamFetchStatus === "paused" && !team)) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!team) {
    return <div className="py-6 text-center text-muted-foreground">Team not found</div>;
  }

  // Exclude the club's broadcast/bot account from the member list
  const botUserId = (team as any)?.clubs?.bot_user_id ?? null;

  const userRoles = roles?.reduce((acc, role) => {
    const userId = role.profiles?.id;
    if (!userId || userId === botUserId) return acc;
    if (!acc[userId]) {
      acc[userId] = { profile: role.profiles, roles: [] };
    }
    acc[userId].roles.push(role);
    return acc;
  }, {} as Record<string, { profile: any; roles: any[] }>);

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Manage Roles</h1>
          <p className="text-sm text-muted-foreground">{team.name}</p>
        </div>
      </div>

      <Tabs defaultValue="members">
        <TabsList className="w-full">
          <TabsTrigger value="members" className="flex-1">Members</TabsTrigger>
          <TabsTrigger value="requests" className="flex-1 relative">
            Requests
            {requests && requests.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-destructive-foreground">
                {requests.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4 space-y-4">
          {loadingRoles ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : Object.keys(userRoles || {}).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No members yet</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(userRoles || {}).map(([userId, { profile, roles: userRoleList }]) => (
              <Card key={userId}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={profile?.avatar_url || undefined} />
                      <AvatarFallback>{profile?.display_name?.charAt(0) || "?"}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium">{profile?.display_name}</p>
                      {userId === user?.id && <p className="text-xs text-muted-foreground">You</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {userRoleList.map((role) => (
                      <div key={role.id} className="flex items-center gap-1">
                        <Badge className={roleColors[role.role as AppRole]} variant="secondary">
                          {roleLabels[role.role as AppRole]}
                        </Badge>
                        {!(userId === user?.id && role.role === "team_admin" && userRoleList.length <= 1) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Role?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Remove {roleLabels[role.role as AppRole]} from {profile?.display_name}?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteRoleMutation.mutate({
                                    roleId: role.id,
                                    userId,
                                    roleName: roleLabels[role.role as AppRole],
                                    userName: profile?.display_name || "User"
                                  })}
                                  className="bg-destructive text-destructive-foreground"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    ))}
                    {/* Reset Points Button */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1">
                          <RotateCcw className="h-3 w-3" />
                          <Flame className="h-3 w-3" />
                          Reset Points
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reset Points?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will reset {profile?.display_name}'s points to 0 and remove any earned rewards.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => resetPointsMutation.mutate(userId)}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Reset Points
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="requests" className="mt-4 space-y-4">
          {requests?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <UserPlus className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pending requests</p>
              </CardContent>
            </Card>
          ) : (
            requests?.map((request) => (
              <Card key={request.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={request.requester?.avatar_url || undefined} />
                      <AvatarFallback>{request.requester?.display_name?.charAt(0) || "?"}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium">{request.requester?.display_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Wants to be: {roleLabels[request.role as AppRole]}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleRequestMutation.mutate({ requestId: request.id, approved: true, request })}
                      disabled={handleRequestMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleRequestMutation.mutate({ requestId: request.id, approved: false, request })}
                      disabled={handleRequestMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-1" /> Deny
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
