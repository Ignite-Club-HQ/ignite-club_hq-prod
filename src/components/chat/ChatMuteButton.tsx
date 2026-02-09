import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BellOff, Bell, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ChatMuteButtonProps {
  chatType: "team" | "club" | "group" | "dm";
  chatId: string;
}

type MuteData = {
  id: string;
  muted_until: string | null;
} | null;

export function ChatMuteButton({ chatType, chatId }: ChatMuteButtonProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showMuteDialog, setShowMuteDialog] = useState(false);

  // Check if chat is muted and when it expires
  const { data: muteData, isLoading: isMutedLoading } = useQuery({
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
    enabled: !!user,
  });

  // Check if currently muted (muted_until is null = indefinite, or in the future)
  const isMuted = muteData && (
    muteData.muted_until === null || 
    new Date(muteData.muted_until) > new Date()
  );

  // Check if it's a timed mute
  const isTimedMute = muteData?.muted_until !== null && muteData?.muted_until !== undefined;

  // Mute mutation
  const muteMutation = useMutation({
    mutationFn: async (duration: "1hour" | "indefinite") => {
      // Delete any existing mute first
      await supabase
        .from("chat_mute_preferences")
        .delete()
        .eq("user_id", user!.id)
        .eq("chat_type", chatType)
        .eq("chat_id", chatId);

      // Insert new mute with duration
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
    onError: () => {
      toast.error("Failed to mute notifications");
    },
  });

  // Unmute mutation
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
    onError: () => {
      toast.error("Failed to unmute notifications");
    },
  });

  const handleClick = () => {
    if (isMuted) {
      unmuteMutation.mutate();
    } else {
      setShowMuteDialog(true);
    }
  };

  const isPending = muteMutation.isPending || unmuteMutation.isPending;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={isPending || isMutedLoading}
        className="h-8 w-8 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        title={isMuted ? "Unmute notifications" : "Mute notifications"}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isMuted ? (
          <div className="relative">
            <BellOff className="h-4 w-4 text-muted-foreground" />
            {isTimedMute && (
              <Clock className="h-2.5 w-2.5 absolute -bottom-0.5 -right-0.5 text-muted-foreground" />
            )}
          </div>
        ) : (
          <Bell className="h-4 w-4" />
        )}
      </Button>

      <Dialog open={showMuteDialog} onOpenChange={setShowMuteDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Mute notifications</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              variant="outline"
              className="justify-start gap-3 h-12"
              onClick={() => muteMutation.mutate("1hour")}
              disabled={muteMutation.isPending}
            >
              <Clock className="h-4 w-4" />
              <span>For 1 hour</span>
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-3 h-12"
              onClick={() => muteMutation.mutate("indefinite")}
              disabled={muteMutation.isPending}
            >
              <BellOff className="h-4 w-4" />
              <span>Until I turn it back on</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
