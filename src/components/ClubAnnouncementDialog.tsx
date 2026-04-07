import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Megaphone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";

interface Team {
  id: string;
  name: string;
  logo_url: string | null;
  is_archived?: boolean;
}

interface ClubAnnouncementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubName: string;
  clubId: string;
  teams: Team[];
  userId: string;
}

export function ClubAnnouncementDialog({
  open,
  onOpenChange,
  clubName,
  clubId,
  teams,
  userId,
}: ClubAnnouncementDialogProps) {
  const [message, setMessage] = useState("");
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());

  const activeTeams = teams.filter((t) => !t.is_archived);

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedTeamIds.size === activeTeams.length) {
      setSelectedTeamIds(new Set());
    } else {
      setSelectedTeamIds(new Set(activeTeams.map((t) => t.id)));
    }
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      const teamIds = Array.from(selectedTeamIds);
      
      // Send via edge function which creates/uses bot profile as author
      // This makes announcements backwards-compatible with old app builds
      const { data, error } = await supabase.functions.invoke("send-club-announcement", {
        body: {
          club_id: clubId,
          team_ids: teamIds,
          message: message.trim(),
          club_name: clubName,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success(`Announcement sent to ${selectedTeamIds.size} team${selectedTeamIds.size > 1 ? "s" : ""}`);
      setMessage("");
      setSelectedTeamIds(new Set());
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to send announcement");
    },
  });

  const canSend = message.trim().length > 0 && selectedTeamIds.size > 0 && !sendMutation.isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Send to Team Chats
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-2 flex-1 min-h-0 overflow-y-auto">
          {/* From label */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
            <span className="text-xs text-muted-foreground">From:</span>
            <span className="text-sm font-medium">{clubName}</span>
          </div>

          {/* Message input */}
          <div className="space-y-1.5">
            <Label htmlFor="announcement-message">Message</Label>
            <Textarea
              id="announcement-message"
              placeholder="Write your announcement..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Team selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Send to teams</Label>
              <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
                {selectedTeamIds.size === activeTeams.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 border rounded-lg p-2">
              {activeTeams.map((team) => (
                <label
                  key={team.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTeamIds.has(team.id)}
                    onCheckedChange={() => toggleTeam(team.id)}
                  />
                  <span className="text-sm">{team.name}</span>
                </label>
              ))}
              {activeTeams.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No teams available</p>
              )}
            </div>
            {selectedTeamIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedTeamIds.size} team{selectedTeamIds.size > 1 ? "s" : ""} selected
              </p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 pt-3 pb-1 bg-background border-t mt-2">
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!canSend}
            className="w-full"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Announcement
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
