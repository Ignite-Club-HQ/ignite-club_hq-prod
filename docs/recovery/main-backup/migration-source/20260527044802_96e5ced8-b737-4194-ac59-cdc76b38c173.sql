ALTER TABLE public.team_messages
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id uuid,
  ADD COLUMN IF NOT EXISTS forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS forwarded_source_label text;

ALTER TABLE public.club_messages
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id uuid,
  ADD COLUMN IF NOT EXISTS forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS forwarded_source_label text;

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id uuid,
  ADD COLUMN IF NOT EXISTS forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS forwarded_source_label text;

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id uuid,
  ADD COLUMN IF NOT EXISTS forwarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS forwarded_source_label text;

-- Optional per-chat-group toggle so admins of sensitive group chats
-- (e.g. Committee) can disable forwarding of their messages.
ALTER TABLE public.chat_groups
  ADD COLUMN IF NOT EXISTS allow_forwarding boolean NOT NULL DEFAULT true;