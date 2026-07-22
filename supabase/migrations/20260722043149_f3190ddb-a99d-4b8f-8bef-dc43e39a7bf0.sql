
-- Restore can_view_competition to its original behaviour (no direct created_by branch);
-- creator visibility is now enforced directly on the SELECT policy row expression so
-- INSERT ... RETURNING resolves reliably without relying on a secondary subquery
-- observing the freshly-inserted row.
CREATE OR REPLACE FUNCTION public.can_view_competition(_user_id uuid, _competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.competitions c
    WHERE c.id = _competition_id
      AND (
        c.visibility = 'public'
        OR public.is_competition_admin(_user_id, c.id)
        OR EXISTS (
          SELECT 1
          FROM public.competition_entries ce
          JOIN public.user_roles ur ON ur.team_id = ce.team_id
          WHERE ce.competition_id = c.id AND ur.user_id = _user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.competition_entries ce
          JOIN public.teams t ON t.id = ce.team_id
          JOIN public.user_roles ur ON ur.club_id = t.club_id AND ur.user_id = _user_id
          WHERE ce.competition_id = c.id
            AND ur.role IN ('club_admin','app_admin','association_admin')
        )
      )
  );
$function$;

-- Replace SELECT policy so the creator clause is evaluated directly on the row.
DROP POLICY IF EXISTS "View competitions" ON public.competitions;
CREATE POLICY "View competitions"
ON public.competitions
FOR SELECT
USING (
  created_by = (SELECT auth.uid())
  OR public.can_view_competition((SELECT auth.uid()), id)
);

-- INSERT policy is unchanged (kept strict): creator must be auth.uid() AND authorised to organise for organizer_club_id.
