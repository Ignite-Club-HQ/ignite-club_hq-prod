import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, X, UserCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface PendingInviteCardProps {
  invite: {
    id: string;
    role: string;
    invited_user_id: string | null;
    invited_label: string | null;
    created_at: string;
    status: string;
    profiles?: {
      id: string;
      display_name: string | null;
      avatar_url: string | null;
    } | null;
  };
  teamId?: string;
  clubId?: string;
}

const roleColors: Record<string, string> = {
  player: "bg-amber-500/20 text-amber-600 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-600 border-pink-500/30",
  coach: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  team_admin: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  club_admin: "bg-purple-500/20 text-purple-600 border-purple-500/30",
};

export default function PendingInviteCard({ invite, teamId, clubId }: PendingInviteCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("pending_invites")
        .delete()
        .eq("id", invite.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
      toast({ title: "Pending invite removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove invite", variant: "destructive" });
    },
  });

  const displayName = invite.profiles?.display_name || invite.invited_label || "Unknown";
  const avatarUrl = invite.profiles?.avatar_url;
  const isExistingUser = !!invite.invited_user_id;
  const roleColor = roleColors[invite.role] || "bg-muted text-muted-foreground";

  return (
    <Card className="border-dashed border-amber-500/50 bg-amber-500/5">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="relative">
          <Avatar className="h-10 w-10 opacity-75">
            <AvatarImage src={avatarUrl || undefined} />
            <AvatarFallback className="bg-muted">
              {displayName[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-amber-500">
            <Clock className="h-3 w-3 text-white" />
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{displayName}</span>
            {isExistingUser && (
              <UserCheck className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge variant="outline" className={`${roleColor} text-xs`}>
              {invite.role.replace("_", " ")}
            </Badge>
            <Badge variant="outline" className="bg-amber-500/20 text-amber-600 border-amber-500/30 text-xs">
              Pending
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(invite.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}