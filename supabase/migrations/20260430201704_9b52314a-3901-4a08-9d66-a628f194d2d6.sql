
CREATE OR REPLACE FUNCTION public.engagement_dau_trend(_days int DEFAULT 30)
RETURNS TABLE(day date, dau bigint, wau bigint, mau bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'app_admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      (now()::date - (_days - 1)),
      now()::date,
      interval '1 day'
    )::date AS d
  )
  SELECT
    days.d AS day,
    (SELECT COUNT(DISTINCT up.user_id) FROM public.user_presence up
       WHERE up.last_seen_at::date = days.d) AS dau,
    (SELECT COUNT(DISTINCT up.user_id) FROM public.user_presence up
       WHERE up.last_seen_at::date > days.d - 7
         AND up.last_seen_at::date <= days.d) AS wau,
    (SELECT COUNT(DISTINCT up.user_id) FROM public.user_presence up
       WHERE up.last_seen_at::date > days.d - 30
         AND up.last_seen_at::date <= days.d) AS mau
  FROM days
  ORDER BY days.d;
END;
$$;

CREATE OR REPLACE FUNCTION public.engagement_activity_trend(_days int DEFAULT 30)
RETURNS TABLE(day date, messages bigint, rsvps bigint, event_views bigint, new_users bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'app_admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      (now()::date - (_days - 1)),
      now()::date,
      interval '1 day'
    )::date AS d
  )
  SELECT
    days.d AS day,
    (SELECT COUNT(*) FROM public.messages m WHERE m.created_at::date = days.d) AS messages,
    (SELECT COUNT(*) FROM public.event_rsvps r WHERE r.created_at::date = days.d) AS rsvps,
    (SELECT COUNT(*) FROM public.event_views v WHERE v.viewed_at::date = days.d) AS event_views,
    (SELECT COUNT(*) FROM public.profiles p WHERE p.created_at::date = days.d) AS new_users
  FROM days
  ORDER BY days.d;
END;
$$;
