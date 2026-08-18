-- LOCAL SECURITY-TEST PARITY ONLY. NOT A DEPLOYMENT MIGRATION.
-- Mirrors the manager read policies and latest atomic move/swap functions
-- added by the reviewed production migrations on 2026-07-30.

create policy local_event_groups_manager_select on public.event_groups
for select to authenticated
using (public.can_manage_event_groups(auth.uid(), event_id));

create policy local_event_group_players_manager_select on public.event_group_players
for select to authenticated
using (
  exists (
    select 1 from public.event_groups eg
    where eg.id = event_group_players.group_id
      and public.can_manage_event_groups(auth.uid(), eg.event_id)
  )
);

create or replace function public.move_event_group_player(
  p_player_id uuid,
  p_from_group_id uuid,
  p_to_group_id uuid,
  p_to_team text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_to_team is null or p_to_team not in ('a', 'b') then
    raise exception 'Invalid team value: %', p_to_team;
  end if;
  update public.event_group_players
    set group_id = p_to_group_id, team = p_to_team
    where group_id = p_from_group_id and player_id = p_player_id;
  if not found then raise exception 'Player not found in source group'; end if;
end;
$$;

revoke all on function public.move_event_group_player(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.move_event_group_player(uuid, uuid, uuid, text) to authenticated, service_role;

create or replace function public.swap_event_group_players(
  p_player1_id uuid,
  p_player1_group_id uuid,
  p_player1_team text,
  p_player2_id uuid,
  p_player2_group_id uuid,
  p_player2_team text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_player1_team is not null and p_player1_team not in ('a', 'b') then
    raise exception 'Invalid team value: %', p_player1_team;
  end if;
  if p_player2_team is not null and p_player2_team not in ('a', 'b') then
    raise exception 'Invalid team value: %', p_player2_team;
  end if;
  if p_player1_id = p_player2_id then
    raise exception 'Cannot swap a player with themselves';
  end if;

  update public.event_group_players
    set group_id = p_player2_group_id, team = p_player2_team
    where group_id = p_player1_group_id and player_id = p_player1_id;
  if not found then raise exception 'Player not found in group'; end if;

  update public.event_group_players
    set group_id = p_player1_group_id, team = p_player1_team
    where group_id = p_player2_group_id and player_id = p_player2_id;
  if not found then raise exception 'Player not found in group'; end if;
end;
$$;

revoke all on function public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.swap_event_group_players(uuid, uuid, text, uuid, uuid, text) to authenticated, service_role;

create or replace function public.replace_event_groups(
  p_event_id uuid,
  p_groups jsonb,
  p_delete_existing boolean default true
)
returns uuid[]
language plpgsql
set search_path = public
as $$
declare
  g jsonb;
  p jsonb;
  new_id uuid;
  ids uuid[] := array[]::uuid[];
begin
  if p_event_id is null then raise exception 'event id is required'; end if;
  if jsonb_typeof(p_groups) <> 'array' then raise exception 'groups payload must be a JSON array'; end if;

  if p_delete_existing then
    delete from public.event_groups where event_id = p_event_id;
  end if;

  for g in select * from jsonb_array_elements(p_groups)
  loop
    insert into public.event_groups (
      event_id, name, ability_band, pitch_name, display_order, team_a_color, team_b_color
    ) values (
      p_event_id,
      coalesce(g->>'name', 'Match'),
      nullif(g->>'ability_band', ''),
      nullif(g->>'pitch_name', ''),
      nullif(g->>'display_order', '')::int,
      nullif(g->>'team_a_color', ''),
      nullif(g->>'team_b_color', '')
    ) returning id into new_id;
    ids := ids || new_id;

    for p in select * from jsonb_array_elements(coalesce(g->'players', '[]'::jsonb))
    loop
      if (p->>'team') is not null and (p->>'team') not in ('a', 'b') then
        raise exception 'Invalid team value: %', p->>'team';
      end if;
      insert into public.event_group_players (group_id, player_id, team)
      values (new_id, (p->>'player_id')::uuid, nullif(p->>'team', ''));
    end loop;
  end loop;
  return ids;
end;
$$;

revoke all on function public.replace_event_groups(uuid, jsonb, boolean) from public, anon;
grant execute on function public.replace_event_groups(uuid, jsonb, boolean) to authenticated, service_role;
