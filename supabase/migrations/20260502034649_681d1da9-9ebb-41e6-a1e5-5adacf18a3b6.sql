-- Auto-cleanup notifications that point to deleted photos / photo comments.
-- Photos use soft-delete (deleted_at). Photo comments are hard-deleted.

CREATE OR REPLACE FUNCTION public.cleanup_notifications_for_deleted_photo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_photo_id uuid;
BEGIN
  -- AFTER UPDATE: only act when transitioning to soft-deleted
  IF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    v_photo_id := NEW.id;
  ELSE
    -- DELETE
    v_photo_id := OLD.id;
  END IF;

  -- 1. Notifications that point directly at the photo
  DELETE FROM public.notifications
  WHERE related_id = v_photo_id
    AND type IN (
      'photo_comment',
      'photo_uploaded',
      'photo_reaction',
      'comment_reply' -- related_id is the photo_id for replies
    );

  -- 2. comment_reaction notifications point at a photo_comments row.
  --    Delete any whose underlying comment belongs to this photo.
  DELETE FROM public.notifications n
  USING public.photo_comments c
  WHERE n.type = 'comment_reaction'
    AND n.related_id = c.id
    AND c.photo_id = v_photo_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_notifications_on_photo_soft_delete ON public.photos;
CREATE TRIGGER trg_cleanup_notifications_on_photo_soft_delete
AFTER UPDATE OF deleted_at ON public.photos
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_notifications_for_deleted_photo();

DROP TRIGGER IF EXISTS trg_cleanup_notifications_on_photo_hard_delete ON public.photos;
CREATE TRIGGER trg_cleanup_notifications_on_photo_hard_delete
AFTER DELETE ON public.photos
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_notifications_for_deleted_photo();

-- Comment-level cleanup: when a photo_comments row is hard-deleted,
-- remove any comment_reaction notifications targeting it.
CREATE OR REPLACE FUNCTION public.cleanup_notifications_for_deleted_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE type = 'comment_reaction'
    AND related_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_notifications_on_comment_delete ON public.photo_comments;
CREATE TRIGGER trg_cleanup_notifications_on_comment_delete
AFTER DELETE ON public.photo_comments
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_notifications_for_deleted_comment();

-- One-off backfill: clean up existing stale notifications.
DELETE FROM public.notifications n
USING public.photos p
WHERE n.related_id = p.id
  AND p.deleted_at IS NOT NULL
  AND n.type IN ('photo_comment','photo_uploaded','photo_reaction','comment_reply');

DELETE FROM public.notifications n
WHERE n.type IN ('photo_comment','photo_uploaded','photo_reaction','comment_reply')
  AND NOT EXISTS (SELECT 1 FROM public.photos p WHERE p.id = n.related_id);

DELETE FROM public.notifications n
WHERE n.type = 'comment_reaction'
  AND NOT EXISTS (SELECT 1 FROM public.photo_comments c WHERE c.id = n.related_id);

DELETE FROM public.notifications n
USING public.photo_comments c, public.photos p
WHERE n.type = 'comment_reaction'
  AND n.related_id = c.id
  AND c.photo_id = p.id
  AND p.deleted_at IS NOT NULL;