-- Approval-based join flow for Operations & Volunteers chat groups
-- Replaces immediate self-join with a request → approve workflow that an
-- existing group member must action.

CREATE TABLE IF NOT EXISTS public.chat_group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.chat_group_join_requests TO authenticated;
GRANT ALL ON public.chat_group_join_requests TO service_role;

ALTER TABLE public.chat_group_join_requests ENABLE ROW LEVEL SECURITY;

-- Only one pending request per (group, user) at a time
CREATE UNIQUE INDEX IF NOT EXISTS chat_group_join_requests_pending_uniq
  ON public.chat_group_join_requests (group_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS chat_group_join_requests_group_status_idx
  ON public.chat_group_join_requests (group_id, status);

-- RLS: requester sees their own requests; current group members see all requests for their group
CREATE POLICY "Requester can view own requests"
  ON public.chat_group_join_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Group members can view requests for their group"
  ON public.chat_group_join_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = chat_group_join_requests.group_id
        AND gm.user_id = auth.uid()
    )
  );

-- INSERT / UPDATE are gated through RPCs (security definer) — no direct policies.

CREATE OR REPLACE FUNCTION public.touch_chat_group_join_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_chat_group_join_requests ON public.chat_group_join_requests;
CREATE TRIGGER trg_touch_chat_group_join_requests
  BEFORE UPDATE ON public.chat_group_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_chat_group_join_requests_updated_at();

-- Request to join an Ops/Volunteers group. Returns the request id.
CREATE OR REPLACE FUNCTION public.request_join_chat_group(_group_id uuid, _message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_group public.chat_groups%ROWTYPE;
  v_request_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_group FROM public.chat_groups WHERE id = _group_id;
  IF NOT FOUND OR v_group.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_group.join_policy <> 'open_to_club'
     OR v_group.club_id IS NULL
     OR v_group.team_id IS NOT NULL
     OR v_group.mini_league_id IS NOT NULL
     OR v_group.category NOT IN ('Operations','Volunteers')
  THEN
    RAISE EXCEPTION 'Group does not accept join requests' USING ERRCODE = '42501';
  END IF;

  -- Caller must be a member of the parent club
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user AND ur.club_id = v_group.club_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this club' USING ERRCODE = '42501';
  END IF;

  -- Already a member?
  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Already a member' USING ERRCODE = '23505';
  END IF;

  -- Reuse existing pending request if any
  SELECT id INTO v_request_id
  FROM public.chat_group_join_requests
  WHERE group_id = _group_id AND user_id = v_user AND status = 'pending'
  LIMIT 1;
  IF v_request_id IS NOT NULL THEN
    RETURN v_request_id;
  END IF;

  INSERT INTO public.chat_group_join_requests (group_id, user_id, message)
  VALUES (_group_id, v_user, _message)
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- Approve a pending request. Caller must be an existing member of the group.
CREATE OR REPLACE FUNCTION public.approve_chat_group_join_request(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_req  public.chat_group_join_requests%ROWTYPE;
  v_member_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_req FROM public.chat_group_join_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already decided' USING ERRCODE = '42501';
  END IF;

  -- Caller must already be a member of the group
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_req.group_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Only existing group members can approve requests' USING ERRCODE = '42501';
  END IF;

  -- Add the requester (idempotent)
  SELECT id INTO v_member_id
  FROM public.group_members
  WHERE group_id = v_req.group_id AND user_id = v_req.user_id
  LIMIT 1;

  IF v_member_id IS NULL THEN
    INSERT INTO public.group_members (group_id, user_id, added_by)
    VALUES (v_req.group_id, v_req.user_id, v_user)
    RETURNING id INTO v_member_id;
  END IF;

  UPDATE public.chat_group_join_requests
  SET status = 'approved', decided_by = v_user, decided_at = now()
  WHERE id = _request_id;

  RETURN v_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_chat_group_join_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_req  public.chat_group_join_requests%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_req FROM public.chat_group_join_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN;
  END IF;

  -- Existing group member OR the requester themselves (cancel) may reject
  IF NOT (
    v_req.user_id = v_user OR EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = v_req.group_id AND user_id = v_user
    )
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.chat_group_join_requests
  SET status = CASE WHEN v_req.user_id = v_user THEN 'cancelled' ELSE 'rejected' END,
      decided_by = v_user,
      decided_at = now()
  WHERE id = _request_id;
END;
$$;

-- Lock down the old immediate-join RPC so Ops/Volunteers ALWAYS go through approval.
CREATE OR REPLACE FUNCTION public.join_open_chat_group(_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group public.chat_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM public.chat_groups WHERE id = _group_id;
  IF NOT FOUND OR v_group.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_group.category IN ('Operations','Volunteers') THEN
    RAISE EXCEPTION 'Operations and Volunteers groups now require approval. Use request_join_chat_group.'
      USING ERRCODE = '42501';
  END IF;

  -- Other open_to_club categories keep self-join (not currently allowed by the
  -- original gate, but kept here for forward compatibility).
  RAISE EXCEPTION 'Group is not open to self-join' USING ERRCODE = '42501';
END;
$$;