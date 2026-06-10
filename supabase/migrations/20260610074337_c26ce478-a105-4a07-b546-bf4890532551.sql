CREATE OR REPLACE FUNCTION public.debug_log_child_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RAISE LOG 'children-insert-debug: auth_uid=%, jwt_role=%, current_user=%, parent_id=%, name=%',
    COALESCE(auth.uid()::text, 'NULL'),
    COALESCE(current_setting('request.jwt.claims', true), 'NULL'),
    current_user,
    COALESCE(NEW.parent_id::text, 'NULL'),
    NEW.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS debug_log_child_insert_trigger ON public.children;
CREATE TRIGGER debug_log_child_insert_trigger
BEFORE INSERT ON public.children
FOR EACH ROW EXECUTE FUNCTION public.debug_log_child_insert();