import { withFeatureBackend } from '@/live/featureRouter';
import { readLiveEventCancellationAudience } from '@/live/features/events';
import { resolveAuthBackend } from '@/live/authBackendMode';
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

type EventCancellationRecipientScope = {
  open: boolean;
  eventId?: string;
  teamId: string | null;
  clubId: string;
  miniLeagueId?: string | null;
};

export function useEventCancellationRecipients({
  open,
  eventId,
  teamId,
  clubId,
  miniLeagueId,
}: EventCancellationRecipientScope) {
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recipientLookupFailed, setRecipientLookupFailed] = useState(false);
  const [recipientLookupReason, setRecipientLookupReason] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open) {
      requestIdRef.current++;
      return;
    }

    const requestId = ++requestIdRef.current;
    void fetchMemberCount(requestId);

    async function fetchMemberCount(reqId: number): Promise<void> {
      setIsLoading(true);
      setRecipientLookupFailed(false);
      setRecipientLookupReason(null);
      const isCurrent = () => requestIdRef.current === reqId;

      try {
        if (resolveAuthBackend() === 'icp') {
          if (!eventId) throw new Error('Missing event ID');
          const read = () => withFeatureBackend('events', {
            supabase: async () => 0,
            icp: ctx => readLiveEventCancellationAudience(ctx, eventId),
          }, { eventId });
          // A read only: one retry absorbs a membership check that raced a
          // concurrent change ("Event or permission changed").
          const count = await read().catch(async (first) => {
            if (!isCurrent()) throw first;
            return read();
          });
          if (isCurrent()) setMemberCount(count);
          return;
        }

        if (miniLeagueId) {
          // A canister roster cannot establish the full push audience here.
          // Keep the count unknown rather than count only the caller's roles.
          if (isFeatureRoutedToIcp("mini_leagues")) {
            if (!isCurrent()) return;
            setMemberCount(null);
            setRecipientLookupFailed(true);
            return;
          }
          const { data: league, error: leagueError } = await supabase
            .from("mini_leagues")
            .select("club_id")
            .eq("id", miniLeagueId)
            .maybeSingle();
          if (leagueError) throw leagueError;

          if (!league) {
            throw new Error("Mini league not found");
          }

          const { data: playersData, error: playersError } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null);
          if (playersError) throw playersError;

          const parentIds = [
            ...new Set(
              (playersData?.map(player => player.parent_user_id).filter(Boolean) as string[]) || [],
            ),
          ];

          const { data: adminRoles, error: adminError } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          if (adminError) throw adminError;

          const adminIds = adminRoles?.map(role => role.user_id) || [];
          const allUserIds = [...new Set([...parentIds, ...adminIds])];
          if (!isCurrent()) return;
          setMemberCount(allUserIds.length);
        } else {
          let memberQuery = supabase.from("user_roles").select("user_id");
          if (teamId) {
            memberQuery = memberQuery.eq("team_id", teamId);
          } else {
            memberQuery = memberQuery.eq("club_id", clubId);
          }

          const { data: members, error: membersError } = await memberQuery;
          if (membersError) throw membersError;
          const uniqueMembers = [...new Set(members?.map(member => member.user_id) || [])];
          if (!isCurrent()) return;
          setMemberCount(uniqueMembers.length);
        }
      } catch (error) {
        console.error("Failed to fetch member count:", error);
        if (!isCurrent()) return;
        setMemberCount(null);
        setRecipientLookupFailed(true);
        setRecipientLookupReason(describeRecipientLookupFailure(error));
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    }
  }, [open, eventId, teamId, clubId, miniLeagueId]);

  return { memberCount, isLoading, recipientLookupFailed, recipientLookupReason };
}

/** Plain-English reason for the cancel dialog; raw text stays in the console. */
export function describeRecipientLookupFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/management forbidden|permission changed/i.test(raw)) return "Your coach or admin role for this team couldn't be confirmed.";
  if (/not found/i.test(raw)) return "This event couldn't be found on the club's service.";
  if (/authority unavailable|membership unavailable|audience unavailable|authority required/i.test(raw)) return "The club's member list couldn't be reached.";
  if (/exceeds bound|exceeds 500/i.test(raw)) return "This team has too many members to check here.";
  if (/locked|fenced|capacity/i.test(raw)) return "The club is temporarily locked for maintenance.";
  if (/Internet Identity|sign-?in|session/i.test(raw)) return "Your sign-in needs refreshing.";
  return "The member check didn't respond.";
}
