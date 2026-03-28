import { memo, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ReaderInfo } from "@/hooks/useMessageReads";

interface ReadReceiptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readers: ReaderInfo[];
  messageId: string;
  messageType: "team" | "club" | "broadcast" | "group" | "dm";
  contextId: string; // teamId, clubId, groupId, conversationId
  currentUserId?: string;
}

interface MemberInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export const ReadReceiptSheet = memo(function ReadReceiptSheet({
  open,
  onOpenChange,
  readers,
  messageId,
  messageType,
  contextId,
  currentUserId,
}: ReadReceiptSheetProps) {
  const [allMembers, setAllMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !contextId || messageType === "dm") return;

    const fetchMembers = async () => {
      setLoading(true);
      try {
        let userIds: string[] = [];

        if (messageType === "team") {
          const { data } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", contextId);
          userIds = [...new Set((data || []).map((r) => r.user_id))];
        } else if (messageType === "club") {
          const { data } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", contextId);
          userIds = [...new Set((data || []).map((r) => r.user_id))];
        } else if (messageType === "group") {
          // Group members from group_members table + role-based members
          const { data: gmData } = await supabase
            .from("group_members")
            .select("user_id")
            .eq("group_id", contextId);
          
          // Also get chat_group info for role-based members
          const { data: groupInfo } = await supabase
            .from("chat_groups")
            .select("club_id, team_id, allowed_roles")
            .eq("id", contextId)
            .maybeSingle();

          const memberIds = new Set((gmData || []).map((r) => r.user_id));

          if (groupInfo?.club_id && groupInfo?.allowed_roles?.length) {
            const { data: roleData } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("club_id", groupInfo.club_id)
              .in("role", groupInfo.allowed_roles);
            for (const r of roleData || []) memberIds.add(r.user_id);
          }
          if (groupInfo?.team_id && groupInfo?.allowed_roles?.length) {
            const { data: roleData } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("team_id", groupInfo.team_id)
              .in("role", groupInfo.allowed_roles);
            for (const r of roleData || []) memberIds.add(r.user_id);
          }

          userIds = [...memberIds];
        } else if (messageType === "broadcast") {
          // For broadcast, just show readers (too many potential members)
          setAllMembers([]);
          setLoading(false);
          return;
        }

        // Remove current user from the list
        userIds = userIds.filter((id) => id !== currentUserId);

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, display_name, avatar_url")
            .in("id", userIds);

          setAllMembers(
            (profiles || []).map((p) => ({
              user_id: p.id,
              display_name: p.display_name,
              avatar_url: p.avatar_url,
            }))
          );
        }
      } catch (err) {
        console.error("Error fetching members for read receipts:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMembers();
  }, [open, contextId, messageType, currentUserId]);

  const readerIds = new Set(readers.map((r) => r.user_id));
  
  // For DMs, just show the readers
  const isDm = messageType === "dm";
  
  const readMembers = isDm
    ? readers
    : allMembers.filter((m) => readerIds.has(m.user_id));
  
  const unreadMembers = isDm
    ? []
    : allMembers.filter((m) => !readerIds.has(m.user_id));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base">Message Read By</SheetTitle>
        </SheetHeader>

        <div className="overflow-y-auto max-h-[55vh] space-y-4">
          {/* Read section */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
              <Eye className="h-3.5 w-3.5" />
              <span>Read ({readMembers.length})</span>
            </div>
            {readMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-5">No one has read this yet</p>
            ) : (
              <div className="space-y-1.5">
                {readMembers.map((member) => (
                  <MemberRow
                    key={member.user_id}
                    name={member.display_name}
                    avatarUrl={member.avatar_url}
                    isRead
                  />
                ))}
              </div>
            )}
          </div>

          {/* Unread section */}
          {!isDm && unreadMembers.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <EyeOff className="h-3.5 w-3.5" />
                <span>Not yet read ({unreadMembers.length})</span>
              </div>
              <div className="space-y-1.5">
                {unreadMembers.map((member) => (
                  <MemberRow
                    key={member.user_id}
                    name={member.display_name}
                    avatarUrl={member.avatar_url}
                    isRead={false}
                  />
                ))}
              </div>
            </div>
          )}

          {loading && (
            <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});

function MemberRow({
  name,
  avatarUrl,
  isRead,
}: {
  name: string | null;
  avatarUrl: string | null;
  isRead: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1 px-1">
      <Avatar className="h-7 w-7">
        <AvatarImage src={avatarUrl || undefined} />
        <AvatarFallback className="text-[11px] bg-muted text-muted-foreground">
          {(name || "?").charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm flex-1 truncate">{name || "Unknown"}</span>
      {isRead && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
    </div>
  );
}
