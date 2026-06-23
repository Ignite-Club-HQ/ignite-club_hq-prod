import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { useClubTheme } from "@/hooks/useClubTheme";
import { seedClubFilterFromInvite } from "@/lib/seedClubFilterFromInvite";

/**
 * Silently auto-accepts any pending invites for the logged-in user.
 * No dialog is shown — invites are processed automatically in the background.
 */
export function PendingInviteWelcomeDialog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { setActiveClubTheme } = useClubTheme();

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
    const createdChildIds: string[] = [];
    for (const childData of childrenData) {
      let childId = childData.existingChildId;

      if (childId) {
        // Link to existing child as guardian instead of creating duplicate
        const { error: guardErr } = await supabase.from("child_guardians").insert({
          child_id: childId,
          guardian_id: parentId,
          relationship_type: "parent",
          is_primary: false,
        });
        if (guardErr && !guardErr.message?.includes("duplicate")) {
          console.error("[InviteAutoAccept] Failed to link guardian to existing child:", guardErr.message);
        }
        // Ensure team assignment exists
        if (teamId) {
          const { data: existing } = await supabase
            .from("child_team_assignments")
            .select("id")
            .eq("child_id", childId)
            .eq("team_id", teamId)
            .maybeSingle();
          if (!existing) {
            await supabase.from("child_team_assignments").insert({
              child_id: childId,
              team_id: teamId,
            });
          }
        }
        createdChildIds.push(childId);
      } else {
        // Check if a child with the same name already exists on this team
        let existingChildOnTeam: any = null;
        if (teamId) {
          const { data: matches } = await supabase
            .from("child_team_assignments")
            .select("child_id, children!inner(id, name)")
            .eq("team_id", teamId);
          existingChildOnTeam = (matches || []).find(
            (m: any) => m.children?.name?.toLowerCase().trim() === childData.name?.toLowerCase().trim()
          );
        }

        if (existingChildOnTeam) {
          // Child already exists on team — link as guardian instead of creating duplicate
          const existingId = existingChildOnTeam.child_id;
          await supabase.from("child_guardians").insert({
            child_id: existingId,
            guardian_id: parentId,
            relationship_type: "parent",
            is_primary: false,
          }).then(({ error: guardErr }) => {
            if (guardErr && !guardErr.message?.includes("duplicate")) {
              console.error("[InviteAutoAccept] Failed to link guardian to existing child:", guardErr.message);
            }
          });
          createdChildIds.push(existingId);
        } else {
          // Create new child
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
          if (newChild?.id) createdChildIds.push(newChild.id);
        }
      }
    }
    return createdChildIds;
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
          const parentInviteMeta = invite.metadata as any;
          const needsParentLinking = invite.role === "parent" && (
            !!parentInviteMeta?.guardian_child_id ||
            !!parentInviteMeta?.child_id ||
            Array.isArray(parentInviteMeta?.children)
          );

          if (!existingRole) {
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
          } else if (!needsParentLinking) {
            // Already a member and nothing else to sync — just mark invite as accepted
            await supabase
              .from("pending_invites")
              .update({ status: "accepted", accepted_at: new Date().toISOString() })
              .eq("id", invite.id);
            console.log("[InviteAutoAccept] Invite already fulfilled, marked accepted:", invite.id);
            continue;
          } else {
            console.log("[InviteAutoAccept] Role already exists, continuing with parent-link sync:", invite.id);
          }

          const entityName =
            (invite.teams as any)?.name ||
            (invite.teams as any)?.clubs?.name ||
            (invite.clubs as any)?.name ||
            "organization";

          console.log("[InviteAutoAccept] Auto-accepted invite for:", entityName, "role:", invite.role);

          // Handle guardian invite (parent-to-parent flow)
          if (invite.metadata && invite.role === "parent") {
            const meta = invite.metadata as any;

            // Parent-to-parent invite: link as guardian to existing child
            if (meta.guardian_child_id) {
              const childId = meta.guardian_child_id;
              // Insert as guardian (non-primary)
              const { error: guardErr } = await supabase.from("child_guardians").insert({
                child_id: childId,
                guardian_id: user.id,
                relationship_type: "parent",
                is_primary: false,
              });
              if (guardErr && !guardErr.message?.includes("duplicate")) {
                console.error("[InviteAutoAccept] Failed to link guardian:", guardErr.message);
              } else {
                console.log("[InviteAutoAccept] Linked as guardian to child:", childId);
              }

              // Assign parent role for ALL teams the child is in (not just the invite's team)
              const allTeamIds: string[] = meta.guardian_all_team_ids || (invite.team_id ? [invite.team_id] : []);
              
              // If no team IDs in metadata, look up child's current team assignments
              let resolvedTeamIds = allTeamIds;
              if (resolvedTeamIds.length === 0) {
                const { data: assignments } = await supabase
                  .from("child_team_assignments")
                  .select("team_id")
                  .eq("child_id", childId);
                resolvedTeamIds = assignments?.map(a => a.team_id) || [];
              }

              for (const tid of resolvedTeamIds) {
                // Get club_id for the team
                const { data: teamData } = await supabase
                  .from("teams")
                  .select("club_id")
                  .eq("id", tid)
                  .single();

                const teamClubId = teamData?.club_id || clubId;

                // Check if role already exists for this team
                const { data: existingTeamRole } = await supabase
                  .from("user_roles")
                  .select("id")
                  .eq("user_id", user.id)
                  .eq("role", "parent" as any)
                  .eq("team_id", tid)
                  .maybeSingle();

                if (!existingTeamRole) {
                  await supabase.from("user_roles").insert({
                    user_id: user.id,
                    role: "parent" as any,
                    team_id: tid,
                    club_id: teamClubId,
                  });
                  console.log("[InviteAutoAccept] Assigned parent role for team:", tid);
                }
              }

              // Send child-added email to the new guardian
              try {
                const childName = meta.guardian_child_name || "your child";
                // Get team and club info for the email
                const firstTeamId = resolvedTeamIds[0];
                if (firstTeamId) {
                  const { data: teamInfo } = await supabase
                    .from("teams")
                    .select("name, club_id, clubs:club_id(name, logo_url, contact_email)")
                    .eq("id", firstTeamId)
                    .single();

                  if (teamInfo) {
                    const club = teamInfo.clubs as any;
                    const inviteLink = `${window.location.origin}/teams/${firstTeamId}`;

                    await supabase.functions.invoke("send-email", {
                      body: {
                        to: null, // Will use the user's auth email
                        toUserId: user.id,
                        subject: `${club?.name || 'Your club'}: You've been linked to ${childName}'s team ⚽`,
                        template: "child-added",
                        senderName: club?.name || undefined,
                        replyTo: club?.contact_email || undefined,
                        templateData: {
                          recipientName: user.user_metadata?.display_name || "there",
                          teamName: teamInfo.name,
                          clubName: club?.name || "The Club",
                          inviteLink,
                          clubLogoUrl: club?.logo_url || undefined,
                          childrenNames: [childName],
                        },
                      },
                    });
                    console.log("[InviteAutoAccept] Sent child-added email for guardian link");
                  }
                }
              } catch (emailErr) {
                console.error("[InviteAutoAccept] Failed to send child-added email:", emailErr);
              }

              await supabase
                .from("pending_invites")
                .update({
                  status: "accepted",
                  accepted_at: new Date().toISOString(),
                  invited_user_id: user.id,
                })
                .eq("id", invite.id);

              continue; // Skip the standard children creation flow
            }

            // Mini-league invite: child already exists, link parent as guardian
            if (meta.child_id && meta.mini_league_id) {
              const childId = meta.child_id;
              const miniLeagueId = meta.mini_league_id;

              console.log("[InviteAutoAccept] Mini-league invite: linking parent to existing child:", childId);

              // Transfer child ownership to this parent (they are the real parent)
              await supabase
                .from("children")
                .update({ parent_id: user.id })
                .eq("id", childId);

              // Ensure mini league assignment exists
              const { data: existingLeagueAssignment } = await supabase
                .from("child_mini_league_assignments")
                .select("id")
                .eq("child_id", childId)
                .eq("mini_league_id", miniLeagueId)
                .maybeSingle();

              if (!existingLeagueAssignment) {
                await supabase.from("child_mini_league_assignments").insert({
                  child_id: childId,
                  mini_league_id: miniLeagueId,
                  ability_rating: 3,
                });
                console.log("[InviteAutoAccept] Created mini league assignment for child:", childId);
              }

              // Update mini_league_players to link parent_user_id
              if (meta.player_id) {
                await supabase
                  .from("mini_league_players")
                  .update({ parent_user_id: user.id })
                  .eq("id", meta.player_id);
              } else {
                await supabase
                  .from("mini_league_players")
                  .update({ parent_user_id: user.id })
                  .eq("child_id", childId)
                  .eq("mini_league_id", miniLeagueId);
              }

              // Send notification
              const playerName = meta.player_name || meta.children?.[0]?.name || "Your child";
              await supabase.from("notifications").insert({
                user_id: user.id,
                type: "membership",
                message: `${playerName} has been added to a league`,
                related_id: miniLeagueId,
              });

              // Send child-added email
              try {
                const { data: leagueInfo } = await supabase
                  .from("mini_leagues")
                  .select("name, club_id, clubs:club_id(name, logo_url, contact_email)")
                  .eq("id", miniLeagueId)
                  .single();

                if (leagueInfo) {
                  const club = leagueInfo.clubs as any;
                  const inviteLink = `${window.location.origin}/mini-leagues/${miniLeagueId}`;

                  await supabase.functions.invoke("send-email", {
                    body: {
                      toUserId: user.id,
                      subject: `${club?.name || 'Your club'}: ${playerName} has been added to ${leagueInfo.name} ⚽`,
                      template: "child-added",
                      senderName: club?.name || undefined,
                      replyTo: club?.contact_email || undefined,
                      templateData: {
                        recipientName: user.user_metadata?.display_name || "there",
                        teamName: leagueInfo.name,
                        clubName: club?.name || "The Club",
                        inviteLink,
                        clubLogoUrl: club?.logo_url || undefined,
                        childrenNames: [playerName],
                      },
                    },
                  });
                  console.log("[InviteAutoAccept] Sent child-added email for mini-league");
                }
              } catch (emailErr) {
                console.error("[InviteAutoAccept] Failed to send mini-league child-added email:", emailErr);
              }

              await supabase
                .from("pending_invites")
                .update({
                  status: "accepted",
                  accepted_at: new Date().toISOString(),
                  invited_user_id: user.id,
                })
                .eq("id", invite.id);

              continue; // Skip standard children flow
            }

            // Standard dual-parent invite flow with children metadata
            const linkedToken = meta.linked_invite_token;
            const childrenData = meta.children || [];

            if (linkedToken && invite.team_id && childrenData.length > 0) {
              // Check if the other parent's invite was already accepted
              const { data: otherInvite } = await supabase
                .from("pending_invites")
                .select("invited_user_id, status")
                .eq("invite_token", linkedToken)
                .maybeSingle();

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
              const createdIds = await createChildrenFromMetadata(childrenData, user.id, invite.team_id);
              
              // If a second parent was added directly (existing user), link them as guardian
              if (meta.second_parent_user_id && createdIds.length > 0) {
                for (const childId of createdIds) {
                  await supabase.from("child_guardians").insert({
                    child_id: childId,
                    guardian_id: meta.second_parent_user_id,
                    relationship_type: "parent",
                    is_primary: false,
                  }).then(({ error: guardErr }) => {
                    if (guardErr && !guardErr.message?.includes("duplicate")) {
                      console.error("[InviteAutoAccept] Failed to link second parent:", guardErr.message);
                    }
                  });
                }
                console.log("[InviteAutoAccept] Linked second parent", meta.second_parent_user_id, "to", createdIds.length, "children");

                // Send child-added email to the second parent
                try {
                  const childNames = childrenData.map((c: any) => c.name);
                  const firstTeamId = invite.team_id;
                  if (firstTeamId && childNames.length > 0) {
                    const { data: teamInfo } = await supabase
                      .from("teams")
                      .select("name, club_id, clubs:club_id(name, logo_url, contact_email)")
                      .eq("id", firstTeamId)
                      .single();

                    if (teamInfo) {
                      const club = teamInfo.clubs as any;
                      await supabase.functions.invoke("send-email", {
                        body: {
                          toUserId: meta.second_parent_user_id,
                          subject: childNames.length === 1
                            ? `${club?.name || 'Your club'}: See which team ${childNames[0]} is in ⚽`
                            : `${club?.name || 'Your club'}: Your children have been added to ${teamInfo.name} ⚽`,
                          template: "child-added",
                          senderName: club?.name || undefined,
                          replyTo: club?.contact_email || undefined,
                          templateData: {
                            recipientName: "Parent",
                            childrenNames: childNames,
                            teamName: teamInfo.name,
                            clubName: club?.name || "The Club",
                            clubLogoUrl: club?.logo_url || undefined,
                            inviteLink: `${window.location.origin}/teams/${firstTeamId}`,
                          },
                        },
                      });
                      console.log("[InviteAutoAccept] Sent child-added email to second parent:", meta.second_parent_user_id);
                    }
                  }
                } catch (emailErr) {
                  console.error("[InviteAutoAccept] Failed to send child-added email to second parent:", emailErr);
                }
              }
            }
          }

          await supabase
            .from("pending_invites")
            .update({
              status: "accepted",
              accepted_at: new Date().toISOString(),
              invited_user_id: user.id,
            })
            .eq("id", invite.id);
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
