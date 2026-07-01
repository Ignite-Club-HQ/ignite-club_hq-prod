import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserPlus, Trash2, Shield, Check, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import AddClubRoleToMemberDialog from "@/components/AddClubRoleToMemberDialog";

type AppRole = "basic_user" | "club_admin" | "team_admin" | "coach" | "player" | "parent" | "app_admin" | "committee_member" | "league_admin" | "association_admin" | "competition_admin";

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  committee_member: "Committee Member",
  league_admin: "League Admin",
  association_admin: "Association Admin",
  competition_admin: "Competition Admin",
};

const roleColors: Record<AppRole, string> = {
  app_admin: "bg-red-500/20 text-red-400 border-red-500/30",
  club_admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  team_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  coach: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  player: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  basic_user: "bg-muted text-muted-foreground border-border",
  committee_member: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  league_admin: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  association_admin: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  competition_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const MEMBERS_PER_PAGE = 10;

export default function ManageRolesPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [displayCount, setDisplayCount] = useState(MEMBERS_PER_PAGE);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: club, isLoading: loadingClub } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: roles, isLoading: loadingRoles } = useQuery({
    queryKey: ["club-members-roles", clubId],
    queryFn: async () => {
      // First get team IDs for this club
      const { data: teamsData } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId!);
      const teamIds = teamsData?.map(t => t.id) || [];

      // Fetch club-level roles
      const { data: clubRoles, error: clubError } = await supabase
        .from("user_roles")
        .select("*, profiles (id, display_name, avatar_url), teams (id, name)")
        .eq("club_id", clubId!);
      if (clubError) throw clubError;

      // Fetch team-level roles for teams in this club
      let teamRoles: typeof clubRoles = [];
      if (teamIds.length > 0) {
        const { data: teamRolesData, error: teamError } = await supabase
          .from("user_roles")
          .select("*, profiles (id, display_name, avatar_url), teams (id, name)")
          .in("team_id", teamIds);
        if (teamError) throw teamError;
        teamRoles = teamRolesData || [];
      }

      // Combine and deduplicate by role id
      const allRoles = [...(clubRoles || []), ...(teamRoles || [])];
      const uniqueRoles = allRoles.filter((role, index, self) => 
        index === self.findIndex(r => r.id === role.id)
      );
      return uniqueRoles;
    },
    enabled: !!clubId,
    refetchOnMount: true,
  });

  const { data: requests } = useQuery({
    queryKey: ["club-role-requests", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_requests")
        .select("*")
        .eq("club_id", clubId!)
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
    enabled: !!clubId,
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async ({ roleId, userId, roleName, userName }: { roleId: string; userId: string; roleName: string; userName: string }) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
      if (error) throw error;
      
      // Send notification to the user about role removal
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: `Your ${roleName} role has been removed from ${club?.name || "the club"}`,
        related_id: clubId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-roles", clubId] });
      toast({ title: "Role removed" });
    },
  });

  const handleRequestMutation = useMutation({
    mutationFn: async ({ requestId, approved }: { 
      requestId: string; 
      approved: boolean;
      request: any;
    }) => {
      const rpcName = approved ? "approve_role_request" : "deny_role_request";
      const { error } = await supabase.rpc(rpcName, { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-role-requests", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-roles", clubId] });
      toast({ title: "Request processed" });
    },
    onError: (error: Error) => {
      const msg = error.message?.toLowerCase() || "";
      if (msg.includes("not authorized")) {
        toast({ title: "Permission denied", description: "You don't have permission to manage join requests. Only club admins can approve or deny requests.", variant: "destructive" });
      } else {
        toast({ title: "Something went wrong", description: "Failed to process the request. Please try again.", variant: "destructive" });
      }
    },
  });

  if (loadingClub) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!club) {
    return <div className="py-6 text-center text-muted-foreground">Club not found</div>;
  }

  // Group roles by user
  const userRoles = roles?.reduce((acc, role) => {
    const userId = role.profiles?.id;
    if (!userId) return acc;
    if (!acc[userId]) {
      acc[userId] = {
        profile: role.profiles,
        roles: [],
      };
    }
    acc[userId].roles.push(role);
    return acc;
  }, {} as Record<string, { profile: any; roles: any[] }>);

  const q = searchQuery.trim().toLowerCase();
  const filteredUserEntries = Object.entries(userRoles || {}).filter(([, { profile }]) =>
    !q || (profile?.display_name || "").toLowerCase().includes(q)
  );

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Manage Roles</h1>
          <p className="text-sm text-muted-foreground">{club.name}</p>
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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setDisplayCount(MEMBERS_PER_PAGE); }}
              placeholder="Search members..."
              className="pl-9"
            />
          </div>
          {loadingRoles ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredUserEntries.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{q ? "No members match your search" : "No members yet"}</p>
              </CardContent>
            </Card>
          ) : (
            <>
            {filteredUserEntries.slice(0, displayCount).map(([userId, { profile, roles: userRoleList }]) => (
              <Card key={userId}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={profile?.avatar_url || undefined} />
                      <AvatarFallback>{profile?.display_name?.charAt(0) || "?"}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium">{profile?.display_name}</p>
                      {userId === user?.id && (
                        <p className="text-xs text-muted-foreground">You</p>
                      )}
                    </div>
                    <AddClubRoleToMemberDialog
                      userId={userId}
                      userName={profile?.display_name || "User"}
                      clubId={clubId!}
                      clubName={club?.name || ""}
                      existingRoles={userRoleList}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {userRoleList.map((role) => {
                      const scopeName = role.teams?.name || (role.club_id ? club?.name : undefined);
                      return (
                      <div key={role.id} className="flex items-center gap-1">
                        <Badge className={`border ${roleColors[role.role as AppRole]}`} variant="outline">
                          {roleLabels[role.role as AppRole]}
                          {scopeName && ` • ${scopeName}`}
                        </Badge>
                        {/* Can't remove own admin role */}
                        {!(userId === user?.id && (role.role === "club_admin" || role.role === "team_admin")) && (
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
                                  Remove {roleLabels[role.role as AppRole]} role from {profile?.display_name}?
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
                    );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredUserEntries.length > displayCount && (
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setDisplayCount(prev => prev + MEMBERS_PER_PAGE)}
              >
                Show more ({filteredUserEntries.length - displayCount} remaining)
              </Button>
            )}
            </>
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
                      <AvatarFallback>
                        {request.requester?.display_name?.charAt(0) || "?"}
                      </AvatarFallback>
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
                      onClick={() => handleRequestMutation.mutate({ 
                        requestId: request.id, 
                        approved: true,
                        request 
                      })}
                      disabled={handleRequestMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleRequestMutation.mutate({ 
                        requestId: request.id, 
                        approved: false,
                        request 
                      })}
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
