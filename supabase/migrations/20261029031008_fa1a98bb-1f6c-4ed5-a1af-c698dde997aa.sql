-- DEV-only compatibility migration part 2 (ecsdwrarzfexssxtrymj). Sources: integration-hybrid 70d821c8
-- 20261014030000, 20261012000000 (+ final write lock-down 20261022092625 / 20261022042733), 20261012020000,
-- 20261010000000, 20261015185653. Corrections noted inline.

-- 0. Tighten part-1 internal helpers (not called directly by app code).
REVOKE EXECUTE ON FUNCTION public.can_manage_competition_vault(uuid), public.competition_scores_visible(uuid),
  public.history_scores_visible(uuid), public.can_read_history_row(uuid,uuid) FROM authenticated;

-- 1. Competition role email invites
CREATE TABLE public.competition_role_email_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 32 AND 128),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('referee','committee_member')),
  invited_email text NOT NULL,
  verification_code_hash text NOT NULL CHECK (verification_code_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','locked')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  accepted_user_id uuid,
  accepted_at timestamptz
);
CREATE INDEX competition_role_email_invites_manager_idx ON public.competition_role_email_invites (competition_id, created_at DESC);
REVOKE ALL ON public.competition_role_email_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.competition_role_email_invites TO authenticated;
GRANT ALL ON public.competition_role_email_invites TO service_role;
ALTER TABLE public.competition_role_email_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY competition_role_email_invites_select_manager ON public.competition_role_email_invites
  AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_competition_admin(auth.uid(), competition_id));

