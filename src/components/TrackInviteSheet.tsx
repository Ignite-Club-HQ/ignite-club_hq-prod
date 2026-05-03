import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Send, Loader2, Mail, X } from "lucide-react";
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
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

interface TrackInviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteToken: string;
  inviteLink: string;
  role: string;
  teamId?: string;
  clubId?: string;
  entityName: string;
}

export default function TrackInviteSheet({
  open,
  onOpenChange,
  inviteToken,
  inviteLink,
  role,
  teamId,
  clubId,
  entityName,
}: TrackInviteSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    masked_email?: string | null;
  } | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Search for existing users (with masked email for disambiguation)
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-invite", debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSearch,
        _limit: 5,
      });
      return (data || []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        masked_email: string | null;
      }>;
    },
    enabled: debouncedSearch.length >= 2,
  });

  const trackInviteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser && !customLabel.trim()) {
        throw new Error("Please select a user or enter a name/email");
      }

      const { error } = await supabase.from("pending_invites").insert({
        team_id: teamId || null,
        club_id: clubId || null,
        role: role as any,
        invited_user_id: selectedUser?.id || null, // Only set if selecting existing user
        invited_by_user_id: user!.id,
        invited_label: selectedUser ? null : customLabel.trim(),
        invited_email: null, // TrackInvite doesn't capture email
      } as any);
      
      if (error) throw error;
    },
    onSuccess: () => {
      // Copy link to clipboard
      navigator.clipboard.writeText(inviteLink);
      toast({ 
        title: "Invite tracked & link copied",
        description: selectedUser 
          ? `${selectedUser.display_name} will appear as pending until they join`
          : `${customLabel} will appear as pending until they join`
      });
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, clubId] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast({ 
        title: "Failed to track invite", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const resetForm = () => {
    setSearchQuery("");
    setSelectedUser(null);
    setCustomLabel("");
  };

  const handleClose = () => {
    onOpenChange(false);
    resetForm();
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Track Invite
          </SheetTitle>
          <SheetDescription>
            Track who you're sending this invite to so you can see their status in the member list.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {/* Role Badge */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Inviting as:</span>
            <Badge variant="secondary">{role.replace("_", " ")}</Badge>
            <span className="text-sm text-muted-foreground">to {entityName}</span>
          </div>

          {/* Selected User Preview */}
          {selectedUser && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Avatar className="h-10 w-10">
                <AvatarImage src={selectedUser.avatar_url || undefined} />
                <AvatarFallback>
                  {selectedUser.display_name?.[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{selectedUser.display_name || "Unknown"}</p>
                <p className="text-sm text-muted-foreground">Existing app user</p>
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
                    onChange={(e) => setSearchQuery(e.target.value)}
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
                
                {!isSearching && searchResults.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(result);
                          setSearchQuery("");
                          setCustomLabel("");
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback>
                            {result.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm truncate">{result.display_name || "Unknown"}</span>
                          {result.masked_email && (
                            <span className="text-xs text-muted-foreground truncate">{result.masked_email}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {!isSearching && debouncedSearch.length >= 2 && searchResults.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">
                    No users found. Enter a name or email below instead.
                  </p>
                )}
              </div>

              <div className="relative flex items-center">
                <div className="flex-1 border-t border-border" />
                <span className="px-3 text-xs text-muted-foreground uppercase">or</span>
                <div className="flex-1 border-t border-border" />
              </div>

              {/* Manual label input */}
              <div className="space-y-2">
                <Label>Enter name or email (for non-users)</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="e.g., john@email.com or John Smith"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </>
          )}

          {/* Action Button */}
          <Button
            className="w-full"
            size="lg"
            disabled={trackInviteMutation.isPending || (!selectedUser && !customLabel.trim())}
            onClick={() => trackInviteMutation.mutate()}
          >
            {trackInviteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Reserve spot & copy link
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Creates a pending invite for this person and copies their unique link to your clipboard.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}