import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, MessageCircle, Loader2, Crown, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface DMableUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  shared_clubs: string[];
}

export function StartDMDialog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Check if user has Pro access for DMs
  const { data: hasProAccess, isLoading: checkingPro } = useQuery({
    queryKey: ["has-pro-for-dm", user?.id],
    queryFn: async () => {
      // Get clubs user is a member of
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!roles?.length) return false;

      const clubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))];

      // Check if any of these clubs have Pro
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", clubIds);

      return subs?.some(sub => 
        (sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override) && 
        (!sub.expires_at || new Date(sub.expires_at) > new Date())
      ) ?? false;
    },
    enabled: !!user && open,
  });

  // Fetch users that can be DMed (members of shared Pro clubs)
  const { data: dmableUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ["dmable-users", user?.id],
    queryFn: async () => {
      // Get Pro clubs user is a member of
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .not("club_id", "is", null);

      if (!userRoles?.length) return [];

      const clubIds = [...new Set(userRoles.map(r => r.club_id).filter(Boolean))] as string[];

      // Filter to Pro clubs only
      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or("is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true");

      const proClubIds = proClubs?.map(c => c.club_id) || [];
      if (proClubIds.length === 0) return [];

      // Get club names for display
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", proClubIds);

      const clubNameMap = new Map(clubs?.map(c => [c.id, c.name]) || []);

      // Get all members of these Pro clubs
      const { data: clubMembers } = await supabase
        .from("user_roles")
        .select("user_id, club_id")
        .in("club_id", proClubIds)
        .neq("user_id", user!.id);

      if (!clubMembers?.length) return [];

      // Group by user and collect their shared clubs
      const userClubMap = new Map<string, string[]>();
      clubMembers.forEach((member: { user_id: string; club_id: string }) => {
        if (!userClubMap.has(member.user_id)) {
          userClubMap.set(member.user_id, []);
        }
        const clubName = clubNameMap.get(member.club_id);
        if (clubName && !userClubMap.get(member.user_id)!.includes(clubName)) {
          userClubMap.get(member.user_id)!.push(clubName);
        }
      });

      const uniqueUserIds = [...userClubMap.keys()];

      // Fetch profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", uniqueUserIds);

      return (profiles || []).map(p => ({
        ...p,
        shared_clubs: userClubMap.get(p.id) || [],
      })) as DMableUser[];
    },
    enabled: !!user && open && hasProAccess === true,
  });

  // Start DM mutation
  const startDMMutation = useMutation({
    mutationFn: async (otherUserId: string) => {
      const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
        other_user_id: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (conversationId) => {
      setOpen(false);
      navigate(`/messages/dm/${conversationId}`);
    },
    onError: (error) => {
      toast.error("Failed to start conversation: " + error.message);
    },
  });

  // Filter users by search query
  const filteredUsers = useMemo(() => {
    if (!dmableUsers) return [];
    if (!searchQuery.trim()) return dmableUsers;
    
    const query = searchQuery.toLowerCase();
    return dmableUsers.filter(u => 
      u.display_name?.toLowerCase().includes(query) ||
      u.shared_clubs.some(c => c.toLowerCase().includes(query))
    );
  }, [dmableUsers, searchQuery]);

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <MessageCircle className="h-4 w-4" />
        <span className="hidden sm:inline">New DM</span>
      </Button>

      <ResponsiveDialogContent fullScreen className="sm:max-w-md sm:max-h-[85vh] flex flex-col p-0">
        <ResponsiveDialogHeader className="p-4 pb-2 border-b sm:border-b-0">
          <ResponsiveDialogTitle className="flex items-center gap-2">
            Start a Direct Message
            <Badge variant="secondary" className="gap-1">
              <Crown className="h-3 w-3" />
              Pro
            </Badge>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Message members from your Pro clubs
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 flex flex-col min-h-0 px-4 pb-4">
          {checkingPro || loadingUsers ? (
            <div className="flex justify-center py-8 flex-1 items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasProAccess ? (
            <div className="flex flex-col items-center py-8 text-center gap-3 flex-1 justify-center">
              <div className="p-3 rounded-full bg-muted">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Pro Feature</p>
                <p className="text-sm text-muted-foreground">
                  Direct messages require you to be a member of a Pro club
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="flex-1 -mx-4 px-4">
                <div className="space-y-1">
                  {filteredUsers.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {searchQuery ? "No members found" : "No members available to message"}
                    </div>
                  ) : (
                    filteredUsers.map((dmUser) => (
                      <button
                        key={dmUser.id}
                        onClick={() => startDMMutation.mutate(dmUser.id)}
                        disabled={startDMMutation.isPending}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={dmUser.avatar_url || undefined} />
                          <AvatarFallback>
                            {dmUser.display_name?.charAt(0).toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {dmUser.display_name || "Unknown User"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {dmUser.shared_clubs.join(", ")}
                          </p>
                        </div>
                        {startDMMutation.isPending && startDMMutation.variables === dmUser.id && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
