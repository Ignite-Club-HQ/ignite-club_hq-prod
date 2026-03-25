import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Silently auto-accepts any pending invites for the logged-in user.
 * No dialog is shown — invites are processed automatically in the background.
 */
export function PendingInviteWelcomeDialog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["pending-invites-for-user", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("pending_invites")
        .select(`
          id,
          role,
          invite_token,
          team_id,
          club_id,
          invited_label,
          metadata,
          teams:team_id (
            name,
            club_id,
            clubs:club_id (
              name
            )
          ),
          clubs:club_id (
            name
          )
        `)
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .limit(10);

      if (error) {
        console.error("[InviteAutoAccept] Error fetching invites:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const createChildrenFromMetadata = async (
    childrenData: any[], parentId: string, teamId: string | null
  ) => {
    for (const childData of childrenData) {
      const { data: newChild, error: childError } = await supabase
        .from("children")
        .insert({
          parent_id: parentId,
          name: childData.name,
          year_of_birth: childData.yearOfBirth,
        })
        .select("id")
        .single();

      if (childError) {
        console.error("[InviteAutoAccept] Failed to create child:", childError.message);
        continue;
      }

      if (newChild?.id && teamId) {
        await supabase.from("child_team_assignments").insert({
          child_id: newChild.id,
          team_id: teamId,
        });
      }
    }
  };

  useEffect(() => {
    if (!user || pendingInvites.length === 0) return;

    const autoAcceptInvites = async () => {
      for (const invite of pendingInvites) {
        try {
          // Resolve club_id
          let clubId: string | null = invite.club_id ?? null;
          if (!clubId && invite.team_id) {
            clubId = (invite.teams as any)?.club_id ?? null;
          }

          // Check if role already exists
          const roleQuery = supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("role", invite.role as any);

          if (invite.team_id) {
            roleQuery.eq("team_id", invite.team_id);
          } else if (clubId) {
            roleQuery.eq("club_id", clubId).is("team_id", null);
          }

          const { data: existingRole } = await roleQuery.maybeSingle();

          if (existingRole) {
            // Already a member — just mark invite as accepted
            await supabase
              .from("pending_invites")
              .update({ status: "accepted", accepted_at: new Date().toISOString() })
              .eq("id", invite.id);
            console.log("[InviteAutoAccept] Invite already fulfilled, marked accepted:", invite.id);
            continue;
          }

          // Insert the role
          const { error: roleError } = await supabase
            .from("user_roles")
            .insert({
              user_id: user.id,
              role: invite.role as any,
              team_id: invite.team_id || null,
              club_id: clubId || null,
            });

          if (roleError) {
            console.error("[InviteAutoAccept] Failed to assign role:", roleError);
            continue;
          }

          // Mark invite as accepted
          await supabase
            .from("pending_invites")
            .update({
              status: "accepted",
              accepted_at: new Date().toISOString(),
              invited_user_id: user.id,
            })
            .eq("id", invite.id);

          const entityName =
            (invite.teams as any)?.name ||
            (invite.teams as any)?.clubs?.name ||
            (invite.clubs as any)?.name ||
            "organization";

          console.log("[InviteAutoAccept] Auto-accepted invite for:", entityName, "role:", invite.role);

          // Handle children from invite metadata (if parent role with children)
          if (
            invite.metadata &&
            invite.role === "parent"
          ) {
            const meta = invite.metadata as any;
            const linkedToken = meta?.linked_invite_token;
            const childrenData = meta?.children || [];

            if (linkedToken && invite.team_id && childrenData.length > 0) {
              // Check if the other parent's invite was already accepted
              const { data: otherInvite } = await supabase
                .from("pending_invites")
                .select("invited_user_id, status")
                .eq("invite_token", linkedToken)
                .single();

              const otherAccepted = otherInvite?.status === "accepted" && otherInvite?.invited_user_id;

              if (otherAccepted) {
                // Other parent accepted first — find their children in this team and link as guardian
                const { data: existingChildren } = await supabase
                  .from("children")
                  .select("id, name, child_team_assignments!inner(team_id)")
                  .eq("parent_id", otherInvite.invited_user_id)
                  .eq("child_team_assignments.team_id", invite.team_id);

                if (existingChildren && existingChildren.length > 0) {
                  for (const child of existingChildren) {
                    await supabase.from("child_guardians").insert({
                      child_id: child.id,
                      guardian_id: user.id,
                      relationship_type: "parent",
                      is_primary: false,
                    }).then(({ error: guardErr }) => {
                      if (guardErr && !guardErr.message?.includes("duplicate")) {
                        console.error("[InviteAutoAccept] Failed to link guardian:", guardErr.message);
                      }
                    });
                  }
                  console.log("[InviteAutoAccept] Linked as guardian to", existingChildren.length, "existing children");
                } else {
                  // Edge case: other parent accepted but children not found — create them
                  await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
                }
              } else {
                // This parent is first to accept — create children normally
                await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
              }
            } else if (childrenData.length > 0) {
              // No linked invite — standard single parent flow
              await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
            }
          }
        } catch (err) {
          console.error("[InviteAutoAccept] Unexpected error for invite:", invite.id, err);
        }
      }

      // Refresh roles/membership queries after processing
      queryClient.invalidateQueries({ queryKey: ["user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites-for-user"] });
    };

    autoAcceptInvites();
  }, [user, pendingInvites, queryClient]);

  // No UI rendered — purely background logic
  return null;
}
