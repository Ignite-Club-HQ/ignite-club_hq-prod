INSERT INTO public.app_settings (key, value, description)
VALUES (
  'legal_reacceptance',
  jsonb_build_object(
    'required', false,
    'version', null,
    'effective_at', null,
    'summary', null,
    'activated_by', null,
    'activated_at', null
  ),
  'Global force re-acceptance of Terms & Privacy Policy. Only app admins may change this via set_legal_reacceptance().'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_legal_reacceptance(
  _required boolean,
  _confirmation text DEFAULT NULL,
  _version text DEFAULT NULL,
  _summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _value jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'app_admin'::app_role, NULL::uuid, NULL::uuid) THEN
    RAISE EXCEPTION 'Only app admins can change legal re-acceptance';
  END IF;

  IF _required THEN
    IF _confirmation IS DISTINCT FROM 'REQUIRE ALL USERS TO REACCEPT' THEN
      RAISE EXCEPTION 'Confirmation phrase required to enable legal re-acceptance';
    END IF;
    IF _version IS NULL OR length(btrim(_version)) = 0 THEN
      RAISE EXCEPTION 'A version label is required to enable legal re-acceptance';
    END IF;
    _value := jsonb_build_object(
      'required', true,
      'version', btrim(_version),
      'effective_at', now(),
      'summary', nullif(btrim(coalesce(_summary, '')), ''),
      'activated_by', _uid,
      'activated_at', now()
    );
  ELSE
    _value := jsonb_build_object(
      'required', false,
      'version', null,
      'effective_at', null,
      'summary', null,
      'activated_by', null,
      'activated_at', now()
    );
  END IF;

  INSERT INTO public.app_settings (key, value, description)
  VALUES ('legal_reacceptance', _value, 'Global force re-acceptance of Terms & Privacy Policy.')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  INSERT INTO public.audit_logs (action_type, actor_id, details)
  VALUES (
    CASE WHEN _required THEN 'legal_reacceptance_enabled' ELSE 'legal_reacceptance_disabled' END,
    _uid,
    _value
  );

  RETURN _value;
END;
$$;

REVOKE ALL ON FUNCTION public.set_legal_reacceptance(boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_legal_reacceptance(boolean, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_current_legal_terms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.profiles
  SET terms_accepted_at = now(),
      privacy_accepted_at = now(),
      updated_at = now()
  WHERE id = _uid;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_current_legal_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_legal_terms() TO authenticated;