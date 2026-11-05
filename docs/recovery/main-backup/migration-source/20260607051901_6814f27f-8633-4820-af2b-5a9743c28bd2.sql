-- Helper RPCs for the competition join flow

-- 1) Token status — distinguishes unknown vs disabled vs archived comp
CREATE OR REPLACE FUNCTION public.get_competition_join_token_status(p_token uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enabled boolean;
  v_status text;
BEGIN
  SELECT join_token_enabled, status
    INTO v_enabled, v_status
  FROM public.competitions
  WHERE join_token = p_token
  LIMIT 1;
  IF v_enabled IS NULL THEN RETURN 'unknown'; END IF;
  IF v_enabled = false THEN RETURN 'disabled'; END IF;
  IF v_status = 'archived' THEN RETURN 'archived'; END IF;
  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_join_token_status(uuid) TO anon, authenticated;

-- 2) Teams already entered (any non-removed status) for the comp — used to grey out
--    already-entered teams in the picker so users get a friendly "already in" UX.
CREATE OR REPLACE FUNCTION public.list_entered_team_ids_by_join_token(p_token uuid)
RETURNS TABLE(team_id uuid, status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.team_id, e.status
  FROM public.competition_entries e
  JOIN public.competitions c ON c.id = e.competition_id
  WHERE c.join_token = p_token AND c.join_token_enabled = true;
$$;

GRANT EXECUTE ON FUNCTION public.list_entered_team_ids_by_join_token(uuid) TO authenticated;
