-- Atomic engagement-reminder dispatch: notification rows and their matching
-- cooldown-log rows are inserted inside one function call (one transaction), so
-- a crash or error between the two writes can no longer leave notifications
-- without cooldowns (which would re-notify every user on the next cron run).
create or replace function public.insert_engagement_reminders_atomic(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array';
  end if;

  create temporary table _er_input on commit drop as
  select
    (r->>'user_id')::uuid as user_id,
    r->>'message' as message,
    coalesce((r->>'unread_messages_count')::int, 0) as unread_messages_count,
    coalesce((r->>'unread_photos_count')::int, 0) as unread_photos_count
  from jsonb_array_elements(p_rows) as r;

  insert into public.notifications (user_id, type, message)
  select user_id, 'engagement_reminder', message from _er_input;

  get diagnostics v_count = row_count;

  insert into public.engagement_reminder_log
    (user_id, unread_messages_count, unread_photos_count)
  select user_id, unread_messages_count, unread_photos_count from _er_input;

  drop table _er_input;
  return v_count;
end;
$$;

revoke all on function public.insert_engagement_reminders_atomic(jsonb) from public;
revoke all on function public.insert_engagement_reminders_atomic(jsonb) from anon;
revoke all on function public.insert_engagement_reminders_atomic(jsonb) from authenticated;
grant execute on function public.insert_engagement_reminders_atomic(jsonb) to service_role;