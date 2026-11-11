ALTER TABLE public.chat_pinned_vault DROP CONSTRAINT chat_pinned_vault_root_scope_check;
ALTER TABLE public.chat_pinned_vault ADD CONSTRAINT chat_pinned_vault_root_scope_check CHECK (root_scope = ANY (ARRAY['team'::text, 'club'::text, 'competition'::text]));

CREATE POLICY "Competition admins can insert pinned vault" ON public.chat_pinned_vault
FOR INSERT TO authenticated
WITH CHECK (set_by = (SELECT auth.uid()) AND chat_type = 'group' AND EXISTS (
  SELECT 1 FROM public.chat_groups cg
  WHERE cg.id = chat_pinned_vault.chat_id AND cg.competition_id IS NOT NULL
    AND public.is_competition_admin((SELECT auth.uid()), cg.competition_id)));

CREATE POLICY "Competition admins can update pinned vault" ON public.chat_pinned_vault
FOR UPDATE TO authenticated
USING (chat_type = 'group' AND EXISTS (
  SELECT 1 FROM public.chat_groups cg
  WHERE cg.id = chat_pinned_vault.chat_id AND cg.competition_id IS NOT NULL
    AND public.is_competition_admin((SELECT auth.uid()), cg.competition_id)));

CREATE POLICY "Competition admins can delete pinned vault" ON public.chat_pinned_vault
FOR DELETE TO authenticated
USING (chat_type = 'group' AND EXISTS (
  SELECT 1 FROM public.chat_groups cg
  WHERE cg.id = chat_pinned_vault.chat_id AND cg.competition_id IS NOT NULL
    AND public.is_competition_admin((SELECT auth.uid()), cg.competition_id)));