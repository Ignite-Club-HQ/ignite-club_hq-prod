-- ============================================================================
-- MIGRATION: Denormalize unread message counts (Step 1) — corrected column names
-- ============================================================================

-- 1. Cache table
CREATE TABLE public.chat_group_unread (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unread_count integer NOT NULL DEFAULT 0,
  last_read_message_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX chat_group_unread_user_idx
  ON public.chat_group_unread(user_id)
  WHERE unread_count > 0;

GRANT SELECT ON public.chat_group_unread TO authenticated;
GRANT ALL    ON public.chat_group_unread TO service_role;

ALTER TABLE public.chat_group_unread ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own unread counts"
  ON public.chat_group_unread
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 2. Trigger: new group message -> increment unread for every member except author
CREATE OR REPLACE FUNCTION public.bump_chat_group_unread_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chat_group_unread AS cgu (group_id, user_id, unread_count)
  SELECT NEW.group_id, gm.user_id, 1
    FROM public.group_members gm
   WHERE gm.group_id = NEW.group_id
     AND gm.user_id <> NEW.author_id
  ON CONFLICT (group_id, user_id)
    DO UPDATE SET unread_count = cgu.unread_count + 1,
                  updated_at   = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_chat_group_unread
AFTER INSERT ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_chat_group_unread_on_message();

-- 3. Trigger: message read receipt -> zero the cache row for that user+group
CREATE OR REPLACE FUNCTION public.clear_chat_group_unread_on_read()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id
    FROM public.group_messages
   WHERE id = NEW.group_message_id;

  IF v_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_group_unread (group_id, user_id, unread_count, last_read_message_id)
  VALUES (v_group_id, NEW.user_id, 0, NEW.group_message_id)
  ON CONFLICT (group_id, user_id)
    DO UPDATE SET unread_count = 0,
                  last_read_message_id = NEW.group_message_id,
                  updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clear_chat_group_unread
AFTER INSERT ON public.message_reads
FOR EACH ROW EXECUTE FUNCTION public.clear_chat_group_unread_on_read();

-- 4. Backfill from current data (safe to re-run)
INSERT INTO public.chat_group_unread (group_id, user_id, unread_count)
SELECT gm.group_id,
       gm.user_id,
       COUNT(msg.id) FILTER (
         WHERE msg.author_id <> gm.user_id
           AND NOT EXISTS (
             SELECT 1 FROM public.message_reads mr
              WHERE mr.group_message_id = msg.id
                AND mr.user_id          = gm.user_id
           )
       )
  FROM public.group_members gm
  JOIN public.group_messages msg ON msg.group_id = gm.group_id
 GROUP BY gm.group_id, gm.user_id
ON CONFLICT (group_id, user_id) DO UPDATE
  SET unread_count = EXCLUDED.unread_count,
      updated_at   = now();

-- 5. Reconciliation canary (should always return 0 rows once triggers are live)
CREATE OR REPLACE FUNCTION public.reconcile_chat_group_unread()
RETURNS TABLE(group_id uuid, user_id uuid, cached integer, actual integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH actual AS (
    SELECT gm.group_id,
           gm.user_id,
           COUNT(msg.id) FILTER (
             WHERE msg.author_id <> gm.user_id
               AND NOT EXISTS (
                 SELECT 1 FROM public.message_reads mr
                  WHERE mr.group_message_id = msg.id
                    AND mr.user_id          = gm.user_id
               )
           )::int AS actual_count
      FROM public.group_members gm
      JOIN public.group_messages msg ON msg.group_id = gm.group_id
     GROUP BY gm.group_id, gm.user_id
  )
  SELECT a.group_id,
         a.user_id,
         COALESCE(cgu.unread_count, 0) AS cached,
         a.actual_count                AS actual
    FROM actual a
    LEFT JOIN public.chat_group_unread cgu
      ON cgu.group_id = a.group_id AND cgu.user_id = a.user_id
   WHERE COALESCE(cgu.unread_count, 0) <> a.actual_count;
$$;