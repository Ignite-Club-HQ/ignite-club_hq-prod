
CREATE OR REPLACE FUNCTION public.notify_parent_on_child_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
BEGIN
  -- Only notify when an admin (not the parent themselves) adds the child
  IF v_actor IS NULL OR v_actor = NEW.parent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(display_name, 'A club admin') INTO v_actor_name
  FROM public.profiles WHERE id = v_actor;

  INSERT INTO public.notifications (user_id, type, message, related_id)
  VALUES (
    NEW.parent_id,
    'child_added',
    v_actor_name || ' added ' || NEW.name || ' as your child',
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_parent_on_child_added ON public.children;
CREATE TRIGGER trg_notify_parent_on_child_added
AFTER INSERT ON public.children
FOR EACH ROW
EXECUTE FUNCTION public.notify_parent_on_child_added();
