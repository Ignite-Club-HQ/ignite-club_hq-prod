
-- Add recurrence support to scheduled_messages
DO $$ BEGIN
  CREATE TYPE public.scheduled_message_recurrence AS ENUM (
    'none', 'daily', 'weekly', 'monthly'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.scheduled_messages
  ADD COLUMN IF NOT EXISTS recurrence public.scheduled_message_recurrence NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_until timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES public.scheduled_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_recurrence_parent
  ON public.scheduled_messages(recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;
