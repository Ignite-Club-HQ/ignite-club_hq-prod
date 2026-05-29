CREATE OR REPLACE FUNCTION public._leaderboard_window_start(_window text)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE lower(_window)
    WHEN 'week'  THEN date_trunc('week', now())
    WHEN 'month' THEN date_trunc('month', now())
    ELSE '-infinity'::timestamptz
  END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_pinned_vault_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;