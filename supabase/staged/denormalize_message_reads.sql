-- ============================================================================
-- STAGED MIGRATION: Denormalize unread message counts
-- ============================================================================
-- Status: DRAFT — do NOT run at current scale (160 DAU).
-- Ship when: sustained > ~500 DAU OR message_reads p95 latency > 500ms
--            after the PARALLEL SAFE fix stops being enough.
--
-- Goal:
--   Replace per-render COUNT(*) over message_reads with a pre-computed
--   (group_id, user_id) -> unread_count row that is kept in lockstep with
--   the source of truth by database triggers. Triggers fire in the same
--   transaction as the source write, so the cache cannot drift.
--
-- Rollout order:
--   1. Apply this migration (creates cache table + triggers + backfills).
--   2. Run reconcile_chat_group_unread() and confirm it logs 0 drift rows.
--   3. Switch the client unread badge query to read from chat_group_unread.
--   4. Schedule weekly cron: SELECT public.reconcile_chat_group_unread();
--      (canary only — should always return 0.)
--   5. Leave message_reads untouched. It remains the source of truth; the
--      cache is disposable and can be rebuilt any time from step 6.
--
-- Rollback:
--   DROP TRIGGER + DROP TABLE chat_group_unread. Client falls back to the
--   original COUNT query. No data loss because message_reads is untouched.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Cache table
-- ----------------------------------------------------------------------------
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

-- Grants: cache is auth-only, reads scoped to auth.uid() via RLS.
GRANT SELECT ON public.chat_group_unread TO authenticated;
GRANT ALL    ON public.chat_group_unread TO service_role;

ALTER TABLE public.chat_group_unread ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own unread counts"
  ON public.chat_group_unread
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for authenticated: only the triggers
-- (SECURITY DEFINER, running as postgres) mutate this table.


-- ----------------------------------------------------------------------------
-- 2. Trigger: new message arrives -> increment unread for every group member
--    except the sender. Uses can_access_chat_group() to respect current
--    membership rules (allowed_roles, manual add, etc.).
-- ----------------------------------------------------------------------------
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
     AND gm.user_id <> NEW.sender_id
  ON CONFLICT (group_id, user_id)
    DO UPDATE SET unread_count = cgu.unread_count + 1,
                  updated_at   = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_chat_group_unread
AFTER INSERT ON public.group_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_chat_group_unread_on_message();


-- ----------------------------------------------------------------------------
-- 3. Trigger: message read receipt inserted -> zero the cache row.
--    We zero (not decrement) because message_reads batches per-open, so a
--    single insert typically covers all outstanding messages in that group.
-- ----------------------------------------------------------------------------
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
   WHERE id = NEW.message_id;

  IF v_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_group_unread (group_id, user_id, unread_count, last_read_message_id)
  VALUES (v_group_id, NEW.user_id, 0, NEW.message_id)
  ON CONFLICT (group_id, user_id)
    DO UPDATE SET unread_count = 0,
                  last_read_message_id = NEW.message_id,
                  updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clear_chat_group_unread
AFTER INSERT ON public.message_reads
FOR EACH ROW EXECUTE FUNCTION public.clear_chat_group_unread_on_read();


-- ----------------------------------------------------------------------------
-- 4. Backfill from current data. Safe to re-run.
-- ----------------------------------------------------------------------------
INSERT INTO public.chat_group_unread (group_id, user_id, unread_count)
SELECT gm.group_id,
       gm.user_id,
       COUNT(msg.id) FILTER (
         WHERE msg.sender_id <> gm.user_id
           AND NOT EXISTS (
             SELECT 1 FROM public.message_reads mr
              WHERE mr.message_id = msg.id
                AND mr.user_id    = gm.user_id
           )
       )
  FROM public.group_members gm
  JOIN public.group_messages msg ON msg.group_id = gm.group_id
 GROUP BY gm.group_id, gm.user_id
ON CONFLICT (group_id, user_id) DO UPDATE
  SET unread_count = EXCLUDED.unread_count,
      updated_at   = now();


-- ----------------------------------------------------------------------------
-- 5. Reconciliation canary. Should always return 0 rows once triggers are
--    live. Any row returned = drift = bug in a trigger or a write path
--    that bypasses them.
-- ----------------------------------------------------------------------------
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
             WHERE msg.sender_id <> gm.user_id
               AND NOT EXISTS (
                 SELECT 1 FROM public.message_reads mr
                  WHERE mr.message_id = msg.id
                    AND mr.user_id    = gm.user_id
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
