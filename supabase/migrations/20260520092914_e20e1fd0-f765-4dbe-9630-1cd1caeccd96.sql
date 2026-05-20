
-- Extend chat-group → vault-folder auto-provisioning to also fire when an
-- existing personal group has its club_id set later (UPDATE), not just on INSERT.
CREATE OR REPLACE FUNCTION public.on_chat_group_club_attached_make_vault_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.club_id IS NOT NULL
     AND OLD.club_id IS NULL
     AND NEW.team_id IS NULL
     AND NEW.mini_league_id IS NULL THEN
    PERFORM public.ensure_chat_group_vault_folder(
      NEW.id,
      NEW.name,
      NEW.club_id,
      NEW.category,
      NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_chat_group_club_attached_make_vault_folder ON public.chat_groups;
CREATE TRIGGER on_chat_group_club_attached_make_vault_folder
AFTER UPDATE OF club_id ON public.chat_groups
FOR EACH ROW
EXECUTE FUNCTION public.on_chat_group_club_attached_make_vault_folder();

-- Attach the two existing Operations groups (Grounds, Registrations) to
-- Bridgewater Soccer Club; the trigger above will provision the linked
-- Operations/<group name> vault folder.
UPDATE public.chat_groups
SET club_id = '966bdaec-ebf1-46da-b2b3-cc53bf05c422'
WHERE id IN (
  'd83e7267-f420-430e-a5de-c785034ca4ca',
  'a1fda98a-65f7-48a9-bdad-71acc0a54705'
)
AND club_id IS NULL;
