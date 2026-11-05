-- Phase 1: Pro access SQL helpers (not yet called by anything)

create or replace function public.has_active_pro_for_club(_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_subscriptions cs
    where cs.club_id = _club_id
      and (cs.expires_at is null or cs.expires_at > now())
      and (
        coalesce(cs.is_pro, false)
        or coalesce(cs.is_pro_football, false)
        or coalesce(cs.admin_pro_override, false)
        or coalesce(cs.admin_pro_football_override, false)
      )
  )
  or public.has_role(auth.uid(), 'app_admin'::app_role, null, null);
$$;

create or replace function public.has_active_pro_for_team(_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_active_pro_for_club(
    (select club_id from public.teams where id = _team_id)
  );
$$;

revoke all on function public.has_active_pro_for_club(uuid) from public;
revoke all on function public.has_active_pro_for_team(uuid) from public;
grant execute on function public.has_active_pro_for_club(uuid) to authenticated, service_role;
grant execute on function public.has_active_pro_for_team(uuid) to authenticated, service_role;