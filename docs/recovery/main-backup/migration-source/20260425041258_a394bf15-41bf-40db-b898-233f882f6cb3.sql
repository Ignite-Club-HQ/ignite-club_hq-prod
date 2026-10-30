INSERT INTO public.chat_groups (name, club_id, allowed_roles, created_by)
VALUES
  ('Coaches', '36231b76-5313-478e-b8d5-23ac4f5e8b10', ARRAY['coach','club_admin','app_admin']::app_role[], 'c58db9a7-69bd-4f79-9fd7-51b267af124f'),
  ('Club Committee', '36231b76-5313-478e-b8d5-23ac4f5e8b10', ARRAY['committee_member','club_admin','app_admin']::app_role[], 'c58db9a7-69bd-4f79-9fd7-51b267af124f');