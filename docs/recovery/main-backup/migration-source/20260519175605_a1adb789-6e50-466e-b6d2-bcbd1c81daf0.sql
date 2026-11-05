UPDATE public.chat_groups
SET club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422'
WHERE id = '32457047-0a68-4846-9a65-8c90c1355be4' AND club_id IS NULL;

DO $$
DECLARE r RECORD;
BEGIN
  SELECT id, name, club_id, category, created_by
    INTO r
    FROM public.chat_groups
    WHERE id = '32457047-0a68-4846-9a65-8c90c1355be4';
  PERFORM public.ensure_chat_group_vault_folder(r.id, r.name, r.club_id, r.category, r.created_by);
END $$;