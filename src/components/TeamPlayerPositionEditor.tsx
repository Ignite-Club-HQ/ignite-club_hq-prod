import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Target, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const POSITION_LABELS: Record<string, string> = {
  GK: "Goalkeeper",
  DEF: "Defender", 
  MID: "Midfielder",
  FWD: "Forward",
};

const POSITION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GK: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500" },
  DEF: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500" },
  MID: { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500" },
  FWD: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500" },
};

type PitchPosition = "GK" | "DEF" | "MID" | "FWD";

interface Member {
  userId: string;
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  roles: { id: string; role: string }[];
}

interface TeamPlayerPositionEditorProps {
  teamId: string;
  members: Record<string, Member>;
}

export default function TeamPlayerPositionEditor({ teamId, members }: TeamPlayerPositionEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<PitchPosition[]>([]);
  const [jerseyNumber, setJerseyNumber] = useState<string>("");

  // Fetch existing positions for all team members
  const { data: playerPositions, isLoading } = useQuery({
    queryKey: ["team-player-positions", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_player_positions")
        .select("*")
        .eq("team_id", teamId);
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  const upsertPositionMutation = useMutation({
    mutationFn: async ({ userId, positions, number }: { userId: string; positions: PitchPosition[]; number: number | null }) => {
      const { error } = await supabase
        .from("team_player_positions")
        .upsert({
          team_id: teamId,
          user_id: userId,
          position: positions[0] || 'MID',
          preferred_positions: positions,
          jersey_number: number,
        } as any, {
          onConflict: "team_id,user_id",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-player-positions", teamId] });
      toast({ title: "Positions saved" });
      setEditingMember(null);
    },
    onError: () => {
      toast({ title: "Failed to save positions", variant: "destructive" });
    },
  });

  const handleMemberClick = (userId: string) => {
    const existing = playerPositions?.find(p => p.user_id === userId);
    setEditingMember(userId);
    setSelectedPositions((existing?.preferred_positions || []) as PitchPosition[]);
    setJerseyNumber(existing?.jersey_number?.toString() || "");
  };

  const handlePositionToggle = (position: PitchPosition) => {
    setSelectedPositions(prev =>
      prev.includes(position)
        ? prev.filter(p => p !== position)
        : [...prev, position]
    );
  };

  const handleSave = () => {
    if (!editingMember) return;
    upsertPositionMutation.mutate({
      userId: editingMember,
      positions: selectedPositions,
      number: jerseyNumber ? parseInt(jerseyNumber) : null,
    });
  };

  const handleBack = () => {
    setEditingMember(null);
    setSelectedPositions([]);
    setJerseyNumber("");
  };

  // Get players only (those with 'player' role)
  const playerMembers = Object.entries(members).filter(([_, member]) =>
    member.roles.some(r => r.role === "player")
  );

  const currentMember = editingMember ? members[editingMember] : null;
  const getPositionData = (userId: string) => playerPositions?.find(p => p.user_id === userId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Target className="h-4 w-4 mr-2" />
          Positions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingMember
              ? `Edit: ${currentMember?.profile?.display_name || "Player"}`
              : "Player Positions"}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : editingMember ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Jersey Number</Label>
              <Input
                type="number"
                placeholder="e.g. 10"
                value={jerseyNumber}
                onChange={(e) => setJerseyNumber(e.target.value)}
                className="w-24"
              />
            </div>

            <div className="space-y-2">
              <Label>Preferred Positions</Label>
              <p className="text-sm text-muted-foreground">
                Select all positions this player can play:
              </p>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {(Object.keys(POSITION_LABELS) as PitchPosition[]).map(position => {
                  const colors = POSITION_COLORS[position];
                  const isSelected = selectedPositions.includes(position);

                  return (
                    <button
                      key={position}
                      onClick={() => handlePositionToggle(position)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border-2 transition-all",
                        isSelected
                          ? `${colors.border} ${colors.bg}`
                          : "border-border bg-muted/50 hover:bg-muted"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        className="pointer-events-none"
                      />
                      <div className="text-left">
                        <div className={cn("font-bold", isSelected ? colors.text : "text-foreground")}>
                          {position}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {POSITION_LABELS[position]}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={handleSave} 
                className="flex-1"
                disabled={upsertPositionMutation.isPending}
              >
                {upsertPositionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </div>
        ) : playerMembers.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">
            No players in this team yet
          </p>
        ) : (
          <div className="space-y-2">
            {playerMembers.map(([userId, member]) => {
              const posData = getPositionData(userId);
              const positions = (posData?.preferred_positions || []) as PitchPosition[];

              return (
                <button
                  key={userId}
                  onClick={() => handleMemberClick(userId)}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50 hover:bg-muted transition-all"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.profile?.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left">
                      <span className="font-medium text-sm">
                        {member.profile?.display_name || "Unknown"}
                      </span>
                      {posData?.jersey_number && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          #{posData.jersey_number}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {positions.length > 0 ? (
                      positions.map(pos => {
                        const colors = POSITION_COLORS[pos];
                        return (
                          <span
                            key={pos}
                            className={cn(
                              "text-[10px] font-bold px-1.5 py-0.5 rounded",
                              colors.bg,
                              colors.text
                            )}
                          >
                            {pos}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">No positions</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
