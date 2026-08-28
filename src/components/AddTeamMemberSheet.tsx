import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { UserPlus, Search, Loader2, Mail, X, CheckCircle2, Check, Send, Users, Plus, Trash2, Upload, Baby, User, Calendar, MessageSquare, Copy, AlertTriangle, Share2, Pencil, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import TeamJoinLinkCard from "@/components/invite/TeamJoinLinkCard";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
const MemberCSVImportDialog = lazy(() => import("@/components/MemberCSVImportDialog").then(m => ({ default: m.MemberCSVImportDialog })));
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
import type { Database } from "@/integrations/supabase/types";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { computeMemberIdentity, type MemberRole, type MemberIdentity } from "@/lib/memberIdentity";
import { useDebounce } from "@/hooks/useDebounce";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { isDuplicateChildError } from "@/lib/childDedup";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import {
  ensureSecondParent,
  secondParentValidationError,
  secondParentPartialFailureMessage,
  isValidSecondParentEmail,
  SecondParentError,
  SECOND_PARENT_EMAIL_REQUIRED,
  type SecondParentResult,
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

interface PendingInviteChildMatch {
  id: string;
  name: string;
  year_of_birth: number | null;
  parent_name: string;
  parent_id: string;
  isPending: true;
  inviteId: string;
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

type TeamRole = "player" | "parent" | "coach" | "team_admin";
type TeamType = "junior" | "senior" | "mixed";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club admin",
  team_admin: "Team admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App admin",
  league_admin: "League admin",
  committee_member: "Committee member",
  association_admin: "Association admin",
  competition_admin: "Competition admin",
};

function getPendingInviteChildName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const children = (metadata as { children?: unknown }).children;
  if (Array.isArray(children) && children.length > 0) {
    const first = children[0] as { name?: unknown };
    if (first?.name) return String(first.name).trim();
  }
  return null;
}

function formatPendingInviteSubtitle(
  role: string,
  teamName: string | null | undefined,
  childName: string | null | undefined,
): string {
  const roleLabel = roleLabels[role as AppRole] || role.replace(/_/g, " ") || "Member";
  const scope = teamName ? `— ${teamName}` : "(club)";
  const childSuffix = childName ? ` (${childName})` : "";
  return `Pending: ${roleLabel} ${scope}${childSuffix}`;
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

const allRoleOptions: { value: TeamRole; label: string; description: string; color: string; icon?: string; juniorOnly?: boolean; seniorOnly?: boolean }[] = [
  { value: "parent", label: "Parent", description: "Add parent + child players", color: "bg-pink-500/20 text-pink-600 border-pink-500/30", icon: "👶", juniorOnly: true },
  { value: "player", label: "Adult Player", description: "18+ team player", color: "bg-amber-500/20 text-amber-600 border-amber-500/30", seniorOnly: true },
  { value: "coach", label: "Coach", description: "Team coach", color: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30" },
  { value: "team_admin", label: "Team Admin", description: "Full admin access", color: "bg-blue-500/20 text-blue-600 border-blue-500/30" },
];

export default function AddTeamMemberSheet({ teamId, teamName, clubId, teamType = "mixed", isClubAdminOnly = false, canBulkInvite = true, triggerVariant = "default", externalOpen, onExternalOpenChange }: AddTeamMemberSheetProps) {
  // Filter role options based on team type
  const roleOptions = allRoleOptions.filter(opt => {
    if (teamType === "junior") {
      // Junior teams: no adult players
      return !opt.seniorOnly;
    }
    // Senior + mixed: keep Parent available — an adult player on a senior team
    // may still need a child added/invited to the same team.
    return true;
  });

  
  // Get default role based on team type
  const getDefaultRole = (): TeamRole => {
    if (teamType === "junior") return "parent";
    return "player"; // senior and mixed default to adult player
  };
  
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
  const debouncedSecondParentSearch = useDebounce(secondParentSearch, 300);

  const debouncedNameInput = useDebounce(nameInput, 300);
  // Fixed-position sheet: use the REMAINING keyboard overlay (after any OEM
  // WebView resize) — the total IME height over-reports on Android and leaves
  // a blank gap between the sheet and the keyboard.
  const nativeKbHeight = useNativeKeyboardBottomInset();
  const autoChildTriggered = useRef(false);
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const roleSectionRef = useRef<HTMLDivElement | null>(null);
  // Single-screen invite form: the share link is visible immediately on open
  // (auto-created for the default role), with the person / role / children /
  // delivery form below it on one scrolling screen — no chooser step.
  const inviteByNameOpen = true;
  // Person is "ready" once an existing user is picked or any name is typed —
  // role / children / delivery sections disclose progressively below the name.
  const personReady = !!selectedUser || nameInput.trim().length > 0;

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
    const nameReady = selectedUser || nameConfirmed || nameInput.trim().length > 0;
    if (selectedRole === "parent" && nameReady && singleChildren.length === 0 && !autoChildTriggered.current) {
      autoChildTriggered.current = true;
      setSingleChildren([{ id: crypto.randomUUID(), name: "", yearOfBirth: "", jerseyNumber: "" }]);
    }
    if (selectedRole !== "parent") {
      autoChildTriggered.current = false;
    }
  }, [selectedRole, selectedUser, nameConfirmed, nameInput, singleChildren.length]);

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

  // Fetch display names for existing team members (for duplicate detection)
  const { data: existingMemberNames = [] } = useQuery({
    queryKey: ["team-member-names", teamId, existingMembers],
    queryFn: async () => {
      if (!existingMembers?.length) return [];
      const { data } = await selectCachedProfilesByIds(existingMembers);
      return data || [];
    },
    enabled: open && !!teamId && (existingMembers?.length || 0) > 0,
  });

  const memberNameMatchesExisting = (name: string) => {
    if (!name.trim() || name.trim().length < 3) return null;
    const query = name.trim().toLowerCase();
    return existingMemberNames.find(m => m.display_name?.toLowerCase() === query) || null;
  };

  // Fetch club branding data for emails
  const { data: clubBranding } = useQuery({
    queryKey: ["club-branding", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("name, logo_url, contact_email, invite_email_style")
        .eq("id", clubId)
        .single();
      return data;
    },
    enabled: !!clubId,
  });
  // Club-selected invite email style: only the "discover" option uses the
  // "See which team X is in" subject line.
  const discoverEmailStyle = (clubBranding as { invite_email_style?: string } | null | undefined)?.invite_email_style === 'discover';
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
      
      // Strategy 2: Children whose parents have roles in this club.
      // A guardian can be a parent in several clubs, so candidates must be
      // filtered down to children with an actual footprint in THIS club.
      const { data: clubParents } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "parent");

      const parentUserIds = [...new Set(clubParents?.map(p => p.user_id) || [])];
      const candidateChildIds = new Set<string>();
      if (parentUserIds.length) {
        const { data: parentChildren } = await supabase
          .from("children")
          .select("id")
          .in("parent_id", parentUserIds);
        parentChildren?.forEach(c => candidateChildIds.add(c.id));
      }

      // Drop candidates already proven in-club by strategy 1.
      const toVerify = [...candidateChildIds].filter(id => !childIdsFromTeams.has(id));
      const childIdsFromParents = new Set<string>(
        [...candidateChildIds].filter(id => childIdsFromTeams.has(id)),
      );

      if (toVerify.length) {
        const clubTeamIds = (teamIds ?? []).map(t => t.id);
        const [assignRes, pointsRes, mlRes, inviteRes] = await Promise.all([
          clubTeamIds.length
            ? supabase
                .from("child_team_assignments")
                .select("child_id")
                .in("child_id", toVerify)
                .in("team_id", clubTeamIds)
            : Promise.resolve({ data: [] as any[] }),
          supabase
            .from("child_club_points")
            .select("child_id")
            .in("child_id", toVerify)
            .eq("club_id", clubId),
          supabase
            .from("child_mini_league_assignments")
            .select("child_id, mini_leagues!inner(club_id)")
            .in("child_id", toVerify)
            .eq("mini_leagues.club_id", clubId),
          supabase
            .from("pending_invites")
            .select("metadata")
            .eq("club_id", clubId),
        ]);

        (assignRes.data as any[] | null)?.forEach(r => childIdsFromParents.add(r.child_id));
        (pointsRes.data as any[] | null)?.forEach(r => childIdsFromParents.add(r.child_id));
        (mlRes.data as any[] | null)?.forEach(r => childIdsFromParents.add(r.child_id));

        const verifySet = new Set(toVerify);
        (inviteRes.data as any[] | null)?.forEach(row => {
          const meta = row?.metadata as any;
          const kids = Array.isArray(meta?.children) ? meta.children : [];
          kids.forEach((child: any) => {
            const ref = child?.existingChildId;
            if (typeof ref === "string" && verifySet.has(ref)) childIdsFromParents.add(ref);
          });
        });
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
      const { data: parents } = await selectCachedProfilesByIds(parentIds);
      const parentMap = new Map(parents?.map(p => [p.id, p.display_name]) || []);
      
      return children.map(c => ({
        ...c,
        parent_name: parentMap.get(c.parent_id) || "Unknown",
      }));
    },
    enabled: open && !!clubId && (selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")),
  });

  // Fetch children from pending invites for this team
  const { data: pendingInviteChildren = [] } = useQuery<PendingInviteChildMatch[]>({
    queryKey: ["pending-invite-children", teamId],
    queryFn: async () => {
      const { data: invites } = await supabase
        .from("pending_invites")
        .select("id, invited_label, metadata")
        .eq("team_id", teamId)
        .eq("status", "pending");
      
      if (!invites?.length) return [];
      
      const inviteLookup = new Map(invites.map((invite) => [invite.id, invite]));
      const pendingChildren = new Map<string, PendingInviteChildMatch>();
      
      invites.forEach(invite => {
        const meta = invite.metadata as any;
        if (meta?.children && Array.isArray(meta.children)) {
          meta.children.forEach((child: any) => {
            if (child.name) {
              const normalizedName = String(child.name).trim();
              const referencedPendingInviteId = typeof child.existingChildId === "string" && child.existingChildId.startsWith("pending-")
                ? child.existingChildId.replace(/^pending-([^-]+)-.*$/, "$1")
                : null;
              const canonicalInviteId = referencedPendingInviteId && inviteLookup.has(referencedPendingInviteId)
                ? referencedPendingInviteId
                : invite.id;
              const canonicalInvite = inviteLookup.get(canonicalInviteId) || invite;
              const dedupeKey = `${canonicalInviteId}:${normalizedName.toLowerCase()}:${child.yearOfBirth || ""}`;

              if (!pendingChildren.has(dedupeKey)) {
                pendingChildren.set(dedupeKey, {
                  id: `pending-${canonicalInviteId}-${normalizedName}`,
                  name: normalizedName,
                  year_of_birth: child.yearOfBirth || null,
                  parent_name: canonicalInvite.invited_label || invite.invited_label || "Unknown",
                  parent_id: canonicalInviteId,
                  isPending: true,
                  inviteId: canonicalInviteId,
                });
              }
            }
          });
        }
      });
      
      return Array.from(pendingChildren.values());
    },
    enabled: open && !!teamId && (selectedRole === "parent" || bulkMembers.some(m => m.role === "parent")),
  });

  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["user-search-team-member", debouncedNameInput, clubId],
    queryFn: async () => {
      if (debouncedNameInput.length < 2) return [];
      const { data, error } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedNameInput,
        _limit: 8,
        _club_id: clubId ?? null,
      });
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        masked_email: string | null;
      }>;
    },
    enabled: debouncedNameInput.length >= 2,
  });

  // Also search pending invites from other teams in same club
  const { data: pendingInviteResults = [] } = useQuery({
    queryKey: ["pending-invite-search", debouncedNameInput, clubId, teamId],
    queryFn: async () => {
      if (debouncedNameInput.length < 2) return [];
      const { data: invites } = await supabase
        .from("pending_invites")
        .select("id, invited_label, invited_email, invited_user_id, metadata, team_id, role")
        .eq("club_id", clubId)
        .eq("status", "pending")
        .ilike("invited_label", `%${debouncedNameInput}%`)
        .limit(12);
      
      if (!invites?.length) return [];

      // Resolve team names so team-scoped invites can show their actual scope
      const teamIds = Array.from(new Set(invites.filter(i => i.team_id).map(i => i.team_id!)));
      const teamNameById: Record<string, string> = {};
      if (teamIds.length > 0 && clubId) {
        const { data: teams } = await supabase
          .from("teams")
          .select("id, name")
          .in("id", teamIds)
          .eq("club_id", clubId);
        for (const t of teams || []) {
          teamNameById[t.id] = t.name;
        }
      }
      
      // For invites that have an invited_user_id, fetch profile data
      const userIds = invites.filter(i => i.invited_user_id).map(i => i.invited_user_id!);
      let profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      
      if (userIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
        if (profiles) {
          profiles.forEach(p => profileMap.set(p.id, p));
        }
      }
      
      return invites.map(invite => {
        const teamName = invite.team_id ? teamNameById[invite.team_id] || null : null;
        return {
          id: invite.invited_user_id || `pending-${invite.id}`,
          display_name: invite.invited_user_id 
            ? (profileMap.get(invite.invited_user_id)?.display_name || invite.invited_label)
            : invite.invited_label,
          avatar_url: invite.invited_user_id 
            ? (profileMap.get(invite.invited_user_id)?.avatar_url || null) 
            : null,
          invited_email: invite.invited_email,
          isPendingInvite: true,
          pendingInviteId: invite.id,
          role: invite.role,
          teamId: invite.team_id,
          teamName,
          childName: getPendingInviteChildName(invite.metadata),
        };
      });
    },
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
    queryFn: async (): Promise<Record<string, MemberIdentity>> => {
      if (identityLookupIds.length === 0 || !clubId) return {};

      const [rolesRes, teamsRes, childrenRes] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, role, team_id")
          .eq("club_id", clubId)
          .in("user_id", identityLookupIds),
        supabase.from("teams").select("id, name").eq("club_id", clubId),
        supabase
          .from("children")
          .select("id, parent_id, name")
          .in("parent_id", identityLookupIds),
      ]);

      const teamNameById: Record<string, string> = {};
      for (const t of teamsRes.data || []) teamNameById[t.id] = t.name;

      const rolesByUser = new Map<string, { role: MemberRole; team_id: string | null }[]>();
      for (const r of rolesRes.data || []) {
        const arr = rolesByUser.get(r.user_id) || [];
        arr.push({ role: r.role as MemberRole, team_id: r.team_id });
        rolesByUser.set(r.user_id, arr);
      }

      // A child row is one human shared across clubs, so "Parent of X" must
      // only name children with an actual footprint in THIS club. Otherwise a
      // guardian from another club leaks their other club's kids into search.
      const candidateChildren = (childrenRes.data || []).filter(c => c.id && c.parent_id && c.name);
      const candidateIds = candidateChildren.map(c => c.id as string);
      const inClubChildIds = new Set<string>();

      if (candidateIds.length) {
        const clubTeamIds = Object.keys(teamNameById);
        const [assignRes, pointsRes, mlRes] = await Promise.all([
          clubTeamIds.length
            ? supabase
                .from("child_team_assignments")
                .select("child_id")
                .in("child_id", candidateIds)
                .in("team_id", clubTeamIds)
            : Promise.resolve({ data: [] as any[] }),
          supabase
            .from("child_club_points")
            .select("child_id")
            .in("child_id", candidateIds)
            .eq("club_id", clubId),
          supabase
            .from("child_mini_league_assignments")
            .select("child_id, mini_leagues!inner(club_id)")
            .in("child_id", candidateIds)
            .eq("mini_leagues.club_id", clubId),
        ]);
        (assignRes.data as any[] | null)?.forEach(r => inClubChildIds.add(r.child_id));
        (pointsRes.data as any[] | null)?.forEach(r => inClubChildIds.add(r.child_id));
        (mlRes.data as any[] | null)?.forEach(r => inClubChildIds.add(r.child_id));
      }

      const childrenByParent = new Map<string, string[]>();
      for (const c of candidateChildren) {
        if (!inClubChildIds.has(c.id as string)) continue;
        const arr = childrenByParent.get(c.parent_id as string) || [];
        arr.push(c.name as string);
        childrenByParent.set(c.parent_id as string, arr);
      }

      const out: Record<string, MemberIdentity> = {};
      for (const id of identityLookupIds) {
        out[id] = computeMemberIdentity({
          display_name: null,
          roles: rolesByUser.get(id) || [],
          children_names: childrenByParent.get(id) || [],
          teamNameById,
        });
      }
      return out;
    },
    enabled: identityLookupIds.length > 0 && !!clubId,
    staleTime: 60 * 1000,
  });

  // Existing team members stay selectable: the role is chosen on step 2, so an
  // adult player already on this team must still be pickable in order to add a
  // Parent role + child under them. Rows are labelled "Already on this team".
  const filteredResults = searchResults;


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
    queryFn: async () => {
      if (bulkSearchTerms.length === 0) return [];

      const searches = await Promise.all(
        bulkSearchTerms.map(async (term) => {
          // Use the same SECURITY DEFINER RPC as single mode so we get
          // consistent visibility across club members (avoids RLS gaps
          // when searching parents who belong only to other teams).
          const { data: rpcData } = await supabase.rpc("search_invitable_profiles", {
            _query: term,
            _limit: 8,
            _club_id: clubId ?? null,
          });

          const profileResults = ((rpcData || []) as Array<{
            id: string;
            display_name: string | null;
            avatar_url: string | null;
            masked_email: string | null;
          }>).filter(
            () => true // existing members stay selectable (may need a Parent role + child)
          );

          // Also search pending invites across the entire club
          const { data: invites } = await supabase
            .from("pending_invites")
            .select("id, invited_label, invited_email, invited_user_id, metadata, team_id")
            .eq("club_id", clubId)
            .eq("status", "pending")
            .ilike("invited_label", `%${term}%`)
            .limit(8);

          const profileIds = new Set(profileResults.map(r => r.id));
          const pendingResults = (invites || [])
            .map(invite => ({
              id: invite.invited_user_id || `pending-${invite.id}`,
              display_name: invite.invited_label,
              avatar_url: null as string | null,
              isPendingInvite: true,
              pendingInviteId: invite.id,
              invited_email: invite.invited_email,
            }))
            .filter(r => !profileIds.has(r.id));

          return {
            term,
            results: [...profileResults, ...pendingResults],
          };
        })
      );

      return searches;
    },
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
    queryKey: ["bulk-second-parent-search", bulkSecondParentTerms, clubId],
    queryFn: async () => {
      if (bulkSecondParentTerms.length === 0) return [];
      const searches = await Promise.all(
        bulkSecondParentTerms.map(async (term) => {
          // Club-scoped: never surface profiles outside the active club.
          const { data } = await supabase.rpc("search_invitable_profiles", {
            _query: term,
            _limit: 5,
            _club_id: clubId ?? null,
          });
          return {
            term,
            results: ((data || []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>).map(
              (r) => ({ id: r.id, display_name: r.display_name, avatar_url: r.avatar_url }),
            ),
          };
        })
      );
      return searches;
    },
    enabled: open && mode === "bulk" && bulkSecondParentTerms.length > 0,
  });

  const bulkSecondParentMap = new Map(bulkSecondParentResults.map((entry) => [entry.term, entry.results]));

  // Search for second parent (existing users) — club-scoped
  const { data: secondParentSearchResults = [] } = useQuery({
    queryKey: ["second-parent-search", debouncedSecondParentSearch, clubId],
    queryFn: async () => {
      if (debouncedSecondParentSearch.length < 2) return [];
      const { data } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSecondParentSearch,
        _limit: 5,
        _club_id: clubId ?? null,
      });
      return ((data || []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>).map((r) => ({
        id: r.id,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
      }));
    },
    enabled: debouncedSecondParentSearch.length >= 2 && !selectedSecondParent,
  });


  // Filter second parent results: exclude primary user but allow existing members (they may need parent role added)
  const filteredSecondParentResults = secondParentSearchResults.filter(
    u => u.id !== selectedUser?.id
  );

  // Find matching existing children by partial name (case-insensitive), including pending invite children
  const findMatchingChildren = (name: string) => {
    if (!name.trim() || name.trim().length < 2) return [];
    const query = name.trim().toLowerCase();
    
    // Search confirmed children
    const confirmedMatches = clubChildren
      .filter(c => c.name.toLowerCase().includes(query))
      .map(c => ({ ...c, isPending: false as const }));
    
    // Search pending invite children (exclude those already in confirmed matches by name)
    const confirmedNames = new Set(confirmedMatches.map(c => c.name.toLowerCase()));
    const pendingMatches = pendingInviteChildren
      .filter(c => c.name.toLowerCase().includes(query) && !confirmedNames.has(c.name.toLowerCase()));
    
    // Return confirmed first, then pending
    return [...confirmedMatches, ...pendingMatches].slice(0, 5);
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
          
          // Skip children linked to pending invites — they'll be created when the invite is accepted
          if (child.pendingInviteId) {
            continue;
          }
          
          if (childId) {
            // Existing child — just add guardian link if not already the parent
            const existingChild = clubChildren.find(c => c.id === childId);
            if (existingChild && existingChild.parent_id !== selectedUser.id) {
              // Only duplicate-link errors are benign; anything else (permission,
              // FK, merged-away child) must surface or the parent silently ends
              // up unlinked from the child and cannot RSVP.
              const { error: guardianError } = await supabase
                .from("child_guardians")
                .insert({ child_id: childId, guardian_id: selectedUser.id });
              if (guardianError && !isDuplicateChildError(guardianError)) {
                console.error("[AddTeamMember] Failed to link guardian:", guardianError.message);
                throw guardianError;
              }
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

      // Handle second parent through the one shared helper. The primary role and
      // children are already committed at this point, so a second-parent failure
      // is reported as a partial success — never swallowed, never a bare "success".
      let secondParent: SecondParentResult = { status: "skipped", label: null };
      let secondParentFailure: string | null = null;
      try {
        secondParent = await ensureSecondParent({
          role: selectedRole,
          selectedProfile: selectedSecondParent,
          name: secondParentName,
          email: secondParentEmail,
          teamId,
          clubId,
          teamName,
          childIds: createdChildIds,
          childrenMetadata: resolvedChildren.map((child) => ({
            name: child.name,
            yearOfBirth: child.yearOfBirth,
            existingChildId: child.id,
          })),
          expectChildren: selectedRole === "parent" && singleChildren.some((c) => c.name.trim()),
          invitedByUserId: user!.id,
        });
      } catch (err) {
        console.error("[AddTeamMember] second parent failed", (err as Error)?.message);
        secondParentFailure = err instanceof SecondParentError ? (err.label ?? "the second parent") : "the second parent";
      }
      const secondParentInviteLink = secondParent.inviteLink ?? null;
      const secondParentAddedDirectly = secondParent.status === "added";


      // Send notification (role is already committed — a failure here is a
      // partial success, not a failed add)
      const { error: notifyErr } = await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        type: "membership",
        message: `You have been added to ${teamName} as ${roleOptions.find(r => r.value === selectedRole)?.label}`,
        related_id: teamId,
      });

      return {
        secondParentInviteLink,
        secondParentAddedDirectly,
        secondParentStatus: secondParent.status,
        secondParentLabel: secondParent.label,
        secondParentInviteEmail: secondParent.email ?? null,
        secondParentFailure,
        roleWasDuplicate,
        notificationFailed: !!notifyErr,
        notificationError: notifyErr?.message ?? null,
      };
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });

      if (result?.notificationFailed) {
        toast({
          variant: "destructive",
          title: "Member added — notification failed",
          description: `${selectedUser?.display_name} was added to ${teamName}, but we couldn't notify them in the app. Please tell them manually.${result.notificationError ? ` (${result.notificationError})` : ""}`,
        });
      } else if (result?.roleWasDuplicate) {

        const roleName = roleOptions.find(r => r.value === selectedRole)?.label || selectedRole;
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

      // Second-parent outcome is always explicit: added now, invited by email,
      // or a visible, retryable partial failure.
      if (result?.secondParentFailure) {
        toast({
          variant: "destructive",
          title: "Second parent not invited",
          description: secondParentPartialFailureMessage(
            `${selectedUser?.display_name || "The member"}${singleChildren.some(c => c.name.trim()) ? ` and ${singleChildren.filter(c => c.name.trim()).map(c => c.name.trim()).join(", ")}` : ""} were added`,
            result.secondParentFailure,
          ),
        });
      } else if (result?.secondParentStatus === "added") {
        toast({
          title: "Second parent added",
          description: `${result.secondParentLabel} has also been added as Parent`,
        });
      } else if (result?.secondParentStatus === "invited") {
        toast({
          title: "Second parent invited",
          description: `An invitation was created for ${result.secondParentLabel}.`,
        });
      }


      // Send team-invite email to primary parent (existing user) — uses full onboarding template with download links
      if (selectedRole === "parent" && selectedUser) {
        const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
        if (childrenNames.length > 0) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                toUserId: selectedUser.id,
                subject: childrenNames.length === 1
                  ? (discoverEmailStyle
                      ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                      : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`)
                  : `${clubBranding?.name || 'Your club'}: Your children have been added to ${teamName} ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: selectedUser.display_name || "Parent",
                  childrenNames,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName: "Parent",
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  customMessage: customMessage?.trim() || undefined,
                  inviteLink: `${window.location.origin}/teams/${teamId}`,
                },
              },
            });
          } catch (err) {
            console.error("[AddMember] Failed to send team-invite email to primary parent:", err);
          }
        }
      }

      // Send team-invite email to existing user added as coach/admin/player (non-parent)
      if (selectedRole !== "parent" && selectedUser && !result?.roleWasDuplicate) {
        const roleName = roleOptions.find(r => r.value === selectedRole)?.label || selectedRole;
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
            await supabase.functions.invoke("send-email", {
              body: {
                toUserId: selectedSecondParent.id,
                subject: childrenNames.length === 1
                  ? (discoverEmailStyle
                      ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                      : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`)
                  : `${clubBranding?.name || 'Your club'}: Your children have been added to ${teamName} ⚽`,
                template: "team-invite",
                senderName: clubBranding?.name || undefined,
                replyTo: (clubBranding as any)?.contact_email || undefined,
                templateData: {
                  recipientName: selectedSecondParent.display_name || "Parent",
                  childrenNames,
                  teamName,
                  clubName: clubBranding?.name || "The Club",
                  roleName: "Parent",
                  clubLogoUrl: clubBranding?.logo_url || undefined,
                  inviteLink: `${window.location.origin}/teams/${teamId}`,
                },
              },
            });
          } catch (err) {
            console.error("[AddMember] Failed to send team-invite email to second parent:", err);
          }
        }
      }

      // Send second parent email ONLY when the pending_invites row was created.
      if (result?.secondParentStatus === "invited" && result.secondParentInviteLink && result.secondParentInviteEmail) {
        try {
          const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: result.secondParentInviteEmail,
              subject: childrenNames.length === 1
                ? (discoverEmailStyle
                    ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                    : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`)
                : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: result.secondParentLabel || "Parent",
                invitedEmail: result.secondParentInviteEmail,
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
              description: `Email sent to ${result.secondParentInviteEmail}`,
            });
          } else {
            toast({
              variant: "destructive",
              title: "Second parent invite created — email failed",
              description: `${result.secondParentLabel}'s invitation exists but the email couldn't be sent. Share the invite link or retry.`,
            });
          }

        } catch (error) {
          console.error("Failed to send second parent email:", error);
        }
        queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
      }

      if (!result?.secondParentFailure) handleClose();
    },
    onError: (error: Error) => {
      toast(
        friendlyMutationError(error, {
          title: "Failed to add member",
          description: error.message || "Something went wrong. Please try again.",
        }),
      );
    },
  });

  // Add pending member (by name) with invite
  const addPendingMemberMutation = useMutation({
    mutationFn: async () => {
      if (!nameInput.trim()) throw new Error("Please enter a name");

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
        if (match?.already_in_team && selectedRole !== "parent") {
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
          if (roleErr && !isDuplicateError(roleErr)) {
            throw roleErr;
          }
          const { error: notifyErr } = await supabase.from("notifications").insert({
            user_id: match.user_id,
            type: "membership",
            message: `You have been added to ${teamName} as ${roleOptions.find(r => r.value === selectedRole)?.label || selectedRole}`,
            related_id: teamId,
          });
          // Second parent still goes through the shared helper so it can never
          // be silently dropped on this branch either.
          let dedupeSecondParent: SecondParentResult = { status: "skipped", label: null };
          let dedupeSecondParentFailure: string | null = null;
          try {
            dedupeSecondParent = await ensureSecondParent({
              role: selectedRole,
              selectedProfile: selectedSecondParent,
              name: secondParentName,
              email: secondParentEmail,
              teamId,
              clubId,
              teamName,
              childrenMetadata: singleChildren
                .filter((c) => c.name.trim())
                .map((c) => ({
                  name: c.name.trim(),
                  yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
                  existingChildId: c.existingChildId || null,
                })),
              expectChildren: selectedRole === "parent" && singleChildren.some((c) => c.name.trim()),
              invitedByUserId: user!.id,
            });
          } catch (err) {
            console.error("[AddTeamMember] second parent failed", (err as Error)?.message);
            dedupeSecondParentFailure =
              err instanceof SecondParentError ? (err.label ?? "the second parent") : "the second parent";
          }
          return {
            link: "",
            shareLink: "",
            email: "",
            childrenCount: 0,
            childrenNames: [] as string[],
            secondParentLink: dedupeSecondParent.inviteLink ?? null,
            secondParentEmail: dedupeSecondParent.email ?? "",
            secondParentName: dedupeSecondParent.label ?? "",
            secondParentAddedDirectly: dedupeSecondParent.status === "added",
            secondParentStatus: dedupeSecondParent.status,
            secondParentLabel: dedupeSecondParent.label,
            secondParentFailure: dedupeSecondParentFailure,
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

      // Create primary invite. The second parent always gets its OWN invite row
      // (created below via the shared helper) linked back with linked_invite_token.
      const { data: primaryInvite, error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: teamId,
        club_id: clubId,
        role: selectedRole as any,
        invited_user_id: null,
        invited_by_user_id: user!.id,
        invited_label: nameInput.trim(),
        invited_email: customEmail.trim().toLowerCase() || null,
        invite_token: inviteToken,
        metadata: childrenMetadata 
          ? { 
              children: JSON.parse(childrenMetadata), 
              ...(selectedSecondParent ? { second_parent_user_id: selectedSecondParent.id } : {}),
            } 
          : null,
      } as any).select("id, invite_token, short_code").single();
      if (inviteError) throw inviteError;
      if (!primaryInvite?.id || !(primaryInvite as any)?.invite_token) {
        throw new Error("The invitation could not be created. Please try again.");
      }

      const link = `${window.location.origin}/join/p/${inviteToken}`;

      // Handle second parent through the one shared helper.
      let secondParent: SecondParentResult = { status: "skipped", label: null };
      let secondParentFailure: string | null = null;
      try {
        secondParent = await ensureSecondParent({
          role: selectedRole,
          selectedProfile: selectedSecondParent,
          name: secondParentName,
          email: secondParentEmail,
          teamId,
          clubId,
          teamName,
          childrenMetadata: validChildren.map((c) => ({
            name: c.name.trim(),
            yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
            existingChildId: c.existingChildId || null,
          })),
          childIds: validChildren.map((c) => c.existingChildId).filter(Boolean) as string[],
          expectChildren: validChildren.length > 0,
          invitedByUserId: user!.id,
          linkedInviteToken: inviteToken,
        });
      } catch (err) {
        console.error("[AddTeamMember] second parent failed", (err as Error)?.message);
        secondParentFailure = err instanceof SecondParentError ? (err.label ?? "the second parent") : "the second parent";
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
        secondParentLink: secondParent.inviteLink ?? null,
        secondParentEmail: secondParent.email ?? "",
        secondParentName: secondParent.label ?? "",
        secondParentAddedDirectly: secondParent.status === "added",
        secondParentStatus: secondParent.status,
        secondParentLabel: secondParent.label,
        secondParentFailure,
      };
    },
    onSuccess: async (result) => {
      const { link, shareLink: sLink, email, childrenCount, childrenNames, secondParentLink, secondParentEmail: secondEmail, secondParentName: secondName, secondParentAddedDirectly } = result;
      const existingUserAdded = (result as any).existingUserAdded as
        | { name: string; notificationFailed?: boolean; notificationError?: string | null }
        | undefined;

      const secondParentOutcomeToast = () => {
        if (result.secondParentFailure) {
          toast({
            variant: "destructive",
            title: "Second parent not invited",
            description: secondParentPartialFailureMessage(
              `${nameInput.trim() || "The member"}${childrenNames.length > 0 ? ` and ${childrenNames.join(", ")}` : ""} were added`,
              result.secondParentFailure,
            ),
          });
        } else if (result.secondParentStatus === "added") {
          toast({
            title: "Second parent added",
            description: `${result.secondParentLabel} has also been added as Parent`,
          });
        } else if (result.secondParentStatus === "invited") {
          toast({
            title: "Second parent invited",
            description: `An invitation was created for ${result.secondParentLabel}.`,
          });
        }
      };

      // Short-circuit when we attached the role directly to an existing user
      if (existingUserAdded) {
        queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
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
        secondParentOutcomeToast();
        setNameInput("");
        setCustomEmail("");
        return;
      }


      setInviteLink(link);
      setInviteShareLink(sLink);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });

      secondParentOutcomeToast();


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
                 ? (discoverEmailStyle
                     ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                     : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`)
                 : childrenNames.length > 1
                   ? (discoverEmailStyle
                       ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                       : `${clubBranding?.name || 'Your club'}: Your children have been added to their team ⚽`)
                   : `${clubBranding?.name || 'Your club'}: You've been added to the team ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: nameInput.trim(),
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
          let functionErrorDetails: string | null = null;
          if (funcError) {
            try {
              const errorContext = (funcError as any)?.context;
              functionErrorDetails = errorContext && typeof errorContext.json === "function"
                ? (await errorContext.json())?.error || null
                : null;
            } catch {
              functionErrorDetails = null;
            }
          }
          const emailError = functionErrorDetails || funcError?.message || (!emailSent ? (emailResult?.error || "Email not verified") : null);
          
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
            void toastInviteSuccess({
              title: "Invite sent!",
              description: `Email notification sent to ${email}`,
            });
          } else {
            toast({
              title: "Invite created — email failed",
              description: emailError || "The email provider did not accept the message. Share the invite link manually.",
              variant: "destructive",
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
          const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
            body: {
              to: secondEmail,
              subject: childrenNames.length === 1
                ? (discoverEmailStyle
                    ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                    : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`)
                : childrenNames.length > 1
                  ? (discoverEmailStyle
                      ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                      : `${clubBranding?.name || 'Your club'}: Your children have been added to their team ⚽`)
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
          } else {
            toast({
              variant: "destructive",
              title: "Second parent invite created — email failed",
              description: `${secondName}'s invitation exists but the email couldn't be sent. Share the invite link or retry.`,
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
          await supabase.functions.invoke("send-email", {
            body: {
              toUserId: selectedSecondParent.id,
              subject: childrenNames.length === 1
                ? (discoverEmailStyle
                    ? `${clubBranding?.name || 'Your club'}: See which team ${childrenNames[0]} is in ⚽`
                    : `${clubBranding?.name || 'Your club'}: ${childrenNames[0]} has been added to their team ⚽`)
                : `${clubBranding?.name || 'Your club'}: Your children have been added to ${teamName} ⚽`,
              template: "team-invite",
              senderName: clubBranding?.name || undefined,
              replyTo: (clubBranding as any)?.contact_email || undefined,
              templateData: {
                recipientName: selectedSecondParent.display_name || "Parent",
                childrenNames,
                teamName,
                clubName: clubBranding?.name || "The Club",
                roleName: "Parent",
                clubLogoUrl: clubBranding?.logo_url || undefined,
                customMessage: customMessage.trim() || undefined,
                inviteLink: `${window.location.origin}/teams/${teamId}`,
              },
            },
          });
        } catch (err) {
          console.error("[AddMember] Failed to send team-invite email to second parent (new flow):", err);
        }
      }
    },
    onError: (error: Error) => {
      toast(
        friendlyMutationError(error, {
          title: "Failed to add member",
          description: error.message || "Something went wrong. Please try again.",
        }),
      );
    },
  });

  // Bulk add pending members with invites
  const addBulkMembersMutation = useMutation({
    mutationFn: async (membersToAdd?: BulkMember[]) => {
      const membersSource = membersToAdd || bulkMembers;
      const validMembers = membersSource.filter(m => m.name.trim());
      if (validMembers.length === 0) throw new Error("Please enter at least one name");

      const results: { name: string; email: string; link: string; sent: boolean; role: string; childrenCount: number }[] = [];
      const secondParentFailures: string[] = [];
      const secondParentInvited: string[] = [];
      const secondParentAdded: string[] = [];

      /**
       * Single second-parent path for BOTH bulk branches. Always creates a real
       * invite row (or attaches an existing profile), never swallows an error,
       * and records the outcome so the summary toast can report it.
       */
      const handleSecondParent = async (
        member: BulkMember,
        validChildren: BulkMember["children"],
        childIds: string[],
        linkedInviteToken: string | null,
      ) => {
        try {
          const res = await ensureSecondParent({
            role: member.role,
            selectedProfile: member.selectedSecondParent ?? null,
            name: member.secondParentName,
            email: member.secondParentEmail,
            teamId,
            clubId,
            teamName,
            childIds,
            childrenMetadata: validChildren
              .filter((c) => c.name.trim())
              .map((c) => ({
                name: c.name.trim(),
                yearOfBirth: c.yearOfBirth ? parseInt(c.yearOfBirth) : null,
                existingChildId: c.existingChildId || null,
              })),
            expectChildren: validChildren.filter((c) => c.name.trim()).length > 0,
            invitedByUserId: user!.id,
            linkedInviteToken,
          });

          if (res.status === "added" && res.label) {
            secondParentAdded.push(res.label);
          } else if (res.status === "invited" && res.email && res.inviteLink) {
            secondParentInvited.push(res.label || res.email);
            try {
              const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
                body: {
                  to: res.email,
                  subject: `${clubBranding?.name || 'Your club'}: You've been invited as a guardian ⚽`,
                  template: "team-invite",
                  senderName: clubBranding?.name || undefined,
                  replyTo: (clubBranding as any)?.contact_email || undefined,
                  templateData: {
                    recipientName: res.label || "Parent",
                    invitedEmail: res.email,
                    teamName,
                    clubName: clubBranding?.name || "The Club",
                    roleName: "Parent",
                    inviteLink: res.inviteLink,
                    clubLogoUrl: clubBranding?.logo_url || undefined,
                    childrenNames: validChildren.filter(c => c.name.trim()).map(c => c.name.trim()),
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
                .eq("invite_token", res.inviteToken!);
            } catch (err) {
              console.error("[BulkAdd] second guardian email failed", (err as Error)?.message);
            }
          }
        } catch (err) {
          console.error("[BulkAdd] second parent failed", (err as Error)?.message);
          secondParentFailures.push(
            err instanceof SecondParentError ? (err.label ?? "a second parent") : "a second parent",
          );
        }
      };


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

        if (member.selectedUser) {
          const { error: roleError } = await supabase.from("user_roles").insert({
            user_id: member.selectedUser.id,
            team_id: teamId,
            club_id: clubId,
            role: memberRole,
          });

          if (roleError && !isDuplicateError(roleError)) {
            console.error("Failed to add existing bulk member", member.name, roleError);
            continue;
          }

          for (const child of validChildren) {
            let childId = child.existingChildId;

            // Skip children linked to pending invites
            if (child.pendingInviteId) continue;

            if (memberRole === "parent") {
              if (childId) {
                const existingChild = clubChildren.find(c => c.id === childId);
                if (existingChild && existingChild.parent_id !== member.selectedUser.id) {
                  const { error: guardianError } = await supabase
                    .from("child_guardians")
                    .insert({ child_id: childId, guardian_id: member.selectedUser.id });
                  if (guardianError && !isDuplicateChildError(guardianError)) {
                    console.error("[AddTeamMember] Failed to link guardian:", guardianError.message);
                    throw guardianError;
                  }
                }
              } else {
                const { data: newChildId, error: childError } = await supabase.rpc(
                  "create_child_for_parent_on_team",
                  {
                    p_parent_user_id: member.selectedUser.id,
                    p_team_id: teamId,
                    p_name: child.name.trim(),
                    p_year_of_birth: child.yearOfBirth ? parseInt(child.yearOfBirth) : null,
                  }
                );

                if (childError) {
                  console.error("Failed to create bulk child:", childError);
                  continue;
                }
                childId = newChildId;
              }

              if (childId) {
                const { data: existingAssignment } = await supabase
                  .from("child_team_assignments")
                  .select("id")
                  .eq("child_id", childId)
                  .eq("team_id", teamId)
                  .maybeSingle();

                if (!existingAssignment) {
                  await supabase.from("child_team_assignments").insert({
                    child_id: childId,
                    team_id: teamId,
                  });
                }
              }
            }
          }

          // Second guardian: one shared path, errors surfaced (never swallowed).
          await handleSecondParent(
            member,
            validChildren,
            validChildren.map((c) => c.existingChildId).filter(Boolean) as string[],
            null,
          );


          await supabase.from("notifications").insert({
            user_id: member.selectedUser.id,
            type: "membership",
            message: `You have been added to ${teamName} as ${roleOptions.find(r => r.value === memberRole)?.label}`,
            related_id: teamId,
          });

          results.push({
            name: member.selectedUser.display_name || member.name.trim(),
            email: member.email.trim(),
            link: `${window.location.origin}/teams/${teamId}`,
            sent: true,
            role: memberRole,
            childrenCount: validChildren.length,
          });
          continue;
        }

        // Add linked_invite_token if this parent is paired with another
        const linkedToken = crossLinks.get(i);
        const metadata = childrenMetadata 
          ? {
              children: JSON.parse(childrenMetadata),
              ...(linkedToken ? { linked_invite_token: linkedToken } : {}),
              ...(member.selectedSecondParent
                ? { second_parent_user_id: member.selectedSecondParent.id }
                : {}),
            }
          : null;

        // Create pending invite record with children metadata
        const { error: inviteError } = await supabase.from("pending_invites").insert({
          team_id: teamId,
          club_id: clubId,
          role: memberRole as any,
          invited_user_id: null,
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

        // Second parent gets its OWN invite row (previously this path only wrote
        // inert second_guardian_* metadata that nothing consumed).
        await handleSecondParent(member, validChildren, [], inviteToken);


        const link = `${window.location.origin}/join/p/${inviteToken}`;
        let sent = false;

        // Send email if provided - with verification and tracking
        let emailId: string | null = null;
        let emailError: string | null = null;

        if (member.email.trim()) {
          try {
            const { data: emailResult, error: funcError } = await supabase.functions.invoke("send-email", {
              body: {
                to: member.email.trim(),
                 subject: validChildren.length === 1
                   ? (discoverEmailStyle
                       ? `${clubBranding?.name || 'Your club'}: See which team ${validChildren[0].name.trim()} is in ⚽`
                       : `${clubBranding?.name || 'Your club'}: ${validChildren[0].name.trim()} has been added to their team ⚽`)
                   : validChildren.length > 1
                     ? (discoverEmailStyle
                         ? `${clubBranding?.name || 'Your club'}: See which team your kids are in ⚽`
                         : `${clubBranding?.name || 'Your club'}: Your children have been added to their team ⚽`)
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

      return { results, secondParentFailures, secondParentInvited, secondParentAdded };
    },
    onSuccess: ({ results, secondParentFailures, secondParentInvited, secondParentAdded }) => {
      setBulkResults(results);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId, null] });
      queryClient.invalidateQueries({ queryKey: ["team-roles", teamId] });
      
      const sentCount = results.filter(r => r.sent).length;
      const totalCount = results.length;
      
      void toastInviteSuccess({
        title: `${totalCount} member${totalCount > 1 ? "s" : ""} added`,
        description: sentCount > 0
          ? `${sentCount} member${sentCount > 1 ? "s were" : " was"} added or emailed successfully`
          : "Share the invite links with your members",
      });

      if (secondParentAdded.length > 0 || secondParentInvited.length > 0) {
        toast({
          title: "Second parents handled",
          description: [
            secondParentAdded.length > 0 ? `Added: ${secondParentAdded.join(", ")}` : null,
            secondParentInvited.length > 0 ? `Invited: ${secondParentInvited.join(", ")}` : null,
          ].filter(Boolean).join(" · "),
        });
      }
      if (secondParentFailures.length > 0) {
        toast({
          variant: "destructive",
          title: "Some second parents were not invited",
          description: secondParentPartialFailureMessage(
            "Members were added",
            secondParentFailures.join(", "),
          ),
        });
      }
    },

    onError: (error: Error) => {
      toast(
        friendlyMutationError(error, {
          title: "Failed to add members",
          description: error.message || "Something went wrong. Please try again.",
        }),
      );
    },
  });

  const buildInviteShareMessage = (overrideLink?: string) => {
    const clubName = clubBranding?.name || "";
    const childrenNames = singleChildren.filter(c => c.name.trim()).map(c => c.name.trim());
    const isAdminRole = ['club_admin', 'committee_member', 'coach', 'team_admin'].includes(selectedRole);
    const roleName = roleOptions.find(r => r.value === selectedRole)?.label || selectedRole;
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
    setNameConfirmed(false);
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
  // Any bulk row with a second-parent name but no valid email blocks the bulk add.
  const bulkSecondParentBlocked = bulkMembers.some(m => !!secondParentValidationError({
    role: m.role,
    name: m.secondParentName,
    email: m.secondParentEmail,
    selectedProfile: m.selectedSecondParent,
  }));

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
        <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              Member Added
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6 pb-6">
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <p className="font-medium mb-1">{nameInput}</p>
              {selectedRole === "parent" && singleChildren.filter(c => c.name.trim()).length > 0 ? (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Baby className="h-3.5 w-3.5" />
                  {singleChildren.filter(c => c.name.trim()).length === 1
                    ? `${singleChildren.find(c => c.name.trim())!.name.trim()} added to ${teamName || "the team"}`
                    : `${singleChildren.filter(c => c.name.trim()).map(c => c.name.trim()).join(", ")} added to ${teamName || "the team"}`}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {customEmail ? `Invite sent to ${customEmail}` : "Invite link created — share it with them"}
              </p>
            </div>

            {/* Share invite via other channels */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-center">Share invite via</p>

              {/* Optional phone — used only to pre-fill SMS / WhatsApp on this device.
                  Not stored anywhere. */}
              <div className="space-y-1.5">
                <Label htmlFor="share-phone" className="text-xs text-muted-foreground">
                  Phone number (optional — opens SMS or WhatsApp)
                </Label>
                <Input
                  id="share-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="e.g. +61 412 345 678"
                  value={sharePhone}
                  onChange={(e) => setSharePhone(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Not saved — used only to open your messaging app.
                </p>
              </div>

              {(() => {
                const msg = buildInviteShareMessage().trim();
                const cleanedPhone = sharePhone.replace(/[^\d+]/g, "");
                // wa.me requires digits only (no +)
                const waPhone = cleanedPhone.replace(/^\+/, "");
                const hasPhone = cleanedPhone.length >= 4;
                const smsHref = hasPhone
                  ? `sms:${cleanedPhone}${/android/i.test(navigator.userAgent) ? "?" : "&"}body=${encodeURIComponent(msg)}`
                  : `sms:?body=${encodeURIComponent(msg)}`;
                const waHref = hasPhone
                  ? `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`
                  : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                return (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        onClick={() => { window.location.href = smsHref; }}
                      >
                        <MessageSquare className="h-4 w-4 mr-2" />
                        SMS
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => { window.open(waHref, "_blank"); }}
                      >
                        <Share2 className="h-4 w-4 mr-2" />
                        WhatsApp
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={async () => {
                          if (Capacitor.isNativePlatform()) {
                            try {
                              await Share.share({
                                title: `Join ${clubBranding?.name || teamName}`,
                                text: msg,
                                dialogTitle: `Share invite`,
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
                        More
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(inviteShareLink || inviteLink || "");
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
                  </>
                );
              })()}
            </div>

            <p className="text-sm text-muted-foreground text-center">
              When they accept the invite, their name will be pre-filled as "{nameInput}"
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => {
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

        <div data-allow-scroll className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6 pb-4 overscroll-contain" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")} className="w-full">
          {/* Multiple/bulk tab removed — join link + single invite cover all cases */}

          <TabsContent value="single" className="space-y-4 mt-0">

            {/* Share link — visible the moment the sheet opens; auto-created
                for the default role so Copy/Share need zero extra taps. */}
            {canBulkInvite && !nameInput.trim() && !selectedUser && (
              <>
                <TeamJoinLinkCard
                  teamId={teamId}
                  teamName={teamName}
                  teamType={teamType}
                  autoCreateLink
                />
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-border" />
                  <p className="text-xs font-medium text-muted-foreground">Or invite a specific person</p>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            {/* Invite-by-name body — always visible below the share link */}
            {inviteByNameOpen && (
              <>

            {/* Person — name input, search, existing user / new member chip */}
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
                          {existingMembers?.includes(result.id) && (
                            <span className="text-[11px] text-muted-foreground truncate">
                              Already on this team — pick to add a child
                            </span>
                          )}
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
                          <span className="text-xs text-muted-foreground truncate">
                            {formatPendingInviteSubtitle(result.role, result.teamName, result.childName)}
                          </span>
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

            {/* Role selection — disclosed as soon as a person is chosen/typed */}
            {personReady && (
              <div className="space-y-2 scroll-mt-4" ref={roleSectionRef}>
                <Label className="text-sm font-medium">Select role</Label>
                <div className={`grid gap-2 ${roleOptions.length <= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {roleOptions.map((opt) => (
                    <button
                      key={`top-${opt.value}`}
                      type="button"
                      role="radio"
                      aria-checked={selectedRole === opt.value}
                      aria-pressed={selectedRole === opt.value}
                      aria-label={`Role: ${opt.label}`}
                      onClick={() => setSelectedRole(opt.value)}
                      className={`p-3 rounded-xl text-center transition-all border ${
                        selectedRole === opt.value
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-muted/40 hover:bg-muted text-foreground"
                      }`}
                    >
                      <p className="text-sm font-medium">
                        {opt.value === "parent" ? "Parent" : opt.value === "coach" ? "Coach" : opt.value === "team_admin" ? "Admin" : opt.label}
                      </p>
                      {opt.value === "parent" && (
                        <p className={`text-[11px] mt-0.5 ${selectedRole === opt.value ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          adds child player
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Existing user, non-parent: optional email to send invite email */}
            {selectedUser && selectedRole !== "parent" && (
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

            {/* Existing user, parent role: child fields + second guardian (inline) */}
            {selectedUser && selectedRole === "parent" && (
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

            {/* New member, parent role: child fields + second guardian (inline) */}
            {!selectedUser && personReady && selectedRole === "parent" && (
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

            {/* Delivery method + custom message (new members only) */}
            {!selectedUser && personReady && (
              <>
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
                      onClick={() => { setDeliveryMethod("share"); setCustomEmail(""); }}
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
                  {deliveryMethod === "email" ? (
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="e.g., john@example.com"
                        value={customEmail}
                        onChange={(e) => setCustomEmail(e.target.value)}
                        className="pl-10"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No email needed — tap <strong>Create Invite</strong> and you'll get a link to share or copy.
                    </p>
                  )}

                </div>

                {/* Custom message toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-sm">
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
                    <Textarea
                      placeholder={`Add a personal note (optional). Example:\n\nHi! We're using Ignite Club HQ to keep everything organised — fixtures, chat, and team updates all in one place. Tap the link to join.`}
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      rows={4}
                      className="text-sm resize-none"
                    />
                  )}
                </div>
              </>
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
            // Single-screen flow: one primary action, validated as a whole.
            const isPending = addExistingUserMutation.isPending || addPendingMemberMutation.isPending;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const emailTrimmed = customEmail.trim();
            const parentNeedsChild =
              selectedRole === "parent" && !singleChildren.some((c) => c.name.trim().length > 0);
            const submitNeedsEmail =
              !selectedUser && deliveryMethod === "email" && !emailTrimmed;
            const submitInvalidEmail =
              !selectedUser && deliveryMethod === "email" && !!emailTrimmed && !emailRegex.test(emailTrimmed);
            // A second-parent name without a valid email must block submission —
            // it must never be silently discarded.
            const secondParentBlocked = secondParentValidationError({
              role: selectedRole,
              name: secondParentName,
              email: secondParentEmail,
              selectedProfile: selectedSecondParent,
            });

            // Guardrail: human-readable reason explaining why the primary
            // action is currently blocked. Surfaced inline above the footer
            // button so users aren't left guessing why it's greyed out.
            let blockedReason: string | null = null;
            if (!personReady) {
              // Don't show a yellow warning on the empty initial state —
              // the disabled CTA below already communicates what's needed.
              blockedReason = null;
            } else if (parentNeedsChild) {
              blockedReason = "Add at least one child's name to continue.";
            } else if (submitNeedsEmail) {
              blockedReason = "Enter an email address to send the invite.";
            } else if (submitInvalidEmail) {
              blockedReason = "That email doesn't look right — double-check the format.";
            } else if (secondParentBlocked) {
              blockedReason = secondParentBlocked;
            }

            const submitBlocked =
              !personReady || parentNeedsChild || submitNeedsEmail || submitInvalidEmail || !!secondParentBlocked;

            const handleSubmit = () => {
              if (submitBlocked || isPending) return;
              // Stamp the name as confirmed so the chip view stays consistent
              // if the mutation errors and the sheet remains open.
              if (!selectedUser && !nameConfirmed) setNameConfirmed(true);
              if (selectedUser) addExistingUserMutation.mutate();
              else addPendingMemberMutation.mutate();
            };

            const ctaLabel = !personReady
              ? "Enter a name to continue"
              : parentNeedsChild
                ? "Add a child to continue"
                : selectedUser
                  ? "Add to Team"
                  : deliveryMethod === "email"
                    ? "Send Invite"
                    : "Create Invite";

            return (
              <div className="space-y-2">
                {blockedReason && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{blockedReason}</span>
                  </div>
                )}
                <Button
                  className="w-full h-12 text-base font-semibold"
                  onClick={handleSubmit}
                  disabled={isPending || submitBlocked}
                  variant={submitBlocked ? "outline" : "default"}
                >
                  {isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="h-5 w-5 mr-2" />
                  )}
                  {ctaLabel}
                </Button>
              </div>
            );
          })() : (
            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => addBulkMembersMutation.mutate(undefined)}
              disabled={validBulkCount === 0 || bulkSecondParentBlocked || addBulkMembersMutation.isPending}
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
