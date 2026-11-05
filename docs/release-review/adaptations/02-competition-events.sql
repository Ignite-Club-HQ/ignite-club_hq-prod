-- REVIEW / LOCAL REHEARSAL ONLY. Add idempotent overload; keep legacy RPC intact.
-- Private operation journal is eligibility/replay state, not a target migration ledger.
CREATE TABLE public.competition_event_operations (
 id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES public.competitions(id),
 requested_by uuid NOT NULL, request_fingerprint text NOT NULL,
 result_count integer NOT NULL DEFAULT 0 CHECK(result_count >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.competition_event_operations TO service_role;
REVOKE ALL ON public.competition_event_operations FROM PUBLIC,anon,authenticated;
ALTER TABLE public.competition_event_operations ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.create_competition_event(
 p_operation_id uuid,p_competition_id uuid,p_title text,p_event_type public.event_type,
 p_starts_at timestamptz,p_ends_at timestamptz,p_location text DEFAULT NULL,p_description text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); fingerprint text; inserted integer; prior public.competition_event_operations; queued integer;
BEGIN
 IF actor IS NULL OR public.can_create_competition_event(actor,p_competition_id) IS NOT TRUE THEN
   RAISE EXCEPTION 'Competition management forbidden' USING ERRCODE='42501';
 END IF;
 IF p_operation_id IS NULL OR p_title IS NULL OR btrim(p_title)='' OR length(p_title)>200
    OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at<=p_starts_at
    OR length(p_location)>256 OR length(p_description)>2000 THEN
   RAISE EXCEPTION 'Invalid competition event' USING ERRCODE='22023';
 END IF;
 -- Epoch is timezone-independent; preserve payload distinctions, including NULL.
 fingerprint:=jsonb_build_array(p_competition_id,p_title,p_event_type,
   extract(epoch FROM p_starts_at),extract(epoch FROM p_ends_at),p_location,p_description)::text;
 INSERT INTO public.competition_event_operations(id,competition_id,requested_by,request_fingerprint)
 VALUES(p_operation_id,p_competition_id,actor,fingerprint) ON CONFLICT(id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=0 THEN
   SELECT * INTO prior FROM public.competition_event_operations WHERE id=p_operation_id FOR UPDATE;
   IF NOT FOUND OR prior.competition_id IS DISTINCT FROM p_competition_id OR prior.requested_by IS DISTINCT FROM actor
     OR prior.request_fingerprint IS DISTINCT FROM fingerprint THEN
     RAISE EXCEPTION 'Operation id already used' USING ERRCODE='22023';
   END IF;
   RETURN prior.result_count;
 END IF;
 -- Delegate once to deployed canonical event/audience/notification implementation.
 queued:=public.create_competition_event(p_competition_id,p_title,p_event_type,p_starts_at,p_location,p_description,p_ends_at);
 IF queued IS NULL OR queued<0 THEN RAISE EXCEPTION 'Invalid legacy queued count'; END IF;
 UPDATE public.competition_event_operations SET result_count=queued WHERE id=p_operation_id;
 RETURN queued;
END; $$;
REVOKE ALL ON FUNCTION public.create_competition_event(uuid,uuid,text,public.event_type,timestamptz,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_competition_event(uuid,uuid,text,public.event_type,timestamptz,timestamptz,text,text) TO authenticated,service_role;