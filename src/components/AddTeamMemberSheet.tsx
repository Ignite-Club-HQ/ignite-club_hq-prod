import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Check, Send, Users, Plus, Trash2, Upload, Baby, User, Calendar, MessageSquare, Copy, AlertTriangle, Share2, Pencil, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import TeamJoinLinkCard from "@/components/invite/TeamJoinLinkCard";
import { BulkInvitationSuccessContent } from "@/components/invite/BulkInvitationSuccessContent";
import { SingleInvitationSuccessContent } from "@/components/invite/SingleInvitationSuccessContent";
import { SingleInvitationWizardFooter } from "@/components/invite/SingleInvitationWizardFooter";
import { SingleInvitationDeliveryStep } from "@/components/invite/SingleInvitationDeliveryStep";
import { SingleInvitationRoleStep } from "@/components/invite/SingleInvitationRoleStep";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
const MemberCSVImportDialog = lazy(() => import("@/components/MemberCSVImportDialog").then(m => ({ default: m.MemberCSVImportDialog })));
import { ClubAdminConfirmBanner } from "@/components/ClubAdminConfirmBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type { MemberIdentity } from "@/lib/memberIdentity";
import { useDebounce } from "@/hooks/useDebounce";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import {
  findExistingMemberByName,
  findMatchingInvitationChildren,
  getDefaultTeamRole,
  getTeamRoleLabel,
  getTeamRoleOptions,
  type TeamRole,
  type TeamType,
} from "@/features/membership/invitationPolicy";
import {
  fetchInvitationClubBranding,
  fetchInvitationClubChildren,
  fetchInvitationIdentityMap,
  fetchPendingInviteChildren,
  fetchTeamMemberIds,
  fetchTeamMemberProfiles,
  searchInvitableProfiles,
  searchBulkInvitationCandidates,
  searchBulkSecondParentProfiles,
  searchPendingClubInvites,
  searchSecondParentProfiles,
  type PendingInviteChildMatch,
} from "@/features/membership/membershipInvitationRepository";
import {
  assignExistingTeamRole,
  addExistingSecondParent,
  isDuplicateMembershipError,
  notifyExistingTeamMember,
  processExistingParentChildren,
  createPendingTeamInvite,
  createPendingSecondParentInvite,
  recordPendingInviteEmailDelivery,
  sendPendingTeamInviteEmail,
  sendExistingParentTeamEmail,
} from "@/features/membership/membershipMutationService";
import { processBulkInvitationBatch } from "@/features/membership/bulkInvitationWorkflow";
import { refreshTeamRoleChange } from "@/features/membership/teamMembershipCacheCompletion";
import {
  ensureSecondParent,
  secondParentValidationError,
  secondParentPartialFailureMessage,
  SecondParentError,
} from "@/features/membership/secondParentInvite";

interface BulkChild {
  id: string;
  name: string;
  yearOfBirth: string;
  jerseyNumber: string;
  existingChildId?: string; // If set, links to an existing child record instead of creating new
  existingChildParentName?: string; // Display context for existing child
  confirmedNew?: boolean; // If true, user explicitly confirmed this is a different child despite name match
  pendingInviteId?: string; // If set, child exists in a pending invite — skip creation
  pendingParentName?: string; // Display context for pending invite parent
}

interface BulkMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: BulkChild[];
  selectedUser?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  // Second guardian fields for parent role
  secondParentName?: string;
  secondParentEmail?: string;
  secondParentSearch?: string;
  selectedSecondParent?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface AddTeamMemberSheetProps {
  teamId: string;
  teamName: string;
  clubId: string;
  teamType?: TeamType;
  /** True when the user is a club admin but NOT a direct member of this team */
  isClubAdminOnly?: boolean;
  /** Whether the user can use bulk/multiple invite mode (admin/coach only) */
  canBulkInvite?: boolean;
  /** Trigger button style: "default" shows full button, "icon" shows icon-only, "none" hides trigger (use externalOpen) */
  triggerVariant?: "default" | "icon" | "none";
  /** Externally controlled open state */
  externalOpen?: boolean;
  /** Callback when open state changes externally */
  onExternalOpenChange?: (open: boolean) => void;
}

