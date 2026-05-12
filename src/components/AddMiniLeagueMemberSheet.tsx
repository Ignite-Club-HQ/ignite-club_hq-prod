import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, X, Send, Plus, Upload } from "lucide-react";
import { MiniLeagueMemberCSVImportDialog } from "@/components/MiniLeagueMemberCSVImportDialog";
import MiniLeagueParentJoinLinkCard from "@/components/mini-league/MiniLeagueParentJoinLinkCard";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
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
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

const abilityOptions = [
  { value: "1", label: "1 - Beginner" },
  { value: "2", label: "2 - Developing" },
  { value: "3", label: "3 - Intermediate" },
  { value: "4", label: "4 - Advanced" },
  { value: "5", label: "5 - Expert" },
];

const createEmptyPlayer = (): BulkPlayer => ({
  id: crypto.randomUUID(),
  name: "",
  abilityRating: "3",
  parentName: "",
  parentEmail: "",
});

export function AddMiniLeagueMemberSheet({ miniLeagueId, miniLeagueName, clubId, externalOpen, onExternalOpenChange }: AddMiniLeagueMemberSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const isExternallyControlled = externalOpen !== undefined;
  const open = isExternallyControlled ? externalOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (isExternallyControlled) {
      onExternalOpenChange?.(val);
    } else {
      setInternalOpen(val);
    }
  };

  const [players, setPlayers] = useState<BulkPlayer[]>([createEmptyPlayer()]);
  const [results, setResults] = useState<{ playerName: string; parentEmail: string; sent: boolean }[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId,
  });

  const handleClose = () => {
    setOpen(false);
    setPlayers([createEmptyPlayer()]);
    setResults([]);
  };

  const addPlayersMutation = useMutation({
    mutationFn: async (playersToAdd?: BulkPlayer[]) => {
      const playersSource = playersToAdd || players;
      const validPlayers = playersSource.filter((player) => player.name.trim());
      if (validPlayers.length === 0) throw new Error("Please enter at least one player");

      const addedResults: { playerName: string; parentEmail: string; sent: boolean }[] = [];

      for (const player of validPlayers) {
        const { data: child, error: childError } = await supabase
          .from("children")
          .insert({
            parent_id: user!.id,
            name: player.name.trim(),
          })
          .select()
          .single();

        if (childError) {
          console.error("Failed to create child:", player.name, childError);
          continue;
        }

        const { error: assignmentError } = await supabase
          .from("child_mini_league_assignments")
          .insert({
            child_id: child.id,
            mini_league_id: miniLeagueId,
            ability_rating: parseInt(player.abilityRating),
          });

        if (assignmentError) {
          console.error("Failed to create league assignment:", player.name, assignmentError);
        }

        const { data: newPlayer, error: playerError } = await supabase
          .from("mini_league_players")
          .insert({
            mini_league_id: miniLeagueId,
            name: player.name.trim(),
            ability_rating: parseInt(player.abilityRating),
            child_id: child.id,
            parent_user_id: null,
          })
          .select()
          .single();

        if (playerError) {
          console.warn("Failed to create legacy player record:", player.name, playerError);
        }

        let sent = false;

        if (player.parentEmail.trim()) {
          const inviteToken = crypto.randomUUID();
          const { error: inviteError } = await supabase.from("pending_invites").insert({
            club_id: clubId,
            role: "parent" as any,
            invited_user_id: null,
            invited_by_user_id: user!.id,
            invited_label: player.parentName.trim() || player.parentEmail.trim(),
            invited_email: player.parentEmail.trim().toLowerCase(),
            invite_token: inviteToken,
            metadata: {
              mini_league_id: miniLeagueId,
              child_id: child.id,
              player_id: newPlayer?.id,
              player_name: player.name.trim(),
              children: [{ name: player.name.trim(), yearOfBirth: null }],
            },
          } as any);

          if (!inviteError) {
            try {
              const link = `${window.location.origin}/join/p/${inviteToken}`;
              const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
                body: {
                  to: player.parentEmail.trim(),
                  subject: `You're invited to ${miniLeagueName}`,
                  template: "team-invite",
                  senderName: clubBranding?.name || undefined,
                  replyTo: (clubBranding as any)?.contact_email || undefined,
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

        addedResults.push({
          playerName: player.name.trim(),
          parentEmail: player.parentEmail.trim(),
          sent,
        });
      }

      return addedResults;
    },
    onSuccess: (addedResults) => {
      setResults(addedResults);
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });

      const sentCount = addedResults.filter((result) => result.sent).length;
      const totalCount = addedResults.length;

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

  const addRow = () => {
    setPlayers((current) => [...current, createEmptyPlayer()]);
  };

  const removeRow = (id: string) => {
    if (players.length <= 1) return;
    setPlayers((current) => current.filter((player) => player.id !== id));
  };

  const updatePlayer = (id: string, field: keyof BulkPlayer, value: string) => {
    setPlayers((current) => current.map((player) => player.id === id ? { ...player, [field]: value } : player));
  };

  const handlePastePlayers = (text: string) => {
    if (!looksLikeMultiRecipient(text)) return false;
    const recipients = parseRecipients(text);
    if (recipients.length < 2) return false;

    setPlayers(recipients.map((recipient) => ({
      id: crypto.randomUUID(),
      name: recipient.name,
      abilityRating: "3",
      parentName: "",
      parentEmail: recipient.email,
    })));
    toast({
      title: `${recipients.length} players detected`,
      description: "Review and add.",
    });
    return true;
  };

  const handleCSVImport = (importedPlayers: BulkPlayer[]) => {
    addPlayersMutation.mutate(importedPlayers);
  };

  const isPending = addPlayersMutation.isPending;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        {!isExternallyControlled && (
          <SheetTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Players
            </Button>
          </SheetTrigger>
        )}
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

          <div className="mt-4">
            <MiniLeagueParentJoinLinkCard
              miniLeagueId={miniLeagueId}
              miniLeagueName={miniLeagueName}
              clubId={clubId}
            />
          </div>

          <div className="flex-1 flex flex-col mt-5 min-h-0 overflow-auto">
            {results.length > 0 ? (
              <div className="flex flex-col h-full space-y-3">
                <h3 className="text-sm font-medium">Results</h3>
                <ScrollArea className="flex-1 h-[50vh]">
                  <div className="space-y-2 pr-4">
                    {results.map((result, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 p-3 bg-muted rounded-lg">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{result.playerName}</p>
                          {result.parentEmail && (
                            <p className="text-xs text-muted-foreground truncate">{result.parentEmail}</p>
                          )}
                        </div>
                        <Badge variant={result.parentEmail ? (result.sent ? "default" : "secondary") : "outline"}>
                          {result.parentEmail
                            ? (result.sent ? "Email sent" : "Invite pending")
                            : "Added"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <Button variant="outline" className="w-full" onClick={handleClose}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold">Add by name</h3>
                    <p className="text-xs text-muted-foreground">Enter one player or add more rows for multiple players.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setCsvImportOpen(true)}>
                    <Upload className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                </div>

                <div className="space-y-4">
                  {players.map((player, idx) => (
                    <div key={player.id} className="space-y-3 border-b border-border pb-4 last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">Player {idx + 1}</p>
                        {players.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => removeRow(player.id)}
                            aria-label={`Remove player ${idx + 1}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`mini-league-player-name-${player.id}`}>Player name</Label>
                        <Input
                          id={`mini-league-player-name-${player.id}`}
                          placeholder="e.g. Tommy Smith"
                          value={player.name}
                          onChange={(event) => updatePlayer(player.id, "name", event.target.value)}
                          onPaste={idx === 0 ? (event) => {
                            const text = event.clipboardData.getData("text");
                            if (handlePastePlayers(text)) event.preventDefault();
                          } : undefined}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`mini-league-ability-${player.id}`}>Ability rating</Label>
                        <Select
                          value={player.abilityRating}
                          onValueChange={(value) => updatePlayer(player.id, "abilityRating", value)}
                        >
                          <SelectTrigger id={`mini-league-ability-${player.id}`}>
                            <SelectValue placeholder="Ability" />
                          </SelectTrigger>
                          <SelectContent>
                            {abilityOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor={`mini-league-parent-name-${player.id}`}>Parent name optional</Label>
                          <Input
                            id={`mini-league-parent-name-${player.id}`}
                            placeholder="Parent name"
                            value={player.parentName}
                            onChange={(event) => updatePlayer(player.id, "parentName", event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`mini-league-parent-email-${player.id}`}>Parent email optional</Label>
                          <Input
                            id={`mini-league-parent-email-${player.id}`}
                            type="email"
                            placeholder="parent@email.com"
                            value={player.parentEmail}
                            onChange={(event) => updatePlayer(player.id, "parentEmail", event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Button variant="outline" className="w-full" onClick={addRow}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Another Player
                </Button>

                <Button
                  className="w-full"
                  onClick={() => addPlayersMutation.mutate(undefined)}
                  disabled={!players.some((player) => player.name.trim()) || isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      {players.filter((player) => player.parentEmail.trim()).length > 0
                        ? "Add & Send Invites"
                        : "Add Players"}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
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
