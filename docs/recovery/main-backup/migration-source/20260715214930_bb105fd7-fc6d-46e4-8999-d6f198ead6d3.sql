
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_new_club_created()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  alert_secret text;
begin
  select decrypted_secret into alert_secret
  from vault.decrypted_secrets
  where name = 'new_club_alert_secret'
  limit 1;

  if alert_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://ecsdwrarzfexssxtrymj.supabase.co/functions/v1/send-new-club-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-secret', alert_secret
    ),
    body := jsonb_build_object('club_id', new.id)
  );

  return new;
exception when others then
  -- Never block club creation because of alerting failure.
  return new;
end;
$$;

drop trigger if exists trg_notify_new_club_created on public.clubs;
create trigger trg_notify_new_club_created
after insert on public.clubs
for each row
execute function public.notify_new_club_created();
