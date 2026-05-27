import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Shield, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatTimeShort } from "@/lib/formatTimeShort";

interface ClubAdminInboxListProps {
  /** Optional: limit to a single active club. */
  clubFilter?: string | null;
  /** Render a "Admin Groups" section header above the list (only when non-empty). */
  withSectionHeader?: boolean;
}

interface ConversationRow {
  id: string;
  club_id: string;
  member_user_id: string;
  updated_at: string;
  club_name: string;
  club_logo: string | null;
  member_name: string;
  member_avatar: string | null;
  last_text: string | null;
  last_image: string | null;
  last_created_at: string | null;
}

/**
 * Lists incoming "Contact Club Admin" conversations for users who are a
 * club_admin of one or more clubs. Lets admins reply to messages members
 * sent via the home-screen "Contact Club" button.
 */
export default function ClubAdminInboxList({ clubFilter, withSectionHeader = false }: ClubAdminInboxListProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: conversations } = useQuery({
    queryKey: ["club-admin-inbox", user?.id, clubFilter],
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ConversationRow[]> => {
      // Clubs where this user is a club_admin
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin");

      const adminClubIds = [
        ...new Set((adminRoles || []).map((r) => r.club_id).filter(Boolean) as string[]),
      ];
      const filtered = clubFilter ? adminClubIds.filter((id) => id === clubFilter) : adminClubIds;
      if (filtered.length === 0) return [];

      const { data: convs } = await supabase
        .from("club_admin_conversations")
        .select("id, club_id, member_user_id, updated_at")
        .in("club_id", filtered)
        .order("updated_at", { ascending: false });

      if (!convs?.length) return [];

      const clubIds = [...new Set(convs.map((c) => c.club_id))];
      const memberIds = [...new Set(convs.map((c) => c.member_user_id))];
      const convIds = convs.map((c) => c.id);

      const sb = supabase as any;
      const [clubsRes, profilesRes, msgsRes] = await Promise.all([
        sb.from("clubs").select("id, name, logo_url").in("id", clubIds),
        sb.from("profiles").select("id, display_name, avatar_url").in("id", memberIds),
        sb
          .from("club_admin_messages")
          .select("conversation_id, text, image_url, created_at")
          .in("conversation_id", convIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);

      const clubMap = new Map((clubsRes.data || []).map((c: any) => [c.id, c]));
      const profileMap = new Map(
        (profilesRes.data || []).map((p: any) => [p.id, p]),
      );
      const latestByConv = new Map<string, any>();
      for (const m of msgsRes.data || []) {
        if (!latestByConv.has(m.conversation_id)) {
          latestByConv.set(m.conversation_id, m);
        }
      }

      return convs.flatMap((c) => {
        const last = latestByConv.get(c.id);
        // Hide empty conversations — only show threads where a member has actually messaged
        if (!last) return [];
        const club = clubMap.get(c.club_id) as any;
        const profile = profileMap.get(c.member_user_id) as any;
        return [{
          id: c.id,
          club_id: c.club_id,
          member_user_id: c.member_user_id,
          updated_at: c.updated_at,
          club_name: club?.name || "Club",
          club_logo: club?.logo_url || null,
          member_name: profile?.display_name || "Member",
          member_avatar: profile?.avatar_url || null,
          last_text: last?.text ?? null,
          last_image: last?.image_url ?? null,
          last_created_at: last?.created_at ?? c.updated_at,
        }];
      });

    },
  });

  if (!conversations?.length) return null;

  return (
    <>
      {conversations.map((conv) => {
        const preview = conv.last_text?.trim()
          ? conv.last_text
          : conv.last_image
            ? "📷 Photo"
            : "No messages yet";
        return (
          <button
            key={`club-admin-conv-${conv.id}`}
            onClick={() => navigate(`/messages/club-admin/${conv.id}`)}
            className="w-full text-left"
          >
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="relative shrink-0">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={conv.member_avatar || undefined} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground">
                      {conv.member_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center border-2 border-background">
                    <Shield className="h-2.5 w-2.5 text-primary-foreground" />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-[15px] leading-tight font-semibold">
                      {conv.member_name}
                    </h3>
                    {conv.last_created_at && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatTimeShort(conv.last_created_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {conv.club_name} · Admin chat
                  </p>
                  <p className="text-[13px] leading-relaxed mt-0.5 line-clamp-1 text-foreground/70">
                    {preview}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </button>
        );
      })}
    </>
  );
}
