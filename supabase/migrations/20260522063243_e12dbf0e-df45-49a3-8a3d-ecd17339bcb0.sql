DROP POLICY IF EXISTS "Admins can delete pinned vault" ON public.chat_pinned_vault;

CREATE POLICY "Admins or author can delete pinned vault"
ON public.chat_pinned_vault
FOR DELETE
USING (
  set_by = auth.uid()
  OR (
    chat_type = 'team' AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = chat_pinned_vault.chat_id
        AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
    )
  )
  OR (chat_type = 'club' AND is_club_admin(auth.uid(), chat_id))
  OR (
    chat_type = 'group' AND EXISTS (
      SELECT 1 FROM chat_groups cg
      WHERE cg.id = chat_pinned_vault.chat_id
        AND (
          cg.created_by = auth.uid()
          OR (cg.club_id IS NOT NULL AND is_club_admin(auth.uid(), cg.club_id))
          OR (cg.team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.team_id = cg.team_id
              AND ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])
          ))
        )
    )
  )
);