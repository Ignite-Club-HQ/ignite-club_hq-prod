-- Fix: Recalculate Riverside FC storage to match actual non-deleted files
UPDATE public.clubs 
SET storage_used_bytes = COALESCE((
  SELECT SUM(file_size) 
  FROM vault_files 
  WHERE club_id = '36231b76-5313-478e-b8d5-23ac4f5e8b10' 
  AND deleted_at IS NULL
), 0)
WHERE id = '36231b76-5313-478e-b8d5-23ac4f5e8b10';

-- Fix trigger to handle soft deletes (UPDATE setting deleted_at) and restores
CREATE OR REPLACE FUNCTION public.update_club_storage_on_file_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_file_size bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only count if not already soft-deleted
    IF NEW.deleted_at IS NULL AND NEW.club_id IS NOT NULL THEN
      v_file_size := COALESCE(NEW.file_size, 0);
      UPDATE public.clubs SET storage_used_bytes = storage_used_bytes + v_file_size WHERE id = NEW.club_id;
    END IF;
    RETURN NEW;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    -- Only subtract if it wasn't already soft-deleted
    IF OLD.deleted_at IS NULL AND OLD.club_id IS NOT NULL THEN
      v_file_size := COALESCE(OLD.file_size, 0);
      UPDATE public.clubs SET storage_used_bytes = GREATEST(0, storage_used_bytes - v_file_size) WHERE id = OLD.club_id;
    END IF;
    RETURN OLD;
  END IF;
  
  IF TG_OP = 'UPDATE' THEN
    v_file_size := COALESCE(NEW.file_size, OLD.file_size, 0);
    
    -- Soft delete: deleted_at changed from NULL to non-NULL → subtract
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.club_id IS NOT NULL THEN
      UPDATE public.clubs SET storage_used_bytes = GREATEST(0, storage_used_bytes - v_file_size) WHERE id = OLD.club_id;
    END IF;
    
    -- Restore: deleted_at changed from non-NULL to NULL → add back
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.club_id IS NOT NULL THEN
      UPDATE public.clubs SET storage_used_bytes = storage_used_bytes + v_file_size WHERE id = NEW.club_id;
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Recreate trigger to fire on INSERT, UPDATE, and DELETE
DROP TRIGGER IF EXISTS update_club_storage_on_file_change_trigger ON public.vault_files;
CREATE TRIGGER update_club_storage_on_file_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vault_files
  FOR EACH ROW
  EXECUTE FUNCTION public.update_club_storage_on_file_change();