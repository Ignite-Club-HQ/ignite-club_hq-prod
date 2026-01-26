import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Send, Users } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

interface AddClubAdminSheetProps {
  clubId: string;
  clubName: string;
}

export default function AddClubAdminSheet({ clubId, clubName }: AddClubAdminSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [customName, setCustomName] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [mode, setMode] = useState<"existing" | "invite">("invite");

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch existing club admins
  const { data: existingMembers } = useQuery({
    queryKey: ["club-roles", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .is("team_id", null);
      return data?.map(m => m.user_id) || [];
    },
    enabled: !!clubId,
  });

  // Fetch club branding data for emails
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

  // Search for existing users
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-club-admin", debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < 2) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .ilike("display_name", `%${debouncedSearch}%`)
        .limit(8);
      return data || [];
    },
    enabled: debouncedSearch.length >= 2,
  });

  // Filter out existing members
  const filteredResults = searchResults.filter(
    user => !existingMembers?.includes(user.id)
  );

  // Add existing user directly to club
  const addExistingUserMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("No user selected");

      const { error } = await supabase.from("user_roles").insert({
        user_id: selectedUser.id,
        club_id: clubId,
        role: "club_admin",
      });
      if (error) throw error;

      // Send notification
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "membership",
        message: `You have been added to ${clubName} as Club Admin`,
        related_id: clubId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-roles", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-members-roles", clubId] });
      toast({
        title: "Admin added",
        description: `${selectedUser?.display_name} has been added as a club admin`,
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add admin",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add pending member (by name) with invite
  const addPendingMemberMutation = useMutation({
    mutationFn: async () => {
      if (!customName.trim()) throw new Error("Please enter a name");

      // Create a unique token for this specific pending invite
      const inviteToken = crypto.randomUUID();

      // Create pending invite record with the unique token
      const { error: inviteError } = await supabase.from("pending_invites").insert({
        club_id: clubId,
        team_id: null,
        role: "club_admin" as any,
        invited_user_id: null, // Will be set when user accepts invite
        invited_by_user_id: user!.id,
        invited_label: customName.trim(),
        invited_email: customEmail.trim().toLowerCase() || null,
        invite_token: inviteToken,
      } as any);
      if (inviteError) throw inviteError;

      // Use the pending invite token for name-restricted link
      const link = `${window.location.origin}/join/p/${inviteToken}`;
      return { link, email: customEmail.trim(), inviteToken };
    },
    onSuccess: async ({ link, email, inviteToken }) => {
      setInviteLink(link);
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });

      // Auto-send email notification if email was provided
      if (email) {
        setIsSendingNotification(true);
        let emailSent = false;
        let emailId: string | null = null;
        let emailError: string | null = null;
        
        try {
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: email,
              subject: `You're invited to join ${clubName} as an Admin`,
              template: "team-invite",
              templateData: {
                recipientName: customName.trim(),
                teamName: clubName, // Using teamName field for club name
                clubName: clubName,
                roleName: "Club Admin",
                inviteLink: link,
                clubLogoUrl: clubBranding?.logo_url || undefined,
              },
            },
          });
          
          if (funcError) {
            emailError = funcError.message || "Function error";
            console.error("Email function error:", funcError);
          } else if (emailResult?.verified && emailResult?.success) {
            emailSent = true;
            emailId = emailResult.emailId;
            toast({
              title: "Invite sent!",
              description: `Email notification sent to ${email}`,
            });
          } else {
            emailError = emailResult?.error || "Email not verified";
            console.warn("Email not verified:", emailResult);
            toast({
              title: "Admin added",
              description: "Could not send email, but invite link is ready to share",
              variant: "default",
            });
          }
        } catch (error) {
          emailError = error instanceof Error ? error.message : "Unknown error";
          console.error("Failed to send email:", error);
          toast({
            title: "Admin added",
            description: "Could not send email, but invite link is ready to share",
            variant: "default",
          });
        } finally {
          setIsSendingNotification(false);
          
          // Update pending invite with email status
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailId,
              email_error: emailError,
            } as any)
            .eq("invite_token", inviteToken);
        }
      } else {
        toast({
          title: "Admin added as pending",
          description: `${customName} has been added. Share the invite link with them.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add admin",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setOpen(false);
    setSearchQuery("");
    setSelectedUser(null);
    setCustomName("");
    setCustomEmail("");
    setInviteLink(null);
    setInviteSent(false);
    setMode("invite");
  };

  const handleDone = () => {
    handleClose();
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => isOpen ? setOpen(true) : handleClose()}>
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4 mr-2" />
          Add Admin
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-1 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-purple-500/10">
              <Users className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <SheetTitle>Add Club Admin</SheetTitle>
              <SheetDescription className="text-sm">{clubName}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Success State - Email sent confirmation */}
        {inviteLink && (
          <div className="space-y-5 pt-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-2">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="font-semibold text-lg">Invite Sent!</h3>
              <p className="text-sm text-muted-foreground">
                Email invitation sent to <span className="font-medium">{customEmail}</span>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <p className="font-medium mb-1">{customName}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Invited as Club Admin
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => {
                  setInviteLink(null);
                  setCustomName("");
                  setCustomEmail("");
                }}
              >
                Add Another
              </Button>
              <Button className="flex-1" onClick={handleDone}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Main Form */}
        {!inviteLink && (
          <div className="space-y-5 pt-6">
            <Tabs value={mode} onValueChange={(v) => setMode(v as "existing" | "invite")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="invite">
                  <Mail className="h-4 w-4 mr-2" />
                  Invite New
                </TabsTrigger>
                <TabsTrigger value="existing">
                  <Search className="h-4 w-4 mr-2" />
                  Add Existing
                </TabsTrigger>
              </TabsList>

              {/* Invite New Admin */}
              <TabsContent value="invite" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Name *</Label>
                  <Input
                    placeholder="Enter admin's name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Email *</Label>
                  <Input
                    type="email"
                    placeholder="Enter email to send invite"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    An invite email will be sent to this address
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-purple-500/20 text-purple-600 border-purple-500/30">
                      Club Admin
                    </Badge>
                    <span className="text-xs text-muted-foreground">Full club management access</span>
                  </div>
                </div>

                <Button
                  className="w-full h-12"
                  onClick={() => addPendingMemberMutation.mutate()}
                  disabled={!customName.trim() || !customEmail.trim() || addPendingMemberMutation.isPending || isSendingNotification}
                >
                  {addPendingMemberMutation.isPending || isSendingNotification ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <Send className="h-5 w-5 mr-2" />
                  )}
                  Send Invite
                </Button>
              </TabsContent>

              {/* Add Existing User */}
              <TabsContent value="existing" className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Search User</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Type a name to search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 h-11"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                        onClick={() => {
                          setSearchQuery("");
                          setSelectedUser(null);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Search Results */}
                {debouncedSearch.length >= 2 && (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                    {isSearching ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredResults.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No users found
                      </p>
                    ) : (
                      filteredResults.map((result) => (
                        <div
                          key={result.id}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                            selectedUser?.id === result.id
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "hover:bg-background border border-transparent hover:border-border"
                          }`}
                          onClick={() => setSelectedUser(result)}
                        >
                          <Avatar className="h-9 w-9 border-2 border-background">
                            <AvatarImage src={result.avatar_url || undefined} />
                            <AvatarFallback className={selectedUser?.id === result.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/20 text-primary"}>
                              {result.display_name?.charAt(0) || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm flex-1">{result.display_name || "Unknown"}</span>
                          {selectedUser?.id === result.id && (
                            <CheckCircle2 className="h-5 w-5" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Selected User Preview */}
                {selectedUser && (
                  <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/5 to-purple-500/10 border border-purple-500/20">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Selected User</p>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10 border-2 border-purple-500/20">
                        <AvatarImage src={selectedUser.avatar_url || undefined} />
                        <AvatarFallback className="bg-purple-500/20 text-purple-600 font-semibold">
                          {selectedUser.display_name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-semibold">{selectedUser.display_name}</span>
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-purple-500/20 text-purple-600 border-purple-500/30">
                      Club Admin
                    </Badge>
                    <span className="text-xs text-muted-foreground">Full club management access</span>
                  </div>
                </div>

                <Button
                  className="w-full h-12"
                  onClick={() => addExistingUserMutation.mutate()}
                  disabled={!selectedUser || addExistingUserMutation.isPending}
                >
                  {addExistingUserMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="h-5 w-5 mr-2" />
                  )}
                  Add as Club Admin
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