CREATE OR REPLACE FUNCTION public.create_competition_role_email_invite(_competition_id uuid, _role text, _token text, _email text, _verification_code_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user_id uuid := auth.uid(); v_email text := lower(btrim(COALESCE(_email,''))); v_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_competition_admin(v_user_id, _competition_id) THEN RAISE EXCEPTION 'Competition admin required'; END IF;
  IF _role IS NULL OR _role NOT IN ('referee','committee_member') THEN RAISE EXCEPTION 'Invalid official role'; END IF;
  IF _token IS NULL OR char_length(_token) NOT BETWEEN 32 AND 128 THEN RAISE EXCEPTION 'Invalid invitation token'; END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN RAISE EXCEPTION 'Invalid email address'; END IF;
  IF _verification_code_hash IS NULL OR _verification_code_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid verification code'; END IF;
  INSERT INTO public.competition_role_email_invites (token, competition_id, role, invited_email, verification_code_hash, created_by)
  VALUES (_token, _competition_id, _role, v_email, _verification_code_hash, v_user_id) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_competition_role_email_invite_status(p_token text)
RETURNS TABLE(status text, competition_id uuid, competition_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN c.id IS NULL OR invite.status IN ('revoked','locked') THEN 'invalid'
              WHEN invite.status = 'accepted' THEN 'used'
              WHEN invite.expires_at <= now() THEN 'expired'
              WHEN c.status = 'archived' THEN 'archived'
              ELSE 'valid' END,
         invite.competition_id, c.name, invite.role
  FROM public.competition_role_email_invites invite
  LEFT JOIN public.competitions c ON c.id = invite.competition_id
  WHERE invite.token = p_token
  UNION ALL
  SELECT 'invalid', NULL::uuid, NULL::text, NULL::text
  WHERE NOT EXISTS (SELECT 1 FROM public.competition_role_email_invites invite WHERE invite.token = p_token)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.accept_competition_role_email_invite(p_token text, p_verification_code_hash text)
RETURNS TABLE(status text, competition_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user_id uuid := auth.uid(); v_account_email text; v_email_confirmed_at timestamptz;
  v_invite public.competition_role_email_invites%ROWTYPE; v_name text; v_club_id uuid; v_db_role text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT lower(btrim(u.email)), u.email_confirmed_at INTO v_account_email, v_email_confirmed_at FROM auth.users u WHERE u.id = v_user_id;
  IF v_account_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RETURN QUERY SELECT 'email_unverified'::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  SELECT * INTO v_invite FROM public.competition_role_email_invites i WHERE i.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text; RETURN; END IF;
  IF v_invite.status = 'accepted' AND v_invite.accepted_user_id = v_user_id THEN
    RETURN QUERY SELECT 'already'::text, v_invite.competition_id, v_invite.role; RETURN;
  END IF;
  IF v_invite.status <> 'pending' OR v_invite.expires_at <= now() THEN
    RETURN QUERY SELECT 'invalid'::text, v_invite.competition_id, v_invite.role; RETURN;
  END IF;
  IF v_account_email <> lower(btrim(v_invite.invited_email)) OR p_verification_code_hash IS DISTINCT FROM v_invite.verification_code_hash THEN
    UPDATE public.competition_role_email_invites i
       SET attempts = i.attempts + 1, status = CASE WHEN i.attempts + 1 >= 5 THEN 'locked' ELSE i.status END
     WHERE i.id = v_invite.id;
    RETURN QUERY SELECT CASE WHEN v_invite.attempts + 1 >= 5 THEN 'locked' ELSE 'code_invalid' END, v_invite.competition_id, v_invite.role;
    RETURN;
  END IF;
  SELECT c.name, c.organizer_club_id INTO v_name, v_club_id FROM public.competitions c
   WHERE c.id = v_invite.competition_id AND c.status <> 'archived';
  IF NOT FOUND THEN RETURN QUERY SELECT 'archived'::text, v_invite.competition_id, v_invite.role; RETURN; END IF;
  -- Correction: DEV/hybrid competition_roles stores the committee role as 'committee'.
  v_db_role := CASE WHEN v_invite.role = 'committee_member' THEN 'committee' ELSE v_invite.role END;
  INSERT INTO public.competition_roles (competition_id, user_id, role)
  SELECT v_invite.competition_id, v_user_id, v_db_role
  WHERE NOT EXISTS (SELECT 1 FROM public.competition_roles cr
                    WHERE cr.competition_id = v_invite.competition_id AND cr.user_id = v_user_id AND cr.role = v_db_role);
  INSERT INTO public.notifications (user_id, type, message, related_id, club_id)
  VALUES (v_user_id, 'membership', 'You joined as a ' || replace(v_invite.role,'_',' ') || ' for ' || v_name, v_invite.competition_id, v_club_id);
  UPDATE public.competition_role_email_invites i SET status = 'accepted', accepted_user_id = v_user_id, accepted_at = now() WHERE i.id = v_invite.id;
  RETURN QUERY SELECT 'joined'::text, v_invite.competition_id, v_invite.role;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_competition_role_email_invite(_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.competition_role_email_invites SET status = 'revoked'
   WHERE token = _token AND status = 'pending' AND public.is_competition_admin(auth.uid(), competition_id);
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.create_competition_role_email_invite(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_competition_role_email_invite_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_competition_role_email_invite(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_competition_role_email_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_competition_role_email_invite(uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_role_email_invite_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_competition_role_email_invite(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_competition_role_email_invite(text) TO authenticated;

-- 2. Competition Vault access
CREATE OR REPLACE FUNCTION public.can_access_competition_vault(_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.competition_roles cr WHERE cr.competition_id = _competition_id AND cr.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.competitions c JOIN public.user_roles ur ON ur.club_id = c.organizer_club_id
               WHERE c.id = _competition_id AND ur.user_id = auth.uid() AND ur.role = 'club_admin')
    OR EXISTS (
      SELECT 1 FROM public.competition_entries e JOIN public.teams t ON t.id = e.team_id
      WHERE e.competition_id = _competition_id AND e.status IN ('accepted','registered')
        AND (
          EXISTS (SELECT 1 FROM public.team_memberships tm JOIN public.club_players cp ON cp.id = tm.club_player_id
                  WHERE tm.team_id = e.team_id AND tm.status = 'active' AND tm.removed_at IS NULL AND cp.is_active
                    AND (cp.profile_id = auth.uid()
                         OR EXISTS (SELECT 1 FROM public.children ch WHERE ch.id = cp.child_id AND ch.parent_id = auth.uid())
                         OR EXISTS (SELECT 1 FROM public.child_guardians cg WHERE cg.child_id = cp.child_id AND cg.guardian_id = auth.uid())))
          OR EXISTS (SELECT 1 FROM public.child_team_assignments cta JOIN public.children ch ON ch.id = cta.child_id
                     WHERE cta.team_id = e.team_id
                       AND (ch.parent_id = auth.uid() OR EXISTS (SELECT 1 FROM public.child_guardians cg WHERE cg.child_id = ch.id AND cg.guardian_id = auth.uid())))
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.team_id = e.team_id AND ur.role IN ('team_admin','coach'))
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.club_id = t.club_id AND ur.role = 'club_admin')))
  )
$$;

CREATE OR REPLACE FUNCTION public.competition_vault_storage_access(_object_name text, _manage boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_competition_id uuid; v_club_id uuid;
BEGIN
  IF _object_name IS NULL OR split_part(_object_name,'/',1) <> 'clubs' OR split_part(_object_name,'/',3) <> 'competitions'
     OR split_part(_object_name,'/',2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(_object_name,'/',4) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_club_id := split_part(_object_name,'/',2)::uuid;
  v_competition_id := split_part(_object_name,'/',4)::uuid;
  RETURN EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = v_competition_id AND c.organizer_club_id = v_club_id
                 AND CASE WHEN coalesce(_manage, true) THEN public.can_manage_competition_vault(c.id) ELSE public.can_access_competition_vault(c.id) END);
END $$;

REVOKE ALL ON FUNCTION public.can_access_competition_vault(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_vault_storage_access(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_competition_vault(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.competition_vault_storage_access(text,boolean) TO authenticated;

-- Storage policies for the private competition-vault bucket (path clubs/<club>/competitions/<competition>/...).
CREATE POLICY competition_vault_objects_select_grant ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'competition-vault' AND public.competition_vault_storage_access(name, false));
CREATE POLICY competition_vault_objects_delete_grant ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (bucket_id = 'competition-vault' AND public.competition_vault_storage_access(name, true));
CREATE POLICY competition_vault_objects_select ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'competition-vault' OR public.competition_vault_storage_access(name, false));
CREATE POLICY competition_vault_objects_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'competition-vault' OR public.competition_vault_storage_access(name, true));
-- Hybrid final state: client writes go through the measured upload service (service role) only.
CREATE POLICY competition_vault_writes_service_only ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id <> 'competition-vault');
CREATE POLICY competition_vault_updates_service_only ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'competition-vault') WITH CHECK (bucket_id <> 'competition-vault');
CREATE POLICY competition_vault_no_anon_read ON storage.objects AS RESTRICTIVE FOR SELECT TO anon
  USING (bucket_id <> 'competition-vault');

-- 3. Club invite message defaults
CREATE TABLE IF NOT EXISTS public.club_invite_message_defaults (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  message text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_invite_message_defaults TO authenticated;
GRANT ALL ON public.club_invite_message_defaults TO service_role;
ALTER TABLE public.club_invite_message_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "club members can view invite message default" ON public.club_invite_message_defaults FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id = club_invite_message_defaults.club_id AND ur.user_id = auth.uid()));
CREATE POLICY "club admins can upsert invite message default" ON public.club_invite_message_defaults FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id = club_invite_message_defaults.club_id AND ur.user_id = auth.uid() AND ur.role = 'club_admin'));
CREATE POLICY "club admins can update invite message default" ON public.club_invite_message_defaults FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id = club_invite_message_defaults.club_id AND ur.user_id = auth.uid() AND ur.role = 'club_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id = club_invite_message_defaults.club_id AND ur.user_id = auth.uid() AND ur.role = 'club_admin'));
CREATE POLICY "club admins can delete invite message default" ON public.club_invite_message_defaults FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.club_id = club_invite_message_defaults.club_id AND ur.user_id = auth.uid() AND ur.role = 'club_admin'));

