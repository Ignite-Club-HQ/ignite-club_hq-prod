import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, Loader2, BellOff, VolumeOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";


interface ChatMembersSheetProps {
  chatType: "team" | "club" | "group";
  chatId: string;
  chatName: string;
  teamId?: string;
  clubId?: string;
  groupAllowedRoles?: string[];
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
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
  groupAllowedRoles,
  externalOpen,
  onExternalOpenChange,
}: ChatMembersSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onExternalOpenChange || setInternalOpen;
  const queryClient = useQueryClient();
  const previousCountRef = useRef<number | null>(null);
  const cacheKey = `chat-members-count-${chatType}-${chatId}`;

  // Check if this is a personal group (no team_id or club_id)
  const isPersonalGroup = chatType === "group" && !teamId && !clubId;

  // Fetch members based on chat type
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["chat-members", chatType, chatId, teamId, clubId],
    queryFn: async () => {
      // For personal groups, fetch from group_members table
      if (chatType === "group" && !teamId && !clubId) {
        const { data: groupMembers, error } = await supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", chatId);
        
        if (error || !groupMembers?.length) return [];
        
        const userIds = groupMembers.map(gm => gm.user_id);
        
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        
        return (profiles || []).map(p => ({
          id: p.id,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          role: undefined,
        })) as Member[];
      }
      
      // For team/club groups, use role-based membership
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

      const userIds = [...new Set(roles.map(r => r.user_id))] as string[];
      
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
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
    staleTime: 1000 * 60 * 5,
  });

  // Deduplicate members by id
  const uniqueMembers = members?.reduce((acc, member) => {
    if (!acc.find(m => m.id === member.id)) {
      acc.push(member);
    }
    return acc;
  }, [] as Member[]) || [];

  const memberIds = useMemo(() => uniqueMembers.map(m => m.id), [uniqueMembers]);

  // Fetch notification preferences (push messages_enabled) for all members
  // Uses security definer RPC to bypass RLS (users can only read their own prefs)
  const { data: notifPrefs } = useQuery({
    queryKey: ["chat-members-notif-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data, error } = await supabase
        .rpc("get_members_messages_enabled", { member_ids: memberIds });
      
      if (error) console.error("[ChatMembers] notif prefs RPC error:", error);
      
      // Build map: true = enabled, false = disabled, missing = no prefs row
      const map: Record<string, boolean> = {};
      const returnedIds = new Set<string>();
      for (const row of data || []) {
        map[row.user_id] = row.messages_enabled;
        returnedIds.add(row.user_id);
      }
      // Members with NO notification_preferences row → treat as not configured (disabled)
      for (const id of memberIds) {
        if (!returnedIds.has(id)) {
          map[id] = false;
        }
      }
      return map;
    },
    enabled: open && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Fetch chat mute preferences for this specific chat
  const { data: mutePrefs } = useQuery({
    queryKey: ["chat-members-mute-prefs", chatType, chatId, memberIds],
    queryFn: async () => {
      if (memberIds.length === 0) return {};
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("user_id, muted_until")
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .in("user_id", memberIds);
      
      const now = new Date();
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        // Muted if muted_until is null (indefinite) or in the future
        const isMuted = !row.muted_until || new Date(row.muted_until) > now;
        if (isMuted) {
          map[row.user_id] = true;
        }
      }
      return map;
    },
    enabled: open && memberIds.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  const formatRole = (role: string) => {
    return role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  };

  // Check if member count decreased and trigger refresh
  useEffect(() => {
    if (!membersLoading && uniqueMembers.length > 0) {
      const storedCount = localStorage.getItem(cacheKey);
      const previousCount = storedCount ? parseInt(storedCount, 10) : null;
      
      if (previousCount !== null && uniqueMembers.length < previousCount) {
        queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
      }
      
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
                    {(() => { console.log('[ChatMembers] Rendering members:', uniqueMembers.length, 'notifPrefs:', JSON.stringify(notifPrefs), 'mutePrefs:', JSON.stringify(mutePrefs)); return null; })()}
                    {uniqueMembers.map((member) => {
                      const pushDisabled = notifPrefs ? (notifPrefs[member.id] === false) : false;
                      const chatMuted = mutePrefs?.[member.id] ?? false;

                      return (
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
                          {pushDisabled && (
                            <svg style={{ marginLeft: 4, flexShrink: 0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 1 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                          )}
                          {chatMuted && (
                            <svg style={{ marginLeft: 2, flexShrink: 0 }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A.7.7 0 0 1 5.9 7.8H4a1 1 0 0 0-1 1v6.4a1 1 0 0 0 1 1h1.9a.7.7 0 0 1 .513.213l3.384 3.383A.705.705 0 0 0 11 19.298z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}