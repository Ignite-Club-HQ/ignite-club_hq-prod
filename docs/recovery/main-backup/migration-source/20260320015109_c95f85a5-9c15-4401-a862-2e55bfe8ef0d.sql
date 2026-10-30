
-- Create a SECURITY DEFINER function to insert formation change notifications
-- This bypasses RLS so any authenticated user (e.g. parent running pitch board) can notify staff
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
BEGIN
  FOREACH _recipient_id IN ARRAY _recipient_ids
  LOOP
    INSERT INTO public.notifications (user_id, type, message, related_id)
    VALUES (_recipient_id, 'formation_change', _message, _related_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
