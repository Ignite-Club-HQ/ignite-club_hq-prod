create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'post-game-photo-prompts-hourly') then
    perform cron.unschedule('post-game-photo-prompts-hourly');
  end if;

  perform cron.schedule(
    'post-game-photo-prompts-hourly',
    '0 * * * *',
    $cron$
    select net.http_post(
      url := 'https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/post-game-photo-prompts',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as"}'::jsonb,
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;