export default function AddTeamMemberSheet({ teamId, teamName, clubId, teamType = "mixed", isClubAdminOnly = false, canBulkInvite = true, triggerVariant = "default", externalOpen, onExternalOpenChange }: AddTeamMemberSheetProps) {
  const roleOptions = getTeamRoleOptions(teamType);
  const getDefaultRole = () => getDefaultTeamRole(teamType);
  
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * Toast helper that appends a "View pending invites (N)" action button
   * after a successful invite is created. Fetches the live pending count
   * for this team so the badge stays accurate.
   * The action navigates to the team detail page (where PendingInvitesList
   * is rendered); if already there it's a no-op and just dismisses the toast.
   */
  const toastInviteSuccess = useCallback(
    async (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => {
      let pendingCount = 0;
      try {
        const { count } = await supabase
          .from("pending_invites")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId)
          .eq("status", "pending");
        pendingCount = count ?? 0;
      } catch {
        // ignore — fall back to a count-less link
      }

      const teamPath = `/teams/${teamId}`;
      const alreadyOnTeam = location.pathname === teamPath;

      toast({
        title: opts.title,
        description: opts.description,
        variant: opts.variant,
        action: pendingCount > 0 ? (
          <ToastAction
            altText={`View ${pendingCount} pending invite${pendingCount === 1 ? "" : "s"}`}
            onClick={() => {
              if (!alreadyOnTeam) navigate(teamPath);
            }}
          >
            View pending ({pendingCount})
          </ToastAction>
        ) : undefined,
      });
    },
    [teamId, toast, navigate, location.pathname],
  );

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onExternalOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [nameInput, setNameInput] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [customEmail, setCustomEmail] = useState("");
  // Optional phone used ONLY to build SMS/WhatsApp share links on the success step.
  // Never sent to Supabase, never persisted — cleared on reset.
  const [sharePhone, setSharePhone] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"email" | "share">("share");
  const [selectedRole, setSelectedRole] = useState<TeamRole>(getDefaultRole());
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteShareLink, setInviteShareLink] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  // Single invite children (for parent role)
  const [singleChildren, setSingleChildren] = useState<BulkChild[]>([]);
  const [bulkMembers, setBulkMembers] = useState<BulkMember[]>([
    { id: crypto.randomUUID(), name: "", email: "", role: "parent", children: [], selectedUser: null },
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
  const secondParentBlocked = secondParentValidationError({
    role: selectedRole,
    name: secondParentName,
    email: secondParentEmail,
    selectedProfile: selectedSecondParent,
  });
  const debouncedSecondParentSearch = useDebounce(secondParentSearch, 300);

  const debouncedNameInput = useDebounce(nameInput, 300);
  const nativeKbHeight = useNativeKeyboardBottomInset();
  const autoChildTriggered = useRef(false);
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const roleSectionRef = useRef<HTMLDivElement | null>(null);
  // Single-invite wizard step: 1 = Person, 2 = Role (+ children/guardian for parents), 3 = Delivery
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  // Whether the "invite by name" section is expanded. Defaults to collapsed so
  // the first screen is a simple two-way choice: share a link, or invite one person.
  const [inviteByNameExpanded, setInviteByNameExpanded] = useState(false);
  // Progressive disclosure: the join-link role selector only appears after the
  // user chooses "Create link" on the first screen.
  const [linkFlowOpen, setLinkFlowOpen] = useState(false);
  // When the user can't share the bulk join link (non-admins/coaches), the
  // invite-by-name form is the only available flow, so it must be visible by
  // default — otherwise the sheet renders an empty body.
  const inviteByNameOpen = !canBulkInvite || inviteByNameExpanded || !!nameInput.trim() || !!selectedUser || wizardStep > 1;

  // Reset to the chooser each time the sheet is opened.
  useEffect(() => {
    if (open) {
      setInviteByNameExpanded(false);
      setLinkFlowOpen(false);
    }
  }, [open]);

  // When the name is confirmed (or an existing user is selected), the role
  // selector becomes the active step. Dismiss the soft keyboard and scroll
  // the role buttons into view so the user can see what they're picking on
  // small iOS viewports where the keyboard previously hid them.
  useEffect(() => {
    if (!nameConfirmed && !selectedUser) return;
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") active.blur();
    } catch {}
    const t = setTimeout(() => {
      roleSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(t);
  }, [nameConfirmed, selectedUser]);

  // Auto-open first child input when Parent role is selected and name is confirmed (existing user or tick)
  useEffect(() => {
    const nameReady = selectedUser || nameConfirmed;
    if (selectedRole === "parent" && nameReady && singleChildren.length === 0 && !autoChildTriggered.current) {
      autoChildTriggered.current = true;
      setSingleChildren([{ id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }]);
    }
    if (selectedRole !== "parent") {
      autoChildTriggered.current = false;
    }
  }, [selectedRole, selectedUser, nameConfirmed, singleChildren.length]);

  // Fetch existing members (separate key from TeamDetail members query to avoid cache shape collisions)
  const { data: existingMembers } = useQuery({
    queryKey: ["team-member-ids", teamId],
    queryFn: () => fetchTeamMemberIds(teamId),
    enabled: open && !!teamId,
  });

  // Fetch display names for existing team members (for duplicate detection)
  const { data: existingMemberNames = [] } = useQuery({
    queryKey: ["team-member-names", teamId, existingMembers],
    queryFn: () => fetchTeamMemberProfiles(existingMembers ?? []),
    enabled: open && !!teamId && (existingMembers?.length || 0) > 0,
  });

  const memberNameMatchesExisting = (name: string) => {
    return findExistingMemberByName(name, existingMemberNames);
  };

  // Fetch club branding data for emails
  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: () => fetchInvitationClubBranding(clubId),
    enabled: !!clubId,
  });
  // Fetch existing children in the club for matching
  const { data: clubChildren = [] } = useQuery({
    queryKey: ["club-children", clubId],
    queryFn: () => fetchInvitationClubChildren(clubId),
    enabled: open && !!clubId && (selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")),
  });

  // Fetch children from pending invites for this team
  const { data: pendingInviteChildren = [] } = useQuery<PendingInviteChildMatch[]>({
    queryKey: ["pending-invite-children", teamId],
    queryFn: () => fetchPendingInviteChildren(teamId),
    enabled: open && !!teamId && (selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")),
  });

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-team-member", debouncedNameInput, clubId],
    queryFn: () => searchInvitableProfiles(debouncedNameInput, supabase, clubId),
    enabled: debouncedNameInput.length >= 2,
  });

  // Also search pending invites from other teams in same club
  const { data: pendingInviteResults = [] } = useQuery({
    queryKey: ["pending-invite-search", debouncedNameInput, clubId, teamId],
    queryFn: () => searchPendingClubInvites(debouncedNameInput, clubId),
    enabled: debouncedNameInput.length >= 2,
  });

  // Enrich search results with role/context info (Parent of X, Coach • U10, etc.)
  // scoped to the current club so suggestions are easy to disambiguate.
  const searchResultIds = searchResults.map(r => r.id);
  const pendingProfileIds = pendingInviteResults
    .filter(r => !r.id.startsWith("pending-"))
    .map(r => r.id);
  const identityLookupIds = Array.from(new Set([...searchResultIds, ...pendingProfileIds]));

  const { data: identityMap = {} } = useQuery({
    queryKey: ["invite-search-identities", clubId, identityLookupIds.sort().join(",")],
    queryFn: (): Promise<Record<string, MemberIdentity>> =>
      fetchInvitationIdentityMap(clubId, identityLookupIds),
    enabled: identityLookupIds.length > 0 && !!clubId,
    staleTime: 60 * 1000,
  });

  // Filter out existing members — but allow the current user (admin adding themselves as parent)
  // When adding a "parent" role, allow existing members to appear (we're adding a child under them)
  const filteredResults = searchResults.filter(
    u => u.id === user?.id || selectedRole === "parent" || !existingMembers?.includes(u.id)
  );

  // Merge pending invite results, excluding any already in profile results
  const profileIds = new Set(filteredResults.map(r => r.id));
  const filteredPendingResults = pendingInviteResults.filter(
    r => !profileIds.has(r.id)
  );

  const bulkSearchTerms = Array.from(
    new Set(
      bulkMembers
        .filter((member) => !member.selectedUser && member.name.trim().length >= 2)
        .map((member) => member.name.trim())
    )
  );

  const { data: bulkSearchResults = [] } = useQuery({
    queryKey: ["bulk-user-search-team-member", bulkSearchTerms, clubId, teamId],
    queryFn: () => searchBulkInvitationCandidates(bulkSearchTerms, {
      clubId,
      currentUserId: user?.id,
      selectedRole,
      existingMemberIds: existingMembers,
    }),
    enabled: open && mode === "bulk" && bulkSearchTerms.length > 0,
  });

  const bulkSearchMap = new Map(bulkSearchResults.map((entry) => [entry.term, entry.results]));

  // Bulk second parent search
  const bulkSecondParentTerms = Array.from(
    new Set(
      bulkMembers
        .filter(m => m.role === "parent" && !m.selectedSecondParent && (m.secondParentSearch || "").trim().length >= 2)
        .map(m => (m.secondParentSearch || "").trim())
    )
  );

  const { data: bulkSecondParentResults = [] } = useQuery({
    queryKey: ["bulk-second-parent-search", bulkSecondParentTerms],
    queryFn: () => searchBulkSecondParentProfiles(bulkSecondParentTerms),
    enabled: open && mode === "bulk" && bulkSecondParentTerms.length > 0,
  });

  const bulkSecondParentMap = new Map(bulkSecondParentResults.map((entry) => [entry.term, entry.results]));

  // Search for second parent (existing users)
  const { data: secondParentSearchResults = [] } = useQuery({
    queryKey: ["second-parent-search", debouncedSecondParentSearch],
    queryFn: () => searchSecondParentProfiles(debouncedSecondParentSearch),
    enabled: debouncedSecondParentSearch.length >= 2 && !selectedSecondParent,
  });

  // Filter second parent results: exclude primary user but allow existing members (they may need parent role added)
  const filteredSecondParentResults = secondParentSearchResults.filter(
    u => u.id !== selectedUser?.id
  );

  // Find matching existing children by partial name (case-insensitive), including pending invite children
  const findMatchingChildren = (name: string) => {
    return findMatchingInvitationChildren(name, clubChildren, pendingInviteChildren);
  };

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
      if (secondParentBlocked) throw new SecondParentError(secondParentBlocked, secondParentName);

      const { roleWasDuplicate } = await assignExistingTeamRole({
        userId: selectedUser.id,
        teamId,
        clubId,
        role: selectedRole,
      });

      // If parent role, create or link children and assign to team
      // Track resolved child IDs so second-parent flows always link correctly
      const createdChildIds: string[] = [];
      const resolvedChildren: { id: string; name: string; yearOfBirth: number | null }[] = [];
      if (selectedRole === "parent") {
        const result = await processExistingParentChildren({
          parentUserId: selectedUser.id,
          teamId,
          teamName,
          children: singleChildren,
          clubChildren,
        });
        createdChildIds.push(...result.childIds);
        resolvedChildren.push(...result.resolvedChildren);
      }

      // Handle second parent
      let secondParentInviteLink: string | null = null;
      let secondParentAddedDirectly = false;
      
      if ((selectedSecondParent || secondParentName.trim()) && selectedRole === "parent") {
        const secondParentResult = await ensureSecondParent({
          role: selectedRole,
          teamId,
          clubId,
          name: secondParentName,
          email: secondParentEmail,
          selectedProfile: selectedSecondParent,
          childIds: createdChildIds,
          childrenMetadata: resolvedChildren.map((child) => ({
            name: child.name,
            yearOfBirth: child.yearOfBirth,
            existingChildId: child.id,
          })),
          expectChildren: singleChildren.some((child) => child.name.trim()),
          invitedByUserId: user!.id,
          origin: window.location.origin,
        });
        secondParentInviteLink = secondParentResult.inviteLink ?? null;
        secondParentAddedDirectly = secondParentResult.status === "added";
      }

      // Send notification (role is already committed — a failure here is a
      // partial success, not a failed add)
      const notificationResult = await notifyExistingTeamMember({
        userId: selectedUser.id,
        teamId,
        teamName,
        roleLabel: roleOptions.find(r => r.value === selectedRole)?.label,
      });

      return {
        secondParentInviteLink,
        secondParentAddedDirectly,
        roleWasDuplicate,
        ...notificationResult,
      };
    },
    onSuccess: async (result) => {
      refreshTeamRoleChange(queryClient, teamId);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });

      if (result?.notificationFailed) {
        toast({
          variant: "destructive",
          title: "Member added — notification failed",
          description: `${selectedUser?.display_name} was added to ${teamName}, but we couldn't notify them in the app. Please tell them manually.${result.notificationError ? ` (${result.notificationError})` : ""}`,
        });
      } else if (result?.roleWasDuplicate) {

        const roleName = getTeamRoleLabel(selectedRole, roleOptions);
        void toastInviteSuccess({
          title: "Already a member",
          description: `${selectedUser?.display_name} is already a ${roleName} on this team. Any new children have been linked.`,
        });
      } else {
        void toastInviteSuccess({
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

      // Send team-invite email to primary parent (existing user) — uses full onboarding template with download links
      if (selectedRole === "parent" && selectedUser) {
        const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
        if (childrenNames.length > 0) {
          try {
            await sendExistingParentTeamEmail({
              recipientUserId: selectedUser.id,
              recipientName: selectedUser.display_name,
              teamId,
              teamName,
              appOrigin: window.location.origin,
              childrenNames,
              customMessage,
              clubName: clubBranding?.name,
              clubLogoUrl: clubBranding?.logo_url,
              clubContactEmail: clubBranding?.contact_email,
              inviteEmailStyle: clubBranding?.invite_email_style,
            });
          } catch (err) {
            console.error("[AddMember] Failed to send team-invite email to primary parent:", err);
          }
        }
      }

      // Send team-invite email to existing user added as coach/admin/player (non-parent)
      if (selectedRole !== "parent" && selectedUser && !result?.roleWasDuplicate) {
        const roleName = getTeamRoleLabel(selectedRole, roleOptions);
        // Use email from customEmail field, or fall back to sending via toUserId
        const emailTarget = customEmail.trim().toLowerCase();
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              ...(emailTarget ? { to: emailTarget } : { toUserId: selectedUser.id }),
              subject: `${clubBranding?.name || 'Your club'}: You've been added to ${teamName} as ${roleName}`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: selectedUser.display_name || roleName,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName,
                clubLogoUrl: clubBranding?.logo_url || undefined,
                customMessage: customMessage?.trim() || undefined,
                inviteLink: `${window.location.origin}/teams/${teamId}`,
              },
            },
          });
        } catch (err) {
          console.error(`[AddMember] Failed to send team-invite email to ${roleName}:`, err);
        }
      }

      if (result?.secondParentAddedDirectly && selectedSecondParent) {
        const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
        if (childrenNames.length > 0) {
          try {
            await sendExistingParentTeamEmail({
              recipientUserId: selectedSecondParent.id,
              recipientName: selectedSecondParent.display_name,
              teamId,
              teamName,
              appOrigin: window.location.origin,
              childrenNames,
              clubName: clubBranding?.name,
              clubLogoUrl: clubBranding?.logo_url,
              clubContactEmail: clubBranding?.contact_email,
              inviteEmailStyle: clubBranding?.invite_email_style,
            });
          } catch (err) {
            console.error("[AddMember] Failed to send team-invite email to second parent:", err);
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
                ? clubBranding?.invite_email_style === "discover"
                  ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                  : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`
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
      if (!nameInput.trim()) throw new Error("Please enter a name");
      if (secondParentBlocked) throw new SecondParentError(secondParentBlocked, secondParentName);

      // Email dedupe: if the inviter typed an email and it belongs to an
      // existing in-scope user, attach the role directly instead of
      // creating a duplicate pending invite. Outside-scope emails fall
      // through to the normal invite flow (auth-side email uniqueness
      // handles dedupe at acceptance time).
      const dedupeEmail = customEmail.trim().toLowerCase();
      if (dedupeEmail) {
        const { lookupInvitableUserByEmail } = await import("@/lib/inviteEmailDedupe");
        const match = await lookupInvitableUserByEmail({
          email: dedupeEmail,
          clubId,
          teamId,
        });
        if (match?.already_in_team) {
          throw new Error(
            `${match.display_name || dedupeEmail} is already on this team.`,
          );
        }
        if (match) {
          // Existing user the caller can see — add role directly, no email invite.
          const { error: roleErr } = await supabase.from("user_roles").insert({
            user_id: match.user_id,
            team_id: teamId,
            club_id: clubId,
            role: selectedRole as any,
          });
          if (roleErr && !roleErr.message?.includes("duplicate")) {
            throw roleErr;
          }
          const { error: notifyErr } = await supabase.from("notifications").insert({
            user_id: match.user_id,
            type: "membership",
            message: `You have been added to ${teamName} as ${getTeamRoleLabel(selectedRole, roleOptions)}`,
            related_id: teamId,
          });
          return {
            link: "",
            shareLink: "",
            email: "",
            childrenCount: 0,
            childrenNames: [] as string[],
            secondParentLink: null as string | null,
            secondParentEmail: "",
            secondParentName: "",
            secondParentAddedDirectly: false,
            existingUserAdded: {
              name: match.display_name || dedupeEmail,
              notificationFailed: !!notifyErr,
              notificationError: notifyErr?.message ?? null,
            },
          };

        }
      }

      // Create a unique token for this specific pending invite (name-restricted)
      const inviteToken = createPendingInviteToken();

      const validChildren = selectedRole === "parent" 
        ? singleChildren.filter(c => c.name.trim())
        : [];

      // Generate second parent token only if NOT selecting an existing user
      const secondToken = null;

      const { invite: primaryInvite, childrenMetadata } = await createPendingTeamInvite({
        teamId,
        clubId,
        role: selectedRole,
        inviterUserId: user!.id,
        invitedName: nameInput,
        invitedEmail: customEmail,
        inviteToken,
        children: singleChildren,
        linkedSecondParentToken: secondToken,
        selectedSecondParentId: selectedSecondParent?.id ?? null,
      });

      const link = `${window.location.origin}/join/p/${inviteToken}`;
      
      // Handle second parent
      let secondParentLink: string | null = null;
      let secondParentAddedDirectly = false;

      if ((selectedSecondParent || secondParentName.trim()) && selectedRole === "parent") {
        const secondParentResult = await ensureSecondParent({
          role: selectedRole,
          teamId,
          clubId,
          name: secondParentName,
          email: secondParentEmail,
          selectedProfile: selectedSecondParent,
          childrenMetadata,
          expectChildren: validChildren.length > 0,
          invitedByUserId: user!.id,
          linkedInviteToken: inviteToken,
          origin: window.location.origin,
        });
        secondParentLink = secondParentResult.inviteLink ?? null;
        secondParentAddedDirectly = secondParentResult.status === "added";
      }

      const shortCode = (primaryInvite as any)?.short_code || null;
      const sLink = shortCode 
        ? `https://igniteclubhq.app/j/${shortCode}` 
        : link;

      return { 
        link, 
        shareLink: sLink,
        email: customEmail.trim(), 
        childrenCount: validChildren.length, 
        childrenNames: validChildren.map(c => c.name.trim()),
        secondParentLink,
        secondParentEmail: secondParentEmail.trim(),
        secondParentName: secondParentName.trim(),
        secondParentAddedDirectly,
      };
    },
    onSuccess: async (result) => {
      const { link, shareLink: sLink, email, childrenCount, childrenNames, secondParentLink, secondParentEmail: secondEmail, secondParentName: secondName, secondParentAddedDirectly } = result;
      const existingUserAdded = (result as any).existingUserAdded as
        | { name: string; notificationFailed?: boolean; notificationError?: string | null }
        | undefined;

      // Short-circuit when we attached the role directly to an existing user
      if (existingUserAdded) {
        refreshTeamRoleChange(queryClient, teamId);
        queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });
        if (existingUserAdded.notificationFailed) {
          toast({
            variant: "destructive",
            title: "Member added — notification failed",
            description: `${existingUserAdded.name} was added to ${teamName}, but we couldn't notify them in the app. Please tell them manually.${existingUserAdded.notificationError ? ` (${existingUserAdded.notificationError})` : ""}`,
          });
        } else {
          toast({
            title: "Added to team",
            description: `${existingUserAdded.name} already has an account and has been added directly — no email invite was sent.`,
          });
        }
        setNameInput("");
        setCustomEmail("");
        return;
      }


      setInviteLink(link);
      setInviteShareLink(sLink);
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
          
          const { providerResult: emailResult, invocationError: funcError } = await sendPendingTeamInviteEmail({
            recipientName: nameInput,
            recipientEmail: email,
            teamName,
            roleLabel: roleOptions.find(r => r.value === selectedRole)?.label || "Member",
            inviteLink: link,
            childrenNames,
            customMessage,
            clubName: clubBranding?.name,
            clubLogoUrl: clubBranding?.logo_url,
            clubContactEmail: clubBranding?.contact_email,
            inviteEmailStyle: clubBranding?.invite_email_style,
          });
          
          // Update pending invite with email status
          const { emailSent } = await recordPendingInviteEmailDelivery({
            inviteToken,
            providerResult: emailResult,
            invocationError: funcError,
          });
          
          // Refresh the pending invites list to show updated status
          queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
          
          if (emailSent) {
            void toastInviteSuccess({
              title: "Invite sent!",
              description: `Email notification sent to ${email}`,
            });
          } else {
            void toastInviteSuccess({
              title: "Member added",
              description: "Could not send email, but invite has been created",
              variant: "default",
            });
          }
        } catch (error) {
          console.error("Failed to send email:", error);
          void toastInviteSuccess({
            title: "Member added",
            description: "Could not send email, but invite has been created",
            variant: "default",
          });
        } finally {
          setIsSendingNotification(false);
        }
      } else {
        // No email — show share step. Do NOT auto-write to clipboard here:
        // the success step has an explicit "Copy Link" button, and clobbering
        // the clipboard wipes out anything the user just copied (e.g. a phone
        // number they intended to paste into the SMS/WhatsApp share field).
        void toastInviteSuccess({
          title: "Member added",
          description: `${nameInput} has been added. Use the share options to send the invite link.`,
        });
      }

      // Send email to second parent if provided
      if (secondEmail && secondParentLink) {
        try {
          const secondToken = secondParentLink.split("/join/p/")[1];
          const { providerResult: emailResult, invocationError: funcError } = await sendPendingTeamInviteEmail({
            recipientName: secondName,
            recipientEmail: secondEmail,
            teamName,
            roleLabel: "Parent",
            inviteLink: secondParentLink,
            childrenNames,
            customMessage,
            clubName: clubBranding?.name,
            clubLogoUrl: clubBranding?.logo_url,
            clubContactEmail: clubBranding?.contact_email,
            inviteEmailStyle: clubBranding?.invite_email_style,
          });

          const { emailSent } = await recordPendingInviteEmailDelivery({
            inviteToken: secondToken,
            providerResult: emailResult,
            invocationError: funcError,
            invocationErrorPolicy: "provider-fallback",
          });

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

      // Send team-invite email to second parent (existing user added directly)
      if (secondParentAddedDirectly && selectedSecondParent && childrenNames.length > 0) {
        try {
          await sendExistingParentTeamEmail({
            recipientUserId: selectedSecondParent.id,
            recipientName: selectedSecondParent.display_name,
            teamId,
            teamName,
            appOrigin: window.location.origin,
            childrenNames,
            customMessage,
            clubName: clubBranding?.name,
            clubLogoUrl: clubBranding?.logo_url,
            clubContactEmail: clubBranding?.contact_email,
            inviteEmailStyle: clubBranding?.invite_email_style,
          });
        } catch (err) {
          console.error("[AddMember] Failed to send team-invite email to second parent (new flow):", err);
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
      const { results, failures } = await processBulkInvitationBatch(membersSource, {
          teamId,
          teamName,
          clubId,
          inviterUserId: user!.id,
          roleLabel: (role) => roleOptions.find(option => option.value === role)?.label,
          clubChildren,
          customMessage,
          appOrigin: window.location.origin,
          clubName: clubBranding?.name,
          clubLogoUrl: clubBranding?.logo_url,
          clubContactEmail: clubBranding?.contact_email,
          inviteEmailStyle: clubBranding?.invite_email_style,
      });
      for (const failure of failures) {
        console.error("Failed to add bulk member", failure.memberName, failure.error);
      }

      return { results, failures };
    },
    onSuccess: ({ results, failures }) => {
      setBulkResults(results);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });
      refreshTeamRoleChange(queryClient, teamId);
      
      const sentCount = results.filter(r => r.sent).length;
      const totalCount = results.length;
      
      if (failures.length > 0) {
        toast({
          title: "Some invitations need attention",
          description: secondParentPartialFailureMessage(
            `${totalCount} member${totalCount === 1 ? " was" : "s were"} added`,
            failures.map((failure) => failure.memberName).join(", "),
          ),
          variant: "destructive",
        });
      } else void toastInviteSuccess({
        title: `${totalCount} member${totalCount > 1 ? "s" : ""} added`,
        description: sentCount > 0
          ? `${sentCount} member${sentCount > 1 ? "s were" : " was"} added or emailed successfully`
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

  const buildInviteShareMessage = (overrideLink?: string) => {
    const clubName = clubBranding?.name || "";
    const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
    const isAdminRole = ['club_admin', 'committee_member', 'coach', 'team_admin'].includes(selectedRole);
    const roleName = getTeamRoleLabel(selectedRole, roleOptions);
    const email = customEmail.trim();
    const appDownload = `\n\n📲 Get the app:\nApple: https://apps.apple.com/au/app/ignite-club-hq/id6758928691\nAndroid: https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub`;
    const emailNote = email ? `\n\nSign up with ${email} so your account links automatically.` : "";
    const link = overrideLink || inviteShareLink || inviteLink || "";

    if (isAdminRole && teamName) {
      return `You've been invited to join ${teamName}${clubName ? ` at ${clubName}` : ""} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    if (isAdminRole && clubName) {
      return `You've been invited to help run ${clubName} as ${roleName}. Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    if (selectedRole === "parent" && childrenNames.length === 1) {
      return `${childrenNames[0]} has been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`.trim();
    }
    if (selectedRole === "parent" && childrenNames.length > 1) {
      return `Your kids (${childrenNames.join(", ")}) have been added to ${teamName || clubName || "the team"}${clubName && teamName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`.trim();
    }
    if (selectedRole === "parent" && teamName) {
      return `Your child has been added to ${teamName}${clubName ? ` at ${clubName}` : ""}!${appDownload}${emailNote}${link ? `\n\nJoin here: ${link}` : ""}`.trim();
    }
    if (teamName) {
      return `You've been added to ${teamName}${clubName ? ` at ${clubName}` : ""}! Tap here to join: ${link}${appDownload}${emailNote}`;
    }
    if (clubName) {
      return `You've been invited to join ${clubName}! Tap here to get started: ${link}${appDownload}${emailNote}`;
    }
    return `You've been invited to join the team! Tap here to get started: ${link}${appDownload}${emailNote}`;
  };

  const handleClose = () => {
    setOpen(false);
    setNameInput("");
    setNameConfirmed(false);
    setSelectedUser(null);
    setCustomEmail("");
    setSharePhone("");
    setDeliveryMethod("share");
    setSelectedRole(getDefaultRole());
    setInviteLink(null);
    setInviteShareLink(null);
    setInviteSent(false);
    setMode("single");
    setWizardStep(1);
    setNameConfirmed(false);
    setInviteByNameExpanded(false);
    setSingleChildren([]);
    autoChildTriggered.current = false;
    setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: getDefaultRole(), children: [], selectedUser: null }]);
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
    setBulkMembers([...bulkMembers, { id: crypto.randomUUID(), name: "", email: "", role: selectedRole, children: [], selectedUser: null }]);
  };

  const removeBulkMemberRow = (id: string) => {
    if (bulkMembers.length > 1) {
      setBulkMembers(bulkMembers.filter(m => m.id !== id));
    }
  };

  const updateBulkMember = (id: string, field: keyof Omit<BulkMember, "id" | "children" | "selectedUser">, value: string) => {
    setBulkMembers(bulkMembers.map(m => 
      m.id === id
        ? { ...m, [field]: value, ...(field === "name" ? { selectedUser: null } : {}) }
        : m
    ));
  };

  const selectBulkExistingUser = (memberId: string, selected: { id: string; display_name: string | null; avatar_url: string | null }) => {
    setBulkMembers(bulkMembers.map(m =>
      m.id === memberId
        ? { ...m, name: selected.display_name || "", selectedUser: selected, email: "" }
        : m
    ));
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
              updated.pendingInviteId = undefined;
              updated.pendingParentName = undefined;
              updated.confirmedNew = undefined;
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
        {triggerVariant !== "none" && (
          <SheetTrigger asChild>
            {triggerVariant === "icon" ? (
              <Button variant="ghost" size="icon" className="h-9 w-9" data-invite-trigger onClick={() => setOpen(true)}>
                <UserPlus className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" data-invite-trigger onClick={() => setOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite to Team
              </Button>
            )}
          </SheetTrigger>
        )}
        <BulkInvitationSuccessContent
          results={bulkResults}
          onCopyLink={async (result) => {
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
          onAddMore={() => {
            setBulkResults([]);
            setBulkMembers([{ id: crypto.randomUUID(), name: "", email: "", role: getDefaultRole(), children: [] }]);
          }}
          onDone={handleDone}
        />
      </Sheet>
    );
  }

  // If we have a pending invite link (single mode), show success state
  if (inviteLink) {
    return (
      <Sheet open={open} onOpenChange={handleClose}>
        {triggerVariant !== "none" && (
          <SheetTrigger asChild>
            {triggerVariant === "icon" ? (
              <Button variant="ghost" size="icon" className="h-9 w-9" data-invite-trigger onClick={() => setOpen(true)}>
                <UserPlus className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" data-invite-trigger onClick={() => setOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Invite to Team
              </Button>
            )}
          </SheetTrigger>
        )}
        <SingleInvitationSuccessContent
          memberName={nameInput}
          isParent={selectedRole === "parent"}
          childNames={singleChildren.filter(child => child.name.trim()).map(child => child.name.trim())}
          teamName={teamName}
          invitedEmail={customEmail}
          phone={sharePhone}
          shareMessage={buildInviteShareMessage()}
          isAndroid={/android/i.test(navigator.userAgent)}
          onPhoneChange={setSharePhone}
          onOpenSms={(href) => { window.location.href = href; }}
          onOpenWhatsApp={(href) => { window.open(href, "_blank"); }}
          onMoreShare={async () => {
            const message = buildInviteShareMessage().trim();
            if (Capacitor.isNativePlatform()) {
              try {
                await Share.share({ title: `Join ${clubBranding?.name || teamName}`, text: message, dialogTitle: "Share invite" });
                return;
              } catch {
                // cancelled
              }
            }
            window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
          }}
          onCopyLink={async () => {
            try {
              await navigator.clipboard.writeText(inviteShareLink || inviteLink || "");
              toast({ title: "Invite link copied!" });
            } catch {
              toast({ title: "Failed to copy link", variant: "destructive" });
            }
          }}
          onAddAnother={() => {
                setInviteLink(null);
                setInviteShareLink(null);
                setNameInput("");
                setNameConfirmed(false);
                setCustomEmail("");
                setSharePhone("");
                setDeliveryMethod("share");
                setSingleChildren([]);
                setSecondParentName("");
                setSecondParentEmail("");
                setSecondParentSearch("");
                setSelectedSecondParent(null);
                setCustomMessage("");
                setShowMessageEditor(false);
          }}
          onDone={handleDone}
        />
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {triggerVariant !== "none" && (
        <SheetTrigger asChild>
          {triggerVariant === "icon" ? (
            <Button variant="ghost" size="icon" className="h-9 w-9" data-invite-trigger onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" data-invite-trigger onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite to Team
            </Button>
          )}
        </SheetTrigger>
      )}
      <SheetContent
        side="bottom"
        enableDragToClose
        hideCloseButton
        className="rounded-t-2xl flex flex-col overflow-hidden overscroll-contain"
        data-lock-keyboard-scroll="true"
        data-allow-scroll
        style={{
          touchAction: 'pan-y',
          WebkitOverflowScrolling: 'touch',
          // When the soft keyboard is open (Capacitor Keyboard.resize='none'),
          // lift the sheet ABOVE the keyboard by offsetting its bottom edge.
          bottom: nativeKbHeight > 0 ? `${nativeKbHeight}px` : undefined,
          // STABLE HEIGHT: the sheet keeps ONE height for the whole invite
          // workflow so it never grows/shrinks (and visibly jolts) as steps
          // change or as validation rows/errors appear while typing. Only the
          // keyboard inset changes it; all content scrolls inside.
          // `--visual-vh` is the monotonic-max locked viewport height.
          height: `calc(min(86vh, calc(var(--visual-vh, 100dvh) * 0.86)) - ${nativeKbHeight}px)`,
          maxHeight: `calc(var(--visual-vh, 100dvh) - ${nativeKbHeight}px - env(safe-area-inset-top, 0px) - 8px)`,
          // Only animate the keyboard lift — never height, so content changes
          // cannot produce an animated up/down jolt.
          transitionProperty: 'bottom',
          transitionDuration: '200ms',
          transitionTimingFunction: 'ease',
        }}

      >
        <SheetHeader className="mb-3 shrink-0 relative pr-2">
          <SheetTitle>Invite to Team</SheetTitle>
          <SheetDescription>
            Add players, parents or coaches
          </SheetDescription>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute -right-1 top-0 h-8 w-8 rounded-full opacity-70 hover:opacity-100"
              aria-label="Close invite sheet"
            >
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        {/* Club admin confirmation banner */}
        {isClubAdminOnly && (
          <div className="mb-3 shrink-0">
            <ClubAdminConfirmBanner teamName={teamName} action="add members" />
          </div>
        )}

        <div data-allow-scroll className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 pb-4 overscroll-contain" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="w-full">
          {/* Multiple/bulk tab removed — join link + single invite cover all cases */}

          <TabsContent value="single" className="space-y-4 mt-0">

            {/* STEP 0 — the only decision on first open: one link, or one person. */}
            {canBulkInvite && wizardStep === 1 && !nameInput.trim() && !selectedUser && !inviteByNameExpanded && !linkFlowOpen && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Link2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Share a team link</p>
                      <p className="text-xs text-muted-foreground">Invite several people at once.</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="w-full h-11 text-sm font-semibold"
                    onClick={() => setLinkFlowOpen(true)}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Create link
                  </Button>
                </div>

                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <UserPlus className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Invite someone directly</p>
                      <p className="text-xs text-muted-foreground">Send an individual invitation by email or SMS.</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-11 text-sm font-semibold bg-background"
                    onClick={() => setInviteByNameExpanded(true)}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite person
                  </Button>
                </div>
              </div>
            )}

            {/* Join-link flow — role choice + link actions, shown after "Create link". */}
            {canBulkInvite && wizardStep === 1 && !nameInput.trim() && !selectedUser && linkFlowOpen && !inviteByNameExpanded && (
              <TeamJoinLinkCard
                teamId={teamId}
                teamName={teamName}
                teamType={teamType}
                onBack={() => setLinkFlowOpen(false)}
              />
            )}

            {/* Invite-by-name body (form + wizard) — only when expanded */}
            {inviteByNameOpen && (
              <>
            {canBulkInvite && wizardStep === 1 && !nameInput.trim() && !selectedUser && (
              <div className="flex items-start justify-between gap-2 pt-1">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold">Invite by name</h3>
                  <p className="text-xs text-muted-foreground">Send a personal invite to one specific person.</p>
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
            )}

            <SingleInvitationRoleStep
              ref={roleSectionRef}
              wizardStep={wizardStep}
              personName={selectedUser?.display_name || nameInput.trim()}
              isExistingUser={!!selectedUser}
              selectedRole={selectedRole}
              roleOptions={roleOptions}
              onEditPerson={() => setWizardStep(1)}
              onEditRole={() => setWizardStep(2)}
              onRoleChange={setSelectedRole}
            />

            {/* STEP 1: Person — name input, search, existing user / new member chip */}
            {wizardStep === 1 && (
              <>
            {/* 2. NAME INPUT */}
            {!selectedUser && !nameConfirmed ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Name</Label>

                <div className="relative flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email, or enter new"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="pl-10 h-12 text-base"
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (!looksLikeMultiRecipient(text)) return;
                        e.preventDefault();
                        const recipients = parseRecipients(text);
                        if (recipients.length < 2) return;
                        setBulkMembers(recipients.map((r) => ({
                          id: crypto.randomUUID(),
                          name: r.name,
                          email: r.email,
                          role: getDefaultRole(),
                          children: [],
                          selectedUser: null,
                        })));
                        setMode("bulk");
                        toast({
                          title: `${recipients.length} recipients detected`,
                          description: "Switched to multi-invite. Review the list and send.",
                        });
                      }}
                      onFocus={(e) => {
                        // On iOS the soft keyboard covers the input because the
                        // sheet sits above the keyboard but the input is below
                        // the role selector. Scroll the field into view once the
                        // keyboard has begun to animate up.
                        const el = e.currentTarget;
                        setTimeout(() => {
                          try {
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          } catch {}
                        }, 250);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && nameInput.trim()) {
                          setNameConfirmed(true);
                        }
                      }}
                    />
                  </div>
                  {nameInput.trim() && (
                    <Button
                      type="button"
                      size="icon"
                      className="h-12 w-12 shrink-0"
                      onClick={() => setNameConfirmed(true)}
                    >
                      <Check className="h-5 w-5" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">You can paste multiple names.</p>

                {isSearching && (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}

                {!isSearching && (filteredResults.length > 0 || filteredPendingResults.length > 0) && debouncedNameInput.length >= 2 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                    {filteredResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(result);
                          setNameInput("");
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-sm">
                            {result.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{result.display_name || "Unknown"}</span>
                          {identityMap[result.id]?.contextLine && (
                            <span className="text-xs text-muted-foreground truncate">{identityMap[result.id].contextLine}</span>
                          )}
                          {(result as any).masked_email && (
                            <span className="text-[11px] text-muted-foreground/70 truncate">{(result as any).masked_email}</span>
                          )}
                        </div>
                      </button>
                    ))}
                    {filteredPendingResults.map((result) => (
                      <button
                        key={result.pendingInviteId}
                        type="button"
                        onClick={() => {
                          if (result.id.startsWith("pending-")) {
                            setNameInput(result.display_name || "");
                            if (result.invited_email) {
                              setCustomEmail(result.invited_email);
                            }
                          } else {
                            setSelectedUser({
                              id: result.id,
                              display_name: result.display_name,
                              avatar_url: result.avatar_url,
                            });
                            setNameInput("");
                          }
                        }}
                        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-background transition-colors text-left"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback className="bg-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
                            {result.display_name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{result.display_name || "Unknown"}</span>
                          {identityMap[result.id]?.contextLine ? (
                            <span className="text-xs text-muted-foreground truncate">{identityMap[result.id].contextLine}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending invite (other team)</span>
                          )}
                        </div>
                      </button>
                    ))}
                    <p className="text-xs text-muted-foreground px-2 pt-1">
                      Or continue typing to add as a new member
                    </p>
                  </div>
                )}

                {!isSearching && debouncedNameInput.length >= 2 && filteredResults.length === 0 && filteredPendingResults.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">
                    No existing users found — will be invited as new member
                  </p>
                )}

                {selectedRole !== "parent" && memberNameMatchesExisting(nameInput) && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      <strong>{memberNameMatchesExisting(nameInput)?.display_name}</strong> is already on this team.
                    </p>
                  </div>
                )}
              </div>
            ) : !selectedUser && nameConfirmed ? (
              /* Confirmed new member name chip */
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {nameInput.trim()[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{nameInput.trim()}</p>
                  <p className="text-sm text-muted-foreground">New member</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setNameConfirmed(false)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              /* Selected user chip */
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedUser!.avatar_url || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary">
                    {selectedUser!.display_name?.[0]?.toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium">{selectedUser!.display_name || "Unknown"}</p>
                  <p className="text-sm text-muted-foreground">Will be added directly</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedUser(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
              </>
            )}


            {/* STEP 3 (existing user): optional email for non-parent roles */}
            {wizardStep === 3 && selectedUser && selectedRole !== "parent" && (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  Email address (optional — to send invite email)
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="e.g., coach@example.com"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            )}

            {/* STEP 2 (existing user, parent role): child fields + second guardian */}
            {wizardStep === 2 && selectedUser && selectedRole === "parent" && (
              <>
                {/* Child fields for existing user with parent role */}
                <div className="space-y-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-2">
                    <Baby className="h-4 w-4 text-primary" />
                    <Label className="text-primary font-medium">Child Player(s)</Label>
                  </div>

                  {singleChildren.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : (
                    <div className="space-y-2">
                      {singleChildren.map((child, idx) => {
                        const matches = !child.existingChildId && !child.confirmedNew && !child.pendingInviteId ? findMatchingChildren(child.name) : [];
                        return (
                          <div key={child.id} className="space-y-1">
                            <div className="space-y-2">
                              <div className="flex gap-2 items-start">
                                <div className="flex-1 space-y-1 relative">
                                  <Input
                                    placeholder="Child's name"
                                    value={child.name}
                                    onChange={(e) => setSingleChildren(singleChildren.map(c =>
                                      c.id === child.id ? { ...c, name: e.target.value, existingChildId: undefined, existingChildParentName: undefined, pendingInviteId: undefined, pendingParentName: undefined, confirmedNew: undefined } : c
                                    ))}
                                    className={`h-9 ${child.existingChildId || child.pendingInviteId ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
                                  />
                                  {matches.length > 0 && !child.existingChildId && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-32 overflow-y-auto">
                                      {matches.map(m => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onClick={() => setSingleChildren(singleChildren.map(c =>
                                            c.id === child.id ? ((m as any).isPending
                                              ? { ...c, name: m.name, pendingInviteId: (m as any).inviteId, pendingParentName: m.parent_name, existingChildId: undefined, existingChildParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: true }
                                              : { ...c, name: m.name, existingChildId: m.id, existingChildParentName: m.parent_name, pendingInviteId: undefined, pendingParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: undefined }) : c
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
                              <Collapsible defaultOpen={!!(child.jerseyNumber || child.yearOfBirth)}>
                                <CollapsibleTrigger asChild>
                                  <button
                                    type="button"
                                    className="group flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
                                    <span className="italic">Add details now (optional)</span>
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-2">
                                  <div className="flex gap-2 pl-0">
                                    <div className="flex-1">
                                      <Input
                                        placeholder="Jersey #"
                                        value={child.jerseyNumber}
                                        onChange={(e) => {
                                          const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                                          setSingleChildren(singleChildren.map(c =>
                                            c.id === child.id ? { ...c, jerseyNumber: val } : c
                                          ));
                                        }}
                                        className="h-10 text-sm"
                                        maxLength={2}
                                        inputMode="numeric"
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <select
                                        value={child.existingChildId ? (clubChildren.find(c => c.id === child.existingChildId)?.year_of_birth?.toString() || '') : child.yearOfBirth}
                                        onChange={(e) => {
                                          setSingleChildren(singleChildren.map(c =>
                                            c.id === child.id ? { ...c, yearOfBirth: e.target.value } : c
                                          ));
                                        }}
                                        disabled={!!child.existingChildId}
                                        className="h-10 w-full text-sm rounded-md border border-input bg-background px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                      >
                                        <option value="">Birth year</option>
                                        {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - 3 - i).map(year => (
                                          <option key={year} value={year.toString()}>{year}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground italic mt-1.5 pl-0.5">
                                    Parent can complete this later
                                  </p>
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                            {child.existingChildId && (
                              <p className="text-xs text-emerald-600 flex items-center gap-1 pl-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Linked to existing child ({child.existingChildParentName || 'existing parent'})
                              </p>
                            )}
                            {child.pendingInviteId && !child.existingChildId && (
                              <p className="text-xs text-blue-600 flex items-center gap-1 pl-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Pending invite (parent: {child.pendingParentName})
                              </p>
                            )}
                            {!child.existingChildId && !child.confirmedNew && matches.length > 0 && child.name.trim().length >= 3 && (
                              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-xs text-amber-700 dark:text-amber-300">
                                    <strong>{matches[0].name}</strong>{' '}
                                    {(matches[0] as any).isPending
                                      ? <>has a pending invite (parent: {matches[0].parent_name}). Same child?</>
                                      : <>already exists (parent: {matches[0].parent_name}). Link to them?</>
                                    }
                                  </p>
                                  <div className="flex gap-2 mt-1.5">
                                    {(matches[0] as any).isPending ? (
                                      <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        onClick={() => setSingleChildren(singleChildren.map(c =>
                                          c.id === child.id ? { ...c, confirmedNew: true, pendingInviteId: (matches[0] as any).inviteId, pendingParentName: matches[0].parent_name, existingChildId: undefined, existingChildParentName: undefined } : c
                                        ))}
                                      >
                                        Yes, same child
                                      </Button>
                                    ) : (
                                      <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        onClick={() => setSingleChildren(singleChildren.map(c =>
                                          c.id === child.id ? { ...c, name: matches[0].name, existingChildId: matches[0].id, existingChildParentName: matches[0].parent_name, yearOfBirth: matches[0].year_of_birth?.toString() || '', confirmedNew: undefined } : c
                                        ))}
                                      >
                                        Link to existing
                                      </Button>
                                    )}
                                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                                      onClick={() => setSingleChildren(singleChildren.map(c =>
                                        c.id === child.id ? { ...c, confirmedNew: true } : c
                                      ))}
                                    >
                                      Different child
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setSingleChildren([...singleChildren, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }])}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors mt-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add another child
                      </button>
                    </div>
                  )}
                </div>

                {/* Second parent/guardian for existing user */}
                {singleChildren.length > 0 && (
                  <div className="space-y-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Optional</p>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <Label className="text-blue-600 font-medium">Second Parent / Guardian</Label>
                    </div>

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
                          <p className="text-xs text-muted-foreground">Will be added directly</p>
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
                            placeholder="Search by name or email, or type new"
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
                              placeholder="Second parent's email"
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

            {/* STEP 2 (new member, parent role): child fields + second guardian */}
            {wizardStep === 2 && !selectedUser && nameConfirmed && nameInput.trim() && selectedRole === "parent" && (
              <>
                {/* Child fields for parent role (new member) */}
                <div className="space-y-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-2">
                    <Baby className="h-4 w-4 text-primary" />
                    <Label className="text-primary font-medium">Child Player(s)</Label>
                  </div>

                  {singleChildren.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : (
                    <div className="space-y-2">
                      {singleChildren.map((child, idx) => {
                        const matches = !child.existingChildId && !child.confirmedNew && !child.pendingInviteId ? findMatchingChildren(child.name) : [];
                        return (
                          <div key={child.id} className="space-y-1">
                            <div className="space-y-2">
                              <div className="flex gap-2 items-start">
                                <div className="flex-1 space-y-1 relative">
                                  <Input
                                    placeholder="Child's name"
                                    value={child.name}
                                    onChange={(e) => setSingleChildren(singleChildren.map(c =>
                                      c.id === child.id ? { ...c, name: e.target.value, existingChildId: undefined, existingChildParentName: undefined, pendingInviteId: undefined, pendingParentName: undefined, confirmedNew: undefined } : c
                                    ))}
                                    className={`h-9 ${child.existingChildId || child.pendingInviteId ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
                                  />
                                  {matches.length > 0 && !child.existingChildId && (
                                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-32 overflow-y-auto">
                                      {matches.map(m => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onClick={() => setSingleChildren(singleChildren.map(c =>
                                            c.id === child.id ? ((m as any).isPending
                                              ? { ...c, name: m.name, pendingInviteId: (m as any).inviteId, pendingParentName: m.parent_name, existingChildId: undefined, existingChildParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: true }
                                              : { ...c, name: m.name, existingChildId: m.id, existingChildParentName: m.parent_name, pendingInviteId: undefined, pendingParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: undefined }) : c
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
                              <Collapsible defaultOpen={!!(child.jerseyNumber || child.yearOfBirth)}>
                                <CollapsibleTrigger asChild>
                                  <button
                                    type="button"
                                    className="group flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
                                    <span className="italic">Add details now (optional)</span>
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-2">
                                  <div className="flex gap-2 pl-0">
                                    <div className="flex-1">
                                      <Input
                                        placeholder="Jersey #"
                                        value={child.jerseyNumber}
                                        onChange={(e) => {
                                          const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                                          setSingleChildren(singleChildren.map(c =>
                                            c.id === child.id ? { ...c, jerseyNumber: val } : c
                                          ));
                                        }}
                                        className="h-10 text-sm"
                                        maxLength={2}
                                        inputMode="numeric"
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <select
                                        value={child.existingChildId ? (clubChildren.find(c => c.id === child.existingChildId)?.year_of_birth?.toString() || '') : child.yearOfBirth}
                                        onChange={(e) => {
                                          setSingleChildren(singleChildren.map(c =>
                                            c.id === child.id ? { ...c, yearOfBirth: e.target.value } : c
                                          ));
                                        }}
                                        disabled={!!child.existingChildId}
                                        className="h-10 w-full text-sm rounded-md border border-input bg-background px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                                      >
                                        <option value="">Birth year</option>
                                        {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - 3 - i).map(year => (
                                          <option key={year} value={year.toString()}>{year}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground italic mt-1.5 pl-0.5">
                                    Parent can complete this later
                                  </p>
                                </CollapsibleContent>
                              </Collapsible>
                            </div>
                            {child.existingChildId && (
                              <p className="text-xs text-emerald-600 flex items-center gap-1 pl-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Linked to existing child ({child.existingChildParentName || 'existing parent'})
                              </p>
                            )}
                            {child.pendingInviteId && !child.existingChildId && (
                              <p className="text-xs text-blue-600 flex items-center gap-1 pl-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Pending invite (parent: {child.pendingParentName})
                              </p>
                            )}
                            {!child.existingChildId && !child.confirmedNew && matches.length > 0 && child.name.trim().length >= 3 && (
                              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-xs text-amber-700 dark:text-amber-300">
                                    <strong>{matches[0].name}</strong>{' '}
                                    {(matches[0] as any).isPending
                                      ? <>has a pending invite (parent: {matches[0].parent_name}). Same child?</>
                                      : <>already exists (parent: {matches[0].parent_name}). Link to them?</>
                                    }
                                  </p>
                                  <div className="flex gap-2 mt-1.5">
                                    {(matches[0] as any).isPending ? (
                                      <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        onClick={() => setSingleChildren(singleChildren.map(c =>
                                          c.id === child.id ? { ...c, confirmedNew: true, pendingInviteId: (matches[0] as any).inviteId, pendingParentName: matches[0].parent_name, existingChildId: undefined, existingChildParentName: undefined } : c
                                        ))}
                                      >
                                        Yes, same child
                                      </Button>
                                    ) : (
                                      <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        onClick={() => setSingleChildren(singleChildren.map(c =>
                                          c.id === child.id ? { ...c, name: matches[0].name, existingChildId: matches[0].id, existingChildParentName: matches[0].parent_name, yearOfBirth: matches[0].year_of_birth?.toString() || '', confirmedNew: undefined } : c
                                        ))}
                                      >
                                        Link to existing
                                      </Button>
                                    )}
                                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                                      onClick={() => setSingleChildren(singleChildren.map(c =>
                                        c.id === child.id ? { ...c, confirmedNew: true } : c
                                      ))}
                                    >
                                      Different child
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setSingleChildren([...singleChildren, { id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }])}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors mt-1"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add another child
                      </button>
                    </div>
                  )}
                </div>

                {/* Second parent/guardian fields (new member) */}
                {singleChildren.length > 0 && (
                  <div className="space-y-3 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Optional</p>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-600" />
                      <Label className="text-blue-600 font-medium">Second Parent / Guardian</Label>
                    </div>

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
                          <p className="text-xs text-muted-foreground">Joins team immediately</p>
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
                            placeholder="Search by name or email, or type new"
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
                              placeholder="Second parent's email"
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

            {/* STEP 3: Delivery method + custom message (new members only) */}
            {wizardStep === 3 && !selectedUser && nameConfirmed && nameInput.trim() && (
              <SingleInvitationDeliveryStep
                deliveryMethod={deliveryMethod}
                email={customEmail}
                showMessageEditor={showMessageEditor}
                customMessage={customMessage}
                onDeliveryMethodChange={(method) => {
                  setDeliveryMethod(method);
                  if (method === "share") setCustomEmail("");
                }}
                onEmailChange={setCustomEmail}
                onMessageEditorChange={setShowMessageEditor}
                onCustomMessageChange={setCustomMessage}
              />
            )}
              </>
            )}
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4 mt-0">
            {/* Role Selection for bulk mode */}
            <div className="space-y-2 mb-2">
              <Label className="text-sm font-medium">Default role</Label>
              <div className={`grid gap-2 ${roleOptions.length <= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {roleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedRole(opt.value)}
                    className={`p-2.5 rounded-xl text-center transition-all border ${
                      selectedRole === opt.value
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-muted/40 hover:bg-muted text-foreground"
                    }`}
                  >
                    <p className="text-sm font-medium">
                      {opt.value === "parent" ? "Parent" : opt.value === "coach" ? "Coach" : opt.value === "team_admin" ? "Admin" : opt.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add multiple members at once. Email addresses are optional.
              </p>
              
              {/* Contextual hint for parent role */}
              {(selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")) && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Baby className="h-3.5 w-3.5 text-primary" />
                  Add child details under each parent row
                </p>
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
              
              {csvImportOpen && <Suspense fallback={null}><MemberCSVImportDialog
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
                        jerseyNumber: child.shirtNumber ? String(child.shirtNumber) : "",
                        existingChildId: match && !(match as any).isPending ? match.id : undefined,
                        existingChildParentName: match && !(match as any).isPending ? match.parent_name : undefined,
                        pendingInviteId: (match as any)?.isPending ? (match as any).inviteId : undefined,
                        pendingParentName: (match as any)?.isPending ? match.parent_name : undefined,
                        confirmedNew: (match as any)?.isPending ? true : undefined,
                      };
                    }),
                  }));
                  // Pass members directly to mutation to avoid state timing issues
                  addBulkMembersMutation.mutate(formattedMembers);
                }}
              /></Suspense>}
            </div>

            <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
              {bulkMembers.map((member, idx) => {
                const bulkMatches = member.selectedUser ? [] : (bulkSearchMap.get(member.name.trim()) || []);

                return (
                  <div key={member.id} className="p-3 rounded-lg border bg-muted/20 space-y-3">
                    <div className="flex gap-2 items-start">
                      <div className="flex-1 space-y-2">
                        {member.selectedUser ? (
                          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={member.selectedUser.avatar_url || undefined} />
                              <AvatarFallback className="bg-primary/20 text-primary text-sm">
                                {member.selectedUser.display_name?.[0]?.toUpperCase() || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{member.selectedUser.display_name || member.name}</p>
                              <p className="text-xs text-muted-foreground">Existing user • Joins team immediately</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => updateBulkMember(member.id, "name", "")}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="Search by name or email, or type new"
                                value={member.name}
                                onChange={(e) => updateBulkMember(member.id, "name", e.target.value)}
                                className="pl-10"
                              />
                            </div>

                            {member.name.trim().length >= 2 && bulkMatches.length > 0 && (
                              <div className="space-y-1 rounded-lg border bg-muted/30 p-2">
                                {bulkMatches.map((result: any) => (
                                  <button
                                    key={result.id}
                                    type="button"
                                    onClick={() => {
                                      if (result.isPendingInvite && result.id.toString().startsWith("pending-")) {
                                        // Pending invite without profile — pre-fill name and email
                                        setBulkMembers(bulkMembers.map(m =>
                                          m.id === member.id
                                            ? { ...m, name: result.display_name || "", email: result.invited_email || "", selectedUser: null }
                                            : m
                                        ));
                                      } else {
                                        selectBulkExistingUser(member.id, result);
                                      }
                                    }}
                                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-background"
                                  >
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage src={result.avatar_url || undefined} />
                                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                                        {result.display_name?.[0]?.toUpperCase() || "?"}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 flex items-center gap-2">
                                      <span className="text-sm font-medium">{result.display_name || "Unknown"}</span>
                                      {result.isPendingInvite && (
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-500/30 text-blue-600">Pending</Badge>
                                      )}
                                    </div>
                                  </button>
                                ))}
                                <p className="px-2 pt-1 text-xs text-muted-foreground">
                                  Or keep typing to add a new member by name
                                </p>
                              </div>
                            )}

                            {member.name.trim().length >= 2 && bulkMatches.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                No existing users found — this will be added as a new invite
                              </p>
                            )}

                            {member.role !== "parent" && !member.selectedUser && memberNameMatchesExisting(member.name) && (
                              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                  <strong>{memberNameMatchesExisting(member.name)?.display_name}</strong> is already a member of this team.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {!member.selectedUser && (
                          <Input
                            type="email"
                            placeholder="Email (optional)"
                            value={member.email}
                            onChange={(e) => updateBulkMember(member.id, "email", e.target.value)}
                          />
                        )}
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
                    <div className="space-y-2 pl-3 border-l-2 border-primary/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-primary flex items-center gap-1">
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
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeChildFromMember(member.id, child.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          <Collapsible defaultOpen={!!(child.jerseyNumber || child.yearOfBirth)}>
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="group flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
                                <span className="italic">Add details now (optional)</span>
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2">
                              <div className="flex gap-2">
                                <Input
                                  placeholder="Jersey #"
                                  value={child.jerseyNumber}
                                  onChange={(e) => updateChild(member.id, child.id, "jerseyNumber", e.target.value.replace(/\D/g, "").slice(0, 2))}
                                  className="h-9 text-sm w-24"
                                  maxLength={2}
                                  inputMode="numeric"
                                />
                                <Input
                                  placeholder="Birth year"
                                  value={child.yearOfBirth}
                                  onChange={(e) => updateChild(member.id, child.id, "yearOfBirth", e.target.value)}
                                  className="h-9 text-sm w-28"
                                  maxLength={4}
                                />
                              </div>
                              <p className="text-[10px] text-muted-foreground italic mt-1.5 pl-0.5">
                                Parent can complete this later
                              </p>
                            </CollapsibleContent>
                          </Collapsible>
                          {child.existingChildId && (
                            <p className="text-[10px] text-emerald-600 pl-1 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Linked to existing child ({child.existingChildParentName || 'existing parent'})
                            </p>
                          )}
                          {child.pendingInviteId && !child.existingChildId && (
                            <p className="text-[10px] text-blue-600 pl-1 flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Pending invite (parent: {child.pendingParentName}) — won't create duplicate
                            </p>
                          )}
                          {!child.existingChildId && !child.confirmedNew && (() => {
                            const bulkChildMatches = findMatchingChildren(child.name);
                            if (bulkChildMatches.length === 0 || child.name.trim().length < 3) return null;
                            const m = bulkChildMatches[0];
                            return (
                              <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-xs text-amber-700 dark:text-amber-300">
                                    <strong>{m.name}</strong>{' '}
                                    {(m as any).isPending 
                                      ? <>has a pending invite (parent: {m.parent_name}). Same child?</>
                                      : <>already exists (parent: {m.parent_name}). Link to them?</>
                                    }
                                  </p>
                                  <div className="flex gap-2 mt-1.5">
                                    {(m as any).isPending ? (
                                      <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        onClick={() => setBulkMembers(bulkMembers.map(bm => bm.id === member.id ? {
                                          ...bm, children: bm.children.map(c => c.id === child.id ? { ...c, confirmedNew: true, pendingInviteId: (m as any).inviteId, pendingParentName: m.parent_name, existingChildId: undefined, existingChildParentName: undefined } : c)
                                        } : bm))}
                                      >
                                        Yes, same child
                                      </Button>
                                    ) : (
                                      <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                                        onClick={() => setBulkMembers(bulkMembers.map(bm => bm.id === member.id ? {
                                          ...bm, children: bm.children.map(c => c.id === child.id ? { ...c, name: m.name, existingChildId: m.id, existingChildParentName: m.parent_name, pendingInviteId: undefined, pendingParentName: undefined, yearOfBirth: m.year_of_birth?.toString() || '', confirmedNew: undefined } : c)
                                        } : bm))}
                                      >
                                        Link to existing
                                      </Button>
                                    )}
                                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                                      onClick={() => setBulkMembers(bulkMembers.map(bm => bm.id === member.id ? {
                                        ...bm, children: bm.children.map(c => c.id === child.id ? { ...c, confirmedNew: true } : c)
                                      } : bm))}
                                    >
                                      Different child
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Second parent/guardian for bulk parent row */}
                  {member.role === "parent" && member.children.length > 0 && (
                    <div className="space-y-2 pl-3 border-l-2 border-blue-500/30">
                      <span className="text-xs font-medium text-blue-600 flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        Second Parent / Guardian (Optional)
                      </span>

                      {member.selectedSecondParent ? (
                        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={member.selectedSecondParent.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-xs">
                              {member.selectedSecondParent.display_name?.[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-xs font-medium">{member.selectedSecondParent.display_name}</p>
                            <p className="text-[10px] text-muted-foreground">Existing user</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => 
                            setBulkMembers(bulkMembers.map(m => m.id === member.id 
                              ? { ...m, selectedSecondParent: null, secondParentSearch: "", secondParentName: "", secondParentEmail: "" } : m))
                          }>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              placeholder="Search by name or email, or type new"
                              value={member.secondParentSearch || member.secondParentName || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBulkMembers(bulkMembers.map(m => m.id === member.id
                                  ? { ...m, secondParentSearch: val, secondParentName: val } : m));
                              }}
                              className="h-8 text-sm pl-9"
                            />
                          </div>

                          {/* Search results for second parent */}
                          {(() => {
                            const spSearch = (member.secondParentSearch || "").trim();
                            const spResults = spSearch.length >= 2 ? (bulkSecondParentMap.get(spSearch) || []) : [];
                            const filtered = spResults.filter(u => u.id !== member.selectedUser?.id);
                            if (filtered.length === 0) return null;
                            return (
                              <div className="border rounded-md overflow-hidden divide-y max-h-28 overflow-y-auto">
                                {filtered.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    className="w-full flex items-center gap-2 p-2 hover:bg-accent/50 transition-colors text-left"
                                    onClick={() => setBulkMembers(bulkMembers.map(m => m.id === member.id
                                      ? { ...m, selectedSecondParent: u, secondParentName: u.display_name || "", secondParentSearch: "", secondParentEmail: "" } : m))}
                                  >
                                    <Avatar className="h-6 w-6">
                                      <AvatarImage src={u.avatar_url || undefined} />
                                      <AvatarFallback className="bg-muted text-[10px]">
                                        {u.display_name?.[0]?.toUpperCase() || "?"}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="text-xs">{u.display_name}</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}

                          {(member.secondParentName || "").trim() && !member.selectedSecondParent && (
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                type="email"
                                placeholder="Guardian's email (for invite)"
                                value={member.secondParentEmail || ""}
                                onChange={(e) => setBulkMembers(bulkMembers.map(m => m.id === member.id
                                  ? { ...m, secondParentEmail: e.target.value } : m))}
                                className="h-8 text-sm pl-9"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
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
                  }}
                >
                  {showMessageEditor ? "Hide" : "Add message"}
                </Button>
              </div>
              {showMessageEditor && (
                <div className="space-y-1.5">
                  <Textarea
                    placeholder={`Add a personal note (optional). Example:\n\nHi! We're using Ignite Club HQ to keep everything organised — fixtures, chat, and team updates all in one place. Tap the link to join.`}
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={4}
                    className="text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    This message will appear in all invite emails
                  </p>
                </div>
              )}
            </div>

          </TabsContent>
        </Tabs>
        </div>

        {/* Sticky CTA footer — hidden entirely when invite-by-name is collapsed */}
        {(mode !== "single" || inviteByNameOpen) && (
        <div data-allow-scroll className="shrink-0 border-t bg-background px-6 py-4 -mx-6 -mb-6" style={{ touchAction: 'pan-y' }}>
          {mode === "single" ? (() => {
            // When invite-by-name is collapsed (initial state), the bottom
            // CTA shouldn't render at all — the join-link card is the
            // primary action and has its own buttons.
            if (!inviteByNameOpen) return null;
            // Wizard navigation for single-invite flow
            const isPending = addExistingUserMutation.isPending || addPendingMemberMutation.isPending;

            const handleNext = () => {
              if (wizardStep === 1) {
                // Confirm new-member name on the way out of step 1
                if (!selectedUser && !nameConfirmed && nameInput.trim()) {
                  setNameConfirmed(true);
                }
                setWizardStep(2);
                return;
              }
              if (wizardStep === 2) {
                // Auto-add a child row for parent role if missing
                if (selectedRole === "parent" && singleChildren.length === 0 && (selectedUser || nameInput.trim())) {
                  setSingleChildren([{ id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }]);
                  return;
                }
                // Existing user with non-parent role can submit directly from step 2 → step 3 for delivery email
                setWizardStep(3);
                return;
              }
            };

            const handleSubmit = () => {
              if (selectedUser) addExistingUserMutation.mutate();
              else addPendingMemberMutation.mutate();
            };

            return (
              <SingleInvitationWizardFooter
                wizardStep={wizardStep}
                hasMemberIdentity={!!selectedUser}
                hasMemberName={nameInput.trim().length > 0}
                selectedRole={selectedRole}
                hasNamedChild={singleChildren.some((child) => child.name.trim().length > 0)}
                deliveryMethod={deliveryMethod}
                email={customEmail}
                isPending={isPending}
                onBack={() => setWizardStep((step) => (step > 1 ? ((step - 1) as 1 | 2 | 3) : step))}
                onNext={handleNext}
                onSubmit={handleSubmit}
              />
            );
          })() : (
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
                ? `Add ${validBulkCount} Member${validBulkCount > 1 ? "s" : ""}`
                : "Enter names to continue"}
            </Button>
          )}
        </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
