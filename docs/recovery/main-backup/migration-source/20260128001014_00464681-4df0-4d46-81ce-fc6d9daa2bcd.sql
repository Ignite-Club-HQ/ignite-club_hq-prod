-- Add mini_league_id column to role_requests table for league join requests
ALTER TABLE public.role_requests
ADD COLUMN mini_league_id uuid REFERENCES public.mini_leagues(id) ON DELETE CASCADE;

-- Add index for efficient lookups
CREATE INDEX idx_role_requests_mini_league_id ON public.role_requests(mini_league_id) WHERE mini_league_id IS NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.role_requests.mini_league_id IS 'Reference to mini_league for league join requests';