-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anyone can read pending invites by token" ON public.pending_invites;