
CREATE OR REPLACE FUNCTION public.create_default_club_chats()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Coaches group chat
  INSERT INTO public.chat_groups (name, club_id, created_by, allowed_roles)
  VALUES (
    'Coaches',
    NEW.id,
    COALESCE(NEW.created_by, NEW.admin_user_id, auth.uid()),
    ARRAY['coach', 'club_admin', 'app_admin']::app_role[]
  );

  -- Team Admin group chat
  INSERT INTO public.chat_groups (name, club_id, created_by, allowed_roles)
  VALUES (
    'Team Admins',
    NEW.id,
    COALESCE(NEW.created_by, NEW.admin_user_id, auth.uid()),
    ARRAY['team_admin', 'club_admin', 'app_admin']::app_role[]
  );

  -- Club Committee group chat
  INSERT INTO public.chat_groups (name, club_id, created_by, allowed_roles)
  VALUES (
    'Club Committee',
    NEW.id,
    COALESCE(NEW.created_by, NEW.admin_user_id, auth.uid()),
    ARRAY['committee_member', 'club_admin', 'app_admin']::app_role[]
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_club_created_create_default_chats
  AFTER INSERT ON public.clubs
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_club_chats();
