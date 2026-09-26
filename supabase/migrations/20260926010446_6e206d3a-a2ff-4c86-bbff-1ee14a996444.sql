-- Re-sync every existing competition Referees / Committee / Coordinators chat
-- with the strict role-based rules, removing anyone added by the older rules
-- (organisers, league/club admins). Earlier messages are kept.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT competition_id, competition_scope
    FROM public.chat_groups
    WHERE competition_id IS NOT NULL
      AND competition_scope IN ('referees','committee','coordinators')
  LOOP
    IF r.competition_scope = 'coordinators' THEN
      PERFORM public.sync_competition_coord_chat_members(r.competition_id);
    ELSE
      PERFORM public.sync_competition_role_chat_members(r.competition_id, r.competition_scope);
    END IF;
  END LOOP;
END $$;