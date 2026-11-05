insert into public.app_settings (key, value)
values ('engagement_reminders', '{"enabled": false}'::jsonb)
on conflict (key) do update set value = jsonb_set(
  coalesce(public.app_settings.value, '{}'::jsonb), '{enabled}', 'false'::jsonb, true
);

select cron.unschedule(jobname) from cron.job
where command ilike '%send-engagement-reminders%';