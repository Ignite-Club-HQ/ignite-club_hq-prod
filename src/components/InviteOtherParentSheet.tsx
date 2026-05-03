import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, UserPlus, Mail, User, CheckCircle2, Share2, Copy, Search } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

interface InviteOtherParentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId: string;
  childName: string;
  teamIds: string[];
}

export default function InviteOtherParentSheet({
  open,
  onOpenChange,
  childId,
  childName,
  teamIds,
}: InviteOtherParentSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "share">("share");
  const [sent, setSent] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [resolvedClubName, setResolvedClubName] = useState("");
  const [resolvedTeamName, setResolvedTeamName] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; display_name: string | null; avatar_url: string | null } | null>(null);

  const debouncedName = useDebounce(parentName, 300);

  // Search for existing users as parent types
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["parent-invite-user-search", debouncedName],
    queryFn: async () => {
      if (debouncedName.length < 2) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .ilike("display_name", `%${debouncedName}%`)
        .limit(6);
      // Filter out self
      return (data || []).filter(u => u.id !== user?.id);
    },
    enabled: open && debouncedName.length >= 2 && !selectedUser,
  });

  // Direct link existing user as guardian (no invite needed)
  const linkExistingGuardian = useMutation({
    mutationFn: async () => {
      if (!selectedUser) return;
      const { error } = await supabase.from("child_guardians").insert({
        child_id: childId,
        guardian_id: selectedUser.id,
        relationship_type: "parent",
        is_primary: false,
      } as any);
      if (error && !error.message?.includes("duplicate")) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["child_guardians", childId] });
      queryClient.invalidateQueries({ queryKey: ["potential_guardians"] });
      toast({ title: `${selectedUser?.display_name || "Guardian"} linked to ${childName}` });
      handleClose(false);
    },
    onError: (error: Error) => {
      console.error("[LinkGuardian] Error:", error);
      toast({ title: "Failed to link guardian", variant: "destructive" });
    },
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      if (!user || !parentName.trim()) return;
      if (deliveryMethod === "email" && !parentEmail.trim()) return;

      const inviteToken = crypto.randomUUID();

      let clubId: string | null = null;
      let teamId: string | null = null;
      if (teamIds.length > 0) {
        teamId = teamIds[0];
        const { data: team } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", teamId)
          .single();
        clubId = team?.club_id || null;
      }

      const trimmedEmail = parentEmail.trim().toLowerCase();

      const { data: insertedInvite, error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: teamId,
        club_id: clubId,
        role: "parent" as any,
        invited_user_id: selectedUser?.id || null,
        invited_by_user_id: user.id,
        invited_label: parentName.trim(),
        invited_email: trimmedEmail || null,
        invite_token: inviteToken,
        metadata: {
          guardian_child_id: childId,
          guardian_child_name: childName,
          guardian_all_team_ids: teamIds,
          invited_by_parent: true,
        },
      } as any).select("id").single();

      if (inviteError) throw inviteError;

      const link = `${window.location.origin}/join/p/${inviteToken}`;

      let clubName = "Your Club";
      let clubLogoUrl: string | undefined;
      let contactEmail: string | undefined;
      if (clubId) {
        const { data: club } = await supabase
          .from("clubs")
          .select("name, logo_url, contact_email")
          .eq("id", clubId)
          .single();
        if (club) {
          clubName = club.name;
          clubLogoUrl = club.logo_url || undefined;
          contactEmail = club.contact_email || undefined;
        }
      }

      let teamName = "";
      if (teamId) {
        const { data: team } = await supabase
          .from("teams")
          .select("name")
          .eq("id", teamId)
          .single();
        teamName = team?.name || "";
      }

      setResolvedClubName(clubName);
      setResolvedTeamName(teamName);

      // Only send email if delivery method is email
      if (deliveryMethod === "email" && trimmedEmail) {
        await supabase.functions.invoke("send-email", {
          body: {
            to: trimmedEmail,
            subject: `${clubName}: You've been invited as a guardian for ${childName} ⚽`,
            template: "team-invite",
            senderName: clubName,
            replyTo: contactEmail,
            templateData: {
              recipientName: parentName.trim(),
              invitedEmail: trimmedEmail,
              teamName,
              clubName,
              roleName: "Parent",
              inviteLink: link,
              clubLogoUrl,
              childrenNames: [childName],
            },
          },
        });

        if (insertedInvite?.id) {
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: new Date().toISOString(),
            } as any)
            .eq("id", insertedInvite.id);
        }
      }

      return { link };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["child_guardians", childId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      setInviteLink(data?.link || null);
      setSent(true);
    },
    onError: (error: Error) => {
      console.error("[InviteOtherParent] Error:", error);
      toast({ title: "Failed to send invite", variant: "destructive" });
    },
  });

  const handleClose = (open: boolean) => {
    if (!open) {
      setTimeout(() => {
        setParentName("");
        setParentEmail("");
        setDeliveryMethod("share");
        setSent(false);
        setInviteLink(null);
        setResolvedClubName("");
        setResolvedTeamName("");
        setSelectedUser(null);
      }, 300);
    }
    onOpenChange(open);
  };

  const buildShareMessage = () => {
    const parts: string[] = [];
    if (resolvedClubName) {
      parts.push(`You've been invited to join ${resolvedClubName} as a guardian for ${childName}.`);
    } else {
      parts.push(`You've been invited as a guardian for ${childName}.`);
    }
    parts.push("");
    parts.push(`Tap the link to accept: ${inviteLink}`);
    return parts.join("\n");
  };

  const canSend = parentName.trim() && (deliveryMethod === "share" || (parentEmail.trim() && parentEmail.includes("@")));

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="max-w-md">
        {sent ? (
          <>
            <ResponsiveDialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <ResponsiveDialogTitle>Invite Created!</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    Guardian invite for {childName}
                  </ResponsiveDialogDescription>
                </div>
              </div>
            </ResponsiveDialogHeader>

            <div className="space-y-4 py-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
                <p className="font-medium mb-1">{parentName}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  {deliveryMethod === "email" && parentEmail
                    ? `Invite sent to ${parentEmail}`
                    : "Invite link created — share it with them"}
                </p>
              </div>

              {/* Share invite via other channels */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-center">Share invite via</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      const msg = buildShareMessage();
                      if (Capacitor.isNativePlatform()) {
                        try {
                          await Share.share({
                            title: `Join ${resolvedClubName || resolvedTeamName}`,
                            text: msg,
                            dialogTitle: "Share invite",
                          });
                          return;
                        } catch {
                          // cancelled
                        }
                      }
                      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
                    }}
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteLink || "");
                        toast({ title: "Invite link copied!" });
                      } catch {
                        toast({ title: "Failed to copy link", variant: "destructive" });
                      }
                    }}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Link
                  </Button>
                </div>
              </div>

              <p className="text-sm text-muted-foreground text-center">
                When they accept, they'll be automatically linked to <strong>{childName}</strong> as a guardian.
              </p>
            </div>

            <ResponsiveDialogFooter>
              <Button onClick={() => handleClose(false)} className="w-full">
                Done
              </Button>
            </ResponsiveDialogFooter>
          </>
        ) : (
          <>
            <ResponsiveDialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <ResponsiveDialogTitle>Invite Parent</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    Guardian for {childName}
                  </ResponsiveDialogDescription>
                </div>
              </div>
            </ResponsiveDialogHeader>

            <div className="space-y-4 py-2">
              {/* Name input with search */}
              <div className="space-y-1">
                {selectedUser ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={selectedUser.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {selectedUser.display_name?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium flex-1">{selectedUser.display_name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setSelectedUser(null);
                        setParentName("");
                      }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={parentName}
                        onChange={(e) => setParentName(e.target.value)}
                        placeholder="Search or type parent's name"
                        className="pl-10"
                        autoFocus
                      />
                    </div>

                    {isSearching && debouncedName.length >= 2 && (
                      <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Searching...
                      </div>
                    )}

                    {!isSearching && searchResults.length > 0 && debouncedName.length >= 2 && (
                      <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-1.5">
                        {searchResults.map((result) => (
                          <button
                            key={result.id}
                            type="button"
                            onClick={() => {
                              setSelectedUser(result);
                              setParentName(result.display_name || "");
                            }}
                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                          >
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={result.avatar_url || undefined} />
                              <AvatarFallback className="bg-primary/20 text-primary text-xs">
                                {result.display_name?.[0]?.toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{result.display_name || "Unknown"}</span>
                          </button>
                        ))}
                        <p className="text-xs text-muted-foreground px-2 pt-1">
                          Or continue typing to invite as new
                        </p>
                      </div>
                    )}

                    {!isSearching && debouncedName.length >= 2 && searchResults.length === 0 && (
                      <p className="text-xs text-muted-foreground py-1">
                        No existing users found — will be invited as new
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Delivery method toggle */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">How to deliver invite?</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setDeliveryMethod("email"); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      deliveryMethod === "email"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeliveryMethod("share"); setParentEmail(""); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      deliveryMethod === "share"
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <Share2 className="h-4 w-4" />
                    Share Link
                  </button>
                </div>

                {deliveryMethod === "email" && (
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      value={parentEmail}
                      onChange={(e) => setParentEmail(e.target.value)}
                      placeholder="e.g., parent@example.com"
                      className="pl-10"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </div>

            <ResponsiveDialogFooter className="mt-2">
              <Button
                className="w-full"
                onClick={() => sendInvite.mutate()}
                disabled={!canSend || sendInvite.isPending}
              >
                {sendInvite.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {!parentName.trim()
                  ? "Enter name to continue"
                  : deliveryMethod === "email" && !parentEmail.trim()
                    ? "Enter email to continue"
                    : "Create Invite"}
              </Button>
            </ResponsiveDialogFooter>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
