-- REVIEW / LOCAL REHEARSAL ONLY. Existing links/invites already implement tokens,
-- idempotent acceptance, claim triggers and policies. No duplicate schema or ACL sweep.
DO $$ BEGIN
 IF to_regclass('public.competition_role_links') IS NULL
   OR to_regprocedure('public.accept_competition_role_link(text)') IS NULL
   OR to_regprocedure('public.get_competition_role_link_status(text)') IS NULL THEN
   RAISE EXCEPTION 'Expected deployed official link contracts missing';
 END IF;
END; $$;
-- Anonymous status retained; acceptance's existing auth guard stays unchanged.
-- Broad default grants/anonymous execution hardening is a separate approval.