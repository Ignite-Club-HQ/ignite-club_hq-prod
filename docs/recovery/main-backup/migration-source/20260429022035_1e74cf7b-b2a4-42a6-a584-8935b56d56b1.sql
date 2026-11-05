REVOKE ALL ON FUNCTION public.on_role_request_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.on_role_request_created() FROM anon;
REVOKE ALL ON FUNCTION public.on_role_request_created() FROM authenticated;

REVOKE ALL ON FUNCTION public.on_role_request_processed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.on_role_request_processed() FROM anon;
REVOKE ALL ON FUNCTION public.on_role_request_processed() FROM authenticated;