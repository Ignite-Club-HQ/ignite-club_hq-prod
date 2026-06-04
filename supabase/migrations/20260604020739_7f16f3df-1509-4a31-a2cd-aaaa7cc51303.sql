DO $fix_push_auth_key$
DECLARE
  ddl text;
BEGIN
  SELECT replace(
    pg_get_functiondef('public.on_direct_message_created()'::regprocedure),
    'ew6qjjYM3BR3S1RupohNEQmQ_3MeHFFn8zDXhLM4as',
    'ew6qjjYM3BR3S1YupohNEQmQ_3MeHFFn8zDXhLM4as'
  ) INTO ddl;
  EXECUTE ddl;

  SELECT replace(
    pg_get_functiondef('public.send_push_notification()'::regprocedure),
    'ew6qjjYM3BR3S1RupohNEQmQ_3MeHFFn8zDXhLM4as',
    'ew6qjjYM3BR3S1YupohNEQmQ_3MeHFFn8zDXhLM4as'
  ) INTO ddl;
  EXECUTE ddl;
END
$fix_push_auth_key$;