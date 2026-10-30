create or replace function public.user_has_any_club_pro(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.user_roles ur
            where ur.user_id = _user_id and ur.role = 'app_admin')
    or exists (
      select 1
      from public.user_roles ur
      left join public.teams t on t.id = ur.team_id
      join public.club_subscriptions cs
        on cs.club_id = coalesce(ur.club_id, t.club_id)
      where ur.user_id = _user_id
        and coalesce(ur.club_id, t.club_id) is not null
        and (cs.is_pro = true
             or cs.is_pro_football = true
             or cs.admin_pro_override = true
             or cs.admin_pro_football_override = true)
        and (cs.expires_at is null or cs.expires_at > now())
    );
$$;

revoke all on function public.user_has_any_club_pro(uuid) from public;
grant execute on function public.user_has_any_club_pro(uuid) to authenticated, service_role;