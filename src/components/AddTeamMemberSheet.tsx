import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Copy, Check, Send } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

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
  const [selectedRole, setSelectedRole] = useState<TeamRole>("player");
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

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

  // Get or create invite link for the selected role
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

      // Create pending invite record
      const { error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: teamId,
        club_id: clubId,
        role: selectedRole as any,
        invited_user_id: user!.id, // Set to current user as placeholder
        invited_by_user_id: user!.id,
        invited_label: customName.trim(),
      } as any);
      if (inviteError) throw inviteError;

      // Get or create invite link
      const link = await getOrCreateInviteLink(selectedRole);
      return link;
    },
    onSuccess: (link) => {
      setInviteLink(link);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });
      toast({
        title: "Member added as pending",
        description: `${customName} has been added. Share the invite link with them.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add member",
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

  const handleClose = () => {
    setOpen(false);
    setSearchQuery("");
    setSelectedUser(null);
    setCustomName("");
    setSelectedRole("player");
    setInviteLink(null);
    setCopied(false);
  };

  const handleDone = () => {
    handleClose();
  };

  const selectedRoleOption = roleOptions.find(r => r.value === selectedRole);

  // If we have a pending invite link, show success state
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

        <div className="space-y-5 pb-6">
          {/* Role Selection */}
          <div className="space-y-2">
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

          {/* Search for existing user */}
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
                      setCustomName(""); // Clear custom name when searching
                    }}
                    className="pl-10"
                  />
                </div>

                {/* Search Results */}
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

              {/* Custom name input */}
              <div className="space-y-2">
                <Label>Enter name (for new members)</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="e.g., John Smith"
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      setSearchQuery(""); // Clear search when entering name
                    }}
                    className="pl-10"
                  />
                </div>
                {customName.trim() && (
                  <p className="text-xs text-muted-foreground">
                    This person will appear as "Pending" until they accept the invite
                  </p>
                )}
              </div>
            </>
          )}

          {/* Action Buttons */}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
