import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, ArrowRightLeft, Trash2, X, MessageCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
  app_admin: "App Admin",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  basic_user: "Member",
};

const ROLE_COLORS: Record<string, string> = {
  app_admin: "bg-red-500/20 text-red-400 border-red-500/30",
  club_admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  team_admin: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  coach: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  player: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  parent: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  basic_user: "bg-muted text-muted-foreground border-border",
};

interface MemberRole {
  id: string;
  role: string;
}

interface MemberDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  roles: MemberRole[];
  canManage: boolean;
  canMove: boolean;
  isSelf: boolean;
  showMoveAction?: boolean;
  showRemoveAction?: boolean;
  onAddRole: () => void;
  onMove: () => void;
  onRemove: () => void;
  onRemoveRole: (roleItem: MemberRole) => void;
}

export default function MemberDetailSheet({
  open,
  onOpenChange,
  userId,
  displayName,
  avatarUrl,
  roles,
  canManage,
  canMove,
  isSelf,
  showMoveAction = true,
  showRemoveAction = true,
  onAddRole,
  onMove,
  onRemove,
  onRemoveRole,
}: MemberDetailSheetProps) {
  const navigate = useNavigate();
  const [startingDM, setStartingDM] = useState(false);
  const canRemoveRoles = canManage && !isSelf && roles.length > 1;

  const handleSendMessage = async () => {
    if (startingDM) return;
    setStartingDM(true);
    try {
      const { data, error } = await supabase.rpc("get_or_create_dm_conversation", {
        other_user_id: userId,
      });
      if (error) throw error;
      onOpenChange(false);
      navigate(`/messages/dm/${data as string}`);
    } catch (err: any) {
      const message = err?.message || "Could not start conversation";
      toast.error(message.includes("not allowed") || message.includes("permission")
        ? "You can't message this member"
        : `Failed to start conversation: ${message}`);
    } finally {
      setStartingDM(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="sr-only">Member Details</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-5">
          {/* Profile header */}
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-lg">
                {displayName?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-base truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground">
                {roles.map(r => ROLE_LABELS[r.role] || r.role).join(", ")}
              </p>
            </div>
          </div>

          {/* Current roles */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Roles</p>
            <div className="flex flex-wrap gap-2">
              {roles.map((roleItem) => {
                const colorClass = ROLE_COLORS[roleItem.role] || ROLE_COLORS.basic_user;
                const label = ROLE_LABELS[roleItem.role] || "Member";
                return (
                  <Badge
                    key={roleItem.id}
                    variant="outline"
                    className={`text-xs border px-2 py-0.5 ${colorClass} flex items-center gap-1`}
                  >
                    {label}
                    {canRemoveRoles && (
                      <button
                        onClick={() => onRemoveRole(roleItem)}
                        className="ml-0.5 hover:bg-destructive/20 rounded-full p-0.5"
                        aria-label={`Remove ${label} role`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          {canManage && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</p>
              <div className="grid gap-2">
                <Button
                  variant="outline"
                  className="justify-start gap-2 h-11"
                  onClick={() => {
                    onOpenChange(false);
                    onAddRole();
                  }}
                >
                  <Plus className="h-4 w-4 text-blue-500" />
                  Add Role
                </Button>
                {showMoveAction && canMove && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11"
                    onClick={() => {
                      onOpenChange(false);
                      onMove();
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4 text-amber-500" />
                    Move to Another Team
                  </Button>
                )}
                {showRemoveAction && !isSelf && (
                  <Button
                    variant="outline"
                    className="justify-start gap-2 h-11 text-destructive hover:text-destructive"
                    onClick={() => {
                      onOpenChange(false);
                      onRemove();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove from Team
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
