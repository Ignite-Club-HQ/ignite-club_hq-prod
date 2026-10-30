-- Polls feature for chat threads (team, club, group, broadcast, club_admin)

CREATE TYPE public.poll_chat_type AS ENUM ('team', 'club', 'group', 'broadcast', 'club_admin');

CREATE TABLE public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_type public.poll_chat_type NOT NULL,
  chat_id uuid NOT NULL,
  created_by uuid NOT NULL,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  allow_multiple boolean NOT NULL DEFAULT false,
  closes_at timestamptz NULL,
  closed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_polls_chat ON public.polls(chat_type, chat_id);
CREATE INDEX idx_polls_created_by ON public.polls(created_by);

CREATE TABLE public.poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  position smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_poll_options_poll ON public.poll_options(poll_id);
CREATE UNIQUE INDEX idx_poll_options_position ON public.poll_options(poll_id, position);

CREATE TABLE public.poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, option_id, user_id)
);

CREATE INDEX idx_poll_votes_poll ON public.poll_votes(poll_id);
CREATE INDEX idx_poll_votes_user ON public.poll_votes(user_id);

-- Updated-at trigger for polls
CREATE TRIGGER update_polls_updated_at
BEFORE UPDATE ON public.polls
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Security definer helper: can the current user access (read+post in) a given chat?
CREATE OR REPLACE FUNCTION public.can_access_poll_chat(_chat_type public.poll_chat_type, _chat_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF _chat_type = 'team' THEN
    -- Member of the team OR club admin/committee/app admin for the team's club
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.team_id = _chat_id
    ) OR EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.user_roles ur2 ON ur2.club_id = t.club_id AND ur2.user_id = _user_id
      WHERE t.id = _chat_id
        AND ur2.role IN ('club_admin','committee','app_admin')
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'club' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.club_id = _chat_id
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'broadcast' THEN
    -- Broadcast is org-wide; any user with any role can see (mirrors broadcast visibility used in the app)
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'group' THEN
    -- Member of any team/club tied to the chat group, plus role permission
    SELECT EXISTS (
      SELECT 1
      FROM public.chat_groups cg
      WHERE cg.id = _chat_id
        AND (
          (cg.team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.team_id = cg.team_id
              AND ur.role = ANY (cg.allowed_roles)
          ))
          OR (cg.club_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.club_id = cg.club_id
              AND ur.role = ANY (cg.allowed_roles)
          ))
          OR cg.created_by = _user_id
        )
    ) INTO v_ok;
    RETURN v_ok;

  ELSIF _chat_type = 'club_admin' THEN
    -- Either the member who owns the conversation, or a club admin/committee for the club
    SELECT EXISTS (
      SELECT 1
      FROM public.club_admin_conversations c
      WHERE c.id = _chat_id
        AND (
          c.member_user_id = _user_id
          OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = _user_id
              AND ur.club_id = c.club_id
              AND ur.role IN ('club_admin','committee','app_admin')
          )
        )
    ) INTO v_ok;
    RETURN v_ok;
  END IF;

  RETURN false;
END;
$$;

-- Enable RLS
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- POLLS policies
CREATE POLICY "Members can view polls in their chats"
ON public.polls
FOR SELECT
TO authenticated
USING (public.can_access_poll_chat(chat_type, chat_id, auth.uid()));

CREATE POLICY "Members can create polls in their chats"
ON public.polls
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.can_access_poll_chat(chat_type, chat_id, auth.uid())
);

CREATE POLICY "Creators can update their polls"
ON public.polls
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creators can delete their polls"
ON public.polls
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- POLL_OPTIONS policies
CREATE POLICY "View options for accessible polls"
ON public.poll_options
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_options.poll_id
      AND public.can_access_poll_chat(p.chat_type, p.chat_id, auth.uid())
  )
);

CREATE POLICY "Poll creator can insert options"
ON public.poll_options
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_options.poll_id AND p.created_by = auth.uid()
  )
);

CREATE POLICY "Poll creator can delete options"
ON public.poll_options
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_options.poll_id AND p.created_by = auth.uid()
  )
);

-- POLL_VOTES policies
CREATE POLICY "View votes for accessible polls"
ON public.poll_votes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_votes.poll_id
      AND public.can_access_poll_chat(p.chat_type, p.chat_id, auth.uid())
  )
);

CREATE POLICY "Members can cast their own votes in accessible, open polls"
ON public.poll_votes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = poll_votes.poll_id
      AND public.can_access_poll_chat(p.chat_type, p.chat_id, auth.uid())
      AND p.closed_at IS NULL
      AND (p.closes_at IS NULL OR p.closes_at > now())
  )
);

CREATE POLICY "Members can remove their own votes"
ON public.poll_votes
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Trigger: enforce single-choice polls (one option per user when allow_multiple = false)
CREATE OR REPLACE FUNCTION public.enforce_single_choice_poll()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_multiple boolean;
  v_existing_count int;
BEGIN
  SELECT allow_multiple INTO v_allow_multiple FROM public.polls WHERE id = NEW.poll_id;
  IF v_allow_multiple IS DISTINCT FROM true THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.poll_votes
    WHERE poll_id = NEW.poll_id AND user_id = NEW.user_id;
    IF v_existing_count > 0 THEN
      RAISE EXCEPTION 'This poll allows only one selection. Remove your previous vote first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_single_choice_poll
BEFORE INSERT ON public.poll_votes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_choice_poll();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_options;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;