
-- Function to get a user's leaderboard rank within their club
CREATE OR REPLACE FUNCTION public.get_user_leaderboard_rank(_user_id uuid, _club_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(rank_pos, 0)::integer
  FROM (
    SELECT p.id, RANK() OVER (ORDER BY p.ignite_points DESC) as rank_pos
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
    WHERE ur.club_id = _club_id
    GROUP BY p.id, p.ignite_points
  ) ranked
  WHERE ranked.id = _user_id
  LIMIT 1;
$$;

-- Function to check engagement streak
CREATE OR REPLACE FUNCTION public.get_engagement_streak(_user_id uuid, _club_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak integer := 0;
  check_date date := CURRENT_DATE;
  has_activity boolean;
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM points_cooldowns
      WHERE user_id = _user_id
        AND club_id = _club_id
        AND awarded_date = check_date::text
    ) INTO has_activity;

    IF has_activity THEN
      streak := streak + 1;
      check_date := check_date - 1;
    ELSE
      IF streak = 0 AND check_date = CURRENT_DATE THEN
        check_date := check_date - 1;
      ELSE
        EXIT;
      END IF;
    END IF;

    IF streak >= 30 THEN EXIT; END IF;
  END LOOP;

  RETURN streak;
END;
$$;

-- Function to award streak bonus atomically
CREATE OR REPLACE FUNCTION public.try_award_streak_bonus(
  _user_id uuid,
  _club_id uuid,
  _streak_length integer,
  _bonus_points integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  week_start text;
BEGIN
  week_start := to_char(date_trunc('week', CURRENT_DATE), 'YYYY-WW');

  INSERT INTO points_cooldowns (user_id, action_type, scope_id, awarded_date, points_awarded, club_id)
  VALUES (_user_id, 'weekly_streak', week_start, CURRENT_DATE::text, _bonus_points, _club_id)
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
