import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2, Search, Users, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";

type TeamRole = "player" | "parent" | "coach" | "team_admin";
type ClubRole = "club_admin";

interface AddMemberDialogProps {
  type: "team" | "club";
  entityId: string;
  entityName: string;
  clubId?: string;
}

const teamRoleOptions: { value: TeamRole; label: string; description: string; color: string }[] = [
  { value: "player", label: "Player", description: "Active team player", color: "bg-amber-500/20 text-amber-600 border-amber-500/30" },
  { value: "parent", label: "Parent", description: "Parent/Guardian", color: "bg-pink-500/20 text-pink-600 border-pink-500/30" },
  { value: "coach", label: "Coach", description: "Team coach", color: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" },
  { value: "team_admin", label: "Team Admin", description: "Full admin access", color: "bg-blue-500/20 text-blue-600 border-blue-500/30" },
];

const clubRoleOptions: { value: ClubRole; label: string; description: string; color: string }[] = [
  { value: "club_admin", label: "Club Admin", description: "Full club management", color: "bg-purple-500/20 text-purple-600 border-purple-500/30" },
];

export default function AddMemberDialog({ type, entityId, entityName, clubId }: AddMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>(type === "team" ? "player" : "club_admin");
  const debouncedSearch = useDebounce(search, 300);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const roleOptions = type === "team" ? teamRoleOptions : clubRoleOptions;

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ["user-search", debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) return [];
      
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .ilike("display_name", `%${debouncedSearch}%`)
        .limit(10);
      
      if (error) throw error;
      return data;
    },
    enabled: debouncedSearch.length >= 2,
  });

  const { data: existingMembers } = useQuery({
    queryKey: [type === "team" ? "team-roles" : "club-roles", entityId],
    queryFn: async () => {
      const query = supabase
        .from("user_roles")
        .select("user_id");
      
      if (type === "team") {
        query.eq("team_id", entityId);
      } else {
        query.eq("club_id", entityId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data?.map(m => m.user_id) || [];
    },
    enabled: !!entityId,
  });

  const filteredResults = searchResults?.filter(
    user => !existingMembers?.includes(user.id)
  );

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error("No user selected");
      
      const roleData: any = {
        user_id: selectedUserId,
        role: selectedRole,
      };
      
      if (type === "team") {
        roleData.team_id = entityId;
        roleData.club_id = clubId;
      } else {
        roleData.club_id = entityId;
      }
      
      const { error } = await supabase.from("user_roles").insert(roleData);
      if (error) throw error;

      const roleLabelMap: Record<string, string> = {
        player: "Player",
        parent: "Parent",
        coach: "Coach",
        team_admin: "Team Admin",
        club_admin: "Club Admin",
      };
      const roleLabel = roleLabelMap[selectedRole] || selectedRole;
      const notificationMessage = `You have been added to ${entityName} as ${roleLabel}`;

      await supabase.from("notifications").insert({
        user_id: selectedUserId,
        type: "membership",
        message: notificationMessage,
        related_id: entityId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [type === "team" ? "team-roles" : "club-roles", entityId] });
      toast({ 
        title: "Member added", 
        description: `Successfully added member to ${entityName}` 
      });
      setOpen(false);
      setSearch("");
      setSelectedUserId(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to add member", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const selectedUser = searchResults?.find(u => u.id === selectedUserId);
  const selectedRoleOption = roleOptions.find(r => r.value === selectedRole);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-2" />
        Add Member
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-full bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <ResponsiveDialogTitle>Add Member</ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="text-sm">
                  {entityName}
                </ResponsiveDialogDescription>
              </div>
            </div>
          </ResponsiveDialogHeader>
          
          <div className="space-y-5 pt-2 pb-4">
            {/* Search */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Search User</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Type a name to search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            {/* Search Results */}
            {debouncedSearch.length >= 2 && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                {searchLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredResults?.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No users found
                  </p>
                ) : (
                  filteredResults?.map((user) => (
                    <div
                      key={user.id}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                        selectedUserId === user.id 
                          ? "bg-primary text-primary-foreground shadow-sm" 
                          : "hover:bg-background border border-transparent hover:border-border"
                      }`}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <Avatar className="h-9 w-9 border-2 border-background">
                        <AvatarImage src={user.avatar_url || undefined} />
                        <AvatarFallback className={selectedUserId === user.id ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/20 text-primary"}>
                          {user.display_name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm flex-1">{user.display_name || "Unknown"}</span>
                      {selectedUserId === user.id && (
                        <CheckCircle2 className="h-5 w-5" />
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Selected User Preview */}
            {selectedUser && (
              <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
                <p className="text-xs font-medium text-muted-foreground mb-2">Selected User</p>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 border-2 border-primary/20">
                    <AvatarImage src={selectedUser.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold">
                      {selectedUser.display_name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-semibold">{selectedUser.display_name}</span>
                </div>
              </div>
            )}

            {/* Role Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Select Role</Label>
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

            {/* Submit */}
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => addMemberMutation.mutate()}
              disabled={!selectedUserId || addMemberMutation.isPending}
            >
              {addMemberMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <UserPlus className="h-5 w-5 mr-2" />
              )}
              Add as {selectedRoleOption?.label || "Member"}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
