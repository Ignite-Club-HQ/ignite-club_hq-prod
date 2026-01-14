import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BellOff, Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ChatMuteButtonProps {
  chatType: "team" | "club" | "group";
  chatId: string;
}

export function ChatMuteButton({ chatType, chatId }: ChatMuteButtonProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Check if chat is muted
  const { data: isMuted, isLoading: isMutedLoading } = useQuery({
    queryKey: ["chat-mute", chatType, chatId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("id")
        .eq("user_id", user!.id)
        .eq("chat_type", chatType)
        .eq("chat_id", chatId)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Toggle mute mutation
  const toggleMuteMutation = useMutation({
    mutationFn: async () => {
      if (isMuted) {
        // Unmute
        await supabase
          .from("chat_mute_preferences")
          .delete()
          .eq("user_id", user!.id)
          .eq("chat_type", chatType)
          .eq("chat_id", chatId);
      } else {
        // Mute
        await supabase
          .from("chat_mute_preferences")
          .insert({
            user_id: user!.id,
            chat_type: chatType,
            chat_id: chatId,
          });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-mute", chatType, chatId, user?.id] });
      toast.success(isMuted ? "Notifications unmuted" : "Notifications muted");
    },
    onError: () => {
      toast.error("Failed to update notification settings");
    },
  });

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => toggleMuteMutation.mutate()}
      disabled={toggleMuteMutation.isPending || isMutedLoading}
      className="h-8 w-8 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
      title={isMuted ? "Unmute notifications" : "Mute notifications"}
    >
      {toggleMuteMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isMuted ? (
        <BellOff className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Bell className="h-4 w-4" />
      )}
    </Button>
  );
}
