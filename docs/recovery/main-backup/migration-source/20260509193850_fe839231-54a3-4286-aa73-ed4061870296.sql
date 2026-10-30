
ALTER TABLE public.pinned_messages DROP CONSTRAINT IF EXISTS pinned_messages_chat_type_check;
ALTER TABLE public.pinned_messages ADD CONSTRAINT pinned_messages_chat_type_check
  CHECK (chat_type = ANY (ARRAY['team'::text, 'club'::text, 'group'::text, 'dm'::text]));

CREATE OR REPLACE FUNCTION public.can_access_chat(_chat_type text, _chat_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN FALSE; END IF;

  IF _chat_type = 'team' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND team_id = _chat_id
    );
  ELSIF _chat_type = 'club' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND club_id = _chat_id
    );
  ELSIF _chat_type = 'group' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.group_members
      WHERE user_id = uid AND group_id = _chat_id
    ) OR EXISTS (
      SELECT 1 FROM public.chat_groups cg
      JOIN public.user_roles ur ON ur.user_id = uid
      WHERE cg.id = _chat_id
        AND (
          (cg.team_id IS NOT NULL AND ur.team_id = cg.team_id AND ur.role = ANY(cg.allowed_roles))
          OR (cg.club_id IS NOT NULL AND ur.club_id = cg.club_id AND ur.role = ANY(cg.allowed_roles))
        )
    );
  ELSIF _chat_type = 'dm' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.direct_conversations dc
      WHERE dc.id = _chat_id
        AND (dc.participant_1 = uid OR dc.participant_2 = uid)
    );
  END IF;

  RETURN FALSE;
END;
$function$;
