CREATE TABLE public.competition_role_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_name text,
  role text NOT NULL,
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  accepted_user_id uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competition_role_invites_role_chk CHECK (role IN ('referee','committee')),
  CONSTRAINT competition_role_invites_status_chk CHECK (status IN ('pending','accepted','cancelled'))
);
CREATE UNIQUE INDEX competition_role_invites_pending_uq
  ON public.competition_role_invites (competition_id, lower(email), role) WHERE status = 'pending';

GRANT SELECT, DELETE ON public.competition_role_invites TO authenticated;
GRANT ALL ON public.competition_role_invites TO service_role;
ALTER TABLE public.competition_role_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Competition admins view role invites" ON public.competition_role_invites
FOR SELECT TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));
CREATE POLICY "Competition admins cancel role invites" ON public.competition_role_invites
FOR DELETE TO authenticated USING (public.is_competition_admin((SELECT auth.uid()), competition_id));

CREATE TRIGGER competition_role_invites_updated_at BEFORE UPDATE ON public.competition_role_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Invite (or directly add, if the email already has an account)
CREATE OR REPLACE FUNCTION public.invite_competition_official(
  p_competition_id uuid, p_email text, p_name text, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_user uuid;
  v_comp record;
BEGIN
  IF v_me IS NULL OR NOT public.is_competition_admin(v_me, p_competition_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('referee','committee') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' THEN RAISE EXCEPTION 'invalid_email'; END IF;

  SELECT id, name, organizer_club_id INTO v_comp FROM public.competitions WHERE id = p_competition_id;

  SELECT au.id INTO v_user FROM auth.users au WHERE lower(au.email) = v_email LIMIT 1;

  IF v_user IS NOT NULL THEN
    INSERT INTO public.competition_roles (competition_id, user_id, role)
    SELECT p_competition_id, v_user, p_role
    WHERE NOT EXISTS (SELECT 1 FROM public.competition_roles
      WHERE competition_id = p_competition_id AND user_id = v_user AND role = p_role);
    INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
    VALUES (v_user, 'membership',
      'You have been added as a ' || CASE p_role WHEN 'referee' THEN 'referee' ELSE 'committee member' END
        || ' for ' || v_comp.name, p_competition_id, v_comp.organizer_club_id);
    RETURN jsonb_build_object('status','added','user_id',v_user);
  END IF;

  INSERT INTO public.competition_role_invites (competition_id, email, invited_name, role, invited_by)
  VALUES (p_competition_id, v_email, nullif(btrim(p_name),''), p_role, v_me)
  ON CONFLICT (competition_id, lower(email), role) WHERE status = 'pending'
  DO UPDATE SET invited_name = EXCLUDED.invited_name, invited_by = EXCLUDED.invited_by, updated_at = now();
  RETURN jsonb_build_object('status','invited');
END $$;
REVOKE ALL ON FUNCTION public.invite_competition_official(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_competition_official(uuid,text,text,text) TO authenticated;

-- On sign-up, grant any pending referee/committee invites for that email
CREATE OR REPLACE FUNCTION public.claim_competition_role_invites_on_profile_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text; inv record;
BEGIN
  SELECT lower(btrim(email)) INTO v_email FROM auth.users WHERE id = NEW.id;
  IF v_email IS NULL THEN RETURN NEW; END IF;
  FOR inv IN SELECT * FROM public.competition_role_invites
             WHERE status = 'pending' AND lower(email) = v_email LOOP
    BEGIN
      INSERT INTO public.competition_roles (competition_id, user_id, role)
      SELECT inv.competition_id, NEW.id, inv.role
      WHERE NOT EXISTS (SELECT 1 FROM public.competition_roles
        WHERE competition_id = inv.competition_id AND user_id = NEW.id AND role = inv.role);
      UPDATE public.competition_role_invites
        SET status = 'accepted', accepted_user_id = NEW.id, accepted_at = now()
        WHERE id = inv.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'claim_competition_role_invites: % (%)', inv.id::text, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.claim_competition_role_invites_on_profile_create() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER claim_competition_role_invites_on_profile_create_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.claim_competition_role_invites_on_profile_create();