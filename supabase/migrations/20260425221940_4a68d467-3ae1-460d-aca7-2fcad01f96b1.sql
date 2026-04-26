create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-photo-prompt-followup-hourly') then
    perform cron.unschedule('send-photo-prompt-followup-hourly');
  end if;

  perform cron.schedule(
    'send-photo-prompt-followup-hourly',
    '15 * * * *',
    $cron$
    select net.http_post(
      url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/send-photo-prompt-followup',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as"}'::jsonb,
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;