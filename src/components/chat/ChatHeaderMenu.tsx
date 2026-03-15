import { useState } from "react";
import { MoreVertical, Search, Users, Bell, BellOff, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { BellRing } from "lucide-react";

interface ChatHeaderMenuProps {
  chatType: "team" | "club" | "group" | "dm";
  chatId: string;
  onSearchOpen: () => void;
  onMembersOpen?: () => void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  showMembers?: boolean;
  showMute?: boolean;
  isNativePlatform?: boolean;
  onEditGroup?: () => void;
  onDeleteGroup?: () => void;
}

type MuteData = {
  id: string;
  muted_until: string | null;
} | null;

export function ChatHeaderMenu({
  chatType,
  chatId,
  onSearchOpen,
  onMembersOpen,
  onRefresh,
  isRefreshing = false,
  showMembers = true,
  showMute = true,
  isNativePlatform = false,
}: ChatHeaderMenuProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showMuteDialog, setShowMuteDialog] = useState(false);

  // Mute query
  const { data: muteData } = useQuery({
    queryKey: ["chat-mute", chatType, chatId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("id, muted_until")
        .eq("user_id", user!.id)
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .maybeSingle();
      return data as MuteData;
    },
    enabled: !!user && showMute,
  });

  const isMuted = muteData && (
    muteData.muted_until === null ||
    new Date(muteData.muted_until) > new Date()
  );
  const isTimedMute = muteData?.muted_until !== null && muteData?.muted_until !== undefined;

  const muteMutation = useMutation({
    mutationFn: async (duration: "1hour" | "indefinite") => {
      await supabase
        .from("chat_mute_preferences")
        .delete()
        .eq("user_id", user!.id)
        .eq("chat_type", chatType)
        .eq("chat_id", chatId);

      const muted_until = duration === "1hour"
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : null;

      await supabase
        .from("chat_mute_preferences")
        .insert({
          user_id: user!.id,
          chat_type: chatType,
          chat_id: chatId,
          muted_until,
        });
    },
    onSuccess: (_, duration) => {
      queryClient.invalidateQueries({ queryKey: ["chat-mute", chatType, chatId, user?.id] });
      setShowMuteDialog(false);
      toast.success(duration === "1hour" ? "Muted for 1 hour" : "Muted until turned off");
    },
    onError: () => toast.error("Failed to mute notifications"),
  });

  const unmuteMutation = useMutation({
    mutationFn: async () => {
      await supabase
        .from("chat_mute_preferences")
        .delete()
        .eq("user_id", user!.id)
        .eq("chat_type", chatType)
        .eq("chat_id", chatId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-mute", chatType, chatId, user?.id] });
      toast.success("Notifications unmuted");
    },
    onError: () => toast.error("Failed to unmute notifications"),
  });

  const handleMuteClick = () => {
    if (isMuted) {
      unmuteMutation.mutate();
    } else {
      setShowMuteDialog(true);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="More options"
          >
            <MoreVertical className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover min-w-[180px]">
          <DropdownMenuItem onClick={onSearchOpen}>
            <Search className="h-4 w-4 mr-2" />
            Search messages
          </DropdownMenuItem>

          {showMembers && onMembersOpen && (
            <DropdownMenuItem onClick={onMembersOpen}>
              <Users className="h-4 w-4 mr-2" />
              View members
            </DropdownMenuItem>
          )}

          {showMute && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleMuteClick}>
                {isMuted ? (
                  <>
                    <Bell className="h-4 w-4 mr-2" />
                    Unmute notifications
                    {isTimedMute && <Clock className="h-3 w-3 ml-auto text-muted-foreground" />}
                  </>
                ) : (
                  <>
                    <BellOff className="h-4 w-4 mr-2" />
                    Mute notifications
                  </>
                )}
              </DropdownMenuItem>
            </>
          )}

          {isNativePlatform && onRefresh && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void onRefresh()}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
                Refresh messages
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mute duration dialog */}
      <ResponsiveDialog open={showMuteDialog} onOpenChange={setShowMuteDialog}>
        <ResponsiveDialogContent className="sm:max-w-sm">
          <ResponsiveDialogHeader>
            <div className="flex items-center justify-center mb-2">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <BellRing className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>
            <ResponsiveDialogTitle className="text-center">Mute notifications</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-center">
              Choose how long to silence this chat
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex flex-col gap-3 py-4 px-1">
            <button
              className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/50 active:scale-[0.98] transition-all disabled:opacity-50"
              onClick={() => muteMutation.mutate("1hour")}
              disabled={muteMutation.isPending}
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">For 1 hour</p>
                <p className="text-xs text-muted-foreground">Automatically unmutes after</p>
              </div>
            </button>
            <button
              className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/50 active:scale-[0.98] transition-all disabled:opacity-50"
              onClick={() => muteMutation.mutate("indefinite")}
              disabled={muteMutation.isPending}
            >
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <BellOff className="h-5 w-5 text-destructive" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">Until I turn it back on</p>
                <p className="text-xs text-muted-foreground">Stay muted indefinitely</p>
              </div>
            </button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
