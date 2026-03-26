
-- 1. Atomic points increment function for profiles
CREATE OR REPLACE FUNCTION public.increment_ignite_points(_user_id uuid, _amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE public.profiles
  SET ignite_points = GREATEST(0, ignite_points + _amount)
  WHERE id = _user_id
  RETURNING ignite_points INTO new_balance;
  
  RETURN COALESCE(new_balance, 0);
END;
$$;

-- 2. Atomic points increment function for children
CREATE OR REPLACE FUNCTION public.increment_child_ignite_points(_child_id uuid, _amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE public.children
  SET ignite_points = GREATEST(0, ignite_points + _amount)
  WHERE id = _child_id
  RETURNING ignite_points INTO new_balance;
  
  RETURN COALESCE(new_balance, 0);
END;
$$;

-- 3. Atomic cooldown insert (returns true if inserted, false if already exists)
CREATE OR REPLACE FUNCTION public.try_insert_points_cooldown(
  _user_id uuid,
  _action_type text,
  _scope_id text,
  _awarded_date date,
  _points_awarded integer,
  _club_id uuid,
  _daily_cap integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  total_today integer;
BEGIN
  -- Check if this exact scope was already awarded today
  IF EXISTS (
    SELECT 1 FROM public.points_cooldowns
    WHERE user_id = _user_id
      AND action_type = _action_type
      AND scope_id = _scope_id
      AND awarded_date = _awarded_date
  ) THEN
    RETURN false;
  END IF;

  -- Check daily cap
  SELECT COALESCE(SUM(points_awarded), 0) INTO total_today
  FROM public.points_cooldowns
  WHERE user_id = _user_id
    AND action_type = _action_type
    AND awarded_date = _awarded_date;

  IF total_today >= _daily_cap THEN
    RETURN false;
  END IF;

  -- Insert cooldown record
  INSERT INTO public.points_cooldowns (user_id, action_type, scope_id, awarded_date, points_awarded, club_id)
  VALUES (_user_id, _action_type, _scope_id, _awarded_date, _points_awarded, _club_id);

  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END;
$$;

-- 4. Add unique constraint on points_cooldowns to prevent race condition dupes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'points_cooldowns_user_action_scope_date_unique'
  ) THEN
    CREATE UNIQUE INDEX points_cooldowns_user_action_scope_date_unique 
    ON public.points_cooldowns (user_id, action_type, scope_id, awarded_date);
  END IF;
END$$;

-- 5. Validation trigger for admin award limits (max ±500 per single transaction)
CREATE OR REPLACE FUNCTION public.validate_points_history_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.source_type = 'admin_award' AND ABS(NEW.amount) > 500 THEN
    RAISE EXCEPTION 'Admin award amount cannot exceed 500 points';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_points_history_amount_trigger ON public.points_history;
CREATE TRIGGER validate_points_history_amount_trigger
  BEFORE INSERT ON public.points_history
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_points_history_amount();
