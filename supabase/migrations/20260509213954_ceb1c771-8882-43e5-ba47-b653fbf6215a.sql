-- Seed the Ignite Support system user so automated system messages
-- (post-game photo prompts, welcome messages, etc.) can satisfy the
-- team_messages.author_id -> auth.users(id) FK.
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'system@igniteclubhq.app',
  '',
  now(),
  now(),
  now(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"display_name":"Ignite Support","is_system":true}'::jsonb,
  false,
  false,
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Ignite Support')
ON CONFLICT (id) DO NOTHING;