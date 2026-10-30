CREATE OR REPLACE FUNCTION public.notify_formation_change(
  _recipient_ids uuid[],
  _message text,
  _related_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recipient_id uuid;
  _related_uuid uuid;
BEGIN
  -- Safely cast related_id to uuid, NULL if invalid
  BEGIN
    _related_uuid := _related_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    _related_uuid := NULL;
  END;

  FOREACH _recipient_id IN ARRAY _recipient_ids
  LOOP
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (_recipient_id, 'formation_change', _message, _related_uuid)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;