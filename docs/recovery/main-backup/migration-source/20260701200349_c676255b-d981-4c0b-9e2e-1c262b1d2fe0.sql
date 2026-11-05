-- Drop the duplicate index. Both indexes cover (group_id, created_at DESC)
-- identically; the planner only ever picks one, but every INSERT/UPDATE on
-- group_messages was paying to maintain both.
DROP INDEX IF EXISTS public.idx_group_messages_group_created;