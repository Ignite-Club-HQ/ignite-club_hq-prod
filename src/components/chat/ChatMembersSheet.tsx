import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChatMembersSheetProps {
  chatType: "team" | "club" | "group";
  chatId: string;
  chatName: string;
  teamId?: string;
  clubId?: string;
  groupAllowedRoles?: string[];
}

interface Member {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role?: string;
}

export function ChatMembersSheet({ 
  chatType, 
  chatId, 
  chatName,
  teamId,
  clubId,
  groupAllowedRoles 
}: ChatMembersSheetProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const previousCountRef = useRef<number | null>(null);
  const cacheKey = `chat-members-count-${chatType}-${chatId}`;

  // Fetch members based on chat type - exclude avatar_url initially for speed
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["chat-members", chatType, chatId],
    queryFn: async () => {
      // First, get user_ids and roles quickly (no avatar)
      let roleQuery;
      
      if (chatType === "team") {
        roleQuery = supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("team_id", chatId);
      } else if (chatType === "club") {
        roleQuery = supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("club_id", chatId);
      } else if (chatType === "group") {
        if (teamId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("team_id", teamId)
            .in("role", (groupAllowedRoles || []) as ("app_admin" | "basic_user" | "club_admin" | "coach" | "parent" | "player" | "team_admin")[]);
        } else if (clubId) {
          roleQuery = supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("club_id", clubId)
            .in("role", (groupAllowedRoles || []) as ("app_admin" | "basic_user" | "club_admin" | "coach" | "parent" | "player" | "team_admin")[]);
        } else {
          return [];
        }
      } else {
        return [];
      }

      const { data: roles } = await roleQuery;
      if (!roles?.length) return [];

      // Get unique user_ids
      const userIds = [...new Set(roles.map(r => r.user_id))] as string[];
      
      // Fetch profiles separately - only id and display_name (fast)
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Build unique members with roles
      const memberMap = new Map<string, Member>();
      for (const r of roles) {
        if (!memberMap.has(r.user_id)) {
          const profile = profileMap.get(r.user_id);
          memberMap.set(r.user_id, {
            id: r.user_id,
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
            role: r.role,
          });
        }
      }
      
      return Array.from(memberMap.values());
    },
    enabled: open,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const formatRole = (role: string) => {
    return role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  };

  // Deduplicate members by id
  const uniqueMembers = members?.reduce((acc, member) => {
    if (!acc.find(m => m.id === member.id)) {
      acc.push(member);
    }
    return acc;
  }, [] as Member[]) || [];

  // Check if member count decreased and trigger refresh
  useEffect(() => {
    if (!membersLoading && uniqueMembers.length > 0) {
      const storedCount = localStorage.getItem(cacheKey);
      const previousCount = storedCount ? parseInt(storedCount, 10) : null;
      
      if (previousCount !== null && uniqueMembers.length < previousCount) {
        // Member count decreased, refetch to ensure we have latest data
        queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      }
      
      // Update stored count
      localStorage.setItem(cacheKey, uniqueMembers.length.toString());
      previousCountRef.current = uniqueMembers.length;
    }
  }, [uniqueMembers.length, membersLoading, cacheKey, queryClient, chatType, chatId]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          title="View members"
        >
          <Users className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>{chatName}</SheetTitle>
        </SheetHeader>
        
        <div className="mt-6">
          {/* Members List */}
          <div>
            <h3 className="text-sm font-medium mb-3">
              Members {uniqueMembers.length > 0 && `(${uniqueMembers.length})`}
            </h3>
            <ScrollArea className="h-[calc(100vh-180px)]">
              {membersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : uniqueMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No members found
                </p>
              ) : (
                <div className="space-y-2">
                  {uniqueMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={member.avatar_url || undefined} />
                        <AvatarFallback>
                          {member.display_name?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {member.display_name || "Unknown"}
                        </p>
                        {member.role && (
                          <p className="text-xs text-muted-foreground">
                            {formatRole(member.role)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
