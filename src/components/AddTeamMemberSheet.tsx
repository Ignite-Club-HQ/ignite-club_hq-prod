import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Send, Users, Plus, Trash2, Upload, Baby, User, Calendar, MessageSquare, Copy } from "lucide-react";
import { MemberCSVImportDialog } from "@/components/MemberCSVImportDialog";
import { ClubAdminConfirmBanner } from "@/components/ClubAdminConfirmBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  jerseyNumber: string;
  existingChildId?: string; // If set, links to an existing child record instead of creating new
  existingChildParentName?: string; // Display context for existing child
}

interface BulkMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: BulkChild[];
}

type TeamRole = "player" | "parent" | "coach" | "team_admin";
type TeamType = "junior" | "senior" | "mixed";

interface AddTeamMemberSheetProps {
  teamId: string;
  teamName: string;
  clubId: string;
  teamType?: TeamType;
  /** True when the user is a club admin but NOT a direct member of this team */
  isClubAdminOnly?: boolean;
}

const allRoleOptions: { value: TeamRole; label: string; description: string; color: string; icon?: string; juniorOnly?: boolean; seniorOnly?: boolean }[] = [
  { value: "parent", label: "Parent", description: "Add parent + child players", color: "bg-pink-500/20 text-pink-600 border-pink-500/30", icon: "👶", juniorOnly: true },
  { value: "player", label: "Adult Player", description: "18+ team player", color: "bg-amber-500/20 text-amber-600 border-amber-500/30", seniorOnly: true },
  { value: "coach", label: "Coach", description: "Team coach", color: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" },
  { value: "team_admin", label: "Team Admin", description: "Full admin access", color: "bg-blue-500/20 text-blue-600 border-blue-500/30" },
];

export default function AddTeamMemberSheet({ teamId, teamName, clubId, teamType = "mixed", isClubAdminOnly = false }: AddTeamMemberSheetProps) {
  // Filter role options based on team type
  const roleOptions = allRoleOptions.filter(opt => {
    if (teamType === "junior") {
      // Junior teams: no adult players
      return !opt.seniorOnly;
    } else if (teamType === "senior") {
      // Senior teams: no parents/kids
      return !opt.juniorOnly;
    }
    // Mixed: all roles
    return true;
  });
  
  // Get default role based on team type
  const getDefaultRole = (): TeamRole => {
    if (teamType === "senior") return "player";
    return "parent"; // junior and mixed default to parent
  };
  
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
  const [selectedRole, setSelectedRole] = useState<TeamRole>(getDefaultRole());
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  // Single invite children (for parent role)
  const [singleChildren, setSingleChildren] = useState<BulkChild[]>([]);
  const [bulkMembers, setBulkMembers] = useState<BulkMember[]>([
    { id: crypto.randomUUID(), name: "", email: "", role: "parent", children: [] },
  ]);
  const [bulkResults, setBulkResults] = useState<{ name: string; email: string; link: string; sent: boolean; role?: string; childrenCount?: number }[]>([]);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [showMessageEditor, setShowMessageEditor] = useState(false);
  // Second parent fields (for parent role)
  const [secondParentName, setSecondParentName] = useState("");
  const [secondParentEmail, setSecondParentEmail] = useState("");
  const [secondParentSearch, setSecondParentSearch] = useState("");
  const [selectedSecondParent, setSelectedSecondParent] = useState<{ id: string; display_name: string | null; avatar_url: string | null } | null>(null);
  const debouncedSecondParentSearch = useDebounce(secondParentSearch, 300);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch existing members (separate key from TeamDetail members query to avoid cache shape collisions)
  const { data: existingMembers } = useQuery({
    queryKey: ["team-member-ids", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", teamId);
      return data?.map(m => m.user_id) || [];
    },
    enabled: open && !!teamId,
  });

  // Fetch club branding data for emails
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
  // Fetch existing children in the club for matching
  const { data: clubChildren = [] } = useQuery({
    queryKey: ["club-children", clubId],
    queryFn: async () => {
      // Strategy 1: Children linked to club teams via assignments
      const { data: teamIds } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId);
      
      const childIdsFromTeams = new Set<string>();
      if (teamIds?.length) {
        const { data: assignments } = await supabase
          .from("child_team_assignments")
          .select("child_id")
          .in("team_id", teamIds.map(t => t.id));
        assignments?.forEach(a => childIdsFromTeams.add(a.child_id));
      }
      
      // Strategy 2: Children whose parents have roles in this club
      const { data: clubParents } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "parent");
      
      const parentUserIds = [...new Set(clubParents?.map(p => p.user_id) || [])];
      const childIdsFromParents = new Set<string>();
      if (parentUserIds.length) {
        const { data: parentChildren } = await supabase
          .from("children")
          .select("id")
          .in("parent_id", parentUserIds);
        parentChildren?.forEach(c => childIdsFromParents.add(c.id));
      }
      
      // Merge both sets
      const allChildIds = [...new Set([...childIdsFromTeams, ...childIdsFromParents])];
      if (!allChildIds.length) return [];
      
      const { data: children } = await supabase
        .from("children")
        .select("id, name, year_of_birth, parent_id")
        .in("id", allChildIds);
      
      if (!children?.length) return [];
      const parentIds = [...new Set(children.map(c => c.parent_id))];
      const { data: parents } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", parentIds);
      const parentMap = new Map(parents?.map(p => [p.id, p.display_name]) || []);
      
      return children.map(c => ({
        ...c,
        parent_name: parentMap.get(c.parent_id) || "Unknown",
      }));
    },
    enabled: open && !!clubId && (selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")),
  });


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

  // Filter out existing members — but allow the current user (admin adding themselves as parent)
  // When adding a "parent" role, allow existing members to appear (we're adding a child under them)
  const filteredResults = searchResults.filter(
    u => u.id === user?.id || selectedRole === "parent" || !existingMembers?.includes(u.id)
  );

  // Search for second parent (existing users)
  const { data: secondParentSearchResults = [] } = useQuery({
    queryKey: ["second-parent-search", debouncedSecondParentSearch],
    queryFn: async () => {
      if (debouncedSecondParentSearch.length < 2) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .ilike("display_name", `%${debouncedSecondParentSearch}%`)
        .limit(5);
      return data || [];
    },
    enabled: debouncedSecondParentSearch.length >= 2 && !selectedSecondParent,
  });

  // Filter second parent results: exclude primary user but allow existing members (they may need parent role added)
  const filteredSecondParentResults = secondParentSearchResults.filter(
    u => u.id !== selectedUser?.id
  );

  // Find matching existing children by partial name (case-insensitive)
  const findMatchingChildren = (name: string) => {
    if (!name.trim() || name.trim().length < 2) return [];
    const query = name.trim().toLowerCase();
    return clubChildren.filter(c => c.name.toLowerCase().includes(query)).slice(0, 5);
  };

  // Create a unique invite token for a pending invite (name-restricted)
  const createPendingInviteToken = (): string => {
    return crypto.randomUUID();
  };

  const isDuplicateError = (error: { code?: string | null; message?: string | null } | null | undefined) => {
    const message = error?.message?.toLowerCase() || "";
    return error?.code === "23505" || message.includes("duplicate") || message.includes("unique constraint");
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

      const roleWasDuplicate = error && isDuplicateError(error);
      if (error && !roleWasDuplicate) throw error;

      // If parent role, create or link children and assign to team
      // Track resolved child IDs so second-parent flows always link correctly
      const createdChildIds: string[] = [];
      const resolvedChildren: { id: string; name: string; yearOfBirth: number | null }[] = [];
      if (selectedRole === "parent") {
        const validChildren = singleChildren.filter(c => c.name.trim());
        for (const child of validChildren) {
          let childId = child.existingChildId;
          
          if (childId) {
            // Existing child — just add guardian link if not already the parent
            const existingChild = clubChildren.find(c => c.id === childId);
            if (existingChild && existingChild.parent_id !== selectedUser.id) {
              await supabase.from("child_guardians").insert({
                child_id: childId,
                guardian_id: selectedUser.id,
              }).select().maybeSingle(); // ignore duplicate errors
            }
          } else {
            // Create new child via secure RPC so admins can add children for existing parents
            const { data: newChildId, error: childError } = await supabase.rpc(
              "create_child_for_parent_on_team",
              {
                p_parent_user_id: selectedUser.id,
                p_team_id: teamId,
                p_name: child.name.trim(),
                p_year_of_birth: child.yearOfBirth ? parseInt(child.yearOfBirth) : null,
              }
            );

            if (childError) {
              console.error("Failed to create child:", childError.message, childError.code, childError.details, childError.hint, JSON.stringify(childError));
              throw new Error(`We couldn't save ${child.name.trim()}. ${childError.message}`);
            }
            childId = newChildId;
          }

          if (childId) {
            createdChildIds.push(childId);
            const existingClubChild = clubChildren.find(c => c.id === childId);
            resolvedChildren.push({
              id: childId,
              name: child.name.trim(),
              yearOfBirth: existingClubChild?.year_of_birth ?? (child.yearOfBirth ? parseInt(child.yearOfBirth) : null),
            });
            // Check if already assigned to this team
            const { data: existing } = await supabase
              .from("child_team_assignments")
              .select("id")
              .eq("child_id", childId)
              .eq("team_id", teamId)
              .maybeSingle();
            
            if (!existing) {
              const { error: assignError } = await supabase.from("child_team_assignments").insert({
                child_id: childId,
                team_id: teamId,
              });
              if (assignError) {
                console.error("Failed to assign child to team:", assignError.message);
                throw new Error(`We saved ${child.name.trim()}, but couldn't add them to ${teamName}. Please try again.`);
              }
            }

            // Save jersey number to team_player_positions if provided
            if (child.jerseyNumber) {
              const jerseyNum = parseInt(child.jerseyNumber);
              if (!isNaN(jerseyNum)) {
                // Check if position record already exists
                const { data: existingPos } = await supabase
                  .from("team_player_positions")
                  .select("id")
                  .eq("team_id", teamId)
                  .eq("child_id", childId)
                  .maybeSingle();

                if (existingPos) {
                  await supabase.from("team_player_positions")
                    .update({ jersey_number: jerseyNum })
                    .eq("id", existingPos.id);
                } else {
                  await supabase.from("team_player_positions").insert({
                    team_id: teamId,
                    child_id: childId,
                    position: "MID",
                    jersey_number: jerseyNum,
                  });
                }
              }
            }
          }
        }
      }

      // Handle second parent
      let secondParentInviteLink: string | null = null;
      let secondParentAddedDirectly = false;
      
      if (selectedSecondParent && selectedRole === "parent") {
        // Add existing user directly as second parent (ignore duplicate)
        const { error: roleErr } = await supabase.from("user_roles").insert({
          user_id: selectedSecondParent.id,
          team_id: teamId,
          club_id: clubId,
          role: "parent",
        });
        if (roleErr && !isDuplicateError(roleErr)) {
          console.error("Failed to add second parent role:", roleErr.message);
        }

        // Link all children (existing and newly created) as guardian for second parent
        for (const childId of createdChildIds) {
          await supabase.from("child_guardians").insert({
            child_id: childId,
            guardian_id: selectedSecondParent.id,
          }).select().maybeSingle(); // ignore duplicate errors
        }

        // Send notification
        await supabase.from("notifications").insert({
          user_id: selectedSecondParent.id,
          type: "membership",
          message: `You have been added to ${teamName} as Parent`,
          related_id: teamId,
        });

        secondParentAddedDirectly = true;
      } else if (secondParentName.trim() && secondParentEmail.trim() && selectedRole === "parent") {
        // Create pending invite for new second parent
        const secondToken = crypto.randomUUID();
        const childrenMetadata = resolvedChildren.length > 0 
          ? resolvedChildren.map(child => ({ 
              name: child.name,
              yearOfBirth: child.yearOfBirth,
              existingChildId: child.id,
            }))
          : null;

        await supabase.from("pending_invites").insert({
          team_id: teamId,
          club_id: clubId,
          role: "parent" as any,
          invited_user_id: null,
          invited_by_user_id: user!.id,
          invited_label: secondParentName.trim(),
          invited_email: secondParentEmail.trim().toLowerCase(),
          invite_token: secondToken,
          metadata: childrenMetadata ? { children: childrenMetadata } : null,
        } as any);

        secondParentInviteLink = `${window.location.origin}/join/p/${secondToken}`;
      }

      // Send notification
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "membership",
        message: `You have been added to ${teamName} as ${roleOptions.find(r => r.value === selectedRole)?.label}`,
        related_id: teamId,
      });

      return { secondParentInviteLink, secondParentAddedDirectly, roleWasDuplicate };
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      
      if (result?.roleWasDuplicate) {
        const roleName = roleOptions.find(r => r.value === selectedRole)?.label || selectedRole;
        toast({
          title: "Already a member",
          description: `${selectedUser?.display_name} is already a ${roleName} on this team. Any new children have been linked.`,
        });
      } else {
        toast({
          title: "Member added",
          description: `${selectedUser?.display_name} has been added to the team`,
        });
      }

      if (result?.secondParentAddedDirectly && selectedSecondParent) {
        toast({
          title: "Second parent added",
          description: `${selectedSecondParent.display_name} has also been added as Parent`,
        });
      }

      // Send child-added email to primary parent (existing user)
      if (selectedRole === "parent" && selectedUser) {
        const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
        if (childrenNames.length > 0) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                toUserId: selectedUser.id,
                subject: childrenNames.length === 1
                  ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                  : `${clubBranding?.name || 'Your club'}: Your children have been added to ${teamName} ⚽`,
                template: "child-added",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: selectedUser.display_name || "Parent",
                  childrenNames,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  inviteLink: `${window.location.origin}/teams/${teamId}`,
                },
              },
            });
          } catch (err) {
            console.error("[AddMember] Failed to send child-added email to primary parent:", err);
          }
        }
      }

      // Send child-added email to second parent (existing user added directly)
      if (result?.secondParentAddedDirectly && selectedSecondParent) {
        const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
        if (childrenNames.length > 0) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                toUserId: selectedSecondParent.id,
                subject: childrenNames.length === 1
                  ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                  : `${clubBranding?.name || 'Your club'}: Your children have been added to ${teamName} ⚽`,
                template: "child-added",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: selectedSecondParent.display_name || "Parent",
                  childrenNames,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  inviteLink: `${window.location.origin}/teams/${teamId}`,
                },
              },
            });
          } catch (err) {
            console.error("[AddMember] Failed to send child-added email to second parent:", err);
          }
        }
      }

      // Send second parent email if applicable
      if (result?.secondParentInviteLink && secondParentEmail.trim()) {
        try {
          const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: secondParentEmail.trim().toLowerCase(),
              subject: childrenNames.length === 1
                ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: secondParentName.trim(),
                invitedEmail: secondParentEmail.trim().toLowerCase(),
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: "Parent",
                inviteLink: result.secondParentInviteLink,
                clubLogoUrl: clubBranding?.logo_url || undefined,
                childrenNames: childrenNames.length > 0 ? childrenNames : undefined,
                customMessage: customMessage.trim() || undefined,
              },
            },
          });

          const emailSent = !funcError && emailResult?.verified && emailResult?.success;
          const secondToken = result.secondParentInviteLink.split("/join/p/")[1];
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailResult?.emailId || null,
              email_error: !emailSent ? (emailResult?.error || "Email not verified") : null,
            } as any)
            .eq("invite_token", secondToken);

          if (emailSent) {
            toast({
              title: "Second parent invited!",
              description: `Email sent to ${secondParentEmail.trim()}`,
            });
          }
        } catch (error) {
          console.error("Failed to send second parent email:", error);
        }
        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      }

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

      // Build metadata for children (for parent role)
      const validChildren = selectedRole === "parent" 
        ? singleChildren.filter(c => c.name.trim())
        : [];
      const childrenMetadata = validChildren.length > 0 ? JSON.stringify(
        validChildren.map(c => ({ 
          name: c.name.trim(), 
          yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
          existingChildId: c.existingChildId || null,
        }))
      ) : null;

      // Generate second parent token only if NOT selecting an existing user
      const secondToken = (!selectedSecondParent && secondParentName.trim() && secondParentEmail.trim() && selectedRole === "parent") 
        ? crypto.randomUUID() : null;

      // Create primary invite
      const { data: primaryInvite, error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: teamId,
        club_id: clubId,
        role: selectedRole as any,
        invited_user_id: null,
        invited_by_user_id: user!.id,
        invited_label: customName.trim(),
        invited_email: customEmail.trim().toLowerCase() || null,
        invite_token: inviteToken,
        metadata: childrenMetadata 
          ? { 
              children: JSON.parse(childrenMetadata), 
              ...(secondToken ? { linked_invite_token: secondToken } : {}),
              ...(selectedSecondParent ? { second_parent_user_id: selectedSecondParent.id } : {}),
            } 
          : null,
      } as any).select("id").single();
      if (inviteError) throw inviteError;

      const link = `${window.location.origin}/join/p/${inviteToken}`;
      
      // Handle second parent
      let secondParentLink: string | null = null;
      let secondParentAddedDirectly = false;

      if (selectedSecondParent && selectedRole === "parent") {
        // Add existing user directly as second parent (ignore duplicate)
        const { error: roleErr } = await supabase.from("user_roles").insert({
          user_id: selectedSecondParent.id,
          team_id: teamId,
          club_id: clubId,
          role: "parent",
        });
        if (roleErr && !roleErr.message?.includes("duplicate")) {
          console.error("Failed to add second parent role:", roleErr.message);
        }

        await supabase.from("notifications").insert({
          user_id: selectedSecondParent.id,
          type: "membership",
          message: `You have been added to ${teamName} as Parent`,
          related_id: teamId,
        });

        secondParentAddedDirectly = true;
      } else if (secondToken) {
        const { error: secondError } = await supabase.from("pending_invites").insert({
          team_id: teamId,
          club_id: clubId,
          role: "parent" as any,
          invited_user_id: null,
          invited_by_user_id: user!.id,
          invited_label: secondParentName.trim(),
          invited_email: secondParentEmail.trim().toLowerCase(),
          invite_token: secondToken,
          metadata: childrenMetadata 
            ? { children: JSON.parse(childrenMetadata), linked_invite_token: inviteToken } 
            : null,
        } as any);
        if (!secondError) {
          secondParentLink = `${window.location.origin}/join/p/${secondToken}`;
        }
      }

      return { 
        link, 
        email: customEmail.trim(), 
        childrenCount: validChildren.length, 
        childrenNames: validChildren.map(c => c.name.trim()),
        secondParentLink,
        secondParentEmail: secondParentEmail.trim(),
        secondParentName: secondParentName.trim(),
        secondParentAddedDirectly,
      };
    },
    onSuccess: async ({ link, email, childrenCount, childrenNames, secondParentLink, secondParentEmail: secondEmail, secondParentName: secondName, secondParentAddedDirectly }) => {
      setInviteLink(link);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });

      if (secondParentAddedDirectly && selectedSecondParent) {
        toast({
          title: "Second parent added",
          description: `${selectedSecondParent.display_name} has also been added as Parent`,
        });
      }

      // Auto-send email notification if email was provided
      if (email) {
        setIsSendingNotification(true);
        try {
          // Extract invite token from link for tracking
          const inviteToken = link.split("/join/p/")[1];
          
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: email,
               subject: childrenNames.length === 1
                 ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                 : childrenNames.length > 1
                   ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                   : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: customName.trim(),
                invitedEmail: email,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: roleOptions.find(r => r.value === selectedRole)?.label || "Member",
                inviteLink: link,
                clubLogoUrl: clubBranding?.logo_url || undefined,
                childrenNames: childrenNames.length > 0 ? childrenNames : undefined,
                customMessage: customMessage.trim() || undefined,
              },
            },
          });
          
          // Update pending invite with email status
          const emailSent = !funcError && emailResult?.verified && emailResult?.success;
          const emailId = emailResult?.emailId || null;
          const emailError = funcError?.message || (!emailSent ? (emailResult?.error || "Email not verified") : null);
          
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailId,
              email_error: emailError,
            } as any)
            .eq("invite_token", inviteToken);
          
          // Refresh the pending invites list to show updated status
          queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
          
          if (emailSent) {
            toast({
              title: "Invite sent!",
              description: `Email notification sent to ${email}`,
            });
          } else {
            toast({
              title: "Member added",
              description: "Could not send email, but invite has been created",
              variant: "default",
            });
          }
        } catch (error) {
          console.error("Failed to send email:", error);
          toast({
            title: "Member added",
            description: "Could not send email, but invite has been created",
            variant: "default",
          });
        } finally {
          setIsSendingNotification(false);
        }
      } else {
        // No email - copy link to clipboard for sharing
        try { await navigator.clipboard.writeText(link); } catch {}
        toast({
          title: "Member added — link copied!",
          description: `${customName} has been added. Paste the invite link to share it with them.`,
        });
      }

      // Send email to second parent if provided
      if (secondEmail && secondParentLink) {
        try {
          const secondToken = secondParentLink.split("/join/p/")[1];
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: secondEmail,
              subject: childrenNames.length === 1
                ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                : childrenNames.length > 1
                  ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                  : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: secondName,
                invitedEmail: secondEmail,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: "Parent",
                inviteLink: secondParentLink,
                clubLogoUrl: clubBranding?.logo_url || undefined,
                childrenNames: childrenNames.length > 0 ? childrenNames : undefined,
                customMessage: customMessage.trim() || undefined,
              },
            },
          });

          const emailSent = !funcError && emailResult?.verified && emailResult?.success;
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: emailSent ? new Date().toISOString() : null,
              email_id: emailResult?.emailId || null,
              email_error: !emailSent ? (emailResult?.error || "Email not verified") : null,
            } as any)
            .eq("invite_token", secondToken);

          if (emailSent) {
            toast({
              title: "Second parent invited!",
              description: `Email also sent to ${secondEmail}`,
            });
          }
        } catch (error) {
          console.error("Failed to send second parent email:", error);
        }
        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      }

      // Send child-added email to second parent (existing user added directly)
      if (secondParentAddedDirectly && selectedSecondParent && childrenNames.length > 0) {
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              toUserId: selectedSecondParent.id,
              subject: childrenNames.length === 1
                ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                : `${clubBranding?.name || 'Your club'}: Your children have been added to ${teamName} ⚽`,
              template: "child-added",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: selectedSecondParent.display_name || "Parent",
                childrenNames,
                teamName,
                clubName: clubBranding?.name || "The Club",
                clubLogoUrl: clubBranding?.logo_url || undefined,
                customMessage: customMessage.trim() || undefined,
                inviteLink: `${window.location.origin}/teams/${teamId}`,
              },
            },
          });
        } catch (err) {
          console.error("[AddMember] Failed to send child-added email to second parent (new flow):", err);
        }
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
    mutationFn: async (membersToAdd?: BulkMember[]) => {
      const membersSource = membersToAdd || bulkMembers;
      const validMembers = membersSource.filter(m => m.name.trim());
      if (validMembers.length === 0) throw new Error("Please enter at least one name");

      const results: { name: string; email: string; link: string; sent: boolean; role: string; childrenCount: number }[] = [];

      // Pre-generate tokens for all members so we can cross-link parent pairs
      const memberTokens = validMembers.map(() => crypto.randomUUID());

      // Detect parent pairs sharing the same children (by matching children names)
      // Build a map: children fingerprint -> list of member indices
      const childFingerprints = new Map<string, number[]>();
      validMembers.forEach((member, idx) => {
        if (member.role === "parent" && member.children.some(c => c.name.trim())) {
          const fingerprint = member.children
            .filter(c => c.name.trim())
            .map(c => c.name.trim().toLowerCase())
            .sort()
            .join("|");
          if (fingerprint) {
            const existing = childFingerprints.get(fingerprint) || [];
            existing.push(idx);
            childFingerprints.set(fingerprint, existing);
          }
        }
      });

      // Build cross-link map: memberIndex -> linkedMemberToken
      const crossLinks = new Map<number, string>();
      for (const indices of childFingerprints.values()) {
        if (indices.length === 2) {
          crossLinks.set(indices[0], memberTokens[indices[1]]);
          crossLinks.set(indices[1], memberTokens[indices[0]]);
        }
      }

      for (let i = 0; i < validMembers.length; i++) {
        const member = validMembers[i];
        const inviteToken = memberTokens[i];
        const memberRole = member.role;

        // Build metadata for children (for parent role)
        const validChildren = member.children.filter(c => c.name.trim());
        const childrenMetadata = validChildren.length > 0 ? JSON.stringify(
          validChildren.map(c => ({ 
            name: c.name.trim(), 
            yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
            jerseyNumber: c.jerseyNumber ? parseInt(c.jerseyNumber) : null,
            existingChildId: c.existingChildId || null,
          }))
        ) : null;

        // Add linked_invite_token if this parent is paired with another
        const linkedToken = crossLinks.get(i);
        const metadata = childrenMetadata 
          ? { children: JSON.parse(childrenMetadata), ...(linkedToken ? { linked_invite_token: linkedToken } : {}) }
          : null;

        // Create pending invite record with children metadata
        const { error: inviteError } = await supabase.from("pending_invites").insert({
          team_id: teamId,
          club_id: clubId,
          role: memberRole as any,
          invited_user_id: null, // Will be set when user accepts invite
          invited_by_user_id: user!.id,
          invited_label: member.name.trim(),
          invited_email: member.email.trim().toLowerCase() || null,
          invite_token: inviteToken,
          metadata,
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

        // Send email if provided - with verification and tracking
        let emailId: string | null = null;
        let emailError: string | null = null;
        
        if (member.email.trim()) {
          try {
            const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
              body: {
                to: member.email.trim(),
                 subject: validChildren.length === 1
                   ? `${clubBranding?.name || 'Your club'}: See which team ${validChildren[0].name.trim()} is in ⚽`
                   : validChildren.length > 1
                     ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                     : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: member.name.trim(),
                  invitedEmail: member.email.trim(),
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName: roleOptions.find(r => r.value === memberRole)?.label || "Member",
                  inviteLink: link,
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  childrenNames: validChildren.map(c => c.name.trim()),
                  customMessage: customMessage.trim() || undefined,
                },
              },
            });
            
            // Verify email was actually sent by checking the verified flag
            if (funcError) {
              emailError = funcError.message || "Function error";
              console.error("Email function error for", member.email, funcError);
            } else if (emailResult?.verified && emailResult?.success) {
              sent = true;
              emailId = emailResult.emailId;
              console.log("Email verified sent to", member.email, "ID:", emailId);
            } else {
              emailError = emailResult?.error || "Email not verified";
              console.warn("Email not verified for", member.email, "Response:", emailResult);
            }
          } catch (error) {
            emailError = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to send email to", member.email, error);
          }
          
          // Update pending invite with email status
          await supabase
            .from("pending_invites")
            .update({
              email_sent_at: sent ? new Date().toISOString() : null,
              email_id: emailId,
              email_error: emailError,
            } as any)
            .eq("invite_token", inviteToken);
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

  const handleClose = () => {
    setOpen(false);
    setSearchQuery("");
    setSelectedUser(null);
    setCustomName("");
    setCustomEmail("");
    setSelectedRole(getDefaultRole());
    setInviteLink(null);
    setInviteSent(false);
    setMode("single");
    setSingleChildren([]);
    setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: getDefaultRole(), children: [] }]);
    setBulkResults([]);
    setCustomMessage("");
    setShowMessageEditor(false);
    setSecondParentName("");
    setSecondParentEmail("");
    setSecondParentSearch("");
    setSelectedSecondParent(null);
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
        ? { ...m, children: [...m.children, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }] }
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

  const updateChild = (memberId: string, childId: string, field: "name" | "yearOfBirth" | "jerseyNumber", value: string) => {
    setBulkMembers(bulkMembers.map(m => 
      m.id === memberId 
        ? { ...m, children: m.children.map(c => {
            if (c.id !== childId) return c;
            const updated = { ...c, [field]: value };
            // Clear existing link when name changes (user must explicitly pick from search)
            if (field === "name") {
              updated.existingChildId = undefined;
              updated.existingChildParentName = undefined;
            }
            return updated;
          }) }
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
              <div key={idx} className="p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{result.name}</p>
                    {result.email && (
                      <p className="text-xs text-muted-foreground">{result.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {result.sent ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                        <Mail className="h-3 w-3 mr-1" />
                        Sent
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                        {result.email ? "Failed" : "Link only"}
                      </Badge>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(result.link);
                          toast({
                            title: "Invite link copied",
                            description: `Share ${result.name}'s invite link wherever you like.`,
                          });
                        } catch {
                          toast({
                            title: "Could not copy link",
                            description: "Please try again.",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copy link
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => {
                setBulkResults([]);
                setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: getDefaultRole(), children: [] }]);
              }}>
                Add More
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
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {customEmail ? `Invite sent to ${customEmail}` : "Invite link created — share it with them"}
              </p>
            </div>

            <p className="text-sm text-muted-foreground text-center">
              When they accept the invite, their name will be pre-filled as "{customName}"
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => {
                setInviteLink(null);
                setCustomName("");
                setCustomEmail("");
                setSingleChildren([]);
                setSecondParentName("");
                setSecondParentEmail("");
                setSecondParentSearch("");
                setSelectedSecondParent(null);
                setCustomMessage("");
                setShowMessageEditor(false);
              }}>
                Add Another
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Member
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" enableDragToClose className="h-[90vh] rounded-t-2xl flex flex-col overflow-hidden">
        <SheetHeader className="mb-4 shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add Team Member
          </SheetTitle>
          <SheetDescription>
            Add an existing user or enter a name to send an invite
          </SheetDescription>
        </SheetHeader>

        {/* Club admin confirmation banner */}
        {isClubAdminOnly && (
          <div className="mb-4 shrink-0">
            <ClubAdminConfirmBanner teamName={teamName} action="add members" />
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 pb-6">
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
            <p className="text-xs text-muted-foreground mb-2">
              To add child players, select Parent and add their details
            </p>
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
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Badge variant="outline" className={opt.color}>
                      {opt.label}
                    </Badge>
                    {opt.icon && <span className="text-sm">{opt.icon}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Parent role preview - shows what fields will be available */}
          {selectedRole === "parent" && (
            <div className="p-3 rounded-xl bg-pink-500/5 border border-pink-500/20 mb-5">
              <div className="flex items-start gap-2">
                <Baby className="h-4 w-4 text-pink-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-pink-600">Adding a parent with child players</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    After adding the parent, you'll be able to add their child's details. 
                    The child will be registered as a player when the parent accepts the invite.
                  </p>
                  {/* Example child fields preview */}
                  <div className="bg-background/50 rounded-lg p-2 border border-pink-500/10">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Example child fields:</p>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span>Child's Name</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>Year of Birth</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <TabsContent value="single" className="space-y-5 mt-0">
            {/* Selected User Preview */}
            {selectedUser && (
              <>
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

                {/* Child fields for existing user with parent role */}
                {selectedRole === "parent" && (
                  <div className="space-y-3 p-4 rounded-xl bg-pink-500/5 border border-pink-500/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Baby className="h-4 w-4 text-pink-600" />
                        <Label className="text-pink-600 font-medium">Child Player(s)</Label>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSingleChildren([...singleChildren, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }])}
                        className="h-7 text-xs border-pink-500/30 text-pink-600 hover:bg-pink-500/10"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Child
                      </Button>
                    </div>
                    
                    {singleChildren.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Add the child player(s) who will be registered to this team.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {singleChildren.map((child, idx) => {
                          const matches = !child.existingChildId ? findMatchingChildren(child.name) : [];
                          return (
                            <div key={child.id} className="space-y-1">
                              <div className="flex gap-2 items-start">
                                <div className="flex-1 space-y-1 relative">
                                  <Input
                                    placeholder="Search or type child's name"
                                    value={child.name}
                                    onChange={(e) => setSingleChildren(singleChildren.map(c => 
                                      c.id === child.id ? { ...c, name: e.target.value, existingChildId: undefined, existingChildParentName: undefined } : c
                                    ))}
                                    className={`h-9 ${child.existingChildId ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
                                  />
                                  {matches.length > 0 && !child.existingChildId && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-32 overflow-y-auto">
                                      {matches.map(m => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onClick={() => setSingleChildren(singleChildren.map(c => 
                                            c.id === child.id ? { ...c, name: m.name, existingChildId: m.id, existingChildParentName: m.parent_name, yearOfBirth: m.year_of_birth?.toString() || '' } : c
                                          ))}
                                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex justify-between items-center"
                                        >
                                          <span className="font-medium">{m.name}</span>
                                          <span className="text-xs text-muted-foreground">{m.parent_name} {m.year_of_birth ? `· ${m.year_of_birth}` : ''}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="w-16">
                                  <Input
                                    placeholder="#"
                                    value={child.jerseyNumber}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                                      setSingleChildren(singleChildren.map(c => 
                                        c.id === child.id ? { ...c, jerseyNumber: val } : c
                                      ));
                                    }}
                                    className="h-9"
                                    maxLength={2}
                                    inputMode="numeric"
                                  />
                                </div>
                                <div className="w-20">
                                  <Input
                                    placeholder="Year"
                                    value={child.existingChildId ? (clubChildren.find(c => c.id === child.existingChildId)?.year_of_birth?.toString() || '') : child.yearOfBirth}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                                      setSingleChildren(singleChildren.map(c => 
                                        c.id === child.id ? { ...c, yearOfBirth: val } : c
                                      ));
                                    }}
                                    className="h-9"
                                    maxLength={4}
                                    disabled={!!child.existingChildId}
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-destructive hover:text-destructive"
                                  onClick={() => setSingleChildren(singleChildren.filter(c => c.id !== child.id))}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              {child.existingChildId && (
                                <p className="text-xs text-emerald-600 flex items-center gap-1 pl-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Linked to existing child ({child.existingChildParentName || 'existing parent'})
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Second parent/guardian for existing user */}
                {selectedRole === "parent" && singleChildren.length > 0 && (
                  <div className="space-y-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <Label className="text-blue-600 font-medium">Second Parent / Guardian (Optional)</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Search for an existing user or enter details for a new invite.
                    </p>

                    {selectedSecondParent ? (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={selectedSecondParent.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {selectedSecondParent.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{selectedSecondParent.display_name}</p>
                          <p className="text-xs text-muted-foreground">Existing user • Will be added directly</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setSelectedSecondParent(null);
                          setSecondParentSearch("");
                        }}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search existing user or type new name..."
                            value={secondParentSearch || secondParentName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSecondParentSearch(val);
                              setSecondParentName(val);
                            }}
                            className="h-9 pl-10"
                          />
                        </div>

                        {/* Search results dropdown */}
                        {filteredSecondParentResults.length > 0 && secondParentSearch.length >= 2 && (
                          <div className="border rounded-lg overflow-hidden divide-y">
                            {filteredSecondParentResults.map((user) => (
                              <button
                                key={user.id}
                                type="button"
                                className="w-full flex items-center gap-3 p-2.5 hover:bg-accent/50 transition-colors text-left"
                                onClick={() => {
                                  setSelectedSecondParent(user);
                                  setSecondParentName(user.display_name || "");
                                  setSecondParentSearch("");
                                  setSecondParentEmail("");
                                }}
                              >
                                <Avatar className="h-7 w-7">
                                  <AvatarImage src={user.avatar_url || undefined} />
                                  <AvatarFallback className="bg-muted text-xs">
                                    {user.display_name?.[0]?.toUpperCase() || "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm">{user.display_name}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {secondParentName.trim() && !selectedSecondParent && (
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="email"
                              placeholder="Second parent's email (for invite)"
                              value={secondParentEmail}
                              onChange={(e) => setSecondParentEmail(e.target.value)}
                              className="h-9 pl-10"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
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
                    <Label>Email (optional)</Label>
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
                      {customEmail.trim() ? "An invite email will be sent to this address" : "Without email, you'll get a shareable invite link"}
                    </p>
                  </div>
                )}

                {customName.trim() && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" />
                        Custom Message
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setShowMessageEditor(!showMessageEditor);
                          if (!showMessageEditor && !customMessage) {
                            setCustomMessage(`We're using a new app to bring everything together for the club — it's called Ignite Club HQ.\n\nIt's been built by one of our own club members to keep things simple, organised, and completely ad-free.\n\n👀 Jump in to see:\n• What team they're in\n• Who their teammates are\n• Your club space for updates as the season gets underway\n\n(Fixtures and games will be added soon by the team admin or coach)`);
                          }
                        }}
                      >
                        {showMessageEditor ? "Hide" : "Add message"}
                      </Button>
                    </div>
                    {showMessageEditor && (
                      <div className="space-y-1.5">
                        <Textarea
                          placeholder="Write a personal welcome message..."
                          value={customMessage}
                          onChange={(e) => setCustomMessage(e.target.value)}
                          rows={3}
                          className="text-sm resize-none"
                        />
                        <p className="text-xs text-muted-foreground">
                          This message will appear in the invite email
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Child fields for parent role in single mode */}
                {customName.trim() && selectedRole === "parent" && (
                  <div className="space-y-3 p-4 rounded-xl bg-pink-500/5 border border-pink-500/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Baby className="h-4 w-4 text-pink-600" />
                        <Label className="text-pink-600 font-medium">Child Player(s)</Label>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSingleChildren([...singleChildren, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }])}
                        className="h-7 text-xs border-pink-500/30 text-pink-600 hover:bg-pink-500/10"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Child
                      </Button>
                    </div>
                    
                    {singleChildren.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Add the child player(s) who will be registered to this team when the parent accepts the invite.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {singleChildren.map((child, idx) => {
                          const matches = !child.existingChildId ? findMatchingChildren(child.name) : [];
                          return (
                            <div key={child.id} className="space-y-1">
                              <div className="flex gap-2 items-start">
                                <div className="flex-1 space-y-1 relative">
                                  <Input
                                    placeholder="Search or type child's name"
                                    value={child.name}
                                    onChange={(e) => setSingleChildren(singleChildren.map(c => 
                                      c.id === child.id ? { ...c, name: e.target.value, existingChildId: undefined, existingChildParentName: undefined } : c
                                    ))}
                                    className={`h-9 ${child.existingChildId ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
                                  />
                                  {matches.length > 0 && !child.existingChildId && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-32 overflow-y-auto">
                                      {matches.map(m => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onClick={() => setSingleChildren(singleChildren.map(c => 
                                            c.id === child.id ? { ...c, name: m.name, existingChildId: m.id, existingChildParentName: m.parent_name, yearOfBirth: m.year_of_birth?.toString() || '' } : c
                                          ))}
                                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex justify-between items-center"
                                        >
                                          <span className="font-medium">{m.name}</span>
                                          <span className="text-xs text-muted-foreground">{m.parent_name} {m.year_of_birth ? `· ${m.year_of_birth}` : ''}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="w-16">
                                  <Input
                                    placeholder="#"
                                    value={child.jerseyNumber}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                                      setSingleChildren(singleChildren.map(c => 
                                        c.id === child.id ? { ...c, jerseyNumber: val } : c
                                      ));
                                    }}
                                    className="h-9"
                                    maxLength={2}
                                    inputMode="numeric"
                                  />
                                </div>
                                <div className="w-20">
                                  <Input
                                    placeholder="Year"
                                    value={child.existingChildId ? (clubChildren.find(c => c.id === child.existingChildId)?.year_of_birth?.toString() || '') : child.yearOfBirth}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                                      setSingleChildren(singleChildren.map(c => 
                                        c.id === child.id ? { ...c, yearOfBirth: val } : c
                                      ));
                                    }}
                                    className="h-9"
                                    maxLength={4}
                                    disabled={!!child.existingChildId}
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-destructive hover:text-destructive"
                                  onClick={() => setSingleChildren(singleChildren.filter(c => c.id !== child.id))}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              {child.existingChildId && (
                                <p className="text-xs text-emerald-600 flex items-center gap-1 pl-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Linked to existing child ({child.existingChildParentName || 'existing parent'})
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Second parent/guardian fields */}
                {customName.trim() && selectedRole === "parent" && singleChildren.length > 0 && (
                  <div className="space-y-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <Label className="text-blue-600 font-medium">Second Parent / Guardian (Optional)</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Search for an existing user or enter details for a new invite.
                    </p>

                    {selectedSecondParent ? (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={selectedSecondParent.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {selectedSecondParent.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{selectedSecondParent.display_name}</p>
                          <p className="text-xs text-muted-foreground">Existing user • Will be added directly</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setSelectedSecondParent(null);
                          setSecondParentSearch("");
                        }}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search existing user or type new name..."
                            value={secondParentSearch || secondParentName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSecondParentSearch(val);
                              setSecondParentName(val);
                            }}
                            className="h-9 pl-10"
                          />
                        </div>

                        {filteredSecondParentResults.length > 0 && secondParentSearch.length >= 2 && (
                          <div className="border rounded-lg overflow-hidden divide-y">
                            {filteredSecondParentResults.map((user) => (
                              <button
                                key={user.id}
                                type="button"
                                className="w-full flex items-center gap-3 p-2.5 hover:bg-accent/50 transition-colors text-left"
                                onClick={() => {
                                  setSelectedSecondParent(user);
                                  setSecondParentName(user.display_name || "");
                                  setSecondParentSearch("");
                                  setSecondParentEmail("");
                                }}
                              >
                                <Avatar className="h-7 w-7">
                                  <AvatarImage src={user.avatar_url || undefined} />
                                  <AvatarFallback className="bg-muted text-xs">
                                    {user.display_name?.[0]?.toUpperCase() || "?"}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm">{user.display_name}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {secondParentName.trim() && !selectedSecondParent && (
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="email"
                              placeholder="Second parent's email (for invite)"
                              value={secondParentEmail}
                              onChange={(e) => setSecondParentEmail(e.target.value)}
                              className="h-9 pl-10"
                            />
                          </div>
                        )}
                      </div>
                    )}
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
                {selectedRole === "parent" && (selectedSecondParent || (secondParentName.trim() && secondParentEmail.trim()))
                  ? `Add Parents to Team`
                  : `Add ${selectedUser.display_name} as ${selectedRoleOption?.label}`}
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
                {customName.trim()
                  ? (selectedSecondParent
                    ? `${customEmail.trim() ? 'Send Invite' : 'Add'} & Add ${selectedSecondParent.display_name}`
                    : secondParentName.trim() && secondParentEmail.trim() 
                      ? `Send Invites to ${customName} & ${secondParentName}` 
                      : customEmail.trim()
                        ? `Send Invite to ${customName}`
                        : `Add ${customName} as Pending`) 
                  : "Enter name to continue"}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4 mt-0">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add multiple members at once. Email addresses are optional — members without emails will get a shareable link.
              </p>
              
              {/* Parent role preview hint for bulk tab */}
              {(selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")) && (
                <div className="p-3 rounded-xl bg-pink-500/5 border border-pink-500/20">
                  <div className="flex items-start gap-2">
                    <Baby className="h-4 w-4 text-pink-600 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-pink-600">Adding parents with child players</p>
                      <p className="text-xs text-muted-foreground mb-2">
                        For each parent row, you can add their children's details below.
                      </p>
                      <div className="bg-background/50 rounded-lg p-2 border border-pink-500/10">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Child fields per parent:</p>
                        <div className="flex flex-wrap gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />
                            <span>Child's Name</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>Year of Birth</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
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
                  // Convert members to the expected format and auto-trigger invites
                  const formattedMembers: BulkMember[] = members.map(m => ({
                    ...m,
                    children: m.children.map(child => {
                      const match = findMatchingChildren(child.name)[0] || null;
                      return {
                        id: crypto.randomUUID(),
                        name: child.name,
                        yearOfBirth: child.yearOfBirth ? String(child.yearOfBirth) : "",
                        jerseyNumber: "",
                        existingChildId: match?.id,
                        existingChildParentName: match?.parent_name,
                      };
                    }),
                  }));
                  // Pass members directly to mutation to avoid state timing issues
                  addBulkMembersMutation.mutate(formattedMembers);
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
                        <div key={child.id} className="space-y-1">
                          <div className="flex gap-2 items-center">
                            <Input
                              placeholder="Child's name"
                              value={child.name}
                              onChange={(e) => updateChild(member.id, child.id, "name", e.target.value)}
                              className={`h-8 text-sm flex-1 ${child.existingChildId ? 'border-amber-500/50' : ''}`}
                            />
                            <Input
                              placeholder="#"
                              value={child.jerseyNumber}
                              onChange={(e) => updateChild(member.id, child.id, "jerseyNumber", e.target.value.replace(/\D/g, "").slice(0, 2))}
                              className="h-8 text-sm w-12"
                              maxLength={2}
                              inputMode="numeric"
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
                          {child.existingChildId && (
                            <p className="text-[10px] text-amber-600 pl-1">
                              ⚠️ Matches existing child (parent: {child.existingChildParentName}) — will link instead of creating new
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Custom message for bulk invites */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Custom Message
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setShowMessageEditor(!showMessageEditor);
                    if (!showMessageEditor && !customMessage) {
                      setCustomMessage(`We're using a new app to bring everything together for the club — it's called Ignite Club HQ.\n\nIt's been built by one of our own club members to keep things simple, organised, and completely ad-free.\n\n👀 Jump in to see:\n• What team they're in\n• Who their teammates are\n• Your club space for updates as the season gets underway\n\n(Fixtures and games will be added soon by the team admin or coach)`);
                    }
                  }}
                >
                  {showMessageEditor ? "Hide" : "Add message"}
                </Button>
              </div>
              {showMessageEditor && (
                <div className="space-y-1.5">
                  <Textarea
                    placeholder="Write a personal welcome message..."
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={3}
                    className="text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    This message will appear in all invite emails
                  </p>
                </div>
              )}
            </div>

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => addBulkMembersMutation.mutate(undefined)}
              disabled={validBulkCount === 0 || addBulkMembersMutation.isPending}
            >
              {addBulkMembersMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Send className="h-5 w-5 mr-2" />
              )}
              {validBulkCount > 0 
                ? (() => {
                    const emailCount = bulkMembers.filter(m => m.name.trim() && m.email.trim()).length;
                    return emailCount > 0
                      ? `Add ${validBulkCount} Member${validBulkCount > 1 ? "s" : ""} & Send ${emailCount} Invite${emailCount > 1 ? "s" : ""}`
                      : `Add ${validBulkCount} Member${validBulkCount > 1 ? "s" : ""}`;
                  })()
                : "Enter names to continue"}
            </Button>
          </TabsContent>
        </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
