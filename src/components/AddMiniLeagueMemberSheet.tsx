import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, Mail, X, Send, Users, Plus, Trash2, Upload, Baby, User, Star } from "lucide-react";
import { MiniLeagueMemberCSVImportDialog } from "@/components/MiniLeagueMemberCSVImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface BulkPlayer {
  id: string;
  name: string;
  abilityRating: string;
  parentName: string;
  parentEmail: string;
}

interface AddMiniLeagueMemberSheetProps {
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
}

const abilityOptions = [
  { value: "1", label: "1 - Beginner" },
  { value: "2", label: "2 - Developing" },
  { value: "3", label: "3 - Intermediate" },
  { value: "4", label: "4 - Advanced" },
  { value: "5", label: "5 - Expert" },
];

export function AddMiniLeagueMemberSheet({ miniLeagueId, miniLeagueName, clubId }: AddMiniLeagueMemberSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  
  // Single input state
  const [playerName, setPlayerName] = useState("");
  const [abilityRating, setAbilityRating] = useState("3");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  
  // Bulk input state
  const [bulkPlayers, setBulkPlayers] = useState<BulkPlayer[]>([
    { id: crypto.randomUUID(), name: "", abilityRating: "3", parentName: "", parentEmail: "" },
  ]);
  const [bulkResults, setBulkResults] = useState<{ playerName: string; parentEmail: string; sent: boolean }[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Fetch club branding for emails
  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId,
  });

  const handleClose = () => {
    setOpen(false);
    setPlayerName("");
    setAbilityRating("3");
    setParentName("");
    setParentEmail("");
    setBulkPlayers([{ id: crypto.randomUUID(), name: "", abilityRating: "3", parentName: "", parentEmail: "" }]);
    setBulkResults([]);
  };

  // Add single player
  const addPlayerMutation = useMutation({
    mutationFn: async () => {
      if (!playerName.trim()) throw new Error("Player name is required");

      // Create player record
      const { data: player, error: playerError } = await supabase
        .from("mini_league_players")
        .insert({
          mini_league_id: miniLeagueId,
          name: playerName.trim(),
          ability_rating: parseInt(abilityRating),
          parent_user_id: null, // Will be linked when parent accepts invite
        })
        .select()
        .single();
      
      if (playerError) throw playerError;

      // If parent email provided, create pending invite
      if (parentEmail.trim()) {
        const inviteToken = crypto.randomUUID();
        
        const { error: inviteError } = await supabase.from("pending_invites").insert({
          club_id: clubId,
          role: "league_parent" as any,
          invited_user_id: null,
          invited_by_user_id: user!.id,
          invited_label: parentName.trim() || parentEmail.trim(),
          invited_email: parentEmail.trim().toLowerCase(),
          invite_token: inviteToken,
          metadata: { 
            mini_league_id: miniLeagueId,
            player_id: player.id,
            player_name: playerName.trim(),
          },
        } as any);
        
        if (inviteError) throw inviteError;

        return { player, inviteToken, parentEmail: parentEmail.trim() };
      }

      return { player, inviteToken: null, parentEmail: null };
    },
    onSuccess: async ({ player, inviteToken, parentEmail: email }) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      
      // Send email if parent email provided
      if (email && inviteToken) {
        setIsSendingNotification(true);
        try {
          const link = `${window.location.origin}/join/p/${inviteToken}`;
          
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: email,
              subject: `You're invited to ${miniLeagueName}`,
              template: "team-invite",
              templateData: {
                recipientName: parentName.trim() || email,
                teamName: miniLeagueName,
                clubName: clubBranding?.name || "The Club",
                roleName: "Parent",
                inviteLink: link,
                clubLogoUrl: clubBranding?.logo_url || undefined,
                childrenNames: [playerName.trim()],
              },
            },
          });

          const emailSent = !funcError && emailResult?.verified && emailResult?.success;
          
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailResult?.emailId || null,
              email_error: funcError?.message || (!emailSent ? "Email not verified" : null),
            } as any)
            .eq("invite_token", inviteToken);

          queryClient.invalidateQueries({ queryKey: ["pending-invites"] });

          if (emailSent) {
            toast({
              title: "Player added!",
              description: `Invite sent to ${email}`,
            });
          } else {
            toast({
              title: "Player added",
              description: "Could not send email, but player has been added",
            });
          }
        } catch (error) {
          console.error("Failed to send email:", error);
          toast({
            title: "Player added",
            description: "Could not send email, but player has been added",
          });
        } finally {
          setIsSendingNotification(false);
        }
      } else {
        toast({
          title: "Player added!",
          description: `${playerName} has been added to the league`,
        });
      }
      
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add player",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Bulk add players
  const addBulkPlayersMutation = useMutation({
    mutationFn: async (playersToAdd?: BulkPlayer[]) => {
      const playersSource = playersToAdd || bulkPlayers;
      const validPlayers = playersSource.filter(p => p.name.trim());
      if (validPlayers.length === 0) throw new Error("Please enter at least one player");

      const results: { playerName: string; parentEmail: string; sent: boolean }[] = [];

      for (const player of validPlayers) {
        // Create player record
        const { data: newPlayer, error: playerError } = await supabase
          .from("mini_league_players")
          .insert({
            mini_league_id: miniLeagueId,
            name: player.name.trim(),
            ability_rating: parseInt(player.abilityRating),
            parent_user_id: null,
          })
          .select()
          .single();

        if (playerError) {
          console.error("Failed to create player:", player.name, playerError);
          continue;
        }

        let sent = false;

        // Create pending invite if parent email provided
        if (player.parentEmail.trim()) {
          const inviteToken = crypto.randomUUID();
          
          const { error: inviteError } = await supabase.from("pending_invites").insert({
            club_id: clubId,
            role: "league_parent" as any,
            invited_user_id: null,
            invited_by_user_id: user!.id,
            invited_label: player.parentName.trim() || player.parentEmail.trim(),
            invited_email: player.parentEmail.trim().toLowerCase(),
            invite_token: inviteToken,
            metadata: { 
              mini_league_id: miniLeagueId,
              player_id: newPlayer.id,
              player_name: player.name.trim(),
            },
          } as any);

          if (!inviteError) {
            // Send email
            try {
              const link = `${window.location.origin}/join/p/${inviteToken}`;
              
              const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
                body: {
                  to: player.parentEmail.trim(),
                  subject: `You're invited to ${miniLeagueName}`,
                  template: "team-invite",
                  templateData: {
                    recipientName: player.parentName.trim() || player.parentEmail.trim(),
                    teamName: miniLeagueName,
                    clubName: clubBranding?.name || "The Club",
                    roleName: "Parent",
                    inviteLink: link,
                    clubLogoUrl: clubBranding?.logo_url || undefined,
                    childrenNames: [player.name.trim()],
                  },
                },
              });

              sent = !funcError && emailResult?.verified && emailResult?.success;
              
              await supabase
                .from("pending_invites")
                .update({
                  email_sent_at: sent ? new Date().toISOString() : null,
                  email_id: emailResult?.emailId || null,
                  email_error: funcError?.message || (!sent ? "Email not verified" : null),
                } as any)
                .eq("invite_token", inviteToken);
            } catch (error) {
              console.error("Failed to send email:", error);
            }
          }
        }

        results.push({
          playerName: player.name.trim(),
          parentEmail: player.parentEmail.trim(),
          sent,
        });
      }

      return results;
    },
    onSuccess: (results) => {
      setBulkResults(results);
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      
      const sentCount = results.filter(r => r.sent).length;
      const totalCount = results.length;
      
      toast({
        title: `${totalCount} player${totalCount > 1 ? "s" : ""} added`,
        description: sentCount > 0 
          ? `${sentCount} invite${sentCount > 1 ? "s" : ""} sent` 
          : "Players added to the league",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add players",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addBulkRow = () => {
    setBulkPlayers(prev => [
      ...prev,
      { id: crypto.randomUUID(), name: "", abilityRating: "3", parentName: "", parentEmail: "" },
    ]);
  };

  const removeBulkRow = (id: string) => {
    if (bulkPlayers.length <= 1) return;
    setBulkPlayers(prev => prev.filter(p => p.id !== id));
  };

  const updateBulkPlayer = (id: string, field: keyof BulkPlayer, value: string) => {
    setBulkPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleCSVImport = (players: BulkPlayer[]) => {
    addBulkPlayersMutation.mutate(players);
  };

  const isPending = addPlayerMutation.isPending || addBulkPlayersMutation.isPending || isSendingNotification;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Players
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-[85vh] flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add Players
            </SheetTitle>
            <SheetDescription>
              Add players to {miniLeagueName}
            </SheetDescription>
          </SheetHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="flex-1 flex flex-col mt-4">
            <TabsList className="grid grid-cols-2 mb-4">
              <TabsTrigger value="single" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Single
              </TabsTrigger>
              <TabsTrigger value="bulk" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Bulk
              </TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="flex-1 overflow-auto space-y-4">
              {/* Player Info */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Baby className="h-4 w-4" />
                  Player Details
                </h3>
                <div className="space-y-2">
                  <Label>Player Name *</Label>
                  <Input
                    placeholder="e.g. Tommy Smith"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ability Rating</Label>
                  <Select value={abilityRating} onValueChange={setAbilityRating}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {abilityOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            {Array.from({ length: parseInt(opt.value) }).map((_, i) => (
                              <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                            ))}
                            <span className="ml-1">{opt.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Parent Info */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Parent Details (Optional)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Add parent email to send them an invite to manage their child
                </p>
                <div className="space-y-2">
                  <Label>Parent Name</Label>
                  <Input
                    placeholder="e.g. John Smith"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Parent Email</Label>
                  <Input
                    type="email"
                    placeholder="parent@example.com"
                    value={parentEmail}
                    onChange={(e) => setParentEmail(e.target.value)}
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => addPlayerMutation.mutate()}
                disabled={!playerName.trim() || isPending}
              >
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {parentEmail.trim() ? (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Add Player & Send Invite
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Player
                  </>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="bulk" className="flex-1 overflow-auto space-y-4">
              {bulkResults.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Results</h3>
                  <div className="space-y-2">
                    {bulkResults.map((result, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium text-sm">{result.playerName}</p>
                          {result.parentEmail && (
                            <p className="text-xs text-muted-foreground">{result.parentEmail}</p>
                          )}
                        </div>
                        {result.parentEmail && (
                          <Badge variant={result.sent ? "default" : "secondary"}>
                            {result.sent ? "Sent" : "Not sent"}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" className="w-full" onClick={handleClose}>
                    Done
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Add Multiple Players</h3>
                    <Button size="sm" variant="outline" onClick={() => setCsvImportOpen(true)}>
                      <Upload className="h-4 w-4 mr-1" />
                      Import CSV
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {bulkPlayers.map((player, idx) => (
                      <div key={player.id} className="p-3 bg-muted/50 rounded-lg space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">Player {idx + 1}</Badge>
                          {bulkPlayers.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeBulkRow(player.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Player name *"
                            value={player.name}
                            onChange={(e) => updateBulkPlayer(player.id, "name", e.target.value)}
                          />
                          <Select
                            value={player.abilityRating}
                            onValueChange={(v) => updateBulkPlayer(player.id, "abilityRating", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Ability" />
                            </SelectTrigger>
                            <SelectContent>
                              {abilityOptions.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Parent name"
                            value={player.parentName}
                            onChange={(e) => updateBulkPlayer(player.id, "parentName", e.target.value)}
                          />
                          <Input
                            type="email"
                            placeholder="Parent email"
                            value={player.parentEmail}
                            onChange={(e) => updateBulkPlayer(player.id, "parentEmail", e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button variant="outline" className="w-full" onClick={addBulkRow}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Another Player
                  </Button>

                  <Button
                    className="w-full"
                    onClick={() => addBulkPlayersMutation.mutate(undefined)}
                    disabled={!bulkPlayers.some(p => p.name.trim()) || isPending}
                  >
                    {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <Send className="h-4 w-4 mr-2" />
                    Add Players & Send Invites
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <MiniLeagueMemberCSVImportDialog
        open={csvImportOpen}
        onOpenChange={setCsvImportOpen}
        onImport={handleCSVImport}
      />
    </>
  );
}