-- 4. Welcome email settings (settings only; delivery tables/functions are not part of this approval)
CREATE TABLE public.welcome_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  subject text NOT NULL DEFAULT 'Welcome to your team',
  message text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welcome_email_settings_single_scope CHECK ((team_id IS NOT NULL) <> (competition_id IS NOT NULL)),
  CONSTRAINT welcome_email_settings_subject_length CHECK (char_length(subject) BETWEEN 1 AND 160),
  CONSTRAINT welcome_email_settings_message_length CHECK (char_length(message) <= 4000)
);
CREATE UNIQUE INDEX welcome_email_settings_team_unique ON public.welcome_email_settings(team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX welcome_email_settings_competition_unique ON public.welcome_email_settings(competition_id) WHERE competition_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON public.welcome_email_settings TO authenticated;
GRANT ALL ON public.welcome_email_settings TO service_role;
ALTER TABLE public.welcome_email_settings ENABLE ROW LEVEL SECURITY;
-- Correction: hybrid passed (team_id, auth.uid()) to can_manage_team_roster(_user_id, _team_id).
CREATE POLICY welcome_email_settings_team_read ON public.welcome_email_settings FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND public.can_manage_team_roster(auth.uid(), team_id));
CREATE POLICY welcome_email_settings_team_insert ON public.welcome_email_settings FOR INSERT TO authenticated
  WITH CHECK (team_id IS NOT NULL AND public.can_manage_team_roster(auth.uid(), team_id));
CREATE POLICY welcome_email_settings_team_update ON public.welcome_email_settings FOR UPDATE TO authenticated
  USING (team_id IS NOT NULL AND public.can_manage_team_roster(auth.uid(), team_id))
  WITH CHECK (team_id IS NOT NULL AND public.can_manage_team_roster(auth.uid(), team_id));
CREATE POLICY welcome_email_settings_competition_read ON public.welcome_email_settings FOR SELECT TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));
CREATE POLICY welcome_email_settings_competition_insert ON public.welcome_email_settings FOR INSERT TO authenticated
  WITH CHECK (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));
CREATE POLICY welcome_email_settings_competition_update ON public.welcome_email_settings FOR UPDATE TO authenticated
  USING (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id))
  WITH CHECK (competition_id IS NOT NULL AND public.is_competition_admin(auth.uid(), competition_id));
CREATE TRIGGER update_welcome_email_settings_updated_at BEFORE UPDATE ON public.welcome_email_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Canister memory reports (app admins only)
CREATE TABLE public.canister_memory_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis jsonb,
  created_by uuid
);
GRANT SELECT, INSERT ON public.canister_memory_reports TO authenticated;
GRANT ALL ON public.canister_memory_reports TO service_role;
ALTER TABLE public.canister_memory_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "App admins read memory reports" ON public.canister_memory_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));
CREATE POLICY "App admins add manual readings" ON public.canister_memory_reports FOR INSERT TO authenticated
  WITH CHECK (source = 'manual' AND created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'app_admin'));