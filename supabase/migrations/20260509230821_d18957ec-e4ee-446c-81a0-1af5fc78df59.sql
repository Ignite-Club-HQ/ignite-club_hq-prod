-- Track when an event reminder (RSVP nudge) was sent, to enforce a 24h cooldown
-- and provide visibility on the last nudge in the UI.

CREATE TABLE IF NOT EXISTS public.event_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sent_by uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipients_count integer NOT NULL DEFAULT 0,
  channels text NOT NULL DEFAULT 'both',
  pushes_sent integer NOT NULL DEFAULT 0,
  emails_sent integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_reminder_log_event_sent_at
  ON public.event_reminder_log (event_id, sent_at DESC);

ALTER TABLE public.event_reminder_log ENABLE ROW LEVEL SECURITY;

-- Admins (any role that can already send the reminder) can read the log for
-- events in their team or club. We mirror the auth check used by the edge
-- function: app_admin, club_admin/team_admin/coach/league_admin/committee_member
-- scoped to the event's club, or team_admin/coach scoped to the event's team.
CREATE POLICY "Event admins can view reminder log"
ON public.event_reminder_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_reminder_log.event_id
      AND (
        public.has_role(auth.uid(), 'app_admin'::app_role)
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND (
              (ur.club_id = e.club_id
                AND ur.role IN ('club_admin','team_admin','coach','league_admin','committee_member'))
              OR (e.team_id IS NOT NULL AND ur.team_id = e.team_id
                AND ur.role IN ('team_admin','coach'))
            )
        )
      )
  )
);

-- Inserts only via the service role from the edge function. No direct insert
-- policy is created, so authenticated clients cannot write to this table.