import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, Mail, X, Send, Users, Plus, Trash2, Upload, Baby, User, Star, Search, CheckCircle2, ChevronUp } from "lucide-react";
import { MiniLeagueMemberCSVImportDialog } from "@/components/MiniLeagueMemberCSVImportDialog";
import MiniLeagueParentJoinLinkCard from "@/components/mini-league/MiniLeagueParentJoinLinkCard";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useDebounce } from "@/hooks/useDebounce";

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
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [inviteByNameExpanded, setInviteByNameExpanded] = useState(false);
  
  // Single input state
  const [playerName, setPlayerName] = useState("");
  const [abilityRating, setAbilityRating] = useState("3");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  // Parent search state
  const [parentSearchQuery, setParentSearchQuery] = useState("");
  const [selectedParent, setSelectedParent] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [parentMode, setParentMode] = useState<"search" | "manual">("search");
  
  // Bulk input state
  const [bulkPlayers, setBulkPlayers] = useState<BulkPlayer[]>([
    { id: crypto.randomUUID(), name: "", abilityRating: "3", parentName: "", parentEmail: "" },
  ]);
  const [bulkResults, setBulkResults] = useState<{ playerName: string; parentEmail: string; sent: boolean }[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const debouncedParentSearch = useDebounce(parentSearchQuery, 300);

  // Fetch club branding for emails
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

  // Search for existing users (for parent linking)
  const { data: parentSearchResults = [], isLoading: isSearchingParent } = useQuery({
    queryKey: ["user-search-mini-league-parent", debouncedParentSearch],
    queryFn: async () => {
      if (debouncedParentSearch.length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedParentSearch,
        _limit: 8,
      });
      return (data || []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        masked_email: string | null;
      }>;
    },
    enabled: debouncedParentSearch.length >= 2 && parentMode === "search" && !selectedParent,
  });

  const handleClose = () => {
    setOpen(false);
    setPlayerName("");
    setAbilityRating("3");
    setParentName("");
    setParentEmail("");
    setParentSearchQuery("");
    setSelectedParent(null);
    setParentMode("search");
    setBulkPlayers([{ id: crypto.randomUUID(), name: "", abilityRating: "3", parentName: "", parentEmail: "" }]);
    setBulkResults([]);
    setInviteByNameExpanded(false);
    setMode("single");
  };

  // Helper: ensure user has parent role in club
  const ensureParentRole = async (parentUserId: string) => {
    // Check if user already has a role in this club
    const { data: existingRole } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", parentUserId)
      .eq("club_id", clubId)
      .limit(1);
    
    if (!existingRole || existingRole.length === 0) {
      // Add parent role at club level
      await supabase.from("user_roles").insert({
        user_id: parentUserId,
        club_id: clubId,
        role: "parent" as any,
      });
    }
  };

  // Add single player - creates child record and league assignment
  const addPlayerMutation = useMutation({
    mutationFn: async () => {
      if (!playerName.trim()) throw new Error("Player name is required");

      const parentUserId = selectedParent?.id || null;

      // Create child record
      const { data: child, error: childError } = await supabase
        .from("children")
        .insert({
          parent_id: parentUserId || user!.id,
          name: playerName.trim(),
        })
        .select()
        .single();
      
      if (childError) throw childError;

      // Create mini league assignment with ability rating
      const { error: assignmentError } = await supabase
        .from("child_mini_league_assignments")
        .insert({
          child_id: child.id,
          mini_league_id: miniLeagueId,
          ability_rating: parseInt(abilityRating),
        });
      
      if (assignmentError) throw assignmentError;

      // Also create legacy mini_league_players record for backward compatibility
      const { data: player, error: playerError } = await supabase
        .from("mini_league_players")
        .insert({
          mini_league_id: miniLeagueId,
          name: playerName.trim(),
          ability_rating: parseInt(abilityRating),
          child_id: child.id,
          parent_user_id: parentUserId,
        })
        .select()
        .single();
      
      if (playerError) {
        console.warn("Failed to create legacy player record:", playerError);
      }

      // If existing user selected as parent, add role and notify
      if (parentUserId) {
        await ensureParentRole(parentUserId);

        // Also link child to parent via child_guardians if not already the owner
        if (parentUserId !== user!.id) {
          await supabase.from("child_guardians").insert({
            child_id: child.id,
            guardian_id: parentUserId,
            is_primary: true,
            relationship_type: "parent",
          }).then(() => {});
        }

        // Send notification to the parent
        await supabase.from("notifications").insert({
          user_id: parentUserId,
          type: "membership",
          message: `${playerName.trim()} has been added to ${miniLeagueName}`,
          related_id: miniLeagueId,
        });

        return { child, player, inviteToken: null, parentEmail: null, linkedExisting: true };
      }

      // If parent email provided (manual mode), create pending invite
      if (parentEmail.trim()) {
        const inviteToken = crypto.randomUUID();
        
        const { error: inviteError } = await supabase.from("pending_invites").insert({
          club_id: clubId,
          role: "parent" as any,
          invited_user_id: null,
          invited_by_user_id: user!.id,
          invited_label: parentName.trim() || parentEmail.trim(),
          invited_email: parentEmail.trim().toLowerCase(),
          invite_token: inviteToken,
          metadata: { 
            mini_league_id: miniLeagueId,
            child_id: child.id,
            player_id: player?.id,
            player_name: playerName.trim(),
            children: [{ name: playerName.trim(), yearOfBirth: null }],
          },
        } as any);
        
        if (inviteError) throw inviteError;

        return { child, player, inviteToken, parentEmail: parentEmail.trim(), linkedExisting: false };
      }

      return { child, player, inviteToken: null, parentEmail: null, linkedExisting: false };
    },
    onSuccess: async ({ player, inviteToken, parentEmail: email, linkedExisting }) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", miniLeagueId] });
      
      if (linkedExisting) {
        toast({
          title: "Player added!",
          description: `${playerName} added and linked to ${selectedParent?.display_name}`,
        });
        handleClose();
        return;
      }

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
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: parentName.trim() || email,
                invitedEmail: email,
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

  // Bulk add players - creates child records and league assignments
  const addBulkPlayersMutation = useMutation({
    mutationFn: async (playersToAdd?: BulkPlayer[]) => {
      const playersSource = playersToAdd || bulkPlayers;
      const validPlayers = playersSource.filter(p => p.name.trim());
      if (validPlayers.length === 0) throw new Error("Please enter at least one player");

      const results: { playerName: string; parentEmail: string; sent: boolean }[] = [];

      for (const player of validPlayers) {
        // Create child record
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

        // Create mini league assignment with ability rating
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

        // Also create legacy mini_league_players record
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

        // Create pending invite if parent email provided
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
            // Send email
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

          {!inviteByNameExpanded ? (
            <button
              type="button"
              onClick={() => setInviteByNameExpanded(true)}
              className="mt-3 w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm font-medium hover:bg-muted/40 transition-colors min-h-[44px]"
            >
              <span className="inline-flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                Invite a specific player
              </span>
              <span className="text-xs text-muted-foreground">Name or email</span>
            </button>
          ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="flex-1 flex flex-col mt-4 min-h-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">Invite by name</h3>
                <p className="text-xs text-muted-foreground">Add a player and optionally link a parent.</p>
              </div>
              <button
                type="button"
                onClick={() => setInviteByNameExpanded(false)}
                className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors min-h-[32px]"
                aria-label="Collapse invite by name"
              >
                <ChevronUp className="h-4 w-4" />
                Hide
              </button>
            </div>
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
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text");
                      if (!looksLikeMultiRecipient(text)) return;
                      const recipients = parseRecipients(text);
                      if (recipients.length < 2) return;
                      e.preventDefault();
                      setBulkPlayers(recipients.map((r) => ({
                        id: crypto.randomUUID(),
                        name: r.name,
                        abilityRating: "3",
                        parentName: "",
                        parentEmail: r.email,
                      })));
                      setMode("bulk");
                      toast({
                        title: `${recipients.length} players detected`,
                        description: "Switched to Bulk. Review and add.",
                      });
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">You can paste multiple names to add many at once.</p>
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

              {/* Parent Info - with search or manual */}
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Link Parent (Optional)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Search for an existing user or enter details to send an invite
                </p>

                {/* Mode toggle */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={parentMode === "search" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setParentMode("search");
                      setParentName("");
                      setParentEmail("");
                    }}
                  >
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                    Existing User
                  </Button>
                  <Button
                    type="button"
                    variant={parentMode === "manual" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setParentMode("manual");
                      setSelectedParent(null);
                      setParentSearchQuery("");
                    }}
                  >
                    <Mail className="h-3.5 w-3.5 mr-1.5" />
                    New Invite
                  </Button>
                </div>

                {parentMode === "search" ? (
                  <div className="space-y-2">
                    {selectedParent ? (
                      <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={selectedParent.avatar_url || undefined} />
                          <AvatarFallback className="text-xs">
                            {selectedParent.display_name?.charAt(0)?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{selectedParent.display_name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-primary" />
                            Will be linked as parent
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setSelectedParent(null);
                            setParentSearchQuery("");
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search by name..."
                            value={parentSearchQuery}
                            onChange={(e) => setParentSearchQuery(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                        {isSearchingParent && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Searching...
                          </div>
                        )}
                        {parentSearchResults.length > 0 && (
                          <div className="border rounded-lg divide-y max-h-48 overflow-auto">
                            {parentSearchResults.map((result) => (
                              <button
                                key={result.id}
                                className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left"
                                onClick={() => {
                                  setSelectedParent(result);
                                  setParentSearchQuery("");
                                }}
                              >
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={result.avatar_url || undefined} />
                                  <AvatarFallback className="text-xs">
                                    {result.display_name?.charAt(0)?.toUpperCase() || "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-sm font-medium truncate">{result.display_name}</span>
                                  {(result as any).masked_email && (
                                    <span className="text-xs text-muted-foreground truncate">{(result as any).masked_email}</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {debouncedParentSearch.length >= 2 && !isSearchingParent && parentSearchResults.length === 0 && (
                          <p className="text-xs text-muted-foreground p-2">
                            No users found. Try "New Invite" to send an email instead.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Parent Name</Label>
                    <Input
                      placeholder="e.g. John Smith"
                      value={parentName}
                      onChange={(e) => setParentName(e.target.value)}
                    />
                    <Label>Parent Email</Label>
                    <Input
                      type="email"
                      placeholder="parent@example.com"
                      value={parentEmail}
                      onChange={(e) => setParentEmail(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <Button
                className="w-full"
                onClick={() => addPlayerMutation.mutate()}
                disabled={!playerName.trim() || isPending}
              >
                {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {selectedParent ? (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Player & Link Parent
                  </>
                ) : parentEmail.trim() ? (
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
                <div className="flex flex-col h-full space-y-3">
                  <h3 className="text-sm font-medium">Results</h3>
                  <ScrollArea className="flex-1 h-[50vh]">
                    <div className="space-y-2 pr-4">
                      {bulkResults.map((result, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                          <div>
                            <p className="font-medium text-sm">{result.playerName}</p>
                            {result.parentEmail && (
                              <p className="text-xs text-muted-foreground">{result.parentEmail}</p>
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
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Adding Players...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Add Players & Send Invites
                      </>
                    )}
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
          )}
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
