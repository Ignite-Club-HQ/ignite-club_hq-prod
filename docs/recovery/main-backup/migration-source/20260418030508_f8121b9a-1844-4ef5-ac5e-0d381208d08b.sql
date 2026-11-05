-- Fix club creation RLS: also allow the creator to view their newly-created club
-- The current INSERT policy only checks auth.uid() IS NOT NULL, which is fine,
-- but the .select() returned after INSERT requires a SELECT policy match.
-- Newly created clubs are not yet on the marketplace and creator is not yet a member,
-- so the SELECT-back fails silently OR (in some PostgREST modes) the whole insert fails.

-- 1. Tighten the INSERT policy to require created_by = auth.uid() (best practice)
DROP POLICY IF EXISTS "Authenticated users can create clubs" ON public.clubs;

CREATE POLICY "Authenticated users can create clubs"
ON public.clubs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND (created_by = auth.uid() OR created_by IS NULL));

-- 2. Add a SELECT policy so the creator can read back their just-created club
-- (needed for .select().single() after INSERT, and before they're a member)
CREATE POLICY "Creators can view their clubs"
ON public.clubs
FOR SELECT
TO authenticated
USING (created_by = auth.uid());