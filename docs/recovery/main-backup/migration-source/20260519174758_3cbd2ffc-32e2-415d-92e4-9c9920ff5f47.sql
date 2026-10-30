UPDATE public.chat_groups
SET category = 'Club Management'
WHERE club_id IS NOT NULL
  AND category IS NULL
  AND name IN ('Club Committee', 'Coaches', 'Club Coaches', 'Team Admins', 'Team Admin Chat', 'Team Admins & Coaches');

UPDATE public.chat_groups
SET category = 'Operations'
WHERE club_id IS NOT NULL
  AND category IS NULL
  AND name IN ('Uniform', 'Sponsorship', 'Finance', 'Events', 'Volunteers');

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, name, club_id, category, created_by
    FROM public.chat_groups
    WHERE club_id IS NOT NULL AND category IS NOT NULL
  LOOP
    PERFORM public.ensure_chat_group_vault_folder(r.id, r.name, r.club_id, r.category, r.created_by);
  END LOOP;
END $$;