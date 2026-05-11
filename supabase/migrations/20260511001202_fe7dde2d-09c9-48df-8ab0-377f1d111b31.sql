CREATE TABLE IF NOT EXISTS public.event_default_confirm_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL,
  child_id uuid,
  rsvp_id uuid REFERENCES public.rsvps(id) ON DELETE CASCADE,
  dm_message_id uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_default_confirm_log_uniq
  ON public.event_default_confirm_log (event_id, parent_user_id, COALESCE(child_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS event_default_confirm_log_event_idx
  ON public.event_default_confirm_log (event_id);

ALTER TABLE public.event_default_confirm_log ENABLE ROW LEVEL SECURITY;

-- No policies: service role only (used by cron). Locks down all client access.