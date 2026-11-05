-- Fix cron jobs whose header JSON is built with an operator-precedence bug:
--   '{"a":"' || secret || '"}'::jsonb
-- Postgres binds ::jsonb tighter than ||, so it tries to parse the fragment
-- '"}' as JSON and the job fails every run with:
--   invalid input syntax for type json ... Token ""}" is invalid.
-- The fix is to parenthesise the whole concatenation before the cast.
DO $$
DECLARE
  j record;
  new_cmd text;
BEGIN
  FOR j IN SELECT jobid, jobname, schedule, command FROM cron.job WHERE command LIKE '%''"}''::jsonb%'
  LOOP
    new_cmd := replace(j.command, '''{"Content-Type', '(''{"Content-Type');
    new_cmd := replace(new_cmd, '''"}''::jsonb', '''"}'')::jsonb');
    PERFORM cron.alter_job(j.jobid, command => new_cmd);
    RAISE NOTICE 'Repaired cron job % (%)', j.jobname, j.jobid;
  END LOOP;
END $$;