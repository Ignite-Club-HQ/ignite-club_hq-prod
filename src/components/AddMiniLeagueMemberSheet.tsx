import { useState, useEffect, useRef, type CSSProperties } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, X, Send, Plus, Upload, ChevronDown, ChevronUp, Check } from "lucide-react";
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
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useToast } from "@/hooks/use-toast";

interface BulkPlayer {
  id: string;
  name: string;
  abilityRating: string;
  parentName: string;
  parentEmail: string;
  existingChildId?: string;
  existingParentUserId?: string;
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
  const nativeKeyboardHeight = useNativeKeyboardHeight();
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
  const [inviteByNameExpanded, setInviteByNameExpanded] = useState(false);
  const [activeSearch, setActiveSearch] = useState<{ rowId: string; field: "name" | "parentName" } | null>(null);
  const [parentQuery, setParentQuery] = useState("");
  const [debouncedParentQuery, setDebouncedParentQuery] = useState("");
  const [visualKeyboardInset, setVisualKeyboardInset] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedParentQuery(parentQuery), 250);
    return () => clearTimeout(t);
  }, [parentQuery]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      setVisualKeyboardInset(0);
      return;
    }

    const syncKeyboardInset = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        setVisualKeyboardInset(0);
        return;
      }
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setVisualKeyboardInset(Math.round(inset));
    };

    syncKeyboardInset();
    window.visualViewport?.addEventListener("resize", syncKeyboardInset);
    window.visualViewport?.addEventListener("scroll", syncKeyboardInset);
    window.addEventListener("resize", syncKeyboardInset);

    return () => {
      window.visualViewport?.removeEventListener("resize", syncKeyboardInset);
      window.visualViewport?.removeEventListener("scroll", syncKeyboardInset);
      window.removeEventListener("resize", syncKeyboardInset);
    };
  }, [open]);

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

  // Fetch existing children in this club for player name search
  const { data: clubChildren = [] } = useQuery({
    queryKey: ["mini-league-club-children", clubId],
    queryFn: async () => {
      const { data: teamIds } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId);

      const childIds = new Set<string>();
      if (teamIds?.length) {
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .in("team_id", teamIds.map(t => t.id));
        assignments?.forEach(a => childIds.add(a.child_id));
      }

      const { data: clubParents } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "parent");
      const parentUserIds = [...new Set(clubParents?.map(p => p.user_id) || [])];
      if (parentUserIds.length) {
        const { data: parentChildren } = await supabase
          .from("children")
          .select("id")
          .in("parent_id", parentUserIds);
        parentChildren?.forEach(c => childIds.add(c.id));
      }

      if (!childIds.size) return [];
      const { data: children } = await supabase
        .from("children")
        .select("id, name, parent_id")
        .in("id", [...childIds]);
      if (!children?.length) return [];

      const parentIds = [...new Set(children.map(c => c.parent_id).filter(Boolean))];
      const { data: parents } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", parentIds);
      const parentMap = new Map(parents?.map(p => [p.id, p.display_name]) || []);

      return children.map(c => ({
        id: c.id,
        name: c.name,
        parent_id: c.parent_id,
        parent_name: parentMap.get(c.parent_id) || "",
      }));
    },
    enabled: open && inviteByNameExpanded && !!clubId,
  });

  // Search invitable parents
  const { data: parentResults = [] } = useQuery({
    queryKey: ["mini-league-parent-search", debouncedParentQuery],
    queryFn: async () => {
      if (debouncedParentQuery.trim().length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedParentQuery.trim(),
        _limit: 6,
      });
      return (data || []) as Array<{
        id: string;
        display_name: string | null;
        masked_email: string | null;
      }>;
    },
    enabled: debouncedParentQuery.trim().length >= 2,
  });

  const handleClose = () => {
    setOpen(false);
    setPlayers([createEmptyPlayer()]);
    setResults([]);
    setInviteByNameExpanded(false);
    setActiveSearch(null);
    setParentQuery("");
  };

  const addPlayersMutation = useMutation({
    mutationFn: async (playersToAdd?: BulkPlayer[]) => {
      const playersSource = playersToAdd || players;
      const validPlayers = playersSource.filter((player) => player.name.trim());
      if (validPlayers.length === 0) throw new Error("Please enter at least one player");

      const addedResults: { playerName: string; parentEmail: string; sent: boolean }[] = [];

      for (const player of validPlayers) {
        let childId = player.existingChildId;

        if (!childId) {
          const { data: child, error: childError } = await supabase
            .from("children")
            .insert({
              parent_id: player.existingParentUserId || user!.id,
              name: player.name.trim(),
            })
            .select()
            .single();

          if (childError) {
            console.error("Failed to create child:", player.name, childError);
            continue;
          }
          childId = child.id;
        }

        const { error: assignmentError } = await supabase
          .from("child_mini_league_assignments")
          .insert({
            child_id: childId!,
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
            child_id: childId!,
            parent_user_id: player.existingParentUserId || null,
          })
          .select()
          .single();

        if (playerError) {
          console.warn("Failed to create legacy player record:", player.name, playerError);
        }

        let sent = false;

        if (player.parentEmail.trim() && !player.existingParentUserId) {
          const inviteToken = crypto.randomUUID();
          const inviteMetadata: Json = {
            mini_league_id: miniLeagueId,
            child_id: childId,
            player_id: newPlayer?.id,
            player_name: player.name.trim(),
            children: [{ name: player.name.trim(), yearOfBirth: null }],
          };
          const invitePayload: Database["public"]["Tables"]["pending_invites"]["Insert"] = {
            club_id: clubId,
            role: "parent",
            invited_user_id: null,
            invited_by_user_id: user!.id,
            invited_label: player.parentName.trim() || player.parentEmail.trim(),
            invited_email: player.parentEmail.trim().toLowerCase(),
            invite_token: inviteToken,
            metadata: inviteMetadata,
          };
          const { error: inviteError } = await supabase.from("pending_invites").insert(invitePayload);

          if (!inviteError) {
            try {
              const link = `${window.location.origin}/join/p/${inviteToken}`;
              const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
                body: {
                  to: player.parentEmail.trim(),
                  subject: `You're invited to ${miniLeagueName}`,
                  template: "team-invite",
                  senderName: clubBranding?.name || undefined,
                  replyTo: clubBranding?.contact_email || undefined,
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
                } satisfies Database["public"]["Tables"]["pending_invites"]["Update"])
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

  const updatePlayer = (id: string, patch: Partial<BulkPlayer>) => {
    setPlayers((current) => current.map((player) => player.id === id ? { ...player, ...patch } : player));
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

  const childMatchesFor = (q: string) => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return clubChildren.filter(c => c.name?.toLowerCase().includes(query)).slice(0, 6);
  };

  const activePlayer = activeSearch ? players.find((player) => player.id === activeSearch.rowId) : undefined;
  const activeChildSuggestions = activeSearch?.field === "name" && activePlayer && !activePlayer.existingChildId
    ? childMatchesFor(activePlayer.name)
    : [];
  const activeParentSuggestions = activeSearch?.field === "parentName" && activePlayer && !activePlayer.existingParentUserId
    ? parentResults
    : [];
  const keyboardInset = Math.max(nativeKeyboardHeight, visualKeyboardInset);
  const sheetStyle = {
    "--mini-league-keyboard-inset": `${keyboardInset}px`,
    bottom: `${keyboardInset}px`,
  } as CSSProperties;

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
        <SheetContent
          side="bottom"
          className="h-[min(85vh,calc(100dvh-var(--mini-league-keyboard-inset)))] rounded-t-2xl flex flex-col overflow-hidden overscroll-contain transition-[bottom,height] duration-200 ease-out"
          data-lock-keyboard-scroll="true"
          data-allow-scroll
          style={sheetStyle}
        >
          <SheetHeader className="mb-3 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add Players
            </SheetTitle>
            <SheetDescription>
              Add players to {miniLeagueName}
            </SheetDescription>
          </SheetHeader>

          <div data-allow-scroll className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 pb-24 overscroll-contain" style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
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
                <MiniLeagueParentJoinLinkCard
                  miniLeagueId={miniLeagueId}
                  miniLeagueName={miniLeagueName}
                  clubId={clubId}
                />
                {!inviteByNameExpanded ? (
                  <button
                    type="button"
                    onClick={() => setInviteByNameExpanded(true)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm font-medium hover:bg-muted/40 transition-colors min-h-[44px]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-muted-foreground" />
                      Invite a specific player
                    </span>
                    <span className="text-xs text-muted-foreground">Name or CSV</span>
                  </button>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-semibold">Invite by name</h3>
                        <p className="text-xs text-muted-foreground">Search existing or add new players.</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => setCsvImportOpen(true)}>
                          <Upload className="h-4 w-4 mr-1" />
                          CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setInviteByNameExpanded(false)}
                          aria-label="Collapse"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {players.map((player, idx) => {
                        return (
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

                            <div className="space-y-2 relative">
                              <Label htmlFor={`mini-league-player-name-${player.id}`}>Player name</Label>
                              <Input
                                id={`mini-league-player-name-${player.id}`}
                                placeholder="Search or type a new name"
                                value={player.name}
                                onFocus={() => setActiveSearch({ rowId: player.id, field: "name" })}
                                onBlur={() => setTimeout(() => setActiveSearch((s) => s?.rowId === player.id && s.field === "name" ? null : s), 150)}
                                onChange={(event) => updatePlayer(player.id, { name: event.target.value, existingChildId: undefined })}
                                onPaste={idx === 0 ? (event) => {
                                  const text = event.clipboardData.getData("text");
                                  if (handlePastePlayers(text)) event.preventDefault();
                                } : undefined}
                              />
                              {player.existingChildId && (
                                <p className="text-xs text-primary flex items-center gap-1">
                                  <Check className="h-3 w-3" /> Linked to existing player
                                </p>
                              )}
                              {activeSearch?.rowId === player.id && activeSearch.field === "name" && !player.existingChildId && player.name.trim().length >= 2 && (
                                <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                                  {activeChildSuggestions.length > 0 ? activeChildSuggestions.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      className="w-full text-left p-2 rounded-lg hover:bg-background transition-colors text-sm"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        updatePlayer(player.id, {
                                          name: c.name,
                                          existingChildId: c.id,
                                          existingParentUserId: c.parent_id || undefined,
                                          parentName: c.parent_name || "",
                                        });
                                        setActiveSearch(null);
                                      }}
                                    >
                                      <p className="font-medium">{c.name}</p>
                                      {c.parent_name && <p className="text-xs text-muted-foreground">Parent: {c.parent_name}</p>}
                                    </button>
                                  )) : (
                                    <p className="px-2 py-1 text-xs text-muted-foreground">No existing players found — will add as new player</p>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`mini-league-ability-${player.id}`}>Ability rating</Label>
                              <Select
                                value={player.abilityRating}
                                onValueChange={(value) => updatePlayer(player.id, { abilityRating: value })}
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
                              <div className="space-y-2 relative">
                                <Label htmlFor={`mini-league-parent-name-${player.id}`}>Parent name optional</Label>
                                <Input
                                  id={`mini-league-parent-name-${player.id}`}
                                  placeholder="Search existing or type"
                                  value={player.parentName}
                                  onFocus={() => {
                                    setActiveSearch({ rowId: player.id, field: "parentName" });
                                    setParentQuery(player.parentName);
                                  }}
                                  onBlur={() => setTimeout(() => setActiveSearch((s) => s?.rowId === player.id && s.field === "parentName" ? null : s), 150)}
                                  onChange={(event) => {
                                    updatePlayer(player.id, { parentName: event.target.value, existingParentUserId: undefined });
                                    setParentQuery(event.target.value);
                                  }}
                                />
                                {player.existingParentUserId && (
                                  <p className="text-xs text-primary flex items-center gap-1">
                                    <Check className="h-3 w-3" /> Linked to existing parent
                                  </p>
                                )}
                                {activeSearch?.rowId === player.id && activeSearch.field === "parentName" && !player.existingParentUserId && player.parentName.trim().length >= 2 && (
                                  <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                                    {activeParentSuggestions.length > 0 ? activeParentSuggestions.map((p) => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        className="w-full text-left p-2 rounded-lg hover:bg-background transition-colors text-sm"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          updatePlayer(player.id, {
                                            parentName: p.display_name || "",
                                            existingParentUserId: p.id,
                                            parentEmail: "",
                                          });
                                          setActiveSearch(null);
                                        }}
                                      >
                                        <p className="font-medium">{p.display_name || "Unknown"}</p>
                                        {p.masked_email && <p className="text-xs text-muted-foreground">{p.masked_email}</p>}
                                      </button>
                                    )) : (
                                      <p className="px-2 py-1 text-xs text-muted-foreground">No existing parents found — keep typing to add manually</p>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`mini-league-parent-email-${player.id}`}>Parent email optional</Label>
                                <Input
                                  id={`mini-league-parent-email-${player.id}`}
                                  type="email"
                                  placeholder="parent@email.com"
                                  value={player.parentEmail}
                                  disabled={!!player.existingParentUserId}
                                  onChange={(event) => updatePlayer(player.id, { parentEmail: event.target.value })}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
                          {players.filter((player) => player.parentEmail.trim() && !player.existingParentUserId).length > 0
                            ? "Add & Send Invites"
                            : "Add Players"}
                        </>
                      )}
                    </Button>
                  </>
                )}
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

