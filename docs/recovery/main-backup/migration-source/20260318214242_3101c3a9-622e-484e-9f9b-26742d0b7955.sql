-- 1. Backfill missing club_id on user_roles that have a team_id but no club_id
UPDATE public.user_roles ur
SET club_id = t.club_id
FROM public.teams t
WHERE ur.team_id = t.id
  AND ur.club_id IS NULL
  AND t.club_id IS NOT NULL;

-- 2. Update shares_team_or_club_with to also resolve club membership through teams
CREATE OR REPLACE FUNCTION public.shares_team_or_club_with(_viewer_id uuid, _profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles p
    WHERE p.id = _profile_id
    AND (
      (p.profile_visibility = 'public' AND (
        -- Direct club match
        EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON ur1.club_id = ur2.club_id AND ur1.club_id IS NOT NULL
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
        )
        -- Or club match via team->club relationship
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON true
          JOIN public.teams t1 ON t1.id = ur1.team_id
          JOIN public.teams t2 ON t2.id = ur2.team_id
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
            AND t1.club_id = t2.club_id AND t1.club_id IS NOT NULL
        )
      ))
      OR
      (p.profile_visibility = 'team_members_only' AND (
        -- Direct team match
        EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON ur1.team_id = ur2.team_id AND ur1.team_id IS NOT NULL
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
        )
        -- Direct club match
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON ur1.club_id = ur2.club_id AND ur1.club_id IS NOT NULL
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
        )
        -- Or club match via team->club relationship
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON true
          JOIN public.teams t1 ON t1.id = ur1.team_id
          JOIN public.teams t2 ON t2.id = ur2.team_id
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
            AND t1.club_id = t2.club_id AND t1.club_id IS NOT NULL
        )
        -- Or viewer has club role and target has team in that club
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON true
          JOIN public.teams t ON t.id = ur2.team_id
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
            AND ur1.club_id = t.club_id AND ur1.club_id IS NOT NULL
        )
        -- Or target has club role and viewer has team in that club
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur1
          JOIN public.user_roles ur2 ON true
          JOIN public.teams t ON t.id = ur1.team_id
          WHERE ur1.user_id = _viewer_id AND ur2.user_id = _profile_id
            AND ur2.club_id = t.club_id AND ur2.club_id IS NOT NULL
        )
      ))
    )
  )
$function$;