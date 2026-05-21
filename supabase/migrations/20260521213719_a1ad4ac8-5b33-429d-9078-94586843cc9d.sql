
CREATE TABLE public.chat_pinned_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_type text NOT NULL CHECK (chat_type IN ('team','club','group')),
  chat_id uuid NOT NULL,
  vault_file_id uuid REFERENCES public.vault_files(id) ON DELETE CASCADE,
  vault_folder_id uuid REFERENCES public.vault_folders(id) ON DELETE CASCADE,
  root_scope text CHECK (root_scope IN ('team','club')),
  root_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  set_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_type, chat_id),
  CHECK (
    (vault_file_id IS NOT NULL)::int
    + (vault_folder_id IS NOT NULL)::int
    + (root_scope IS NOT NULL AND root_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX chat_pinned_vault_chat_idx ON public.chat_pinned_vault (chat_type, chat_id);

ALTER TABLE public.chat_pinned_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view pinned vault for accessible chats"
ON public.chat_pinned_vault
FOR SELECT
TO authenticated
USING (
  (chat_type = 'team'  AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.team_id = chat_pinned_vault.chat_id
  ))
  OR (chat_type = 'club' AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.club_id = chat_pinned_vault.chat_id
  ))
  OR (chat_type = 'group' AND public.can_access_chat_group(auth.uid(), chat_id))
);

CREATE POLICY "Admins can insert pinned vault"
ON public.chat_pinned_vault
FOR INSERT
TO authenticated
WITH CHECK (
  set_by = auth.uid()
  AND (
    (chat_type = 'team'  AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.team_id = chat_pinned_vault.chat_id
          AND ur.role IN ('team_admin','coach')
    ))
    OR (chat_type = 'club' AND public.is_club_admin(auth.uid(), chat_id))
    OR (chat_type = 'group' AND EXISTS (
        SELECT 1 FROM public.chat_groups cg
        WHERE cg.id = chat_pinned_vault.chat_id
          AND (
            cg.created_by = auth.uid()
            OR (cg.club_id IS NOT NULL AND public.is_club_admin(auth.uid(), cg.club_id))
            OR (cg.team_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid()
                  AND ur.team_id = cg.team_id
                  AND ur.role IN ('team_admin','coach')
            ))
          )
    ))
  )
);

CREATE POLICY "Admins can update pinned vault"
ON public.chat_pinned_vault
FOR UPDATE
TO authenticated
USING (
  (chat_type = 'team'  AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = chat_pinned_vault.chat_id
        AND ur.role IN ('team_admin','coach')
  ))
  OR (chat_type = 'club' AND public.is_club_admin(auth.uid(), chat_id))
  OR (chat_type = 'group' AND EXISTS (
      SELECT 1 FROM public.chat_groups cg
      WHERE cg.id = chat_pinned_vault.chat_id
        AND (
          cg.created_by = auth.uid()
          OR (cg.club_id IS NOT NULL AND public.is_club_admin(auth.uid(), cg.club_id))
          OR (cg.team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.team_id = cg.team_id
                AND ur.role IN ('team_admin','coach')
          ))
        )
  ))
);

CREATE POLICY "Admins can delete pinned vault"
ON public.chat_pinned_vault
FOR DELETE
TO authenticated
USING (
  (chat_type = 'team'  AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.team_id = chat_pinned_vault.chat_id
        AND ur.role IN ('team_admin','coach')
  ))
  OR (chat_type = 'club' AND public.is_club_admin(auth.uid(), chat_id))
  OR (chat_type = 'group' AND EXISTS (
      SELECT 1 FROM public.chat_groups cg
      WHERE cg.id = chat_pinned_vault.chat_id
        AND (
          cg.created_by = auth.uid()
          OR (cg.club_id IS NOT NULL AND public.is_club_admin(auth.uid(), cg.club_id))
          OR (cg.team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.team_id = cg.team_id
                AND ur.role IN ('team_admin','coach')
          ))
        )
  ))
);

CREATE OR REPLACE FUNCTION public.chat_pinned_vault_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_pinned_vault_set_updated_at
BEFORE UPDATE ON public.chat_pinned_vault
FOR EACH ROW EXECUTE FUNCTION public.chat_pinned_vault_touch_updated_at();
