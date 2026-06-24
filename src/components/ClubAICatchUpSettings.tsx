import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  clubId: string;
}

export function ClubAICatchUpSettings({ clubId }: Props) {
  const queryClient = useQueryClient();

  const { data: club, isLoading } = useQuery({
    queryKey: ["club-ai-catchup", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, ai_catch_up_enabled")
        .eq("id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (ai_catch_up_enabled: boolean) => {
      const { error } = await supabase
        .from("clubs")
        .update({ ai_catch_up_enabled } as any)
        .eq("id", clubId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-ai-catchup", clubId] });
      toast.success("AI Catch Me Up updated");
    },
    onError: (e: Error) => toast.error("Failed to update: " + e.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const enabled = (club as any)?.ai_catch_up_enabled ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Catch Me Up
        </CardTitle>
        <CardDescription>
          Control whether members can use AI summaries to catch up on chat threads in your club
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1 pr-4">
            <Label htmlFor="ai-catchup-enabled" className="text-base font-medium">
              Enable AI Catch Me Up
            </Label>
            <p className="text-sm text-muted-foreground">
              When on, members see the "Catch me up" card and menu option in team, club and group chats and can generate AI summaries of recent messages. Turn off to disable the feature across this club.
            </p>
          </div>
          <Switch
            id="ai-catchup-enabled"
            checked={enabled}
            onCheckedChange={(v) => updateMutation.mutate(v)}
            disabled={updateMutation.isPending}
          />
        </div>
        {updateMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
