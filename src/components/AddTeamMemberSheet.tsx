import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Copy, Check, Send, Users, Plus, Trash2, Upload, Baby } from "lucide-react";
import { MemberCSVImportDialog } from "@/components/MemberCSVImportDialog";
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

interface BulkChild {
  id: string;
  name: string;
  yearOfBirth: string;
}

interface BulkMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: BulkChild[];
}

type TeamRole = "player" | "parent" | "coach" | "team_admin";

interface AddTeamMemberSheetProps {
  teamId: string;
  teamName: string;
  clubId: string;
}

const roleOptions: { value: TeamRole; label: string; description: string; color: string }[] = [
  { value: "player", label: "Player", description: "Active team player", color: "bg-amber-500/20 text-amber-600 border-amber-500/30" },
  { value: "parent", label: "Parent", description: "Parent/Guardian", color: "bg-pink-500/20 text-pink-600 border-pink-500/30" },
  { value: "coach", label: "Coach", description: "Team coach", color: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" },
  { value: "team_admin", label: "Team Admin", description: "Full admin access", color: "bg-blue-500/20 text-blue-600 border-blue-500/30" },
];

export default function AddTeamMemberSheet({ teamId, teamName, clubId }: AddTeamMemberSheetProps) {
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
  const [selectedRole, setSelectedRole] = useState<TeamRole>("player");
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [bulkMembers, setBulkMembers] = useState<BulkMember[]>([
    { id: crypto.randomUUID(), name: "", email: "", role: "player", children: [] },
  ]);
  const [bulkResults, setBulkResults] = useState<{ name: string; email: string; link: string; sent: boolean; role?: string; childrenCount?: number }[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch existing members
  const { data: existingMembers } = useQuery({
    queryKey: ["team-roles", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId);
      return data?.map(m => m.user_id) || [];
    },
    enabled: !!teamId,
  });

  // Search for existing users
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-team-member", debouncedSearch],
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

  // Create a unique invite token for a pending invite (name-restricted)
  const createPendingInviteToken = (): string => {
    return crypto.randomUUID();
  };

  // Get or create generic invite link for the selected role (used for existing users or when no name restriction)
  const getOrCreateInviteLink = async (role: TeamRole): Promise<string> => {
    // First check for existing invite
    const { data: existingInvite } = await supabase
      .from("team_invites")
      .select("token")
      .eq("team_id", teamId)
      .eq("role", role)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingInvite?.token) {
      return `${window.location.origin}/join/${existingInvite.token}`;
    }

    // Create new invite
    const token = crypto.randomUUID();
    const { error } = await supabase.from("team_invites").insert({
      team_id: teamId,
      role: role,
      token: token,
      created_by: user!.id,
    } as any);

    if (error) throw error;
    return `${window.location.origin}/join/${token}`;
  };

  // Add existing user directly to team
  const addExistingUserMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("No user selected");

      const { error } = await supabase.from("user_roles").insert({
        user_id: selectedUser.id,
        team_id: teamId,
        club_id: clubId,
        role: selectedRole,
      });
      if (error) throw error;

      // Send notification
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "membership",
        message: `You have been added to ${teamName} as ${roleOptions.find(r => r.value === selectedRole)?.label}`,
        related_id: teamId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      toast({
        title: "Member added",
        description: `${selectedUser?.display_name} has been added to the team`,
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add member",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add pending member (by name) with invite
  const addPendingMemberMutation = useMutation({
    mutationFn: async () => {
      if (!customName.trim()) throw new Error("Please enter a name");

      // Create a unique token for this specific pending invite (name-restricted)
      const inviteToken = createPendingInviteToken();

      // Create pending invite record with the unique token
      const { error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: teamId,
        club_id: clubId,
        role: selectedRole as any,
        invited_user_id: user!.id, // Set to current user as placeholder
        invited_by_user_id: user!.id,
        invited_label: customName.trim(),
        invited_email: customEmail.trim() || null,
        invite_token: inviteToken,
      } as any);
      if (inviteError) throw inviteError;

      // Use the pending invite token for name-restricted link
      const link = `${window.location.origin}/join/p/${inviteToken}`;
      return { link, email: customEmail.trim() };
    },
    onSuccess: async ({ link, email }) => {
      setInviteLink(link);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });

      // Auto-send email notification if email was provided
      if (email) {
        setIsSendingNotification(true);
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              to: email,
              subject: `You're invited to join ${teamName}`,
              html: `
                <h2>You've been invited to join ${teamName}!</h2>
                <p>Hi ${customName},</p>
                <p>You've been invited to join <strong>${teamName}</strong> as a <strong>${roleOptions.find(r => r.value === selectedRole)?.label}</strong>.</p>
                <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Accept Invite</a></p>
                <p>Or copy this link: ${link}</p>
                <p>See you there!</p>
              `,
            },
          });
          toast({
            title: "Invite sent!",
            description: `Email notification sent to ${email}`,
          });
        } catch (error) {
          console.error("Failed to send email:", error);
          toast({
            title: "Member added",
            description: "Could not send email, but invite link is ready to share",
            variant: "default",
          });
        } finally {
          setIsSendingNotification(false);
        }
      } else {
        toast({
          title: "Member added as pending",
          description: `${customName} has been added. Share the invite link with them.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add member",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Bulk add pending members with invites
  const addBulkMembersMutation = useMutation({
    mutationFn: async () => {
      const validMembers = bulkMembers.filter(m => m.name.trim());
      if (validMembers.length === 0) throw new Error("Please enter at least one name");

      const results: { name: string; email: string; link: string; sent: boolean; role: string; childrenCount: number }[] = [];

      for (const member of validMembers) {
        const inviteToken = crypto.randomUUID();
        const memberRole = member.role;

        // Build metadata for children (for parent role)
        const validChildren = member.children.filter(c => c.name.trim());
        const childrenMetadata = validChildren.length > 0 ? JSON.stringify(
          validChildren.map(c => ({ name: c.name.trim(), yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null }))
        ) : null;

        // Create pending invite record with children metadata
        const { error: inviteError } = await supabase.from("pending_invites").insert({
          team_id: teamId,
          club_id: clubId,
          role: memberRole as any,
          invited_user_id: user!.id,
          invited_by_user_id: user!.id,
          invited_label: member.name.trim(),
          invited_email: member.email.trim() || null,
          invite_token: inviteToken,
          metadata: childrenMetadata ? { children: JSON.parse(childrenMetadata) } : null,
        } as any);

        if (inviteError) {
          console.error("Failed to create invite for", member.name, inviteError);
          continue;
        }

        const link = `${window.location.origin}/join/p/${inviteToken}`;
        let sent = false;

        // Build email content with children info
        let childrenInfo = "";
        if (validChildren.length > 0) {
          childrenInfo = `<p>Your child${validChildren.length > 1 ? "ren" : ""} will also be registered: <strong>${validChildren.map(c => c.name).join(", ")}</strong></p>`;
        }

        // Send email if provided
        if (member.email.trim()) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                to: member.email.trim(),
                subject: `You're invited to join ${teamName}`,
                html: `
                  <h2>You've been invited to join ${teamName}!</h2>
                  <p>Hi ${member.name},</p>
                  <p>You've been invited to join <strong>${teamName}</strong> as a <strong>${roleOptions.find(r => r.value === memberRole)?.label}</strong>.</p>
                  ${childrenInfo}
                  <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Accept Invite</a></p>
                  <p>Or copy this link: ${link}</p>
                  <p>See you there!</p>
                `,
              },
            });
            sent = true;
          } catch (error) {
            console.error("Failed to send email to", member.email, error);
          }
        }

        results.push({ 
          name: member.name.trim(), 
          email: member.email.trim(), 
          link, 
          sent, 
          role: memberRole,
          childrenCount: validChildren.length 
        });
      }

      return results;
    },
    onSuccess: (results) => {
      setBulkResults(results);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });
      
      const sentCount = results.filter(r => r.sent).length;
      const totalCount = results.length;
      
      toast({
        title: `${totalCount} member${totalCount > 1 ? "s" : ""} added`,
        description: sentCount > 0 
          ? `${sentCount} invite email${sentCount > 1 ? "s" : ""} sent successfully`
          : "Share the invite links with your members",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add members",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: "Invite link copied!" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const handleCopyAllLinks = async () => {
    const linksText = bulkResults.map(r => `${r.name}: ${r.link}`).join("\n");
    try {
      await navigator.clipboard.writeText(linksText);
      toast({ title: "All invite links copied!" });
    } catch {
      toast({ title: "Failed to copy links", variant: "destructive" });
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSearchQuery("");
    setSelectedUser(null);
    setCustomName("");
    setCustomEmail("");
    setSelectedRole("player");
    setInviteLink(null);
    setCopied(false);
    setMode("single");
    setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: "player", children: [] }]);
    setBulkResults([]);
  };

  const handleDone = () => {
    handleClose();
  };

  const addBulkMemberRow = () => {
    setBulkMembers([...bulkMembers, { id: crypto.randomUUID(), name: "", email: "", role: selectedRole, children: [] }]);
  };

  const removeBulkMemberRow = (id: string) => {
    if (bulkMembers.length > 1) {
      setBulkMembers(bulkMembers.filter(m => m.id !== id));
    }
  };

  const updateBulkMember = (id: string, field: keyof Omit<BulkMember, "id" | "children">, value: string) => {
    setBulkMembers(bulkMembers.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const updateBulkMemberRole = (id: string, role: TeamRole) => {
    setBulkMembers(bulkMembers.map(m => m.id === id ? { ...m, role, children: role === "parent" ? m.children : [] } : m));
  };

  const addChildToMember = (memberId: string) => {
    setBulkMembers(bulkMembers.map(m => 
      m.id === memberId 
        ? { ...m, children: [...m.children, { id: crypto.randomUUID(), name: "", yearOfBirth: "" }] }
        : m
    ));
  };

  const removeChildFromMember = (memberId: string, childId: string) => {
    setBulkMembers(bulkMembers.map(m => 
      m.id === memberId 
        ? { ...m, children: m.children.filter(c => c.id !== childId) }
        : m
    ));
  };

  const updateChild = (memberId: string, childId: string, field: "name" | "yearOfBirth", value: string) => {
    setBulkMembers(bulkMembers.map(m => 
      m.id === memberId 
        ? { ...m, children: m.children.map(c => c.id === childId ? { ...c, [field]: value } : c) }
        : m
    ));
  };

  const validBulkCount = bulkMembers.filter(m => m.name.trim()).length;

  const selectedRoleOption = roleOptions.find(r => r.value === selectedRole);

  // If we have bulk results, show bulk success state
  if (bulkResults.length > 0) {
    return (
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetTrigger asChild>
          <Button size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Member
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              {bulkResults.length} Member{bulkResults.length > 1 ? "s" : ""} Added
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-4 pb-6">
            {bulkResults.map((result, idx) => (
              <div key={idx} className="p-3 rounded-lg border bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{result.name}</p>
                    {result.email && (
                      <p className="text-xs text-muted-foreground">{result.email}</p>
                    )}
                  </div>
                  {result.sent ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                      <Mail className="h-3 w-3 mr-1" />
                      Sent
                    </Badge>
                  ) : result.email ? (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                      Failed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      Link only
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input value={result.link} readOnly className="text-xs font-mono h-8" />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2"
                    onClick={async () => {
                      await navigator.clipboard.writeText(result.link);
                      toast({ title: `Link copied for ${result.name}` });
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={handleCopyAllLinks}>
                <Copy className="h-4 w-4 mr-2" />
                Copy All Links
              </Button>
              <Button className="flex-1" onClick={handleDone}>
                Done
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // If we have a pending invite link (single mode), show success state
  if (inviteLink) {
    return (
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetTrigger asChild>
          <Button size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Member
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              Member Added
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6 pb-6">
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <p className="font-medium mb-1">{customName}</p>
              <p className="text-sm text-muted-foreground">
                Added as pending {selectedRoleOption?.label}
              </p>
            </div>

            <div className="space-y-3">
              <Label>Send them this invite link:</Label>
              <div className="flex gap-2">
                <Input value={inviteLink} readOnly className="text-sm font-mono" />
                <Button onClick={handleCopyLink} variant="outline">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                When they join, their name will be pre-filled as "{customName}"
              </p>
            </div>

            <Button className="w-full" onClick={handleDone}>
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Member
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add Team Member
          </SheetTitle>
          <SheetDescription>
            Add an existing user or enter a name to send an invite
          </SheetDescription>
        </SheetHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="single" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Single
            </TabsTrigger>
            <TabsTrigger value="bulk" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Multiple
            </TabsTrigger>
          </TabsList>

          {/* Role Selection - shared between modes */}
          <div className="space-y-2 mb-5">
            <Label>Role</Label>
            <div className="grid grid-cols-2 gap-2">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedRole(opt.value)}
                  className={`p-3 rounded-xl text-left transition-all border-2 ${
                    selectedRole === opt.value
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <Badge variant="outline" className={`mb-1.5 ${opt.color}`}>
                    {opt.label}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>

          <TabsContent value="single" className="space-y-5 mt-0">
            {/* Selected User Preview */}
            {selectedUser && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedUser.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {selectedUser.display_name?.[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{selectedUser.display_name || "Unknown"}</p>
                  <p className="text-sm text-muted-foreground">Existing app user • Will be added directly</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedUser(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {!selectedUser && (
              <>
                <div className="space-y-2">
                  <Label>Search for existing user</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCustomName("");
                      }}
                      className="pl-10"
                    />
                  </div>

                  {isSearching && (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </div>
                  )}

                  {!isSearching && filteredResults.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                      {filteredResults.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => {
                            setSelectedUser(result);
                            setSearchQuery("");
                            setCustomName("");
                          }}
                          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={result.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-sm">
                              {result.display_name?.[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{result.display_name || "Unknown"}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!isSearching && debouncedSearch.length >= 2 && filteredResults.length === 0 && (
                    <p className="text-sm text-muted-foreground py-2">
                      No users found. Enter a name below to invite someone new.
                    </p>
                  )}
                </div>

                <div className="relative flex items-center">
                  <div className="flex-1 border-t border-border" />
                  <span className="px-3 text-xs text-muted-foreground uppercase">or add by name</span>
                  <div className="flex-1 border-t border-border" />
                </div>

                <div className="space-y-2">
                  <Label>Enter name (for new members)</Label>
                  <div className="relative">
                    <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="e.g., John Smith"
                      value={customName}
                      onChange={(e) => {
                        setCustomName(e.target.value);
                        setSearchQuery("");
                      }}
                      className="pl-10"
                    />
                  </div>
                </div>

                {customName.trim() && (
                  <div className="space-y-2">
                    <Label>Email (optional - for sending invite)</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="e.g., john@example.com"
                        value={customEmail}
                        onChange={(e) => setCustomEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {customEmail.trim() 
                        ? "An invite email will be sent automatically" 
                        : "Add email to auto-send invite, or share the link manually"}
                    </p>
                  </div>
                )}
              </>
            )}

            {selectedUser ? (
              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={() => addExistingUserMutation.mutate()}
                disabled={addExistingUserMutation.isPending}
              >
                {addExistingUserMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <UserPlus className="h-5 w-5 mr-2" />
                )}
                Add {selectedUser.display_name} as {selectedRoleOption?.label}
              </Button>
            ) : (
              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={() => addPendingMemberMutation.mutate()}
                disabled={!customName.trim() || addPendingMemberMutation.isPending}
              >
                {addPendingMemberMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <Send className="h-5 w-5 mr-2" />
                )}
                {customName.trim() ? `Add ${customName} & Get Invite Link` : "Enter a name to continue"}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4 mt-0">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add multiple members at once. Include emails to auto-send unique invite links.
              </p>
              
              {/* CSV Import */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setCsvImportOpen(true)}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import CSV
                </Button>
                <Button variant="outline" className="flex-1" onClick={addBulkMemberRow}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Row
                </Button>
              </div>
              
              <MemberCSVImportDialog
                open={csvImportOpen}
                onOpenChange={setCsvImportOpen}
                defaultRole={selectedRole}
                onImport={(members) => {
                  setBulkMembers(members.map(m => ({
                    ...m,
                    children: m.children.map(childName => ({
                      id: crypto.randomUUID(),
                      name: childName,
                      yearOfBirth: "",
                    })),
                  })));
                }}
              />
            </div>

            <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
              {bulkMembers.map((member, idx) => (
                <div key={member.id} className="p-3 rounded-lg border bg-muted/20 space-y-3">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Name"
                        value={member.name}
                        onChange={(e) => updateBulkMember(member.id, "name", e.target.value)}
                      />
                      <Input
                        type="email"
                        placeholder="Email (optional)"
                        value={member.email}
                        onChange={(e) => updateBulkMember(member.id, "email", e.target.value)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-1"
                      onClick={() => removeBulkMemberRow(member.id)}
                      disabled={bulkMembers.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                  
                  {/* Per-member role selection */}
                  <div className="flex flex-wrap gap-1.5">
                    {roleOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateBulkMemberRole(member.id, opt.value)}
                        className={`px-2 py-1 text-xs rounded-md transition-all border ${
                          member.role === opt.value
                            ? opt.color + " border-current"
                            : "bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  
                  {/* Children inputs for parent role */}
                  {member.role === "parent" && (
                    <div className="space-y-2 pl-3 border-l-2 border-pink-500/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-pink-600 flex items-center gap-1">
                          <Baby className="h-3 w-3" />
                          Children
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => addChildToMember(member.id)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Child
                        </Button>
                      </div>
                      
                      {member.children.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Add children to register them with this parent
                        </p>
                      )}
                      
                      {member.children.map((child) => (
                        <div key={child.id} className="flex gap-2 items-center">
                          <Input
                            placeholder="Child's name"
                            value={child.name}
                            onChange={(e) => updateChild(member.id, child.id, "name", e.target.value)}
                            className="h-8 text-sm flex-1"
                          />
                          <Input
                            placeholder="Year"
                            value={child.yearOfBirth}
                            onChange={(e) => updateChild(member.id, child.id, "yearOfBirth", e.target.value)}
                            className="h-8 text-sm w-16"
                            maxLength={4}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeChildFromMember(member.id, child.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => addBulkMembersMutation.mutate()}
              disabled={validBulkCount === 0 || addBulkMembersMutation.isPending}
            >
              {addBulkMembersMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Send className="h-5 w-5 mr-2" />
              )}
              {validBulkCount > 0 
                ? `Add ${validBulkCount} Member${validBulkCount > 1 ? "s" : ""} & Send Invites`
                : "Enter names to continue"}
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
