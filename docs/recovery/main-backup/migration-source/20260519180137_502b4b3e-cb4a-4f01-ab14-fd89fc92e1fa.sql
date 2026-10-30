UPDATE public.chat_groups
SET club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422'
WHERE club_id IS NULL
  AND team_id IS NULL
  AND mini_league_id IS NULL
  AND category IS NOT NULL
  AND created_by = 'f51dd664-b0d5-4956-b2d5-cec9222ae3dc';

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, name, club_id, category, created_by
    FROM public.chat_groups
    WHERE club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422' AND category IS NOT NULL
  LOOP
    PERFORM public.ensure_chat_group_vault_folder(r.id, r.name, r.club_id, r.category, r.created_by);
  END LOOP;
END $$;