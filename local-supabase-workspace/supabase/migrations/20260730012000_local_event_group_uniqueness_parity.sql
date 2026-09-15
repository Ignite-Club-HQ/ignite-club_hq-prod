-- LOCAL SECURITY-TEST PARITY ONLY. NOT A DEPLOYMENT MIGRATION.
-- Mirrors the reviewed production duplicate-assignment invariant and hardened
-- replacement RPC using only synthetic local schema/data.

do $$
declare
  v_pairs int;
  v_rows int;
begin
  select count(*), coalesce(sum(c), 0) into v_pairs, v_rows
  from (
    select eg.event_id, egp.player_id, count(*) as c
    from public.event_group_players egp
    join public.event_groups eg on eg.id = egp.group_id
    group by 1, 2 having count(*) > 1
  ) d;
  if v_pairs > 0 then
    raise exception 'Aborting: % duplicate event/player pair(s) covering % assignment row(s) must be remediated before the strict invariant can be enforced.', v_pairs, v_rows;
  end if;
end $$;

alter table public.event_groups
  add constraint event_groups_id_event_id_key unique (id, event_id);

alter table public.event_group_players add column if not exists event_id uuid;
update public.event_group_players egp set event_id = eg.event_id
from public.event_groups eg
where eg.id = egp.group_id and egp.event_id is distinct from eg.event_id;
alter table public.event_group_players alter column event_id set not null;

alter table public.event_group_players
  add constraint event_group_players_group_event_fkey
  foreign key (group_id, event_id)
  references public.event_groups (id, event_id)
  on update cascade on delete cascade;

alter table public.event_group_players
  add constraint event_group_players_event_id_player_id_key unique (event_id, player_id);

create or replace function public.enforce_unique_event_player_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_conflict_id uuid;
begin
  select eg.event_id into v_event_id from public.event_groups eg where eg.id = new.group_id;
  if v_event_id is null then
    raise exception 'Invalid destination match group' using errcode = '23503';
  end if;
  new.event_id := v_event_id;
  if new.player_id is null then return new; end if;

  perform pg_advisory_xact_lock(hashtext(v_event_id::text), hashtext(new.player_id::text));
  select egp.id into v_conflict_id
  from public.event_group_players egp
  where egp.event_id = v_event_id
    and egp.player_id = new.player_id
    and egp.id is distinct from new.id
  limit 1;
  if v_conflict_id is not null then
    raise exception 'Player is already assigned to another match in this event' using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_unique_event_player_assignment() from public, anon;
drop trigger if exists trg_enforce_unique_event_player_assignment on public.event_group_players;
create trigger trg_enforce_unique_event_player_assignment
before insert or update of group_id, player_id, event_id on public.event_group_players
for each row execute function public.enforce_unique_event_player_assignment();

create or replace function public.replace_event_groups(p_event_id uuid, p_groups jsonb, p_delete_existing boolean default true)
returns uuid[]
language plpgsql
set search_path to 'public'
as $function$
declare
  g jsonb;
  p jsonb;
  new_id uuid;
  ids uuid[] := array[]::uuid[];
  payload_players uuid[] := array[]::uuid[];
  dup_count int;
  clash_count int;
begin
  if p_event_id is null then raise exception 'event id is required'; end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'groups payload must be a JSON array';
  end if;

  select coalesce(array_agg((pl->>'player_id')::uuid), array[]::uuid[])
  into payload_players
  from jsonb_array_elements(p_groups) grp
  cross join lateral jsonb_array_elements(coalesce(grp->'players', '[]'::jsonb)) pl
  where nullif(pl->>'player_id', '') is not null;

  select count(*) into dup_count from (
    select pid from unnest(payload_players) pid group by pid having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception 'Player is already assigned to another match in this event' using errcode = '23505';
  end if;

  if array_length(payload_players, 1) > 0 then
    perform pg_advisory_xact_lock(hashtext(p_event_id::text), hashtext(pid::text))
    from (select distinct pid from unnest(payload_players) pid order by 1) s;
  end if;

  if p_delete_existing then
    delete from public.event_groups where event_id = p_event_id;
  else
    select count(*) into clash_count
    from public.event_group_players egp
    where egp.event_id = p_event_id and egp.player_id = any(payload_players);
    if clash_count > 0 then
      raise exception 'Player is already assigned to another match in this event' using errcode = '23505';
    end if;
  end if;

  for g in select * from jsonb_array_elements(p_groups)
  loop
    insert into public.event_groups (
      event_id, name, ability_band, pitch_name, display_order, team_a_color, team_b_color
    ) values (
      p_event_id, coalesce(g->>'name', 'Match'), nullif(g->>'ability_band', ''),
      nullif(g->>'pitch_name', ''), nullif(g->>'display_order', '')::int,
      nullif(g->>'team_a_color', ''), nullif(g->>'team_b_color', '')
    ) returning id into new_id;
    ids := ids || new_id;
    for p in select * from jsonb_array_elements(coalesce(g->'players', '[]'::jsonb))
    loop
      if (p->>'team') is not null and (p->>'team') not in ('a', 'b') then
        raise exception 'Invalid team value: %', p->>'team';
      end if;
      insert into public.event_group_players (event_id, group_id, player_id, team)
      values (p_event_id, new_id, (p->>'player_id')::uuid, nullif(p->>'team', ''));
    end loop;
  end loop;
  return ids;
end;
$function$;
