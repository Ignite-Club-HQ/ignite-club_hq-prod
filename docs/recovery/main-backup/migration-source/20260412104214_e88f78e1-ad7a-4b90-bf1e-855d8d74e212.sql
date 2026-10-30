-- Create message_deletions audit table
CREATE TABLE public.message_deletions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL,
  message_type TEXT NOT NULL, -- 'team', 'club', 'group', 'broadcast'
  author_id UUID NOT NULL,
  deleted_by UUID, -- NULL if we can't determine (e.g. cascade)
  message_text_preview TEXT, -- first 100 chars
  context_id UUID, -- team_id, club_id, or group_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_deletions ENABLE ROW LEVEL SECURITY;

-- App admins and club admins can view all deletion logs
CREATE POLICY "Admins can view message deletions"
  ON public.message_deletions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('app_admin', 'club_admin'))
  );

-- Index for lookups by message_id (to check if a notification's related_id was deleted)
CREATE INDEX idx_message_deletions_message_id ON public.message_deletions (message_id);
CREATE INDEX idx_message_deletions_context ON public.message_deletions (context_id, message_type);

-- Trigger function to log deletions
CREATE OR REPLACE FUNCTION public.log_message_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.message_deletions (message_id, message_type, author_id, deleted_by, message_text_preview, context_id)
  VALUES (
    OLD.id,
    TG_ARGV[0], -- message type passed as trigger argument
    OLD.author_id,
    auth.uid(),
    LEFT(OLD.text, 100),
    CASE TG_ARGV[0]
      WHEN 'team' THEN OLD.team_id
      WHEN 'club' THEN OLD.club_id
      WHEN 'group' THEN (SELECT group_id FROM LATERAL (SELECT NULL::uuid AS group_id) x) -- group_messages doesn't have group_id column, handled below
      ELSE NULL
    END
  );
  RETURN OLD;
END;
$$;

-- Specific trigger functions per table to correctly map context_id

CREATE OR REPLACE FUNCTION public.log_team_message_deletion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.message_deletions (message_id, message_type, author_id, deleted_by, message_text_preview, context_id)
  VALUES (OLD.id, 'team', OLD.author_id, auth.uid(), LEFT(OLD.text, 100), OLD.team_id);
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_club_message_deletion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.message_deletions (message_id, message_type, author_id, deleted_by, message_text_preview, context_id)
  VALUES (OLD.id, 'club', OLD.author_id, auth.uid(), LEFT(OLD.text, 100), OLD.club_id);
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_group_message_deletion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.message_deletions (message_id, message_type, author_id, deleted_by, message_text_preview, context_id)
  VALUES (OLD.id, 'group', OLD.author_id, auth.uid(), LEFT(OLD.text, 100), OLD.group_id);
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_broadcast_message_deletion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.message_deletions (message_id, message_type, author_id, deleted_by, message_text_preview, context_id)
  VALUES (OLD.id, 'broadcast', OLD.author_id, auth.uid(), LEFT(OLD.text, 100), NULL);
  RETURN OLD;
END;
$$;

-- Drop the generic function we won't use
DROP FUNCTION IF EXISTS public.log_message_deletion();

-- Attach triggers
CREATE TRIGGER on_team_message_deleted
  BEFORE DELETE ON public.team_messages
  FOR EACH ROW EXECUTE FUNCTION public.log_team_message_deletion();

CREATE TRIGGER on_club_message_deleted
  BEFORE DELETE ON public.club_messages
  FOR EACH ROW EXECUTE FUNCTION public.log_club_message_deletion();

CREATE TRIGGER on_group_message_deleted
  BEFORE DELETE ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.log_group_message_deletion();

CREATE TRIGGER on_broadcast_message_deleted
  BEFORE DELETE ON public.broadcast_messages
  FOR EACH ROW EXECUTE FUNCTION public.log_broadcast_message_deletion();