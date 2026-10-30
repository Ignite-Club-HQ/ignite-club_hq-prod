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
        OR public.is_competition_admin(_user_id, _competition_id)
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