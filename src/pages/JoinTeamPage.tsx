import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Users, AlertTriangle, Plus, UserCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PhotoConsentDialog } from "@/components/PhotoConsentDialog";
import { AppStoreDownloadGuide } from "@/components/AppStoreDownloadGuide";
import { InviteFlowProgress, setInviteFlowContext, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Basic User",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  league_admin: "League Admin",
  committee_member: "Committee Member",
  association_admin: "Association Admin",
};

// Roles that users can request when joining a team
const selectableRoles: AppRole[] = ["coach", "player", "parent"];

// Roles that don't allow additional role selection (admin roles)
const fixedRoles: AppRole[] = ["club_admin", "team_admin", "app_admin"];

export default function JoinTeamPage() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [joined, setJoined] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingJoinRoles, setPendingJoinRoles] = useState<AppRole[]>([]);
  const [nameValidationError, setNameValidationError] = useState<string | null>(null);
  const [showChildStep, setShowChildStep] = useState(false);
  const [childName, setChildName] = useState("");
  const [childYearOfBirth, setChildYearOfBirth] = useState("");
  const [linkExistingChildId, setLinkExistingChildId] = useState<string | null>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [addedChildren, setAddedChildren] = useState<string[]>([]);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const autoJoinAttempted = useRef(false);
  
  // Check if we should auto-join (returning from auth after install flow)
  const shouldAutoJoin = sessionStorage.getItem("autoJoinAfterAuth") === "true";

  // Check if this is a pending invite token (name-restricted) or a regular team invite
  const isPendingInvite = location.pathname.startsWith("/join/p/");

  // Fetch pending invite details using RPC function (for name-restricted invites)
  const { data: pendingInviteData, isLoading: pendingInviteLoading, error: pendingInviteError, isError: pendingInviteIsError } = useQuery({
    queryKey: ["pending-invite-token", token],
    queryFn: async () => {
      console.log("[JoinTeam] Fetching pending invite for token:", token);
      try {
        const { data, error } = await supabase
          .rpc("get_pending_invite_by_token", { _token: token! });
        console.log("[JoinTeam] RPC response:", { data, error });
        if (error) {
          console.error("[JoinTeam] RPC error:", error);
          throw error;
        }
        if (data && data.length > 0) {
          return data[0];
        }
        console.log("[JoinTeam] No invite found for token");
        return null;
      } catch (err) {
        console.error("[JoinTeam] Exception fetching invite:", err);
        throw err;
      }
    },
    enabled: !!token && isPendingInvite,
    retry: 2,
    retryDelay: 1000,
    staleTime: 0,
  });

  // Fetch team invite details using secure RPC function (for regular invites)
  const { data: teamInvite, isLoading: teamInviteLoading, error: teamInviteError } = useQuery({
    queryKey: ["team-invite", token],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_team_invite_by_token", { _token: token! });
      if (error) throw error;
      if (data && data.length > 0) {
        const row = data[0];
        return {
          id: row.id,
          team_id: row.team_id,
          role: row.role,
          token: row.token,
          uses_count: row.uses_count,
          max_uses: row.max_uses,
          expires_at: row.expires_at,
          created_at: row.created_at,
          created_by: row.created_by,
          metadata: row.metadata as { child_name?: string; child_year_of_birth?: number } | null,
          teams: {
            id: row.team_id,
            name: row.team_name,
            logo_url: row.team_logo_url,
            club_id: row.club_id,
            clubs: {
              name: row.club_name,
              logo_url: undefined as string | undefined
            }
          }
        };
      }
      return null;
    },
    enabled: !!token && !isPendingInvite,
    retry: 2,
    retryDelay: 1000,
    staleTime: 0,
  });

  // Combine invite data based on type
  const invite = isPendingInvite 
    ? pendingInviteData 
      ? {
          id: pendingInviteData.id,
          team_id: pendingInviteData.team_id,
          role: pendingInviteData.role,
          invited_label: pendingInviteData.invited_label,
          status: pendingInviteData.status,
          token: token,
          uses_count: 0,
          max_uses: 1, // Pending invites are single-use
          expires_at: null,
          created_at: null,
          created_by: null,
          teams: {
            id: pendingInviteData.team_id,
            name: pendingInviteData.team_name,
            logo_url: pendingInviteData.team_logo_url,
            club_id: pendingInviteData.club_id,
            clubs: {
              name: pendingInviteData.club_name,
              logo_url: pendingInviteData.club_logo_url
            }
          }
        }
      : null
    : teamInvite;

  const isLoading = isPendingInvite ? pendingInviteLoading : teamInviteLoading;
  const inviteError = isPendingInvite ? pendingInviteError : teamInviteError;
  const pendingInviteMeta = (pendingInviteData?.metadata as { mini_league_id?: string } | null) ?? null;
  const inviteMiniLeagueId = isPendingInvite ? pendingInviteMeta?.mini_league_id ?? null : null;
  const inviteClubId = invite?.teams?.club_id || pendingInviteData?.club_id || null;

  const { data: inviteMiniLeague } = useQuery({
    queryKey: ["invite-mini-league", inviteMiniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name")
        .eq("id", inviteMiniLeagueId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!inviteMiniLeagueId,
  });

  const inviteEntityName = inviteMiniLeague?.name || invite?.teams?.name || invite?.teams?.clubs?.name || "organization";
  const inviteDestination = inviteMiniLeagueId
    ? `/mini-leagues/${inviteMiniLeagueId}?from=invite`
    : invite?.team_id
      ? `/teams/${invite.team_id}?from=invite`
      : inviteClubId
        ? `/clubs/${inviteClubId}?from=invite`
        : "/";
  const inviteEntityLabel = inviteMiniLeagueId ? "League" : invite?.team_id ? "Team" : "Club";

  // Fetch user's existing roles for the invite destination
  const { data: existingRoles = [] } = useQuery({
    queryKey: ["user-invite-roles", invite?.team_id, inviteClubId, user?.id],
    queryFn: async () => {
      let query = supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id);

      if (invite?.team_id) {
        query = query.eq("team_id", invite.team_id);
      } else if (inviteClubId) {
        query = query.eq("club_id", inviteClubId).is("team_id", null);
      } else {
        return [];
      }

      const { data } = await query;
      return data?.map(r => r.role as AppRole) || [];
    },
    enabled: !!invite && !!user,
  });

  // Fetch user's profile for name validation and profile completion check
  // Use staleTime: 0 to ensure fresh data when returning from profile completion
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["user-profile-for-join", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch existing children on this team for parent linking.
  // Only surface children who don't yet have a primary parent or any guardians,
  // so a new parent can claim them without colliding with existing families.
  const { data: existingTeamChildren = [] } = useQuery({
    queryKey: ["team-children-for-linking", invite?.team_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("child_team_assignments")
        .select("child_id, children(id, name, year_of_birth, parent_id)")
        .eq("team_id", invite!.team_id);
      const candidates = (data || [])
        .map(a => (a.children as any))
        .filter((c: any) => c && !c.parent_id);
      if (candidates.length === 0) return [];
      // Exclude any candidates that already have at least one guardian linked
      const ids = candidates.map((c: any) => c.id);
      const { data: guardians } = await supabase
        .from("child_guardians")
        .select("child_id")
        .in("child_id", ids);
      const linked = new Set((guardians || []).map((g: any) => g.child_id));
      return candidates.filter((c: any) => !linked.has(c.id));
    },
    enabled: !!invite?.team_id && showChildStep,
  });

  // Check if user needs to complete their profile first
  const needsProfileCompletion = user && userProfile !== undefined && !userProfile?.display_name;

  // Validate name for pending invites - only block EXISTING users with a different name already set
  // New signups (no display_name yet) are allowed - their name will be auto-set during join
  useEffect(() => {
    if (isPendingInvite && pendingInviteData?.invited_label && user && userProfile !== undefined) {
      const expectedName = pendingInviteData.invited_label.toLowerCase().trim();
      const actualName = (userProfile?.display_name || "").toLowerCase().trim();
      
      // Only block if user has an EXISTING display_name that doesn't match
      // If display_name is empty, they're a new signup and we'll set their name during join
      if (actualName && actualName !== expectedName) {
        setNameValidationError(
          `This invite was created for "${pendingInviteData.invited_label}". Your account name "${userProfile?.display_name}" doesn't match.`
        );
      } else {
        // Either name matches OR they have no display_name yet (new signup) - allow join
        setNameValidationError(null);
      }
    } else {
      setNameValidationError(null);
    }
  }, [isPendingInvite, pendingInviteData, userProfile, user]);

  // Set up invite flow context when invite is loaded (for progress tracking across pages)
  useEffect(() => {
    if (invite) {
      // Check if we're resuming from a stored context (e.g., after PWA install)
      const existingContext = getInviteFlowContext();
      const resumeStep = existingContext?.currentStep;
      
      setInviteFlowContext({
        active: true,
        clubName: invite.teams?.clubs?.name || undefined,
        clubLogoUrl: invite.teams?.clubs?.logo_url || undefined,
        teamName: invite.teams?.name || undefined,
        role: invite.role,
        inviteToken: token,
        currentStep: resumeStep || "view",
      });
    }
  }, [invite, token]);

  // Clear invite flow context on successful join
  useEffect(() => {
    if (joined) {
      clearInviteFlowContext();
    }
  }, [joined]);

  // Surface a "Taking Too Long" screen if the invite RPC hangs (network drop, cold start, etc.)
  // Without this, isLoading stays true indefinitely and the user only sees a spinner — which they
  // typically describe as "timed out". 15s gives slow networks a chance before showing the retry UI.
  useEffect(() => {
    if (!isLoading) {
      setLoadingTimeout(false);
      return;
    }
    const t = setTimeout(() => setLoadingTimeout(true), 15000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // All invite types now use a fixed role — no role selection UI needed
  // Initialize selected roles with invite role if user doesn't have it yet
  useEffect(() => {
    if (invite?.role && existingRoles && !existingRoles.includes(invite.role as AppRole)) {
      setSelectedRoles([invite.role as AppRole]);
    }
  }, [invite?.role, existingRoles]);

  const toggleRole = (role: AppRole) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  // Execute the actual join mutation
  const executeJoin = async (rolesToAdd: AppRole[]) => {
    if (!invite || !user) throw new Error("Missing data");

    // For pending invites, validate name match
    if (isPendingInvite && pendingInviteData?.invited_label) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const expectedName = pendingInviteData.invited_label.toLowerCase().trim();
      const actualName = (profile?.display_name || "").toLowerCase().trim();

      // If user has no display_name, set it to the expected name
      if (!profile?.display_name || !actualName) {
        await supabase
          .from("profiles")
          .update({ display_name: pendingInviteData.invited_label })
          .eq("id", user.id);
      } else if (actualName !== expectedName) {
        const adminType = pendingInviteData.team_id ? "team admin" : "club admin";
        throw new Error(
          `This invite was created for "${pendingInviteData.invited_label}". Please create a new account with that name or contact your ${adminType} for a different invite link.`
        );
      }

      // Check if pending invite is already used
      if (pendingInviteData.status !== "pending") {
        throw new Error("This invite has already been used");
      }

      // Create children from invite metadata (if parent role with children)
      const metadata = pendingInviteData.metadata as { 
        children?: { name: string; yearOfBirth: number | null; existingChildId?: string | null }[];
        mini_league_id?: string;
        child_id?: string;
        player_id?: string;
        second_parent_user_id?: string;
        linked_invite_token?: string;
        kind?: string;
      } | null;

      // Mini-league admin invite: grant per-league admin rights and short-circuit team logic
      if (pendingInviteData.role === "league_admin" && metadata?.mini_league_id) {
        const miniLeagueId = metadata.mini_league_id;
        // Idempotent grant
        const { data: existingGrant } = await supabase
          .from("mini_league_admins")
          .select("id")
          .eq("mini_league_id", miniLeagueId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!existingGrant) {
          await supabase.from("mini_league_admins").insert({
            mini_league_id: miniLeagueId,
            user_id: user.id,
            granted_by: (pendingInviteData as any).invited_by_user_id ?? null,
          } as any);
        }

        // Mark invite accepted — but keep reusable shareable join links pending
        if (metadata?.kind !== "league_admin_join_link") {
          await supabase
            .from("pending_invites")
            .update({
              status: "accepted",
              accepted_at: new Date().toISOString(),
              invited_user_id: user.id,
            })
            .eq("id", pendingInviteData.id);
        }

        // Notification
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "membership",
          message: `You've joined ${inviteEntityName} as League Admin`,
          related_id: miniLeagueId,
        });

        return ["league_admin" as AppRole];
      }

      // Mini-league parent shareable join link: grant club-level parent role,
      // keep token reusable, and let the child-add UI run after success.
      if (
        pendingInviteData.role === "parent" &&
        metadata?.kind === "mini_league_parent_join_link" &&
        metadata?.mini_league_id
      ) {
        const miniLeagueId = metadata.mini_league_id;
        const targetClubId = (pendingInviteData as any).club_id;

        if (targetClubId) {
          const { data: existingRole } = await supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("club_id", targetClubId)
            .is("team_id", null)
            .eq("role", "parent")
            .maybeSingle();
          if (!existingRole) {
            const { error: roleErr } = await supabase.from("user_roles").insert({
              user_id: user.id,
              club_id: targetClubId,
              role: "parent",
            });
            if (roleErr && roleErr.code !== "23505" && !roleErr.message?.includes("duplicate")) {
              throw new Error(`Failed to add parent role: ${roleErr.message}`);
            }
          }
        }

        // Notification (do NOT mark invite accepted — link is reusable)
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "membership",
          message: `You've joined ${inviteEntityName} as Parent`,
          related_id: miniLeagueId,
        });

        return ["parent" as AppRole];
      }
      if (metadata?.child_id && metadata?.mini_league_id && pendingInviteData.role === "parent") {
        const existingChildId = metadata.child_id;
        const miniLeagueId = metadata.mini_league_id;
        console.log("[JoinTeam] Mini-league invite: linking existing child to parent:", existingChildId);
        
        // Transfer child ownership to this parent
        await supabase
          .from("children")
          .update({ parent_id: user.id })
          .eq("id", existingChildId);
        
        // Ensure mini league assignment exists
        const { data: existingLeagueAssignment } = await supabase
          .from("child_mini_league_assignments")
          .select("id")
          .eq("child_id", existingChildId)
          .eq("mini_league_id", miniLeagueId)
          .maybeSingle();
        
        if (!existingLeagueAssignment) {
          await supabase.from("child_mini_league_assignments").insert({
            child_id: existingChildId,
            mini_league_id: miniLeagueId,
            ability_rating: 3,
          });
        }
        
        // Update legacy mini_league_players record
        if (metadata.player_id) {
          await supabase
            .from("mini_league_players")
            .update({ parent_user_id: user.id })
            .eq("id", metadata.player_id);
        } else {
          await supabase
            .from("mini_league_players")
            .update({ parent_user_id: user.id })
            .eq("child_id", existingChildId)
            .eq("mini_league_id", miniLeagueId);
        }
      } else if (metadata?.children && metadata.children.length > 0 && pendingInviteData.role === "parent") {
        console.log("[JoinTeam] Creating children from invite metadata:", metadata.children.length);
        
        // Fetch existing children to avoid duplicates
        const { data: existingChildren } = await supabase
          .from("children")
          .select("id, name, year_of_birth")
          .eq("parent_id", user.id);
        
        const createdChildIds: string[] = [];
        for (const childData of metadata.children) {
          const childNameLower = childData.name.toLowerCase().trim();
          
          let childId: string | null = null;
          
          if (childData.existingChildId) {
            // Admin linked to an existing club child — add as guardian
            childId = childData.existingChildId;
            console.log("[JoinTeam] Linking to existing club child:", childData.name, "ID:", childId);
            const { error: guardErr } = await supabase.from("child_guardians").insert({
              child_id: childId,
              guardian_id: user.id,
              relationship_type: "parent",
              is_primary: false,
            });
            if (guardErr && !guardErr.message?.includes("duplicate")) {
              console.error("[JoinTeam] Failed to link guardian:", guardErr.message);
            }
          } else {
            // Check if a child with the same name already exists for this parent
            const existingChild = existingChildren?.find(
              c => c.name.toLowerCase().trim() === childNameLower
            );
            
            if (existingChild) {
              childId = existingChild.id;
              console.log("[JoinTeam] Child already exists:", childData.name, "ID:", childId);
            } else {
              // Create the child record
              const { data: newChild, error: childError } = await supabase
                .from("children")
                .insert({
                  parent_id: user.id,
                  name: childData.name,
                  year_of_birth: childData.yearOfBirth,
                })
                .select("id")
                .single();
              
              if (childError) {
                console.error("[JoinTeam] Failed to create child:", childError.message);
                continue;
              }
              childId = newChild?.id || null;
              console.log("[JoinTeam] Created new child:", childData.name, "ID:", childId);
            }
          }
          if (childId) createdChildIds.push(childId);
          
          // Assign child to the team (with duplicate check)
          if (childId && pendingInviteData.team_id) {
            // Check if already assigned to this team
            const { data: existingAssignment } = await supabase
              .from("child_team_assignments")
              .select("id")
              .eq("child_id", childId)
              .eq("team_id", pendingInviteData.team_id)
              .maybeSingle();
            
            if (existingAssignment) {
              console.log("[JoinTeam] Child already assigned to team:", childData.name);
            } else {
              const { error: assignError } = await supabase
                .from("child_team_assignments")
                .insert({
                  child_id: childId,
                  team_id: pendingInviteData.team_id,
                });
              
              if (assignError) {
                console.error("[JoinTeam] Failed to assign child to team:", assignError.message);
              } else {
                console.log("[JoinTeam] Child assigned to team:", childData.name);
              }
            }
          }
          
          // Assign child to mini league if mini_league_id exists in metadata
          if (childId && metadata.mini_league_id) {
            // Check if already assigned to this league
            const { data: existingLeagueAssignment } = await supabase
              .from("child_mini_league_assignments")
              .select("id")
              .eq("child_id", childId)
              .eq("mini_league_id", metadata.mini_league_id)
              .maybeSingle();
            
            if (existingLeagueAssignment) {
              console.log("[JoinTeam] Child already assigned to league:", childData.name);
            } else {
              const { error: leagueAssignError } = await supabase
                .from("child_mini_league_assignments")
                .insert({
                  child_id: childId,
                  mini_league_id: metadata.mini_league_id,
                  ability_rating: 3, // Default rating
                });
              
              if (leagueAssignError) {
                console.error("[JoinTeam] Failed to assign child to league:", leagueAssignError.message);
              } else {
                console.log("[JoinTeam] Child assigned to mini league:", childData.name);
              }
            }
            
            // Update legacy mini_league_players record
            if (metadata.player_id) {
              await supabase
                .from("mini_league_players")
                .update({ parent_user_id: user.id, child_id: childId })
                .eq("id", metadata.player_id);
            }
          }
        }
        
        // Link second parent (existing user) as guardian to created children
        if (metadata.second_parent_user_id && createdChildIds.length > 0) {
          for (const cid of createdChildIds) {
            await supabase.from("child_guardians").insert({
              child_id: cid,
              guardian_id: metadata.second_parent_user_id,
              relationship_type: "parent",
              is_primary: false,
            }).then(({ error: guardErr }) => {
              if (guardErr && !guardErr.message?.includes("duplicate")) {
                console.error("[JoinTeam] Failed to link second parent:", guardErr.message);
              }
            });
          }
          console.log("[JoinTeam] Linked second parent to", createdChildIds.length, "children");
        }
      } else if (pendingInviteData.role === "parent" && metadata?.child_id) {
        // Link existing child to this parent (child was pre-created by admin)
        console.log("[JoinTeam] Linking existing child to parent:", metadata.child_id);
        await supabase
          .from("children")
          .update({ parent_id: user.id })
          .eq("id", metadata.child_id);
        
        // Update legacy mini_league_players record
        if (metadata.player_id) {
          await supabase
            .from("mini_league_players")
            .update({ parent_user_id: user.id })
            .eq("id", metadata.player_id);
        }
      }
    } else if (!isPendingInvite) {
      // Regular team invite - check expiry and usage limits
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new Error("This invite link has expired");
      }

      if (invite.max_uses && invite.uses_count >= invite.max_uses) {
        throw new Error("This invite link has reached its usage limit");
      }

      // Reconcile any matching pending invites for this user (by user_id or email)
      const userEmail = user.email?.toLowerCase().trim();
      const orClauses = [`invited_user_id.eq.${user.id}`];
      if (userEmail) {
        orClauses.push(`invited_email.ilike.${userEmail}`);
      }

      const { data: matchingPendingInvites } = await supabase
        .from("pending_invites")
        .select("id, invited_label")
        .eq("team_id", invite.team_id)
        .eq("status", "pending")
        .or(orClauses.join(","))
        .order("created_at", { ascending: false });

      if (matchingPendingInvites && matchingPendingInvites.length > 0) {
        // Use the first match's label to prefill display name if needed
        const firstLabel = matchingPendingInvites.find(i => i.invited_label)?.invited_label;
        if (firstLabel) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("id", user.id)
            .single();

          if (!profile?.display_name) {
            await supabase
              .from("profiles")
              .update({ display_name: firstLabel })
              .eq("id", user.id);
          }
        }

        // Mark ALL matching pending invites as accepted
        const matchingIds = matchingPendingInvites.map(i => i.id);
        await supabase
          .from("pending_invites")
          .update({ 
            status: "accepted", 
            accepted_at: new Date().toISOString(),
            invited_user_id: user.id
          })
          .in("id", matchingIds);
        
        console.log("[JoinTeam] Reconciled", matchingIds.length, "pending invite(s) for user");
      }

      // Increment uses_count for team invite
      await supabase
        .from("team_invites")
        .update({ uses_count: invite.uses_count + 1 })
        .eq("id", invite.id);
    }

    // Add user to team with all selected roles
    for (const role of rolesToAdd) {
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        team_id: invite.team_id,
        club_id: invite.teams?.club_id,
        role: role,
      });
      
      // Ignore duplicate key errors
      if (roleError) {
        const isDuplicate = roleError.code === '23505' || roleError.message.includes('duplicate key') || roleError.message.includes('unique constraint');
        if (!isDuplicate) {
          console.error('Role insert error:', roleError);
          // Provide a user-friendly message for RLS violations (usually email mismatch)
          if (roleError.message.includes('row-level security policy')) {
            const invitedEmail = isPendingInvite ? pendingInviteData?.invited_email : null;
            const hint = invitedEmail 
              ? `Please make sure you signed up with the email address the invite was sent to (${invitedEmail}). If you used a different email, ask your admin to resend the invite to your correct email.`
              : `Please make sure you signed up with the same email address the invite was sent to. If you used a different email, ask your admin to resend the invite to your correct email.`;
            throw new Error(hint);
          }
          throw new Error(`Failed to add ${role} role: ${roleError.message}`);
        }
      }
    }

    // Handle child auto-creation for regular team invites with metadata
    if (!isPendingInvite && teamInvite?.metadata && rolesToAdd.includes("parent")) {
      const childMeta = teamInvite.metadata as { child_name?: string; child_year_of_birth?: number };
      if (childMeta.child_name) {
        console.log("[JoinTeam] Auto-creating child from invite metadata:", childMeta.child_name);
        
        // Check for existing child with same name on this team
        const { data: existingOnTeam } = await supabase
          .from("child_team_assignments")
          .select("child_id, children(id, name)")
          .eq("team_id", invite.team_id);
        
        const existing = existingOnTeam?.find(
          (a: any) => a.children?.name?.toLowerCase().trim() === childMeta.child_name!.toLowerCase().trim()
        );
        
        if (existing) {
          // Link as guardian to existing child
          await supabase.from("child_guardians").insert({
            child_id: (existing.children as any).id,
            guardian_id: user.id,
            relationship_type: "parent",
            is_primary: false,
          }).then(({ error }) => {
            if (error && !error.message?.includes("duplicate")) {
              console.error("[JoinTeam] Failed to link guardian:", error.message);
            }
          });
        } else {
          // Create new child and assign to team
          const { data: newChild } = await supabase
            .from("children")
            .insert({
              parent_id: user.id,
              name: childMeta.child_name,
              year_of_birth: childMeta.child_year_of_birth || null,
            })
            .select("id")
            .single();
          
          if (newChild?.id) {
            await supabase.from("child_team_assignments").insert({
              child_id: newChild.id,
              team_id: invite.team_id,
            });
          }
        }
      }
    }

    if (isPendingInvite && pendingInviteData?.id) {
      await supabase
        .from("pending_invites")
        .update({ 
          status: "accepted", 
          accepted_at: new Date().toISOString(),
          invited_user_id: user.id
        })
        .eq("id", pendingInviteData.id);
    }

    // Send notification to the new member
    const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
    const membershipRelatedId = inviteMiniLeagueId || invite.team_id || invite?.teams?.club_id;
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "membership",
      message: `You've joined ${inviteEntityName} as ${roleNames}`,
      related_id: membershipRelatedId,
    });

    // Send membership confirmation email if user has an email
    if (user.email) {
      try {
        // Fetch club branding for the email
        const clubId = invite.teams?.club_id;
        let clubLogoUrl: string | undefined;
        let clubName = invite.teams?.clubs?.name || "Your Club";
        
        if (clubId) {
          const { data: clubBranding } = await supabase
            .from("clubs")
            .select("name, logo_url")
            .eq("id", clubId)
            .single();
          
          if (clubBranding) {
            clubName = clubBranding.name || clubName;
            clubLogoUrl = clubBranding.logo_url || undefined;
          }
        }

        const teamLink = `${window.location.origin}${inviteDestination}`;
        
        console.log("Sending membership email with:", { clubName, clubLogoUrl, teamName: inviteEntityName });
        
        await supabase.functions.invoke("send-email", {
          body: {
            to: user.email,
            subject: `Welcome to ${inviteEntityName}!`,
            template: "membership-confirmation",
            templateData: {
              recipientName: userProfile?.display_name || pendingInviteData?.invited_label || user.email.split("@")[0],
              teamName: inviteEntityName,
              clubName,
              roleName: roleNames,
              teamLink,
              clubLogoUrl,
            },
          },
        });
        console.log("Membership confirmation email sent to", user.email);
      } catch (emailError) {
        // Don't fail the join if email fails
        console.error("Failed to send membership confirmation email:", emailError);
      }
    }

    return rolesToAdd;
  };

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!invite || !user) throw new Error("Missing data");

      // Block join if there's a name validation error
      if (nameValidationError) {
        throw new Error(nameValidationError);
      }

      // Filter out roles user already has
      const rolesToAdd = selectedRoles.filter(role => !existingRoles?.includes(role));

      if (rolesToAdd.length === 0) {
        throw new Error("You already have all selected roles in this team");
      }

      // If parent role is selected, check if we need to show consent dialog
      if (rolesToAdd.includes("parent")) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("photo_consent_given_at")
          .eq("id", user.id)
          .single();

        if (!profile?.photo_consent_given_at) {
          setPendingJoinRoles(rolesToAdd);
          setShowPhotoConsent(true);
          return null;
        }
      }

      return executeJoin(rolesToAdd);
    },
    onSuccess: (rolesToAdd) => {
      if (rolesToAdd === null) {
        return;
      }
      const roleNames = rolesToAdd.map(r => roleLabels[r]).join(", ");
      toast({ title: `Successfully joined as ${roleNames}!` });
      
      // If parent role was added via a regular invite WITHOUT child metadata, show child step.
      // Same flow for mini-league parent shareable join link (no preset child).
      const isLeagueParentLink =
        isPendingInvite &&
        (pendingInviteData?.metadata as any)?.kind === "mini_league_parent_join_link";
      if (
        (!isPendingInvite && rolesToAdd.includes("parent") && !teamInvite?.metadata) ||
        (isLeagueParentLink && rolesToAdd.includes("parent"))
      ) {
        setShowChildStep(true);
      } else {
        setJoined(true);
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to join team", variant: "destructive" });
    },
  });

  // Auto-join effect: when user returns from auth and shouldAutoJoin is true
  useEffect(() => {
    // Wait for profile to finish loading before making any decisions
    if (profileLoading) return;
    
    // First check if user needs to complete their profile
    if (user && userProfile !== undefined && !userProfile?.display_name) {
      // User hasn't completed profile - redirect to complete profile
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true"); // Ensure flag is set
      // Store the invited_label for profile prefill if available (pending invite)
      if (pendingInviteData?.invited_label) {
        sessionStorage.setItem("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile", { replace: true });
      return;
    }

    // Wait for invite data to load before attempting auto-join
    if (isLoading) return;

    if (
      shouldAutoJoin && 
      user && 
      invite && 
      existingRoles !== undefined && // Wait for existing roles to load
      userProfile?.display_name && // Only auto-join if profile is complete
      !joined && 
      !joinMutation.isPending &&
      !autoJoinAttempted.current &&
      !nameValidationError
    ) {
      // Calculate roles to add - use invite role if user doesn't have it
      const inviteRole = invite.role as AppRole;
      const hasInviteRole = existingRoles?.includes(inviteRole);
      
      if (hasInviteRole) {
        // User already has this role - just navigate to the relevant destination
        autoJoinAttempted.current = true;
        sessionStorage.removeItem("autoJoinAfterAuth");
        toast({ title: `You're already a member of ${inviteEntityName}!` });
        setJoined(true);
        return;
      }
      
      // Set the role before joining
      if (selectedRoles.length === 0) {
        setSelectedRoles([inviteRole]);
        return; // Let the effect re-run after selectedRoles is set
      }
      
      autoJoinAttempted.current = true;
      sessionStorage.removeItem("autoJoinAfterAuth");
      // Small delay to ensure UI is ready
      setTimeout(() => {
        joinMutation.mutate();
      }, 500);
    }
  }, [shouldAutoJoin, user, invite, existingRoles, selectedRoles, joined, joinMutation, nameValidationError, toast, userProfile, location.pathname, navigate, profileLoading, isLoading, pendingInviteData]);

  // Handle photo consent given
  const handlePhotoConsentGiven = async () => {
    if (!user) return;
    
    await supabase
      .from("profiles")
      .update({ photo_consent_given_at: new Date().toISOString() })
      .eq("id", user.id);

    setShowPhotoConsent(false);

    if (pendingJoinRoles.length > 0) {
      try {
        const result = await executeJoin(pendingJoinRoles);
        const roleNames = result.map(r => roleLabels[r]).join(", ");
        toast({ title: `Successfully joined as ${roleNames}!` });
        if (!isPendingInvite && result.includes("parent") && !teamInvite?.metadata) {
          setShowChildStep(true);
        } else {
          setJoined(true);
        }
      } catch (error) {
        toast({ title: (error as Error).message || "Failed to join team", variant: "destructive" });
      }
    }
    setPendingJoinRoles([]);
  };

  // Handle photo consent declined
  const handlePhotoConsentDeclined = () => {
    setShowPhotoConsent(false);
    setPendingJoinRoles([]);
    toast({ 
      title: "Photo consent required", 
      description: "You need to provide consent for your child's photos to join as a parent.",
      variant: "destructive" 
    });
  };

  // Handle join action - redirect to auth if not logged in
  const handleJoinClick = async () => {
    // If not logged in, redirect to auth with auto-join flag
    if (!user) {
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      sessionStorage.setItem("authDefaultTab", "signup");
      navigate("/auth");
      return;
    }

    // Check if user needs to complete their profile first
    if (!userProfile?.display_name) {
      sessionStorage.setItem("redirectAfterAuth", location.pathname);
      sessionStorage.setItem("autoJoinAfterAuth", "true");
      if (pendingInviteData?.invited_label) {
        sessionStorage.setItem("inviteLabel", pendingInviteData.invited_label);
      }
      navigate("/complete-profile");
      return;
    }
    
    // User is logged in with complete profile - proceed with join (may need photo consent for parent role)
    joinMutation.mutate();
  };



  if (isLoading && !loadingTimeout) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading team invite...</p>
      </div>
    );
  }

  // Handle loading timeout - show error and retry option
  if (loadingTimeout && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Taking Too Long</h2>
            <p className="text-muted-foreground mb-4">
              We're having trouble loading this invite. This might be a network issue.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => navigate("/")}>Go Home</Button>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Regular team invites are now allowed (shareable links from AddTeamMemberSheet)

  if (inviteError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invite Link</h2>
            <p className="text-muted-foreground mb-4">
              This invite link is invalid or has been deleted.
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if pending invite is already used (only for pending invite routes)
  if (isPendingInvite && pendingInviteData && pendingInviteData.status !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invite Already Used</h2>
            <p className="text-muted-foreground mb-4">
              This invite link has already been used. Contact your {pendingInviteData?.team_id ? "team admin" : "club admin"} for a new invite.
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if invite is expired or maxed out (for regular team invites)
  const isExpired = !isPendingInvite && invite?.expires_at && new Date(invite.expires_at) < new Date();
  const isMaxedOut = !isPendingInvite && invite?.max_uses && invite.uses_count >= invite.max_uses;

  if (isExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invite Expired</h2>
            <p className="text-muted-foreground mb-4">
              This invite link has expired. Please ask your team admin for a new invite.
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isMaxedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invite Link Used</h2>
            <p className="text-muted-foreground mb-4">
              This invite link has reached its usage limit. Please ask your team admin for a new invite.
            </p>
            <Button onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user already has all selectable roles
  const availableRoles = selectableRoles.filter(role => !existingRoles.includes(role));
  const allRolesAssigned = !!invite?.role && existingRoles.includes(invite.role as AppRole);

  if (allRolesAssigned) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Already a Full Member</h2>
            <p className="text-muted-foreground mb-4">
              You already have all available roles in {inviteEntityName}.
            </p>
            <Button onClick={() => navigate(inviteDestination)}>View {inviteEntityLabel}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Notify team admins + coaches when a parent joins via a link
  // but skips the child-linking step, so someone can manually link them.
  const notifyAdminsOfUnlinkedParent = async () => {
    if (!user || !invite?.team_id) return;
    try {
      const parentName = userProfile?.display_name || user.email?.split("@")[0] || "A parent";
      const { data: staff } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", invite.team_id)
        .in("role", ["team_admin", "coach"]);
      const clubId = invite.teams?.club_id;
      let clubAdmins: { user_id: string }[] = [];
      if (clubId) {
        const { data } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId)
          .is("team_id", null)
          .eq("role", "club_admin");
        clubAdmins = data || [];
      }
      const recipientIds = Array.from(
        new Set(
          [...(staff || []), ...clubAdmins]
            .map((r) => r.user_id)
            .filter((id) => id && id !== user.id)
        )
      );
      if (recipientIds.length === 0) return;
      const message = `${parentName} joined ${inviteEntityName} as a parent but hasn't linked a child yet — tap to link them.`;
      const rows = recipientIds.map((uid) => ({
        user_id: uid,
        type: "membership",
        message,
        related_id: invite.team_id,
      }));
      await supabase.from("notifications").insert(rows);
    } catch (err) {
      console.error("[JoinTeam] Failed to notify admins of unlinked parent:", err);
    }
  };

  // Detect mini-league parent shareable join link (no team_id, child assigns to mini league)
  const leagueLinkMiniLeagueId =
    isPendingInvite &&
    (pendingInviteData?.metadata as any)?.kind === "mini_league_parent_join_link"
      ? ((pendingInviteData?.metadata as any)?.mini_league_id as string | undefined) ?? null
      : null;

  // Add child step for parent role (regular invite links + league parent join link)
  const handleAddChild = async () => {
    if (!user) return;
    if (!invite?.team_id && !leagueLinkMiniLeagueId) return;
    setAddingChild(true);
    try {
      let addedLabel = "";
      if (linkExistingChildId) {
        // Find existing child name for the summary
        const existing = (existingTeamChildren as any[]).find(c => c.id === linkExistingChildId);
        addedLabel = existing?.name || "Child";
        // Link existing child as guardian (team flow only)
        const { error: guardErr } = await supabase.from("child_guardians").insert({
          child_id: linkExistingChildId,
          guardian_id: user.id,
          relationship_type: "parent",
          is_primary: false,
        });
        if (guardErr && !guardErr.message?.includes("duplicate")) {
          throw guardErr;
        }
        toast({ title: `Linked to ${addedLabel}!` });
      } else if (childName.trim()) {
        addedLabel = childName.trim();
        // Create new child
        const { data: newChild, error: childErr } = await supabase
          .from("children")
          .insert({
            parent_id: user.id,
            name: addedLabel,
            year_of_birth: childYearOfBirth ? parseInt(childYearOfBirth) : null,
          })
          .select("id")
          .single();
        
        if (childErr) throw childErr;
        
        if (newChild?.id) {
          if (leagueLinkMiniLeagueId) {
            // Assign to mini league
            const { error: leagueErr } = await supabase
              .from("child_mini_league_assignments")
              .insert({
                child_id: newChild.id,
                mini_league_id: leagueLinkMiniLeagueId,
                ability_rating: 3,
              });
            if (leagueErr && !leagueErr.message?.includes("duplicate")) {
              console.error("[JoinTeam] Failed to assign child to league:", leagueErr.message);
            }
          } else if (invite?.team_id) {
            // Assign to team
            await supabase.from("child_team_assignments").insert({
              child_id: newChild.id,
              team_id: invite.team_id,
            });
          }
        }
        toast({ title: `${addedLabel} added to ${inviteEntityName}!` });
      }

      // Track the added child and reset the form so a sibling can be added next
      setAddedChildren(prev => [...prev, addedLabel]);
      setChildName("");
      setChildYearOfBirth("");
      setLinkExistingChildId(null);
      // Refresh the "existing children on team" list so the just-linked child
      // disappears from the choices.
      queryClient.invalidateQueries({ queryKey: ["team-children-for-linking", invite?.team_id] });
    } catch (err) {
      console.error("[JoinTeam] Error adding child:", err);
      toast({ title: "Failed to add child", variant: "destructive" });
    } finally {
      setAddingChild(false);
    }
  };

  const handleFinishChildStep = () => {
    setShowChildStep(false);
    setJoined(true);
  };

  const handleSkipChildStep = async () => {
    if (addedChildren.length > 0) {
      // They've already added at least one — treat skip as "done"
      handleFinishChildStep();
      return;
    }
    if (!leagueLinkMiniLeagueId) {
      // Team flow: nudge admins to link the parent's child manually
      await notifyAdminsOfUnlinkedParent();
      toast({
        title: "Team admins notified",
        description: "They'll help link your child to the team.",
      });
    } else {
      toast({
        title: "You can add your child anytime",
        description: "Tap your profile to add a child later.",
      });
    }
    setShowChildStep(false);
    setJoined(true);
  };

  if (showChildStep) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="h-10 w-10 text-primary mx-auto mb-2" />
            <CardTitle>You've joined as Parent!</CardTitle>
            <p className="text-sm text-muted-foreground">Now add your child to {inviteEntityName}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {existingTeamChildren.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Link to existing child on team</Label>
                <div className="space-y-1">
                  {existingTeamChildren.map((child: any) => (
                    <button
                      key={child.id}
                      onClick={() => {
                        setLinkExistingChildId(linkExistingChildId === child.id ? null : child.id);
                        if (linkExistingChildId !== child.id) setChildName("");
                      }}
                      className={`w-full flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                        linkExistingChildId === child.id 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm">{child.name}</span>
                      {child.year_of_birth && (
                        <span className="text-xs text-muted-foreground ml-auto">{child.year_of_birth}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or add new</span>
                  </div>
                </div>
              </div>
            )}

            {!linkExistingChildId && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="child-name" className="text-sm">Child's Name</Label>
                  <Input
                    id="child-name"
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                    placeholder="Enter child's name"
                  />
                </div>
                <div>
                  <Label htmlFor="child-yob" className="text-sm">Year of Birth (optional)</Label>
                  <Input
                    id="child-yob"
                    type="number"
                    value={childYearOfBirth}
                    onChange={(e) => setChildYearOfBirth(e.target.value)}
                    placeholder="e.g. 2015"
                    min="2000"
                    max={new Date().getFullYear()}
                  />
                </div>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleAddChild}
              disabled={addingChild || (!childName.trim() && !linkExistingChildId)}
            >
              {addingChild ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {linkExistingChildId ? "Link Child" : "Add Child"}
            </Button>

            <Button
              variant="ghost"
              className="w-full"
              onClick={handleSkipChildStep}
            >
              Skip for now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Joined successfully
  if (joined) {
    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-6">
            {/* Success message */}
            <div className="text-center">
              <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Welcome to the {inviteEntityLabel}!</h2>
              <p className="text-muted-foreground">
                You've successfully joined {inviteEntityName}.
              </p>
            </div>

            {/* App store download - only show if not a native app */}
            {!isNative && (
              <div className="border-t border-border pt-4">
                <AppStoreDownloadGuide compact />
              </div>
            )}

            <Button onClick={() => navigate(inviteDestination)} className="w-full" size="lg">
              View {inviteEntityLabel}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine current step for progress indicator
  const getCurrentStep = (): "view" | "install" | "auth" | "profile" | "done" => {
    // Check stored context for resume step
    const storedContext = getInviteFlowContext();
    if (storedContext?.currentStep && storedContext.currentStep !== "view") {
      return storedContext.currentStep;
    }
    
    return "view";
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Fixed progress indicator at top */}
      <InviteFlowProgress 
        currentStep={getCurrentStep()} 
        isExistingUser={!!user}
        className="fixed top-0 left-0 right-0"
      />
      
      <div className="flex-1 flex items-center justify-center p-4 pt-16">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Avatar className="h-20 w-20 border-2 border-primary/20">
              <AvatarImage src={invite.teams?.logo_url || invite.teams?.clubs?.logo_url || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                {(invite.teams?.name || invite.teams?.clubs?.name)?.charAt(0)?.toUpperCase() || "T"}
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle>Join {inviteEntityName}</CardTitle>
          {invite.teams?.clubs?.name && inviteEntityName !== invite.teams.clubs.name && (
            <p className="text-muted-foreground text-sm">{invite.teams.clubs.name}</p>
          )}
          {isPendingInvite && pendingInviteData?.invited_label && (
            <div className="mt-2 space-y-1">
              <p className="text-sm text-muted-foreground">
                Invite for: <span className="font-medium text-foreground">{pendingInviteData.invited_label}</span>
              </p>
              {!user && (
                <p className="text-xs text-muted-foreground">
                  Create an account to join as {pendingInviteData.invited_label}
                </p>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name validation warning - existing user trying to use new-signup-only link */}
          {nameValidationError && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Link Not Valid For Existing Users</p>
                <p className="text-muted-foreground mt-1">{nameValidationError}</p>
                <p className="text-muted-foreground mt-2">
                  Contact your {invite?.team_id ? "team admin" : "club admin"} to be added directly or to receive a general invite link.
                </p>
              </div>
            </div>
          )}

          {/* Fixed role display for admin invites - no role selection */}
          {/* Fixed role display - all invites use a predetermined role */}
          <div className="flex items-center justify-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">You'll join as:</span>
            <Badge variant="secondary">{roleLabels[invite.role as AppRole]}</Badge>
          </div>

          <Button 
            onClick={handleJoinClick} 
            disabled={joinMutation.isPending || (user && profileLoading) || (user && selectedRoles.length === 0 && !needsProfileCompletion) || (user && !!nameValidationError)}
            className="w-full"
            size="lg"
          >
            {(joinMutation.isPending || (user && profileLoading)) ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            {!joinMutation.isPending && !(user && profileLoading) && (
                !user 
                ? "Create Account to Join"
                : nameValidationError 
                  ? "Cannot Join - Name Mismatch"
                  : needsProfileCompletion
                    ? "Complete Profile to Join"
                    : `Join as ${roleLabels[invite.role as AppRole]}`
            )}
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/")}
            className="w-full"
          >
            Cancel
          </Button>

          {/* App store download instructions - show on join form if not a native app */}
          {!(window as any).Capacitor?.isNativePlatform?.() && (
            <div className="border-t border-border pt-4 mt-4">
              <AppStoreDownloadGuide compact />
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* Photo Consent Dialog for Parents */}
      <PhotoConsentDialog
        open={showPhotoConsent}
        onConsentGiven={handlePhotoConsentGiven}
        onDecline={handlePhotoConsentDeclined}
      />
    </div>
  );
}
