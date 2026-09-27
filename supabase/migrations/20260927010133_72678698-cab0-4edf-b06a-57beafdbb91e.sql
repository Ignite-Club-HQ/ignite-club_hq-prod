ALTER TABLE public.chat_groups DROP CONSTRAINT chat_groups_competition_scope_check;
ALTER TABLE public.chat_groups ADD CONSTRAINT chat_groups_competition_scope_check CHECK (
  (competition_id IS NULL AND competition_scope IS NULL)
  OR (competition_id IS NOT NULL AND competition_scope IN ('coordinators','all_members','referees','committee','admin_contact'))
);